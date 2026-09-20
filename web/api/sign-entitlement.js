// Operator imza ucu.
//
// Entitlement (bakiye belgesi) operatorun Ed25519 anahtariyla imzalanir;
// ESP32 bu imzayi, firmware'ine gomulu operator acik anahtariyla dogrular.
//
// Gizli anahtar YALNIZCA burada, sunucu tarafinda. Tarayiciya hicbir zaman
// inmez. Yerel gelistirmede ayni handler Vite middleware'i olarak calisir
// (bkz. vite.config.ts), uretimde Vercel serverless fonksiyonu olarak.

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { Address, BASE_FEE, Contract, StrKey, TransactionBuilder, rpc, scValToNative } from '@stellar/stellar-sdk';
import { DEPLOYMENT, PROFILES, isProfile } from '../shared/deployment.js';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ENT_DOMAIN = Buffer.from('OFFGATE-ENT-v1', 'ascii');
const ENT_MSG_LEN = 138;
const ID_LEN = 16;

/** Stellar S... gizli anahtarindan ham 32 baytlik Ed25519 tohumunu cikarir. */
function seedFromStellarSecret(secret) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of secret.replace(/=+$/, '')) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('gecersiz Stellar gizli anahtari');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  // [0] surum bayti, [1..32] tohum, son 2 bayt CRC.
  return Buffer.from(out.slice(1, 33));
}

function padId(text, len = ID_LEN) {
  const b = Buffer.alloc(len);
  const src = Buffer.from(String(text), 'ascii');
  if (src.length > len) throw new Error(`kimlik ${len} bayttan uzun: ${text}`);
  src.copy(b);
  return b;
}

const u64be = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(Number(n)); return b; };

/** Kanonik entitlement baytlari — docs/test-vector.md ile birebir ayni. */
export function entitlementBytes(e) {
  const out = Buffer.concat([
    ENT_DOMAIN,
    Buffer.from(e.userRaw, 'hex'),
    Buffer.from(e.devicePk, 'hex'),
    padId(e.event),
    padId(e.gate),
    u64be(e.fareTry),
    u64be(e.rate),
    u32be(e.maxUses),
    u64be(e.expires),
  ]);
  if (out.length !== ENT_MSG_LEN) {
    throw new Error(`entitlement ${out.length} bayt, ${ENT_MSG_LEN} olmaliydi`);
  }
  return out;
}

// --- Zincir dogrulamasi ----------------------------------------------------

// Varsayilanlar tarayicidakiyle AYNI dosyadan gelir; ikisi ayri yerde
// tanimli olsaydi sozlesme yeniden dagitildiginda birbirinden kopabilirlerdi.
const RPC_URL = process.env.VITE_RPC_URL ?? DEPLOYMENT.rpcUrl;
const NETWORK_PASSPHRASE = process.env.VITE_NETWORK_PASSPHRASE ?? DEPLOYMENT.networkPassphrase;
const READ_ACCOUNT = process.env.VITE_READ_ACCOUNT ?? DEPLOYMENT.readAccount;

/**
 * Istemci hangi profilde oldugunu soyler; biz yalnizca ADINI kabul ediyoruz.
 * Sozlesme adresi bizim tablomuzdan geliyor, istemciden degil — aksi halde
 * kullanici kendi sozlesmesini gosterip istedigi bileti imzalatabilirdi.
 *
 * Profil secimi bir yetki degil, yalnizca hangi dagitima bakilacagi.
 * Her iki profilde de imza zincirdeki kilide karsi dogrulaniyor (karar K-9).
 */
function contractFor(profile) {
  if (process.env.VITE_CONTRACT_ID) return process.env.VITE_CONTRACT_ID;
  return isProfile(profile) ? PROFILES[profile].contractId : DEPLOYMENT.contractId;
}

/** En fazla 48 saatlik bilet imzalariz. */
const MAX_TTL_SECONDS = 48 * 3600;

/** Kullanicinin zincirdeki kilidini okur. Imzasiz, ucretsiz simulasyon. */
async function readAccountFromChain(user, contractId) {
  const server = new rpc.Server(RPC_URL);
  const source = await server.getAccount(READ_ACCOUNT);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call('account_of', new Address(user).toScVal()))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`zincir okunamadi: ${sim.error}`);
  }
  if (!sim.result?.retval) throw new Error('zincirde bu cuzdana ait kilit yok');
  return scValToNative(sim.result.retval);
}

const hex = (v) => Buffer.from(v).toString('hex');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });

  const secret = process.env.OPERATOR_SECRET;
  if (!secret) return res.status(500).json({ error: 'OPERATOR_SECRET tanimli degil' });

  try {
    const body = req.body ?? {};
    for (const k of ['user', 'expires']) {
      if (body[k] === undefined) return res.status(400).json({ error: `${k} eksik` });
    }
    if (!StrKey.isValidEd25519PublicKey(body.user)) {
      return res.status(400).json({ error: 'gecersiz cuzdan adresi' });
    }

    // Bilet suresi: gecmise ya da cok ileriye imza atmayiz.
    const expires = Number(body.expires);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(expires) || expires <= now || expires > now + MAX_TTL_SECONDS) {
      return res.status(400).json({ error: 'gecersiz bilet suresi' });
    }

    // --- Tek guven kaynagi: zincir ---------------------------------------
    //
    // Istemcinin gonderdigi hicbir bakiye/gecis sayisi degerine bakmiyoruz.
    // Entitlement'i ZINCIRDEKI kilitten yeniden kuruyoruz: kapi, ucret, kur
    // ve cihaz anahtari `lock_float`in yazdigi degerler; gecis hakki da
    // kilitli bakiyenin gercekten karsiladigi kadar.
    //
    // Son adim kritik: urettigimiz ozet, zincirdeki `ent_hash` ile birebir
    // tutmali. Kullanici tarayicida gecis hakkini sisirirse ozet tutmaz ve
    // imza hic verilmez — kapi imzasiz bileti kabul etmez.
    const acct = await readAccountFromChain(body.user, contractFor(body.profile));

    // Gecis hakki da zincirden: `ent_uses`, yururlukteki biletin kontrat
    // tarafindan hesaplanmis hakki. `top_up` bunu, acikta kalan imzali
    // haklari dusurerek belirliyor (bkz. `grant_for`).
    const maxUses = Number(acct.ent_uses);
    if (!Number.isInteger(maxUses) || maxUses < 1) {
      return res.status(400).json({ error: 'kilitli bakiye bir gecise bile yetmiyor' });
    }

    const ent = {
      userRaw: hex(StrKey.decodeEd25519PublicKey(body.user)),
      devicePk: hex(acct.device_pk),
      event: acct.event,
      gate: acct.gate,
      fareTry: acct.fare_try,
      rate: acct.rate,
      maxUses,
      expires,
    };

    const bytes = entitlementBytes(ent);
    const entHash = createHash('sha256').update(bytes).digest('hex');
    if (entHash !== hex(acct.ent_hash)) {
      return res.status(409).json({
        error: 'bilet zincirdeki kilitle uyusmuyor — kilitlenen tutarin '
          + 'verdiginden fazla gecis hakki istenmis olabilir',
      });
    }

    const key = createPrivateKey({
      key: Buffer.concat([PKCS8_PREFIX, seedFromStellarSecret(secret)]),
      format: 'der',
      type: 'pkcs8',
    });

    return res.status(200).json({
      ent_hash: entHash,
      max_uses: maxUses,
      operator_sig: sign(null, bytes, key).toString('hex'),
      operator_pk: createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'),
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// Operator imza ucu.
//
// Entitlement (bakiye belgesi) operatorun Ed25519 anahtariyla imzalanir;
// ESP32 bu imzayi, firmware'ine gomulu operator acik anahtariyla dogrular.
//
// Gizli anahtar YALNIZCA burada, sunucu tarafinda. Tarayiciya hicbir zaman
// inmez. Yerel gelistirmede ayni handler Vite middleware'i olarak calisir
// (bkz. vite.config.ts), uretimde Vercel serverless fonksiyonu olarak.

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });

  const secret = process.env.OPERATOR_SECRET;
  if (!secret) return res.status(500).json({ error: 'OPERATOR_SECRET tanimli degil' });

  try {
    const ent = req.body ?? {};
    for (const k of ['userRaw', 'devicePk', 'event', 'gate', 'fareTry', 'rate', 'maxUses', 'expires']) {
      if (ent[k] === undefined) return res.status(400).json({ error: `${k} eksik` });
    }

    const bytes = entitlementBytes(ent);
    const key = createPrivateKey({
      key: Buffer.concat([PKCS8_PREFIX, seedFromStellarSecret(secret)]),
      format: 'der',
      type: 'pkcs8',
    });

    return res.status(200).json({
      ent_hash: createHash('sha256').update(bytes).digest('hex'),
      operator_sig: sign(null, bytes, key).toString('hex'),
      operator_pk: createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'),
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

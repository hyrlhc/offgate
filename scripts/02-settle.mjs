#!/usr/bin/env node
// P9 — gorevli senkronizasyonu.
//
// Kapidan toplanan fisleri ceker, sozlesmeye yazar, kapinin kendi
// beyanini da kaydeder. Fisler self-authenticating oldugu icin kaynak
// onemli degil: canli kapi, kaydedilmis dosya ya da baska bir aktarim.
//
// Kullanim:
//   node scripts/02-settle.mjs                       # varsayilan kapi adresi
//   node scripts/02-settle.mjs --from http://192.168.4.1
//   node scripts/02-settle.mjs --from /tmp/receipts.json
//   node scripts/02-settle.mjs --dry-run             # sadece dogrula, yazma

import { readFileSync } from 'node:fs';
import { Address, BASE_FEE, Keypair, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr }
  from '@stellar/stellar-sdk';
import { ACCOUNTS, CONTRACT_ID, NETWORK_PASSPHRASE, RPC_URL } from './lib/env.mjs';
import { receiptMessage, verifyBytes } from './lib/receipts.mjs';
import { fail, header, info, link, ok, step, warn } from './lib/log.mjs';
import { expertTx } from './lib/stellar.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const has = (n) => process.argv.includes(`--${n}`);

const source = arg('from', 'http://192.168.4.1');
const dryRun = has('dry-run');
const server = new rpc.Server(RPC_URL);
const admin = Keypair.fromSecret(ACCOUNTS.admin.secret);

header('OffGate — gorevli senkronizasyonu (P9)');

// --- 1. Fisleri topla ------------------------------------------------------
step('Kapidan fisleri cek');
let payload;
if (source.startsWith('http')) {
  const res = await fetch(`${source}/receipts`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Kapi ${res.status} dondu`);
  payload = await res.json();
  info(`kaynak: ${source}/receipts`);
} else {
  payload = JSON.parse(readFileSync(source, 'utf8'));
  info(`kaynak: ${source} (dosya)`);
}
const { gate, counter = 0, receipts = [] } = payload;
if (!gate) throw new Error('Yanitta kapi kimligi yok');
ok(`kapi ${gate} · beyan ${counter} gecis · ${receipts.length} fis`);
if (receipts.length === 0) {
  warn('Gonderilecek fis yok.');
  process.exit(0);
}

// --- 2. Zincire yazmadan once yerel dogrulama ------------------------------
// Gecersiz imza sozlesmede batch'i durdurur; burada eleyip sebebini gosteriyoruz.
step('Fisleri yerel dogrula');
const devicePkCache = new Map();
async function devicePkOf(user) {
  if (!devicePkCache.has(user)) {
    const acct = await readContract('account_of', [new Address(user).toScVal()]);
    devicePkCache.set(user, Buffer.from(acct.device_pk, 'hex'));
  }
  return devicePkCache.get(user);
}

const good = [];
for (const r of receipts) {
  if (!r?.user) { fail(`seq ${r?.seq}: kullanici adresi yok`); continue; }
  let pk;
  try {
    pk = await devicePkOf(r.user);
  } catch {
    fail(`seq ${r.seq}: ${r.user.slice(0, 8)}… icin zincirde hesap yok`);
    continue;
  }
  const msg = receiptMessage({
    entHash: Buffer.from(r.ent_hash, 'hex'), seq: r.seq,
    fareTry: Number(r.fare_try), ts: r.ts,
  });
  if (!verifyBytes(pk, msg, Buffer.from(r.sig, 'hex'))) {
    fail(`seq ${r.seq}: imza gecersiz — batch'e alinmiyor`);
    continue;
  }
  good.push(r);
}
ok(`${good.length}/${receipts.length} fis gecerli`);
if (good.length === 0) process.exit(1);

if (dryRun) {
  header('KURU CALISMA — zincire hicbir sey yazilmadi');
  process.exit(0);
}

// --- 3. Zincire yaz --------------------------------------------------------
step('settle — fisleri zincire yaz');
const receiptsArg = xdr.ScVal.scvVec(good.map((r) => nativeToScVal({
  ent_hash: Buffer.from(r.ent_hash, 'hex'),
  user: new Address(r.user),
  seq: r.seq,
  fare_try: BigInt(r.fare_try),
  ts: BigInt(r.ts),
  sig: Buffer.from(r.sig, 'hex'),
}, {
  type: {
    ent_hash: ['symbol', null], user: ['symbol', null], seq: ['symbol', 'u32'],
    fare_try: ['symbol', 'i128'], ts: ['symbol', 'u64'], sig: ['symbol', null],
  },
})));

const settled = await invoke('settle', [symbolArg(gate), receiptsArg]);
ok(`${settled.value} fis kabul edildi`);
link('islem', expertTx(settled.hash));

// --- 4. Kapinin beyanini kaydet -------------------------------------------
step('gate_report — kapinin beyani');
const reported = await invoke('gate_report', [symbolArg(gate), u32Arg(counter)]);
ok(`kapi ${counter} gecis beyan etti`);
link('islem', expertTx(reported.hash));

// --- 5. Denetim ------------------------------------------------------------
step('Denetim');
const [declared, onchain, revenue] = await readContract('stats', [symbolArg('EVT1')]);
info(`beyan   : ${declared}`);
info(`zincirde: ${onchain}`);
info(`hasilat : ${(Number(revenue) / 1e7).toFixed(7)} USDC`);
if (declared === onchain) ok('Beyan ile zincir tutuyor.');
else fail(`FARK VAR: ${declared - onchain} gecis zincire dusmemis.`);

header('P9 TAMAM');
console.log(`  ${settled.value} fis zincire yazildi, hasilat operatore gecti.\n`);

// --- Yardimcilar -----------------------------------------------------------

function symbolArg(s) { return nativeToScVal(s, { type: 'symbol' }); }
function u32Arg(n) { return nativeToScVal(n, { type: 'u32' }); }

async function readContract(method, args) {
  const account = await server.getAccount(admin.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new (await import('@stellar/stellar-sdk')).Contract(CONTRACT_ID).call(method, ...args))
    .setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error}`);
  return scValToNative(sim.result.retval);
}

async function invoke(method, args) {
  const { Contract } = await import('@stellar/stellar-sdk');
  const account = await server.getAccount(admin.publicKey());
  const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(CONTRACT_ID).call(method, ...args))
    .setTimeout(120).build();
  const prepared = await server.prepareTransaction(built);
  prepared.sign(admin);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`${method}: ${JSON.stringify(sent.errorResult)}`);
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const got = await server.getTransaction(sent.hash);
    if (got.status === 'SUCCESS') {
      return { hash: sent.hash, value: got.returnValue ? scValToNative(got.returnValue) : null };
    }
    if (got.status === 'FAILED') throw new Error(`${method} basarisiz: ${sent.hash}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${method} zaman asimi: ${sent.hash}`);
}

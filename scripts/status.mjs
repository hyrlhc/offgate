#!/usr/bin/env node
// Demo panosu — her sey tek ekranda.
//
// Prova sirasinda "neredeyiz" sorusunun tek cevabi. Juriye de
// gosterilebilir: butun sayilar zincirden ve anchor'dan canli okunuyor.
//
// Kullanim: node scripts/status.mjs [--gate http://192.168.4.1]

import {
  Address, BASE_FEE, Contract, Keypair, TransactionBuilder,
  nativeToScVal, rpc, scValToNative,
} from '@stellar/stellar-sdk';
import {
  ACCOUNTS, ANCHOR_HOME_DOMAIN, CONTRACT_ID, DEMO, NETWORK_PASSPHRASE, RPC_URL, USDC_CODE, USDC_SAC,
} from './lib/env.mjs';
import { usdcBalance } from './lib/stellar.mjs';
import { header, info, link, ok, step, warn } from './lib/log.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const gateUrl = arg('gate', 'http://192.168.4.1');

const server = new rpc.Server(RPC_URL);
const admin = Keypair.fromSecret(ACCOUNTS.admin.secret);

async function read(method, args, contract = CONTRACT_ID) {
  const account = await server.getAccount(admin.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contract).call(method, ...args))
    .setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error}`);
  return scValToNative(sim.result.retval);
}

const sym = (s) => nativeToScVal(s, { type: 'symbol' });
const addr = (a) => new Address(a).toScVal();
const usdc = (n) => `${(Number(n) / 1e7).toFixed(7)} ${USDC_CODE}`;

header(`OffGate — durum panosu   (etkinlik ${DEMO.eventId})`);

// --- Anchor ---
step('Anchor');
try {
  const h = await (await fetch(`https://${ANCHOR_HOME_DOMAIN}/health`, { signal: AbortSignal.timeout(8000) })).json();
  ok(`${ANCHOR_HOME_DOMAIN} ayakta`);
  info(`kur     : 1 ${USDC_CODE} = ${h.rates.sell_rate} TRY (satis) · kaynak ${h.rates.source}`);
  // Anchor limitleri artik `null` donduruyor; beyan edilmeyince uydurmuyoruz.
  const lim = h.limits ?? {};
  info(lim.min_onramp_try != null
    ? `limitler: ${lim.min_onramp_try}–${lim.max_onramp_try} TRY · offramp min ${lim.min_offramp_usdc}`
    : 'limitler: anchor beyan etmiyor — istemci belgelenmis 50–3000 TRY uyguluyor');
  info(`hazine  : ${h.treasury.usdc_balance} ${USDC_CODE}`);
} catch (e) {
  warn(`anchor okunamadi: ${e.message}`);
}

// --- Sozlesme ---
step('Sozlesme');
info(CONTRACT_ID);
link('gezgin', `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`);
const gates = await read('gates_of', [sym(DEMO.eventId)]);
ok(`${gates.length} kapi kayitli: ${gates.join(', ')}`);
info(`siradaki atama: ${await read('assign_gate', [sym(DEMO.eventId)])}`);

// --- Denetim ---
step('Denetim');
console.log('  kapi     yuk   beyan  zincir   fark');
for (const g of gates) {
  const [load, declared, settled] = await Promise.all([
    read('gate_load', [sym(g)]), read('declared_of', [sym(g)]), read('settled_of', [sym(g)]),
  ]);
  const diff = declared - settled;
  console.log(`  ${g.padEnd(8)} ${String(load).padStart(3)}   ${String(declared).padStart(5)}  ${String(settled).padStart(6)}   ${diff === 0 ? '  0 ✓' : String(diff).padStart(4)}`);
}
const [declared, settled, revenue] = await read('stats', [sym(DEMO.eventId)]);
info(`toplam  : beyan ${declared} · zincir ${settled} · hasilat ${usdc(revenue)}`);
// Farkin YONU iki ayri sey anlatiyor; ayni cumleyle gecistirilemez.
//   beyan > zincir : kapi bu kadar gecis gordugunu soyluyor ama o fisler
//                    zincire hic ulasmamis — hasilat eksik beyan edilmis
//                    olabilir, denetimin yakalamak istedigi durum budur.
//   zincir > beyan : fisler zincirde ama kapinin imzali sayac beyani henuz
//                    tasinmamis. Kayip yok, yalnizca beyan geride.
if (declared === settled) ok('Beyan ile zincir tutuyor.');
else if (declared > settled) {
  warn(`FARK: kapi ${declared - settled} gecis beyan etti ama o fisler zincirde yok.`);
} else {
  info(`Beyan geride: zincirde ${settled - declared} gecis fazla var — kapinin imzali`);
  info('sayac beyani henuz tasinmamis (gate_report). Hasilat kaybi degil.');
}

// --- Paralar ---
step('Bakiyeler');
info(`kontratta kilitli : ${await read('balance', [addr(CONTRACT_ID)], USDC_SAC).then(usdc)}`);
info(`operator          : ${await usdcBalance(ACCOUNTS.operator.public) ?? '(trustline yok)'} ${USDC_CODE}`);

// --- Kapi ---
step('Kapi donanimi');
try {
  const h = await (await fetch(`${gateUrl}/health`, { signal: AbortSignal.timeout(4000) })).json();
  ok(`${gateUrl} yanit veriyor`);
  info(`kapi ${h.gate} · sayac ${h.counter} · ${h.receipts} fis bekliyor · ${h.uptime}sn acik`);
  if (h.receipts > 0) info(`senkronize etmek icin: node scripts/02-settle.mjs --from ${gateUrl}`);
} catch {
  warn(`${gateUrl} erisilemiyor — bu makine kapinin wifi agina bagli degil.`);
  info('Kapiya bagli bir cihazdan:  curl -s http://192.168.4.1/receipts > receipts.json');
  info('Sonra buradan            :  node scripts/02-settle.mjs --from receipts.json');
}

console.log();

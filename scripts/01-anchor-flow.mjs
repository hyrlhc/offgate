#!/usr/bin/env node
// P2 — Anchor akisi: TRY -> USDC, ucdan uca.
//
// SEP-1 kesif -> SEP-10 auth -> SEP-38 kilitli kur -> SEP-6 deposit-exchange
// -> banka simulasyonu -> durum takibi -> zincirde dogrulama.
//
// Hicbir endpoint kodda sabit degil; hepsi stellar.toml'dan kesfediliyor.

import { Keypair } from '@stellar/stellar-sdk';
import { ACCOUNTS, ANCHOR_HOME_DOMAIN, DEMO, USDC_CODE } from './lib/env.mjs';
import {
  depositExchange, depositPlain, discover, makeSession,
  requestQuote, simulateBankTransfer, waitForCompletion,
} from './lib/anchor.mjs';
import { expertAccount, expertTx, usdcBalance } from './lib/stellar.mjs';
import { fail, header, info, link, ok, step, warn } from './lib/log.mjs';

const AMOUNT_TRY = DEMO.depositTry;
const kp = Keypair.fromSecret(ACCOUNTS.user.secret);

header(`OffGate — anchor akisi (P2)   ${AMOUNT_TRY} TRY -> ${USDC_CODE}`);
info(`kullanici: ${kp.publicKey()}`);

// --- 1. SEP-1: kesif -------------------------------------------------------
step('SEP-1 — stellar.toml kesfi');
const endpoints = await discover(ANCHOR_HOME_DOMAIN);
ok(`${ANCHOR_HOME_DOMAIN} cozuldu`);
info(`auth      ${endpoints.webAuth}`);
info(`transfer  ${endpoints.transferServer}`);
info(`quote     ${endpoints.quoteServer}`);
info(`issuer    ${endpoints.issuer}`);

// --- 2. SEP-10: cuzdan ile giris ------------------------------------------
step('SEP-10 — cuzdan dogrulamasi');
const session = makeSession({ endpoints, keypair: kp, homeDomain: ANCHOR_HOME_DOMAIN });
await session.ensure();
ok('JWT alindi — sifre yok, kimlik kaniti cuzdan imzasi');
info(`token: ${session.token.slice(0, 24)}…`);

// --- 3. SEP-38: kilitli kur ------------------------------------------------
step('SEP-38 — kur kilitleme');
const quote = await requestQuote(session, endpoints, AMOUNT_TRY);
ok(`1 ${USDC_CODE} = ${quote.price} TRY  (quote ${quote.id.slice(0, 8)}…)`);
info(`${AMOUNT_TRY} TRY -> ${quote.buy_amount} ${USDC_CODE}`);
info(`gecerlilik: ${quote.expires_at}`);
info('Bu kur kontrata yazilacak — biletin TL fiyati bu andan itibaren sabit.');

// --- 4. SEP-6: yatirma emri ------------------------------------------------
step('SEP-6 — deposit-exchange (kilitli quote ile)');
let deposit;
try {
  deposit = await depositExchange(session, endpoints, {
    account: kp.publicKey(), quoteId: quote.id, amountTry: AMOUNT_TRY,
  });
  ok('deposit-exchange emri olusturuldu — kur kilitli');
} catch (e) {
  warn(`deposit-exchange basarisiz: ${e.message}`);
  warn('Duz SEP-6 deposit ile devam ediliyor (kur kilitli degil).');
  deposit = await depositPlain(session, endpoints, {
    account: kp.publicKey(), amountTry: AMOUNT_TRY,
  });
  ok('deposit emri olusturuldu');
}
const txId = deposit.id;
info(`emir no: ${txId}`);
const how = deposit.instructions ?? deposit.how;
if (how) {
  info('banka talimati:');
  console.log(
    typeof how === 'string'
      ? `      ${how}`
      : Object.entries(how).map(([k, v]) => `      ${k}: ${v?.value ?? v}`).join('\n'),
  );
  info('Kullanici EFT aciklamasina bu referansi yazar; anchor odemeyi hesapla eslestirir.');
}
if (deposit.more_info_url) link('more_info', deposit.more_info_url);

// --- 5. Banka simulasyonu (SADECE mock anchor) -----------------------------
step('Banka transferi — simulasyon');
warn('simulate-bank-transfer yalnizca mock anchor\'da vardir. Gercekte kullanici EFT yapar.');
await simulateBankTransfer(session, endpoints, txId, AMOUNT_TRY);
ok(`${AMOUNT_TRY} TRY yatti olarak isaretlendi`);

// --- 6. Durum takibi -------------------------------------------------------
step('SEP-6 — islem durumu');
const finalTx = await waitForCompletion(session, endpoints, txId, {
  onTick: (t) => info(`durum: ${t.status}`),
});
ok('completed');
if (finalTx.amount_out) info(`cikan: ${finalTx.amount_out} ${USDC_CODE}`);
if (finalTx.amount_fee) info(`ucret: ${finalTx.amount_fee}`);
if (finalTx.stellar_transaction_id) link('zincir islemi', expertTx(finalTx.stellar_transaction_id));

// --- 7. Zincirde dogrulama -------------------------------------------------
step('Zincirde dogrulama');
const bal = await usdcBalance(kp.publicKey());
if (bal === null) {
  fail('Hesapta USDC trustline yok.');
  process.exit(1);
}
if (Number(bal) <= 0) {
  fail(`USDC bakiyesi ${bal} — para gelmemis.`);
  process.exit(1);
}
ok(`kullanici hesabinda ${bal} ${USDC_CODE}`);
link('hesap', expertAccount(kp.publicKey()));

header('P2 KABUL KANITI');
console.log(`  bu islem:     ${AMOUNT_TRY} TRY  ->  ${finalTx.amount_out ?? '?'} ${USDC_CODE}`);
console.log(`  hesap toplam: ${bal} ${USDC_CODE}`);
console.log(`  kilitli kur: 1 ${USDC_CODE} = ${quote.price} TRY`);
console.log(`  anchor emir no: ${txId}`);
console.log(`  ${expertAccount(kp.publicKey())}\n`);

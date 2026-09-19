#!/usr/bin/env node
// P9 — operator hasilati TL'ye cikarir (SEP-6 withdraw).
//
// Zincirde biriken USDC anchor'a gonderilir, anchor TRY oder.
// MEMO ZORUNLU: eksikse anchor odemeyi hangi talebe ait oldugunu
// eslestiremez ve para kaybolmus gibi gorunur.
//
// Kullanim: node scripts/03-withdraw.mjs [--amount 10]

import { BASE_FEE, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { ACCOUNTS, ANCHOR_HOME_DOMAIN, NETWORK_PASSPHRASE, USDC_CODE } from './lib/env.mjs';
import { discover, getTransaction, makeSession, waitForCompletion, withdraw } from './lib/anchor.mjs';
import { expertTx, horizon, USDC, usdcBalance } from './lib/stellar.mjs';
import { fail, header, info, link, ok, step, warn } from './lib/log.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};

const kp = Keypair.fromSecret(ACCOUNTS.operator.secret);
header('OffGate — operator TL cikisi (SEP-6 withdraw)');

step('Operator bakiyesi');
const balance = await usdcBalance(kp.publicKey());
if (balance === null) throw new Error('Operator hesabinda USDC trustline yok');
info(`${balance} ${USDC_CODE}`);

// Anchor'in offramp tabani 1 USDC. Varsayilan: bakiyenin tamami.
const amount = arg('amount', Number(balance).toFixed(7));
if (Number(amount) < 1) {
  fail(`Cekilecek tutar ${amount} USDC — anchor tabani 1.0000000 USDC.`);
  process.exit(1);
}
info(`cekilecek: ${amount} ${USDC_CODE}`);

step('SEP-10 — operator dogrulamasi');
const endpoints = await discover(ANCHOR_HOME_DOMAIN);
const session = makeSession({ endpoints, keypair: kp, homeDomain: ANCHOR_HOME_DOMAIN });
await session.ensure();
ok('JWT alindi');

step('SEP-6 withdraw talebi');
const w = await withdraw(session, endpoints, { amountUsdc: amount });
ok(`talep olusturuldu: ${w.id}`);
info(`hedef : ${w.account_id}`);
info(`memo  : ${w.memo} (${w.memo_type})`);
if (!w.memo) {
  fail('Anchor memo dondurmedi — odeme eslestirilemez, durduruluyor.');
  process.exit(1);
}
warn('Memo olmadan gonderilen odeme kaybolmus gibi gorunur.');

step('USDC odemesi');
const account = await horizon.loadAccount(kp.publicKey());
const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
  .addOperation(Operation.payment({ destination: w.account_id, asset: USDC, amount: String(amount) }))
  .addMemo(w.memo_type === 'hash' ? Memo.hash(w.memo) : Memo.id(String(w.memo)))
  .setTimeout(120)
  .build();
tx.sign(kp);
const sent = await horizon.submitTransaction(tx);
ok(`${amount} ${USDC_CODE} anchor'a gonderildi`);
link('islem', expertTx(sent.hash));

step('TL odemesi bekleniyor');
const done = await waitForCompletion(session, endpoints, w.id, {
  onTick: (t) => info(`durum: ${t.status}`),
});
ok('completed — TRY odendi');
const detail = await getTransaction(session, endpoints, w.id);
if (detail.transaction?.amount_out) info(`odenen: ${detail.transaction.amount_out} TRY`);

step('Kalan bakiye');
info(`${await usdcBalance(kp.publicKey())} ${USDC_CODE}`);

header('P9 TAMAM — hasilat TL olarak operatorun hesabinda');
console.log(`  talep ${w.id}\n  ${done.amount_out ?? amount} cikti\n`);

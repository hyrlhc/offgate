#!/usr/bin/env node
// P1 — hesap hazirligi. Idempotent: tekrar calistirmak zararsiz.
import { Keypair } from '@stellar/stellar-sdk';
import { ACCOUNTS, USDC_CODE } from './lib/env.mjs';
import { balances, ensureTrustline, expertAccount, expertTx } from './lib/stellar.mjs';
import { header, info, link, ok, step } from './lib/log.mjs';

header('OffGate — hesap hazirligi (P1)');

for (const role of ['user', 'operator']) {
  step(`${role} hesabi`);
  const { secret, public: pub } = ACCOUNTS[role];
  if (Keypair.fromSecret(secret).publicKey() !== pub) {
    throw new Error(`.env tutarsiz: ${role.toUpperCase()}_SECRET, ${role.toUpperCase()}_PUBLIC ile eslesmiyor`);
  }
  info(pub);
  const r = await ensureTrustline(secret);
  if (r.created) {
    ok(`${USDC_CODE} trustline acildi`);
    link('tx', expertTx(r.hash));
  } else {
    ok(`${USDC_CODE} trustline zaten var`);
  }
  const b = await balances(pub);
  info(`bakiye: XLM ${b.XLM} · ${USDC_CODE} ${b[USDC_CODE] ?? '(yok)'}`);
  link('hesap', expertAccount(pub));
}

console.log('\nHazir.\n');

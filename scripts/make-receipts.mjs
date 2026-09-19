#!/usr/bin/env node
// Entitlement uretir, hash'ini hesaplar ve fis defterini imzalar.
//
// P7'de bu mantik web uygulamasina tasinacak; burada sozlesmeyi elle
// dogrulamak ve test vektorunu uretmek icin duruyor.
//
// Kullanim:
//   node scripts/make-receipts.mjs --gate M307 [--uses 5] [--out /tmp/book.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { StrKey } from '@stellar/stellar-sdk';
import { ACCOUNTS, DEMO } from './lib/env.mjs';
import {
  buildReceiptBook, entitlementHash, privateKeyFromSeed, rawPublicKey,
} from './lib/receipts.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const gate = arg('gate');
if (!gate) throw new Error('--gate zorunlu (once assign_gate cagir)');

const maxUses = Number(arg('uses', DEMO.maxUses));
const rate = Number(arg('rate', 487_850_780));
const expires = Number(arg('expires', Math.floor(Date.now() / 1000) + 86_400));
const out = arg('out', '/tmp/offgate-book.json');

const device = JSON.parse(readFileSync('.devkey.json', 'utf8'));
const deviceKey = privateKeyFromSeed(Buffer.from(device.seed, 'hex'));
const devicePk = rawPublicKey(deviceKey);

const entitlement = {
  userRaw: Buffer.from(StrKey.decodeEd25519PublicKey(ACCOUNTS.user.public)),
  devicePk,
  event: DEMO.eventId,
  gate,
  fareTry: DEMO.fareTryKurus,
  rate,
  maxUses,
  expires,
};

const entHash = entitlementHash(entitlement);
const receipts = buildReceiptBook(deviceKey, {
  entHash,
  fareTry: entitlement.fareTry,
  maxUses,
});

// Sozlesmenin `settle` fonksiyonunun bekledigi bicim.
const forContract = receipts.map((r) => ({
  ent_hash: r.ent_hash,
  user: ACCOUNTS.user.public,
  seq: r.seq,
  fare_try: r.fare_try,
  ts: r.ts,
  sig: r.sig,
}));

writeFileSync(
  out,
  JSON.stringify(
    {
      gate,
      ent_hash: entHash.toString('hex'),
      device_pk: devicePk.toString('hex'),
      fare_try: entitlement.fareTry,
      rate,
      max_uses: maxUses,
      expires,
      receipts: forContract,
    },
    null,
    2,
  ),
);

console.log(`kapi       : ${gate}`);
console.log(`ent_hash   : ${entHash.toString('hex')}`);
console.log(`device_pk  : ${devicePk.toString('hex')}`);
console.log(`fis sayisi : ${forContract.length}`);
console.log(`yazildi    : ${out}`);

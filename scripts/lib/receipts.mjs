// OffGate kanonik imza formatlari (karar K-4).
//
// Bu dosyadaki bayt duzeni, Soroban sozlesmesindeki `receipt_message` ve
// ESP32 firmware'indeki karsiligi ile BIREBIR AYNI olmak zorundadir.
// Uc platformda da ayni baytlar uretildigi icin dogrulama tasima
// katmanindan bagimsizdir (karar K-8): ayni fis wifi, QR, BLE veya NFC
// uzerinden gelebilir, dogrulama degismez.
//
// Referans vektor: docs/test-vector.md

import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export const ENT_DOMAIN = Buffer.from('OFFGATE-ENT-v1', 'ascii');   // 14 bayt
export const RCPT_DOMAIN = Buffer.from('OFFGATE-RCPT-v1', 'ascii'); // 15 bayt
export const ENT_MSG_LEN = 138;
export const RCPT_MSG_LEN = 67;

const ID_LEN = 16; // etkinlik ve kapi kimlikleri sabit 16 bayta dolguluyor

// --- Ed25519 anahtar donusumleri -------------------------------------------
// Node ham 32 baytlik anahtarlari dogrudan kabul etmiyor; DER sarmalayicilari.
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function privateKeyFromSeed(seed32) {
  const raw = Buffer.from(seed32);
  if (raw.length !== 32) throw new Error('cihaz gizli anahtari 32 bayt olmali');
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

export function publicKeyFromRaw(pub32) {
  const raw = Buffer.from(pub32);
  if (raw.length !== 32) throw new Error('acik anahtar 32 bayt olmali');
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

/** Ham 32 baytlik acik anahtari gizli anahtardan turetir. */
export function rawPublicKey(privateKeyObject) {
  return createPublicKey(privateKeyObject)
    .export({ type: 'spki', format: 'der' })
    .subarray(-32);
}

// --- Kanonik baytlar -------------------------------------------------------

function padId(text, len = ID_LEN) {
  const b = Buffer.alloc(len); // sifirla dolu
  const src = Buffer.from(String(text), 'ascii');
  if (src.length > len) throw new Error(`kimlik ${len} bayttan uzun olamaz: ${text}`);
  src.copy(b);
  return b;
}

function u64be(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(Number(n));
  return b;
}

/**
 * Entitlement (bakiye belgesi) kanonik baytlari — 138 bayt.
 * Operator bu baytlari imzalar; ESP32 operatorun acik anahtariyla dogrular.
 *
 *   "OFFGATE-ENT-v1" (14) || user_raw (32) || device_pk (32)
 *   || event (16) || gate (16) || fare_try (8) || rate (8)
 *   || max_uses (4) || expires (8)
 */
export function entitlementBytes(ent) {
  const out = Buffer.concat([
    ENT_DOMAIN,
    Buffer.from(ent.userRaw),
    Buffer.from(ent.devicePk),
    padId(ent.event),
    padId(ent.gate),
    u64be(ent.fareTry),
    u64be(ent.rate),
    u32be(ent.maxUses),
    u64be(ent.expires),
  ]);
  if (out.length !== ENT_MSG_LEN) {
    throw new Error(`entitlement ${out.length} bayt, ${ENT_MSG_LEN} olmaliydi`);
  }
  return out;
}

/** Entitlement'in sha256'si. Fisler bu hash uzerinden bilete baglanir. */
export function entitlementHash(ent) {
  return createHash('sha256').update(entitlementBytes(ent)).digest();
}

/**
 * Fisin imzalanan kanonik baytlari — 67 bayt.
 *
 *   "OFFGATE-RCPT-v1" (15) || ent_hash (32) || seq (4) || fare_try (8) || ts (8)
 *
 * Kapi kimligi burada YOK: `ent_hash` zaten kapiyi baglar. Bu sayede
 * sozlesme tarafinda Symbol -> bayt donusumune ihtiyac kalmiyor.
 */
export function receiptMessage({ entHash, seq, fareTry, ts }) {
  const out = Buffer.concat([RCPT_DOMAIN, Buffer.from(entHash), u32be(seq), u64be(fareTry), u64be(ts)]);
  if (out.length !== RCPT_MSG_LEN) {
    throw new Error(`fis mesaji ${out.length} bayt, ${RCPT_MSG_LEN} olmaliydi`);
  }
  return out;
}

// --- Imzalama ve dogrulama -------------------------------------------------

export function signBytes(privateKeyObject, message) {
  return sign(null, message, privateKeyObject); // Ed25519 hashsiz imzalar
}

export function verifyBytes(rawPub, message, signature) {
  return verify(null, message, publicKeyFromRaw(rawPub), Buffer.from(signature));
}

export function signReceipt(deviceKey, { entHash, seq, fareTry, ts }) {
  const msg = receiptMessage({ entHash, seq, fareTry, ts });
  return {
    ent_hash: Buffer.from(entHash).toString('hex'),
    seq,
    fare_try: String(fareTry),
    ts,
    sig: signBytes(deviceKey, msg).toString('hex'),
  };
}

/**
 * Fis defteri: kullanici daha ONLINE iken tum gecisleri imzalar (karar K-2).
 * Kapida tarayici hic kripto yapmaz, sadece siradaki fisi gonderir.
 */
export function buildReceiptBook(deviceKey, { entHash, fareTry, maxUses, ts = nowSeconds() }) {
  const receipts = [];
  for (let seq = 1; seq <= maxUses; seq += 1) {
    receipts.push(signReceipt(deviceKey, { entHash, seq, fareTry, ts }));
  }
  return receipts;
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

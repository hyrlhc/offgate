// Kanonik imza formatlari — docs/test-vector.md ile birebir ayni.
//
// Bu dosyadaki bayt duzeni Soroban sozlesmesindeki `receipt_message` ve
// ESP32 firmware'indeki karsiligi ile ayni olmak zorundadir (karar K-4).
// `cargo test -p offgate canonical` bu uyumu derleme zamaninda zorluyor.

// Not: @noble/hashes v2 exports haritasi uzantili yol istiyor ('./sha2.js').
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { getPublicKey, hashes, sign, verify } from '@noble/ed25519';

// noble/ed25519 v3 senkron API icin sha512 saglayicisini bekliyor.
// WebCrypto'ya bel baglamiyoruz: kapi sayfasi http uzerinden servis edilir
// ve orada crypto.subtle yoktur.
hashes.sha512 = sha512;

export const ENT_DOMAIN = new TextEncoder().encode('OFFGATE-ENT-v1'); // 14
export const RCPT_DOMAIN = new TextEncoder().encode('OFFGATE-RCPT-v1'); // 15
export const ENT_MSG_LEN = 138;
export const RCPT_MSG_LEN = 67;
const ID_LEN = 16;

export const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export const fromHex = (h: string) => {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};

function concat(...parts: Uint8Array[]) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function padId(text: string, len = ID_LEN) {
  const src = new TextEncoder().encode(text);
  if (src.length > len) throw new Error(`kimlik ${len} bayttan uzun olamaz: ${text}`);
  const out = new Uint8Array(len); // sifirla dolu
  out.set(src);
  return out;
}

function u64be(n: number | bigint) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n));
  return out;
}

function u32be(n: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

export type Entitlement = {
  userRaw: Uint8Array;
  devicePk: Uint8Array;
  event: string;
  gate: string;
  fareTry: number;
  rate: number;
  maxUses: number;
  expires: number;
};

/** Entitlement kanonik baytlari — 138 bayt. Operator imzalar. */
export function entitlementBytes(e: Entitlement) {
  const out = concat(
    ENT_DOMAIN,
    e.userRaw,
    e.devicePk,
    padId(e.event),
    padId(e.gate),
    u64be(e.fareTry),
    u64be(e.rate),
    u32be(e.maxUses),
    u64be(e.expires),
  );
  if (out.length !== ENT_MSG_LEN) {
    throw new Error(`entitlement ${out.length} bayt, ${ENT_MSG_LEN} olmaliydi`);
  }
  return out;
}

export const entitlementHash = (e: Entitlement) => sha256(entitlementBytes(e));

/**
 * Fisin imzalanan kanonik baytlari — 67 bayt.
 * Kapi kimligi burada YOK: `entHash` zaten kapiyi bagliyor.
 */
export function receiptMessage(entHash: Uint8Array, seq: number, fareTry: number, ts: number) {
  const out = concat(RCPT_DOMAIN, entHash, u32be(seq), u64be(fareTry), u64be(ts));
  if (out.length !== RCPT_MSG_LEN) {
    throw new Error(`fis mesaji ${out.length} bayt, ${RCPT_MSG_LEN} olmaliydi`);
  }
  return out;
}

export type SignedReceipt = {
  ent_hash: string;
  user: string;
  seq: number;
  fare_try: string;
  ts: number;
  sig: string;
};

/**
 * Fis defteri: kullanici daha ONLINE iken tum geciseleri imzalar (karar K-2).
 * Kapida tarayici hic kripto yapmaz, sadece siradaki fisi gonderir.
 */
export function buildReceiptBook(
  deviceSeed: Uint8Array,
  opts: { entHash: Uint8Array; user: string; fareTry: number; maxUses: number; ts?: number },
): SignedReceipt[] {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const entHex = toHex(opts.entHash);
  const book: SignedReceipt[] = [];
  for (let seq = 1; seq <= opts.maxUses; seq += 1) {
    const msg = receiptMessage(opts.entHash, seq, opts.fareTry, ts);
    book.push({
      ent_hash: entHex,
      user: opts.user,
      seq,
      fare_try: String(opts.fareTry),
      ts,
      sig: toHex(sign(msg, deviceSeed)),
    });
  }
  return book;
}

export function verifyReceipt(devicePk: Uint8Array, r: SignedReceipt) {
  const msg = receiptMessage(fromHex(r.ent_hash), r.seq, Number(r.fare_try), r.ts);
  return verify(fromHex(r.sig), msg, devicePk);
}

// --- Cihaz anahtari (karar K-1) --------------------------------------------
// Tarayicida uretilir, yalnizca localStorage'da durur, cuzdana hic dokunmaz.

const DEVICE_KEY_STORAGE = 'offgate.device.seed';

export function loadOrCreateDeviceKey() {
  let hex = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (!hex) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    hex = toHex(seed);
    localStorage.setItem(DEVICE_KEY_STORAGE, hex);
  }
  const seed = fromHex(hex);
  return { seed, publicKey: getPublicKey(seed) };
}

export function resetDeviceKey() {
  localStorage.removeItem(DEVICE_KEY_STORAGE);
}

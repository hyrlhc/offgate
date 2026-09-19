// OffGate kapi cekirdegi — kanonik format ve imza dogrulama.
//
// Bu dosyadaki bayt duzeni Soroban sozlesmesindeki `receipt_message` ve
// web uygulamasindaki `src/lib/receipts.ts` ile BIREBIR AYNI olmak
// zorundadir (karar K-4). Referans: docs/test-vector.md
//
// Kapinin icinde hicbir gizli anahtar yoktur. Yalnizca operatorun ACIK
// anahtari gomuludur; cihaz sokulse bile sahte bilet uretilemez.

#pragma once
#include <Arduino.h>
#include <Ed25519.h>
#include "mbedtls/sha256.h"

static const char ENT_DOMAIN[] = "OFFGATE-ENT-v1";   // 14 bayt
static const char RCPT_DOMAIN[] = "OFFGATE-RCPT-v1"; // 15 bayt
static const size_t ENT_MSG_LEN = 138;
static const size_t RCPT_MSG_LEN = 67;
static const size_t ID_LEN = 16;

struct Entitlement {
  uint8_t user_raw[32];
  uint8_t device_pk[32];
  char event[ID_LEN + 1];
  char gate[ID_LEN + 1];
  uint64_t fare_try;
  uint64_t rate;
  uint32_t max_uses;
  uint64_t expires;
};

struct Receipt {
  uint8_t ent_hash[32];
  uint32_t seq;
  uint64_t fare_try;
  uint64_t ts;
  uint8_t sig[64];
};

// --- Bayt yardimcilari -----------------------------------------------------

inline void put_u32be(uint8_t *out, uint32_t v) {
  out[0] = v >> 24; out[1] = v >> 16; out[2] = v >> 8; out[3] = v;
}

inline void put_u64be(uint8_t *out, uint64_t v) {
  for (int i = 0; i < 8; i++) out[i] = (uint8_t)(v >> (56 - 8 * i));
}

/** Sabit uzunlukta, sagdan sifirla dolgulu ASCII kimlik. */
inline void put_id(uint8_t *out, const char *text, size_t len = ID_LEN) {
  memset(out, 0, len);
  size_t n = strnlen(text, len);
  memcpy(out, text, n);
}

/** "a1b2..." -> bayt. Basarisizlikta false. */
inline bool hex_to_bytes(const char *hex, uint8_t *out, size_t out_len) {
  if (!hex || strlen(hex) != out_len * 2) return false;
  for (size_t i = 0; i < out_len; i++) {
    char buf[3] = { hex[i * 2], hex[i * 2 + 1], 0 };
    char *end = nullptr;
    long v = strtol(buf, &end, 16);
    if (end != buf + 2) return false;
    out[i] = (uint8_t)v;
  }
  return true;
}

inline void bytes_to_hex(const uint8_t *in, size_t len, char *out) {
  static const char *D = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    out[i * 2] = D[in[i] >> 4];
    out[i * 2 + 1] = D[in[i] & 0x0f];
  }
  out[len * 2] = 0;
}

inline void sha256(const uint8_t *data, size_t len, uint8_t out[32]) {
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0); // 0 = SHA-256
  mbedtls_sha256_update(&ctx, data, len);
  mbedtls_sha256_finish(&ctx, out);
  mbedtls_sha256_free(&ctx);
}

// --- Kanonik mesajlar ------------------------------------------------------

/**
 * Entitlement kanonik baytlari — 138 bayt.
 *   "OFFGATE-ENT-v1"(14) || user_raw(32) || device_pk(32) || event(16)
 *   || gate(16) || fare_try(8) || rate(8) || max_uses(4) || expires(8)
 */
inline void entitlement_bytes(const Entitlement &e, uint8_t out[ENT_MSG_LEN]) {
  uint8_t *p = out;
  memcpy(p, ENT_DOMAIN, 14);           p += 14;
  memcpy(p, e.user_raw, 32);           p += 32;
  memcpy(p, e.device_pk, 32);          p += 32;
  put_id(p, e.event);                  p += ID_LEN;
  put_id(p, e.gate);                   p += ID_LEN;
  put_u64be(p, e.fare_try);            p += 8;
  put_u64be(p, e.rate);                p += 8;
  put_u32be(p, e.max_uses);            p += 4;
  put_u64be(p, e.expires);             p += 8;
}

/**
 * Fisin imzalanan kanonik baytlari — 67 bayt.
 *   "OFFGATE-RCPT-v1"(15) || ent_hash(32) || seq(4) || fare_try(8) || ts(8)
 *
 * Kapi kimligi burada YOK: ent_hash zaten kapiyi bagliyor.
 */
inline void receipt_bytes(const Receipt &r, uint8_t out[RCPT_MSG_LEN]) {
  uint8_t *p = out;
  memcpy(p, RCPT_DOMAIN, 15);          p += 15;
  memcpy(p, r.ent_hash, 32);           p += 32;
  put_u32be(p, r.seq);                 p += 4;
  put_u64be(p, r.fare_try);            p += 8;
  put_u64be(p, r.ts);                  p += 8;
}

// --- Dogrulama -------------------------------------------------------------

/** Entitlement operatorun acik anahtariyla imzalanmis mi. */
inline bool verify_entitlement(const Entitlement &e, const uint8_t sig[64],
                               const uint8_t operator_pk[32], uint8_t ent_hash_out[32]) {
  uint8_t msg[ENT_MSG_LEN];
  entitlement_bytes(e, msg);
  sha256(msg, ENT_MSG_LEN, ent_hash_out);
  return Ed25519::verify(sig, operator_pk, msg, ENT_MSG_LEN);
}

/** Fis, entitlement'in icindeki cihaz anahtariyla imzalanmis mi. */
inline bool verify_receipt(const Receipt &r, const uint8_t device_pk[32]) {
  uint8_t msg[RCPT_MSG_LEN];
  receipt_bytes(r, msg);
  return Ed25519::verify(r.sig, device_pk, msg, RCPT_MSG_LEN);
}

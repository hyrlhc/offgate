// Acilista calisan format kaniti.
//
// docs/test-vector.md'deki sabit degerlere karsi dogrular. Bu test gecmezse
// kapi, sozlesme ve web uygulamasiyla ayni dili konusmuyor demektir —
// seri porta HATA basar ve sebebi hemen gorulur.
//
// Ayni vektor Rust tarafinda `canonical_message_matches_javascript_vector`
// testiyle de zorlaniyor (karar K-4 / K-8).

#pragma once
#include "offgate.h"

static const char TV_RCPT_MSG[] =
  "4f4646474154452d524350542d7631"
  "abababababababababababababababababababababababababababababababab"
  "00000001" "0000000000002710" "000000006553f101";

static const char TV_DEVICE_PK[] =
  "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737";

static const char TV_RCPT_SIG[] =
  "5e7623fbf168a4cff62a98b524e8cd2c36855fb2107d231b674d6bfdd44f14ae"
  "16e70d6e62cf551df1dad4f2b491e33775b7982c0c841e08bd7bc412dcec750c";

static const char TV_ENT_HASH[] =
  "55488c4e49e7a58c1dbd37044579e5c7d0f72297ed35550426529549d92f299e";

static const char TV_OPERATOR_PK[] =
  "97c21f9d3372d5b3a624cc2a7ba9f0c1e0e1e6b1a2a5f0a1b2c3d4e5f6a7b8c9"; // acilista uretilir

/** Testte kullanilan operator acik anahtari, tohumdan turetilemedigi icin
 *  imzayi dogrulamak yerine ent_hash ve mesaj baytlarini karsilastiriyoruz;
 *  operator imzasi zaten sahadaki gercek anahtarla sinanir. */
static const char TV_ENT_BYTES[] =
  "4f4646474154452d454e542d7631"
  "3333333333333333333333333333333333333333333333333333333333333333"
  "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737"
  "4556543100000000000000000000" "0000"
  "4d333037000000000000000000000000"
  "0000000000002710" "000000001d14031c" "00000005" "000000006b49d200";

inline bool offgate_selftest() {
  bool ok = true;
  char hex[2 * ENT_MSG_LEN + 1];

  // 1. Fis kanonik baytlari birebir tutuyor mu?
  Receipt r{};
  memset(r.ent_hash, 0xAB, 32);
  r.seq = 1;
  r.fare_try = 10000;
  r.ts = 1700000001ULL;
  uint8_t msg[RCPT_MSG_LEN];
  receipt_bytes(r, msg);
  bytes_to_hex(msg, RCPT_MSG_LEN, hex);
  if (strcmp(hex, TV_RCPT_MSG) != 0) {
    Serial.println("  ✗ fis mesaji test vektorune uymuyor");
    Serial.printf("    beklenen: %s\n    uretilen: %s\n", TV_RCPT_MSG, hex);
    ok = false;
  } else {
    Serial.println("  ✓ fis kanonik baytlari (67) dogru");
  }

  // 2. Bilinen imza, bilinen anahtarla dogrulaniyor mu?
  uint8_t pk[32], sig[64];
  hex_to_bytes(TV_DEVICE_PK, pk, 32);
  hex_to_bytes(TV_RCPT_SIG, sig, 64);
  memcpy(r.sig, sig, 64);
  uint32_t t0 = millis();
  bool sig_ok = verify_receipt(r, pk);
  uint32_t dt = millis() - t0;
  if (!sig_ok) {
    Serial.println("  ✗ Ed25519 dogrulamasi basarisiz");
    ok = false;
  } else {
    Serial.printf("  ✓ Ed25519 dogrulamasi gecti (%u ms)\n", dt);
  }

  // 3. Bozulmus imza reddediliyor mu?
  r.sig[0] ^= 0x01;
  if (verify_receipt(r, pk)) {
    Serial.println("  ✗ bozuk imza kabul edildi — tehlikeli");
    ok = false;
  } else {
    Serial.println("  ✓ bozuk imza reddedildi");
  }

  // 4. Entitlement baytlari ve hash'i tutuyor mu?
  Entitlement e{};
  memset(e.user_raw, 0x33, 32);
  hex_to_bytes(TV_DEVICE_PK, e.device_pk, 32);
  strlcpy(e.event, "EVT1", sizeof(e.event));
  strlcpy(e.gate, "M307", sizeof(e.gate));
  e.fare_try = 10000;
  e.rate = 487850780ULL;
  e.max_uses = 5;
  e.expires = 1800000000ULL;

  uint8_t ent_msg[ENT_MSG_LEN];
  entitlement_bytes(e, ent_msg);
  bytes_to_hex(ent_msg, ENT_MSG_LEN, hex);
  if (strcmp(hex, TV_ENT_BYTES) != 0) {
    Serial.println("  ✗ entitlement baytlari test vektorune uymuyor");
    Serial.printf("    beklenen: %s\n    uretilen: %s\n", TV_ENT_BYTES, hex);
    ok = false;
  } else {
    Serial.println("  ✓ entitlement kanonik baytlari (138) dogru");
  }

  uint8_t h[32];
  char hhex[65];
  sha256(ent_msg, ENT_MSG_LEN, h);
  bytes_to_hex(h, 32, hhex);
  if (strcmp(hhex, TV_ENT_HASH) != 0) {
    Serial.printf("  ✗ ent_hash uyusmuyor: %s\n", hhex);
    ok = false;
  } else {
    Serial.println("  ✓ SHA-256 ent_hash dogru");
  }

  return ok;
}

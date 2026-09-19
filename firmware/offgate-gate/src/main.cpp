// OffGate — kapi firmware'i.
//
// Sorumlulugu dort sey: kendi wifi agini kurmak, iki imzayi dogrulamak,
// ayni fisin ikinci kez kullanilmasini engellemek, fisleri saklamak.
//
// Icinde HICBIR GIZLI ANAHTAR YOK. Yalnizca operatorun acik anahtari
// gomulu; cihaz sokulup okunsa bile sahte bilet uretilemez.
//
// Internet gerekmez. Dogrulama tamamen yerel: Ed25519 imza + NVS'teki
// harcanmis fis kaydi.

#include <Arduino.h>
#include <WiFi.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "offgate.h"
#include "pages.h"
#include "selftest.h"

// --- Yapilandirma ----------------------------------------------------------

// Bu kapinin kimligi derleme bayragiyla gelir (platformio.ini).
// Ayni firmware, farkli kapilara farkli kimlikle yuklenir.
#ifndef OFFGATE_GATE_ID
#define OFFGATE_GATE_ID "M307"
#endif
static const char GATE_ID[] = OFFGATE_GATE_ID;
static const char AP_SSID[] = "OFFGATE-" OFFGATE_GATE_ID;

// Operatorun ham Ed25519 ACIK anahtari (gizli degil).
// docs/DEPLOYMENTS.md icindeki OPERATOR_PK_HEX ile ayni olmali.
static const uint8_t OPERATOR_PK[32] = {
  0xd0,0x2a,0xf0,0x90,0x86,0x48,0xd4,0xad, 0x33,0xe1,0xbc,0xff,0x8f,0x66,0x60,0xc5,
  0xb1,0x4d,0x95,0x29,0xf7,0x53,0xee,0xfd, 0xb4,0xae,0xb8,0xef,0xfa,0xde,0x12,0x64,
};

static const int LED_OK = 2;   // yesil
static const int LED_NO = 4;   // kirmizi
static const uint32_t LED_MS = 1500;

static const int MAX_RECEIPTS = 60;  // NVS'te saklanan fis siniri
static const int ENT_CACHE_SIZE = 4; // dogrulanmis entitlement onbellegi

// --- Durum -----------------------------------------------------------------

WebServer http(80);
DNSServer dns;
Preferences nvs;

static uint32_t g_counter = 0;       // kapidan gecen toplam kisi
static uint32_t g_receipt_count = 0; // NVS'te duran fis sayisi
static String g_status = "HAZIR";
static String g_detail = "";
static String g_status_class = "idle";
static uint32_t g_led_until = 0;
static int g_led_pin = -1;

/**
 * Dogrulanmis entitlement onbellegi.
 * Ed25519 dogrulamasi ESP32'de ~1.5 sn suruyor; her gecis iki dogrulama
 * demek olurdu. Entitlement bir kez dogrulanip onbellege alininca sonraki
 * gecisler yalnizca fis imzasini dogruluyor — tek gecis suresi yariya iniyor.
 * Onbellek RAM'de: elektrik gidince yeniden dogrulanir, guvenlik kaybi yok.
 */
struct EntCache {
  bool used = false;
  uint8_t ent_hash[32];
  uint8_t device_pk[32];
  uint32_t max_uses = 0;
};
static EntCache g_cache[ENT_CACHE_SIZE];
static int g_cache_next = 0;

// --- NVS yardimcilari ------------------------------------------------------

/** "s" + ent_hash'in ilk 8 hex karakteri + "_" + seq. NVS anahtar siniri 15. */
static String spent_key(const uint8_t ent_hash[32], uint32_t seq) {
  char hex[9];
  bytes_to_hex(ent_hash, 4, hex);
  return String("s") + hex + "_" + String(seq);
}

static bool is_spent(const uint8_t ent_hash[32], uint32_t seq) {
  return nvs.isKey(spent_key(ent_hash, seq).c_str());
}

static void mark_spent(const uint8_t ent_hash[32], uint32_t seq) {
  nvs.putBool(spent_key(ent_hash, seq).c_str(), true);
}

/** Fisi settle icin sakla. Elektrik kesilse de hasilat kaybolmaz. */
static void store_receipt(const String &json) {
  if (g_receipt_count >= MAX_RECEIPTS) return;
  nvs.putString((String("r") + g_receipt_count).c_str(), json);
  g_receipt_count++;
  nvs.putUInt("rcount", g_receipt_count);
}

// --- Gosterge --------------------------------------------------------------

static void flash(int pin) {
  digitalWrite(LED_OK, LOW);
  digitalWrite(LED_NO, LOW);
  digitalWrite(pin, HIGH);
  g_led_pin = pin;
  g_led_until = millis() + LED_MS;
}

static void accept(const String &detail) {
  g_counter++;
  nvs.putUInt("counter", g_counter);
  g_status = "GECTI";
  g_status_class = "ok";
  g_detail = detail;
  flash(LED_OK);
}

static void reject(const String &why) {
  g_status = "REDDEDILDI";
  g_status_class = "no";
  g_detail = why;
  flash(LED_NO);
}

// --- Yanit yardimcilari ----------------------------------------------------

static void send_json(int code, const String &body) {
  http.sendHeader("Cache-Control", "no-store");
  http.send(code, "application/json", body);
}

static void deny(const char *reason, const char *message) {
  reject(String(reason));
  send_json(200, String("{\"ok\":false,\"reason\":\"") + reason +
                     "\",\"message\":\"" + message + "\"}");
}

// --- /pay ------------------------------------------------------------------

static void handle_pay() {
  if (http.method() != HTTP_POST) { send_json(405, "{\"ok\":false}"); return; }

  JsonDocument doc;
  if (deserializeJson(doc, http.arg("plain"))) {
    deny("bad_json", "Istek okunamadi");
    return;
  }

  // 1. Entitlement alanlarini oku.
  Entitlement ent{};
  JsonObject e = doc["ent"];
  if (!hex_to_bytes(e["user_raw"] | "", ent.user_raw, 32) ||
      !hex_to_bytes(e["device_pk"] | "", ent.device_pk, 32)) {
    deny("bad_ent", "Bilet bozuk");
    return;
  }
  strlcpy(ent.event, e["event"] | "", sizeof(ent.event));
  strlcpy(ent.gate, e["gate"] | "", sizeof(ent.gate));
  ent.fare_try = e["fare_try"] | 0ULL;
  ent.rate = e["rate"] | 0ULL;
  ent.max_uses = e["max_uses"] | 0U;
  ent.expires = e["expires"] | 0ULL;

  // 2. Bu bilet bu kapiya mi ait?
  if (strcmp(ent.gate, GATE_ID) != 0) {
    deny("wrong_gate", "Bu bilet baska bir kapiya ait");
    return;
  }

  // 3. Fisi oku.
  Receipt r{};
  JsonObject jr = doc["receipt"];
  if (!hex_to_bytes(jr["ent_hash"] | "", r.ent_hash, 32) ||
      !hex_to_bytes(jr["sig"] | "", r.sig, 64)) {
    deny("bad_receipt", "Fis bozuk");
    return;
  }
  r.seq = jr["seq"] | 0U;
  r.fare_try = jr["fare_try"] | 0ULL;
  r.ts = jr["ts"] | 0ULL;

  // Kullanici adresi imzali mesajin parcasi degil, ama settle onsuz fisi
  // zincire yazamaz: eksikse simdi reddet, gece yarisi degil.
  const char *user = jr["user"] | "";
  if (strlen(user) != 56 || user[0] != 'G') {
    deny("no_user", "Fiste kullanici adresi yok");
    return;
  }

  // 4. Fis ile bilet ayni ucreti mi soyluyor?
  if (r.fare_try != ent.fare_try) {
    deny("fare_mismatch", "Ucret uyusmuyor");
    return;
  }

  // 5. Entitlement dogrulamasi — onbellekte varsa atlanir.
  uint8_t ent_hash[32];
  EntCache *hit = nullptr;
  for (int i = 0; i < ENT_CACHE_SIZE; i++) {
    if (g_cache[i].used && memcmp(g_cache[i].ent_hash, r.ent_hash, 32) == 0) {
      hit = &g_cache[i];
      break;
    }
  }

  if (hit) {
    memcpy(ent_hash, hit->ent_hash, 32);
    memcpy(ent.device_pk, hit->device_pk, 32);
    ent.max_uses = hit->max_uses;
  } else {
    uint8_t op_sig[64];
    if (!hex_to_bytes(doc["operator_sig"] | "", op_sig, 64)) {
      deny("bad_sig", "Operator imzasi bozuk");
      return;
    }
    if (!verify_entitlement(ent, op_sig, OPERATOR_PK, ent_hash)) {
      deny("bad_operator_sig", "Bilet operator tarafindan imzalanmamis");
      return;
    }
    // Fis, gercekten bu bilete mi bagli?
    if (memcmp(ent_hash, r.ent_hash, 32) != 0) {
      deny("ent_mismatch", "Fis bu bilete ait degil");
      return;
    }
    EntCache &slot = g_cache[g_cache_next];
    slot.used = true;
    memcpy(slot.ent_hash, ent_hash, 32);
    memcpy(slot.device_pk, ent.device_pk, 32);
    slot.max_uses = ent.max_uses;
    g_cache_next = (g_cache_next + 1) % ENT_CACHE_SIZE;
  }

  // 6. Sira numarasi hak sinirinda mi?
  if (r.seq < 1 || r.seq > ent.max_uses) {
    deny("bad_seq", "Gecersiz fis sirasi");
    return;
  }

  // 7. Daha once harcanmis mi? Tekrar saldirisini burasi durdurur.
  if (is_spent(r.ent_hash, r.seq)) {
    deny("already_spent", "Bu fis kullanilmis");
    return;
  }

  // 8. Fis imzasi — cihaz anahtariyla.
  if (!verify_receipt(r, ent.device_pk)) {
    deny("bad_receipt_sig", "Fis imzasi gecersiz");
    return;
  }

  // 9. Kabul: once harca, sonra sakla.
  mark_spent(r.ent_hash, r.seq);

  char eh[65], sg[129];
  bytes_to_hex(r.ent_hash, 32, eh);
  bytes_to_hex(r.sig, 64, sg);
  String stored = String("{\"ent_hash\":\"") + eh + "\",\"user\":\"" + String(user) +
                  "\",\"seq\":" + r.seq + ",\"fare_try\":\"" + (uint32_t)r.fare_try +
                  "\",\"ts\":" + (uint32_t)r.ts + ",\"sig\":\"" + sg + "\"}";
  store_receipt(stored);

  accept(String("fis #") + r.seq + " / " + ent.max_uses);
  send_json(200, String("{\"ok\":true,\"seq\":") + r.seq +
                     ",\"left\":" + (ent.max_uses - r.seq) +
                     ",\"counter\":" + g_counter + "}");
}

// --- Diger uclar -----------------------------------------------------------

static void handle_root() {
  http.sendHeader("Cache-Control", "no-store");
  http.send_P(200, "text/html", PAGE_PAY);
}

static void handle_screen() {
  String page = FPSTR(PAGE_SCREEN);
  page.replace("%GATE%", GATE_ID);
  page.replace("%COUNT%", String(g_counter));
  page.replace("%STATUS%", g_status);
  page.replace("%CLS%", g_status_class);
  page.replace("%DETAIL%", g_detail);
  http.sendHeader("Cache-Control", "no-store");
  http.send(200, "text/html", page);
}

/** Gorevlinin laptopu fisleri buradan ceker, sonra zincire yazar. */
static void handle_receipts() {
  String out = String("{\"gate\":\"") + GATE_ID + "\",\"counter\":" + g_counter +
               ",\"receipts\":[";
  for (uint32_t i = 0; i < g_receipt_count; i++) {
    if (i) out += ",";
    out += nvs.getString((String("r") + i).c_str(), "null");
  }
  out += "]}";
  send_json(200, out);
}

/** Demo tekrari icin sayaci ve harcanmis fisleri sifirlar. */
static void handle_reset() {
  nvs.clear();
  g_counter = 0;
  g_receipt_count = 0;
  for (int i = 0; i < ENT_CACHE_SIZE; i++) g_cache[i].used = false;
  g_status = "HAZIR";
  g_status_class = "idle";
  g_detail = "sifirlandi";
  send_json(200, "{\"ok\":true}");
}

static void handle_health() {
  send_json(200, String("{\"gate\":\"") + GATE_ID + "\",\"counter\":" + g_counter +
                     ",\"receipts\":" + g_receipt_count + ",\"uptime\":" + (millis() / 1000) + "}");
}

/** Captive portal: taninmayan her istek odeme sayfasina yonlendirilir. */
static void handle_not_found() {
  http.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
  http.send(302, "text/plain", "");
}

// --- Kurulum ---------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(LED_OK, OUTPUT);
  pinMode(LED_NO, OUTPUT);
  digitalWrite(LED_OK, LOW);
  digitalWrite(LED_NO, LOW);

  Serial.println();
  Serial.println("OffGate — kanonik format oz-testi");
  bool self_ok = offgate_selftest();

  nvs.begin("offgate", false);
  g_counter = nvs.getUInt("counter", 0);
  g_receipt_count = nvs.getUInt("rcount", 0);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID);
  IPAddress ip = WiFi.softAPIP();

  // Tum DNS sorgularini kendine yonlendir — captive portal boyle acilir.
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", ip);

  http.on("/", handle_root);
  http.on("/pay", handle_pay);
  http.on("/screen", handle_screen);
  http.on("/receipts", handle_receipts);
  http.on("/reset", handle_reset);
  http.on("/health", handle_health);
  http.onNotFound(handle_not_found);
  http.begin();

  Serial.println();
  Serial.printf("OffGate kapi hazir\n");
  Serial.printf("  kapi     : %s\n", GATE_ID);
  Serial.printf("  wifi     : %s (sifresiz)\n", AP_SSID);
  Serial.printf("  adres    : http://%s\n", ip.toString().c_str());
  Serial.printf("  sayac    : %u gecis, %u fis saklı\n", g_counter, g_receipt_count);
  Serial.printf("  internet : YOK — dogrulama tamamen yerel\n");
  Serial.printf("  oz-test  : %s\n", self_ok ? "GECTI" : "BASARISIZ — format uyusmuyor!");
}

void loop() {
  dns.processNextRequest();
  http.handleClient();

  if (g_led_pin >= 0 && millis() > g_led_until) {
    digitalWrite(g_led_pin, LOW);
    g_led_pin = -1;
    if (g_status_class != "idle") {
      g_status = "HAZIR";
      g_status_class = "idle";
    }
  }
}

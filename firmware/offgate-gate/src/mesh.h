#pragma once
// Kapilar arasi dogrudan iletisim — ESP-NOW.
//
// Router yok, internet yok, eslesme yok. Iki ESP32 birbirine 2.4 GHz'de
// dogrudan cerceve gonderir. Her kapinin kendi Ed25519 anahtar cifti vardir
// ve soyledigi her seyi imzalar.
//
// IKI TUR MESAJ VAR
//
//   1. DUYURU (tek yonlu) — bir gecis kabul edildiginde: "ben M307'yim, su
//      bileti su sirayla harcadim, sayacim su". Komsu dogrular, defterine
//      yazar. Cevap beklenmez.
//
//   2. SORU / ONAY (cift yonlu) — kullanici M307 bileti ile M308'e gelirse,
//      M308 bileti kendi basina dogrular ama o fisin daha once harcanip
//      harcanmadigini BILEMEZ: o defter M307'de. Bu yuzden M308 sorar:
//      "M307, su fisi benim icin yakar misin?" M307 kendi defterine bakar,
//      bostaysa ONCE yakar SONRA imzali onay dondurur. M308 onayi dogrular
//      ve kapiyi acar.
//
// NEDEN GUVENLI
//   Duyuru bir HARCAMA KAYDIdir: bir kapiya "bu harcandi" demek onun
//   yalnizca daha fazla REDDETMESINE yol acabilir.
//
//   Onay ise gecis kazandirir, bu yuzden daha siki: (a) onayi yalnizca
//   biletin SAHIBI kapi verebilir, (b) onay o kapinin gizli anahtariyla
//   imzalidir, (c) icinde soruyu benzersiz kilan bir nonce vardir, eski bir
//   onay tekrar oynatilamaz, (d) sahip kapi fisi onay gondermeden ONCE
//   yakar. Cevap kaybolursa fis yanmis olur ve gecis reddedilir — cifte
//   harcamaya asla acilmaz, en kotu ihtimalle bir hak kaybedilir.
//
//   Sahte mesaj uretmek icin komsunun gizli anahtari gerekir, o da hicbir
//   yere cikmaz.
//
// NE KAZANDIRIYOR
//   1. Dayaniklilik — bir kapinin hafizasi silinse komsusunda kaydi durur.
//   2. Denetim — kapinin artik kimligi var; gordugunu imzaliyor. Operatorun
//      beyanina guvenmek zorunda kalmamanin ilk adimi budur.
//   3. Dagitik defter — her kapi, agin gordugu gecislerin imzali bir
//      kopyasini tutar.
//
// SINIR (durustce)
//   Komsunun acik anahtari ilk duyuldugunda sabitlenir (trust-on-first-use).
//   Kapali bir demo agi icin yeterli; uretimde anahtarlar sozlesmeye
//   kaydedilip oradan dagitilmali.

#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Ed25519.h>
#include "offgate.h"

// Her iki kapi da AYNI kanalda olmali; ESP-NOW kanal atlamaz.
static const uint8_t MESH_CHANNEL = 1;

static const char GOSSIP_DOMAIN[] = "OFFGATE-GOSSIP-v1";  // 17 bayt
static const size_t GOSSIP_DOMAIN_LEN = 17;
// domain(17) || gate(16) || ent_hash(32) || seq(4) || counter(4) || ts(8)
static const size_t GOSSIP_MSG_LEN = 81;

static const int MESH_MAX_PEERS = 4;
static const uint32_t MESH_ANNOUNCE_MS = 15000;

struct GossipPacket {
  uint8_t msg[GOSSIP_MSG_LEN];
  uint8_t sig[64];
  uint8_t pk[32];
};  // 177 bayt — ESP-NOW siniri 250

// Bicim hatasi derleme zamaninda yakalansin: alanlardan biri degisirse
// karsi taraf sessizce yanlis okur, bu da en kotu turden hatadir.
static_assert(GOSSIP_MSG_LEN == GOSSIP_DOMAIN_LEN + ID_LEN + 32 + 4 + 4 + 8,
              "gossip mesaji alan toplamiyla uyusmuyor");
static_assert(sizeof(GossipPacket) == GOSSIP_MSG_LEN + 64 + 32,
              "GossipPacket'te dolgu var — bicim bozulur");
static_assert(sizeof(GossipPacket) <= 250, "ESP-NOW tek cerceve siniri asildi");

// --- Soru / onay bicimi ----------------------------------------------------
//
// domain(14) || from(16) || to(16) || ent_hash(32) || seq(4) || nonce(8)
//   || verdict(1)
//
// Soru ve onay ayni govdeyi kullanir; alan adi domain'den anlasilir.
// Uzunlugu duyurudan farkli oldugu icin alicida karisma ihtimali yok.

static const char ASK_DOMAIN[] = "OFFGATE-ASK-v1";  // 14 bayt
static const char ACK_DOMAIN[] = "OFFGATE-ACK-v1";  // 14 bayt
static const size_t ASK_DOMAIN_LEN = 14;
static const size_t ASK_MSG_LEN = 91;

// verdict degerleri
static const uint8_t VERDICT_NONE  = 0;  // soruda kullanilmaz
static const uint8_t VERDICT_OK    = 1;  // fis bostu, yaktim, gecebilir
static const uint8_t VERDICT_SPENT = 2;  // bu fis bende zaten harcanmis
static const uint8_t VERDICT_NOPE  = 3;  // bu bilet benim degil / bilmiyorum

// Sorunun cevabini bekleme suresi. Ed25519 imza + dogrulama ESP32'de
// yavastir; iki tarafta toplam dort islem var.
static const uint32_t ASK_TIMEOUT_MS = 6000;

struct AskPacket {
  uint8_t msg[ASK_MSG_LEN];
  uint8_t sig[64];
  uint8_t pk[32];
};  // 187 bayt

static_assert(ASK_MSG_LEN == ASK_DOMAIN_LEN + ID_LEN + ID_LEN + 32 + 4 + 8 + 1,
              "soru mesaji alan toplamiyla uyusmuyor");
static_assert(sizeof(AskPacket) == ASK_MSG_LEN + 64 + 32,
              "AskPacket'te dolgu var — bicim bozulur");
static_assert(sizeof(AskPacket) <= 250, "ESP-NOW tek cerceve siniri asildi");
static_assert(sizeof(AskPacket) != sizeof(GossipPacket),
              "iki paket ayni boyda olursa alici hangisi oldugunu ayirt edemez");

struct MeshPeer {
  bool used;
  char gate[ID_LEN + 1];
  uint8_t pk[32];
  uint32_t counter;
  uint32_t heard;      // millis
  uint32_t records;    // bu komsudan alinan harcama kaydi sayisi
};

// --- Durum -----------------------------------------------------------------

static uint8_t g_gate_sk[32];
static uint8_t g_gate_pk[32];
static MeshPeer g_peers[MESH_MAX_PEERS];
static uint32_t g_mesh_sent = 0;
static uint32_t g_mesh_recv = 0;
static uint32_t g_last_announce = 0;

// ESP-NOW geri cagrisi kesme baglaminda calisir: orada NVS'e yazilmaz,
// dogrulama yapilmaz. Paketi kuyruga alip loop() icinde isliyoruz.
static const int MESH_QUEUE = 8;
static volatile int g_q_head = 0, g_q_tail = 0;
static GossipPacket g_queue[MESH_QUEUE];

static volatile int g_aq_head = 0, g_aq_tail = 0;
static AskPacket g_ask_queue[MESH_QUEUE];

/** Kapinin komsudan duydugu harcama kaydini defterine yazmasi icin. */
typedef void (*MeshSpentFn)(const uint8_t ent_hash[32], uint32_t seq, const char *from);
static MeshSpentFn g_on_spent = nullptr;

/**
 * Komsu, bize ait bir fisi yakmamizi istiyor.
 * Donen deger VERDICT_*: yalnizca VERDICT_OK gecise izin verir.
 * Uygulamasi fisi onay dondurmeden ONCE yakmak zorundadir.
 */
typedef uint8_t (*MeshAskFn)(const uint8_t ent_hash[32], uint32_t seq, const char *from);
static MeshAskFn g_on_ask = nullptr;

// Bekledigimiz cevap. Ayni anda tek soru sorulur: turnikede tek kisi vardir.
static bool g_ack_waiting = false;
static uint64_t g_ack_nonce = 0;
static char g_ack_from[ID_LEN + 1] = {0};
static uint8_t g_ack_hash[32];
static uint32_t g_ack_seq = 0;
static bool g_ack_got = false;
static uint8_t g_ack_verdict = VERDICT_NONE;

static uint32_t g_ask_sent = 0;      // sordugumuz
static uint32_t g_ask_served = 0;    // bize sorulup onayladigimiz

// --- Kanonik mesaj ---------------------------------------------------------

inline void gossip_bytes(const char *gate, const uint8_t ent_hash[32], uint32_t seq,
                         uint32_t counter, uint64_t ts, uint8_t out[GOSSIP_MSG_LEN]) {
  uint8_t *p = out;
  memcpy(p, GOSSIP_DOMAIN, GOSSIP_DOMAIN_LEN);  p += GOSSIP_DOMAIN_LEN;
  put_id(p, gate);                              p += ID_LEN;
  memcpy(p, ent_hash, 32);                      p += 32;
  put_u32be(p, seq);                            p += 4;
  put_u32be(p, counter);                        p += 4;
  put_u64be(p, ts);                             p += 8;
}

inline const char *gossip_gate(const uint8_t msg[GOSSIP_MSG_LEN], char out[ID_LEN + 1]) {
  memcpy(out, msg + GOSSIP_DOMAIN_LEN, ID_LEN);
  out[ID_LEN] = 0;
  return out;
}
inline const uint8_t *gossip_hash(const uint8_t msg[GOSSIP_MSG_LEN]) {
  return msg + GOSSIP_DOMAIN_LEN + ID_LEN;
}
inline uint32_t gossip_u32(const uint8_t msg[GOSSIP_MSG_LEN], int at) {
  const uint8_t *p = msg + GOSSIP_DOMAIN_LEN + ID_LEN + 32 + at * 4;
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}

/**
 * Soru/onay kanonik baytlari — 91 bayt.
 *   domain(14) || from(16) || to(16) || ent_hash(32) || seq(4) || nonce(8)
 *   || verdict(1)
 */
inline void ask_bytes(const char *domain, const char *from, const char *to,
                      const uint8_t ent_hash[32], uint32_t seq, uint64_t nonce,
                      uint8_t verdict, uint8_t out[ASK_MSG_LEN]) {
  uint8_t *p = out;
  memcpy(p, domain, ASK_DOMAIN_LEN);  p += ASK_DOMAIN_LEN;
  put_id(p, from);                    p += ID_LEN;
  put_id(p, to);                      p += ID_LEN;
  memcpy(p, ent_hash, 32);            p += 32;
  put_u32be(p, seq);                  p += 4;
  put_u64be(p, nonce);                p += 8;
  *p = verdict;
}

inline bool ask_is(const uint8_t msg[ASK_MSG_LEN], const char *domain) {
  return memcmp(msg, domain, ASK_DOMAIN_LEN) == 0;
}
inline void ask_from(const uint8_t msg[ASK_MSG_LEN], char out[ID_LEN + 1]) {
  memcpy(out, msg + ASK_DOMAIN_LEN, ID_LEN);
  out[ID_LEN] = 0;
}
inline void ask_to(const uint8_t msg[ASK_MSG_LEN], char out[ID_LEN + 1]) {
  memcpy(out, msg + ASK_DOMAIN_LEN + ID_LEN, ID_LEN);
  out[ID_LEN] = 0;
}
inline const uint8_t *ask_hash(const uint8_t msg[ASK_MSG_LEN]) {
  return msg + ASK_DOMAIN_LEN + 2 * ID_LEN;
}
inline uint32_t ask_seq(const uint8_t msg[ASK_MSG_LEN]) {
  const uint8_t *p = msg + ASK_DOMAIN_LEN + 2 * ID_LEN + 32;
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}
inline uint64_t ask_nonce(const uint8_t msg[ASK_MSG_LEN]) {
  const uint8_t *p = msg + ASK_DOMAIN_LEN + 2 * ID_LEN + 32 + 4;
  uint64_t v = 0;
  for (int i = 0; i < 8; i++) v = (v << 8) | p[i];
  return v;
}
inline uint8_t ask_verdict(const uint8_t msg[ASK_MSG_LEN]) {
  return msg[ASK_MSG_LEN - 1];
}

// --- Kimlik ----------------------------------------------------------------

/** Kapinin anahtar cifti: ilk aciliste uretilir, NVS'te kalir. */
inline void mesh_load_identity(Preferences &nvs) {
  size_t n = nvs.getBytes("gate_sk", g_gate_sk, 32);
  if (n != 32) {
    Ed25519::generatePrivateKey(g_gate_sk);
    nvs.putBytes("gate_sk", g_gate_sk, 32);
    Serial.println("[mesh] yeni kapi anahtari uretildi");
  }
  Ed25519::derivePublicKey(g_gate_pk, g_gate_sk);
}

// --- Komsu tablosu ---------------------------------------------------------

inline MeshPeer *mesh_peer(const char *gate) {
  for (int i = 0; i < MESH_MAX_PEERS; i++) {
    if (g_peers[i].used && strcmp(g_peers[i].gate, gate) == 0) return &g_peers[i];
  }
  return nullptr;
}

inline MeshPeer *mesh_peer_add(const char *gate, const uint8_t pk[32]) {
  for (int i = 0; i < MESH_MAX_PEERS; i++) {
    if (!g_peers[i].used) {
      g_peers[i].used = true;
      strlcpy(g_peers[i].gate, gate, sizeof(g_peers[i].gate));
      memcpy(g_peers[i].pk, pk, 32);
      g_peers[i].counter = 0;
      g_peers[i].records = 0;
      return &g_peers[i];
    }
  }
  return nullptr;
}

// --- Gonderme --------------------------------------------------------------

static const uint8_t MESH_BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

inline void mesh_broadcast(const char *gate, const uint8_t ent_hash[32], uint32_t seq,
                           uint32_t counter, uint64_t ts) {
  GossipPacket pkt{};
  gossip_bytes(gate, ent_hash, seq, counter, ts, pkt.msg);
  Ed25519::sign(pkt.sig, g_gate_sk, g_gate_pk, pkt.msg, GOSSIP_MSG_LEN);
  memcpy(pkt.pk, g_gate_pk, 32);
  if (esp_now_send(MESH_BROADCAST, (uint8_t *)&pkt, sizeof(pkt)) == ESP_OK) g_mesh_sent++;
}

/** Imzali soru/onay gonder. */
inline void ask_send(const char *domain, const char *from, const char *to,
                     const uint8_t ent_hash[32], uint32_t seq, uint64_t nonce,
                     uint8_t verdict) {
  AskPacket pkt{};
  ask_bytes(domain, from, to, ent_hash, seq, nonce, verdict, pkt.msg);
  Ed25519::sign(pkt.sig, g_gate_sk, g_gate_pk, pkt.msg, ASK_MSG_LEN);
  memcpy(pkt.pk, g_gate_pk, 32);
  if (esp_now_send(MESH_BROADCAST, (uint8_t *)&pkt, sizeof(pkt)) == ESP_OK) g_mesh_sent++;
}

/** "Buradayim" duyurusu — trafik olmasa da komsular birbirini gorur. */
inline void mesh_announce(const char *gate, uint32_t counter) {
  uint8_t zero[32] = {0};
  mesh_broadcast(gate, zero, 0, counter, (uint64_t)(millis() / 1000));
}

// --- Alma ------------------------------------------------------------------

// Not: bu Arduino-ESP32 surumunde geri cagri MAC adresini ham dizi olarak
// veriyor (yeni surumlerdeki esp_now_recv_info_t degil).
inline void mesh_on_recv(const uint8_t * /*mac*/, const uint8_t *data, int len) {
  if (len == (int)sizeof(GossipPacket)) {
    int next = (g_q_head + 1) % MESH_QUEUE;
    if (next == g_q_tail) return;  // kuyruk dolu, dusur
    memcpy(&g_queue[g_q_head], data, sizeof(GossipPacket));
    g_q_head = next;
  } else if (len == (int)sizeof(AskPacket)) {
    int next = (g_aq_head + 1) % MESH_QUEUE;
    if (next == g_aq_tail) return;
    memcpy(&g_ask_queue[g_aq_head], data, sizeof(AskPacket));
    g_aq_head = next;
  }
}

inline void ask_pump(const char *self_gate);

/** Kuyruktaki paketleri dogrular ve deftere yazar. loop() icinden cagrilir. */
inline void mesh_pump(const char *self_gate) {
  while (g_q_tail != g_q_head) {
    GossipPacket pkt = g_queue[g_q_tail];
    g_q_tail = (g_q_tail + 1) % MESH_QUEUE;

    char from[ID_LEN + 1];
    gossip_gate(pkt.msg, from);
    if (strcmp(from, self_gate) == 0) continue;   // kendi yayinim

    MeshPeer *p = mesh_peer(from);
    if (p) {
      // Anahtar sabitlendi: degisiklik kabul edilmez.
      if (memcmp(p->pk, pkt.pk, 32) != 0) {
        Serial.printf("[mesh] %s anahtari degismis — reddedildi\n", from);
        continue;
      }
    }
    if (!Ed25519::verify(pkt.sig, pkt.pk, pkt.msg, GOSSIP_MSG_LEN)) {
      Serial.printf("[mesh] %s imzasi gecersiz\n", from);
      continue;
    }
    if (!p) {
      p = mesh_peer_add(from, pkt.pk);
      if (!p) continue;
      Serial.printf("[mesh] yeni komsu: %s\n", from);
    }

    p->heard = millis();
    p->counter = gossip_u32(pkt.msg, 1);
    g_mesh_recv++;

    uint32_t seq = gossip_u32(pkt.msg, 0);
    if (seq > 0 && g_on_spent) {
      g_on_spent(gossip_hash(pkt.msg), seq, from);
      p->records++;
    }
  }
  ask_pump(self_gate);
}

/**
 * Soru ve onay paketlerini isler.
 *
 * ONEMLI: soru yalnizca ONCEDEN TANINAN bir komsudan kabul edilir. Duyuru
 * icin ilk-duyusta-guven (TOFU) yeterli — duyuru yalnizca ret uretebilir.
 * Soru ise fis yakiyor, yani hak eksiltiyor; tanimadigimiz bir radyoya bunu
 * yaptirmayiz.
 */
inline void ask_pump(const char *self_gate) {
  while (g_aq_tail != g_aq_head) {
    AskPacket pkt = g_ask_queue[g_aq_tail];
    g_aq_tail = (g_aq_tail + 1) % MESH_QUEUE;

    bool is_ask = ask_is(pkt.msg, ASK_DOMAIN);
    bool is_ack = ask_is(pkt.msg, ACK_DOMAIN);
    if (!is_ask && !is_ack) continue;

    char from[ID_LEN + 1], to[ID_LEN + 1];
    ask_from(pkt.msg, from);
    ask_to(pkt.msg, to);
    if (strcmp(from, self_gate) == 0) continue;   // kendi yayinim
    if (strcmp(to, self_gate) != 0) continue;     // bana degil

    MeshPeer *p = mesh_peer(from);
    if (!p) {
      Serial.printf("[mesh] %s taninmiyor — soru/onay yok sayildi\n", from);
      continue;
    }
    if (memcmp(p->pk, pkt.pk, 32) != 0) {
      Serial.printf("[mesh] %s anahtari degismis — reddedildi\n", from);
      continue;
    }
    if (!Ed25519::verify(pkt.sig, pkt.pk, pkt.msg, ASK_MSG_LEN)) {
      Serial.printf("[mesh] %s imzasi gecersiz\n", from);
      continue;
    }
    p->heard = millis();
    g_mesh_recv++;

    if (is_ask) {
      // Bize ait bir fisin yakilmasi isteniyor.
      uint8_t verdict = g_on_ask
          ? g_on_ask(ask_hash(pkt.msg), ask_seq(pkt.msg), from)
          : VERDICT_NOPE;
      if (verdict == VERDICT_OK) g_ask_served++;
      ask_send(ACK_DOMAIN, self_gate, from, ask_hash(pkt.msg), ask_seq(pkt.msg),
               ask_nonce(pkt.msg), verdict);
      continue;
    }

    // Onay: yalnizca tam olarak bekledigimiz soruya ait olani kabul ederiz.
    if (!g_ack_waiting) continue;
    if (ask_nonce(pkt.msg) != g_ack_nonce) continue;
    if (strcmp(from, g_ack_from) != 0) continue;
    if (ask_seq(pkt.msg) != g_ack_seq) continue;
    if (memcmp(ask_hash(pkt.msg), g_ack_hash, 32) != 0) continue;

    g_ack_verdict = ask_verdict(pkt.msg);
    g_ack_got = true;
  }
}

/**
 * Biletin sahibi kapiya sorar ve cevabi bekler.
 *
 * Donen deger VERDICT_*; cevap gelmezse VERDICT_NONE. Cagiran taraf
 * yalnizca VERDICT_OK'te kapiyi acmalidir — yani sessizlik REDDIR.
 */
inline uint8_t mesh_request_pass(const char *self_gate, const char *home_gate,
                                 const uint8_t ent_hash[32], uint32_t seq,
                                 uint32_t *waited_ms = nullptr) {
  if (waited_ms) *waited_ms = 0;
  if (!mesh_peer(home_gate)) return VERDICT_NONE;  // o kapi duyulmuyor

  uint64_t nonce = ((uint64_t)esp_random() << 32) | esp_random();
  g_ack_waiting = true;
  g_ack_got = false;
  g_ack_verdict = VERDICT_NONE;
  g_ack_nonce = nonce;
  g_ack_seq = seq;
  memcpy(g_ack_hash, ent_hash, 32);
  strlcpy(g_ack_from, home_gate, sizeof(g_ack_from));

  uint32_t t0 = millis();
  ask_send(ASK_DOMAIN, self_gate, home_gate, ent_hash, seq, nonce, VERDICT_NONE);
  g_ask_sent++;

  while (!g_ack_got && millis() - t0 < ASK_TIMEOUT_MS) {
    ask_pump(self_gate);
    delay(2);
  }
  if (waited_ms) *waited_ms = millis() - t0;

  g_ack_waiting = false;
  return g_ack_got ? g_ack_verdict : VERDICT_NONE;
}

// --- Kurulum ---------------------------------------------------------------

inline bool mesh_begin(Preferences &nvs, MeshSpentFn on_spent, MeshAskFn on_ask) {
  mesh_load_identity(nvs);
  g_on_spent = on_spent;
  g_on_ask = on_ask;

  if (esp_now_init() != ESP_OK) {
    Serial.println("[mesh] esp_now_init basarisiz");
    return false;
  }
  esp_now_register_recv_cb(mesh_on_recv);

  esp_now_peer_info_t peer{};
  memcpy(peer.peer_addr, MESH_BROADCAST, 6);
  peer.channel = MESH_CHANNEL;
  peer.ifidx = WIFI_IF_AP;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
  return true;
}

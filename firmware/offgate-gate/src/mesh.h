#pragma once
// Kapilar arasi dogrudan iletisim — ESP-NOW.
//
// Router yok, internet yok, eslesme yok. Iki ESP32 birbirine 2.4 GHz'de
// dogrudan cerceve gonderir. Her kapinin kendi Ed25519 anahtar cifti vardir
// ve soyledigi her seyi imzalar.
//
// NE YAYIYORUZ
//   Bir gecis kabul edildiginde: "ben M307'yim, su bileti su sirayla
//   harcadim, sayacim su". Komsu bunu dogrular ve kendi defterine yazar.
//
// NEDEN GUVENLI
//   Yayilan sey bir HARCAMA KAYDIdir. Bir kapiya "bu harcandi" demek onun
//   yalnizca daha fazla REDDETMESINE yol acabilir; hicbir mesaj kimseye
//   gecis hakki kazandiramaz. Sahte mesaj uretmek icin komsunun gizli
//   anahtari gerekir, o da hicbir yere cikmaz.
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

/** Kapinin komsudan duydugu harcama kaydini defterine yazmasi icin. */
typedef void (*MeshSpentFn)(const uint8_t ent_hash[32], uint32_t seq, const char *from);
static MeshSpentFn g_on_spent = nullptr;

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

/** "Buradayim" duyurusu — trafik olmasa da komsular birbirini gorur. */
inline void mesh_announce(const char *gate, uint32_t counter) {
  uint8_t zero[32] = {0};
  mesh_broadcast(gate, zero, 0, counter, (uint64_t)(millis() / 1000));
}

// --- Alma ------------------------------------------------------------------

// Not: bu Arduino-ESP32 surumunde geri cagri MAC adresini ham dizi olarak
// veriyor (yeni surumlerdeki esp_now_recv_info_t degil).
inline void mesh_on_recv(const uint8_t * /*mac*/, const uint8_t *data, int len) {
  if (len != (int)sizeof(GossipPacket)) return;
  int next = (g_q_head + 1) % MESH_QUEUE;
  if (next == g_q_tail) return;  // kuyruk dolu, dusur
  memcpy(&g_queue[g_q_head], data, sizeof(GossipPacket));
  g_q_head = next;
}

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
}

// --- Kurulum ---------------------------------------------------------------

inline bool mesh_begin(Preferences &nvs, MeshSpentFn on_spent) {
  mesh_load_identity(nvs);
  g_on_spent = on_spent;

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

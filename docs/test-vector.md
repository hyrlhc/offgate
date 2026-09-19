# OffGate — Kanonik Format Test Vektörü

> Bu dosya `node scripts/gen-test-vector.mjs` ile üretilir. Elle düzenleme.

Doğrulama üç platformda çalışır: Soroban sözleşmesi (Rust), web uygulaması
(JavaScript) ve kapı donanımı (ESP32/C++). Üçünün de **aynı baytları** üretmesi
şarttır. Bu dosya o baytları sabitler.

Sözleşme tarafı, `canonical_message_matches_javascript_vector` testiyle
aşağıdaki değerlere bağlıdır — format kayarsa derleme zamanında kırılır.

Formatın taşıma katmanından bağımsız olması (karar K-8) bu sabitliğe dayanır:
aynı 67 bayt wifi, QR, BLE veya NFC üzerinden gelebilir, doğrulama değişmez.

---

## 1. Entitlement (bakiye belgesi) — 138 bayt

Operatör imzalar, ESP32 operatörün açık anahtarıyla doğrular.

```
"OFFGATE-ENT-v1"  14 bayt  ASCII
user_raw          32 bayt  kullanıcının Stellar adresinin ham Ed25519 hali
device_pk         32 bayt  telefonda üretilen cihaz açık anahtarı
event_id          16 bayt  ASCII, sağdan \0 dolgulu
gate_id           16 bayt  ASCII, sağdan \0 dolgulu
fare_try           8 bayt  big-endian u64, kuruş
rate               8 bayt  big-endian u64, TRY/USDC × 10^7
max_uses           4 bayt  big-endian u32
expires            8 bayt  big-endian u64, unix saniye
                 = 138 bayt
```

### Girdiler

| Alan | Değer |
|---|---|
| operator tohumu | `2222222222222222222222222222222222222222222222222222222222222222` |
| operator açık anahtarı | `a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f0` |
| cihaz tohumu | `1111111111111111111111111111111111111111111111111111111111111111` |
| cihaz açık anahtarı | `d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737` |
| user_raw | `3333333333333333333333333333333333333333333333333333333333333333` |
| event_id | `EVT1` |
| gate_id | `M307` |
| fare_try | 10000 (100.00 TL) |
| rate | 487850780 (1 USDC = 48.785078 TRY) |
| max_uses | 5 |
| expires | 1800000000 |

### Çıktılar

```
kanonik baytlar (138):
4f4646474154452d454e542d76313333333333333333333333333333333333333333333333333333333333333333d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737455654310000000000000000000000004d3330370000000000000000000000000000000000002710000000001d14031c00000005000000006b49d200

ent_hash = sha256(yukarıdakiler):
55488c4e49e7a58c1dbd37044579e5c7d0f72297ed35550426529549d92f299e

operatör imzası:
90047adec4cce469f6045adb3482a371d250d94103f7fd3a49c04d1aabd92a098d17f39106b452facbb148667f3f346b923246ffd9a8cb8eca627dbd51bf490a
```

---

## 2. Fiş (geçiş belgesi) — 67 bayt

Cihaz anahtarı imzalar; hem ESP32 hem sözleşme doğrular.

```
"OFFGATE-RCPT-v1" 15 bayt  ASCII
ent_hash          32 bayt  yukarıdaki entitlement'ın sha256'sı
seq                4 bayt  big-endian u32, 1'den başlar
fare_try           8 bayt  big-endian u64, kuruş
ts                 8 bayt  big-endian u64, unix saniye
                 = 67 bayt
```

**Kapı kimliği bu mesajda yoktur** — `ent_hash` zaten kapıyı bağlar. Bu sayede
sözleşme tarafında `Symbol` → bayt dönüşümüne ihtiyaç kalmaz (Soroban'da
`ToString for Symbol` yalnızca wasm dışında mevcuttur).

### 2a. Sabit vektör (sözleşme testi bu değerlere bağlı)

| Alan | Değer |
|---|---|
| ent_hash | `abababababababababababababababababababababababababababababababab` (sabit 0xAB) |
| seq | 1 |
| fare_try | 10000 |
| ts | 1700000001 |

```
mesaj (67 bayt):
4f4646474154452d524350542d7631abababababababababababababababababababababababababababababababab000000010000000000002710000000006553f101

cihaz imzası:
5e7623fbf168a4cff62a98b524e8cd2c36855fb2107d231b674d6bfdd44f14ae16e70d6e62cf551df1dad4f2b491e33775b7982c0c841e08bd7bc412dcec750c
```

### 2b. Uçtan uca örnek (1. bölümdeki gerçek entitlement ile)

| Alan | Değer |
|---|---|
| ent_hash | `55488c4e49e7a58c1dbd37044579e5c7d0f72297ed35550426529549d92f299e` |
| seq | 1 |
| fare_try | 10000 |
| ts | 1700000001 |

```
mesaj:
4f4646474154452d524350542d763155488c4e49e7a58c1dbd37044579e5c7d0f72297ed35550426529549d92f299e000000010000000000002710000000006553f101

cihaz imzası:
9ab736bb87c71415cc9b321dae55792bbf8b07a99f45ea724c9c348d929785704f9e9c9968683fae9ca0a0fc9c1222c4007186a57fbca3990aadbb741ce50b0c
```

---

## 3. Doğrulama kuralları

1. **ESP32** iki imza doğrular: entitlement'ı operatörün açık anahtarıyla
   (firmware'e gömülü), fişi entitlement içindeki `device_pk` ile.
2. **Sözleşme** yalnızca fiş imzasını doğrular; `device_pk` zaten
   `lock_float` sırasında zincire yazılmıştır.
3. `(ent_hash, seq)` ikilisi her iki tarafta da bir kez harcanır —
   ESP32'de NVS'te, zincirde `Spent` altında.
4. Sayı alanları **big-endian**, işaretsiz. Kuruş ve stroop tamsayıdır;
   hiçbir yerde ondalık kayan sayı kullanılmaz.

## 4. Yeniden üretme

```sh
node scripts/gen-test-vector.mjs   # bu dosyayı üretir
cargo test -p offgate canonical    # Rust tarafının uyduğunu doğrular
```

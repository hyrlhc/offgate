#!/usr/bin/env node
// docs/test-vector.md dosyasini uretir.
//
// Bu vektor, kanonik formatin uc platformda (Soroban/Rust, web/JS, ESP32/C++)
// ayni baytlari urettiginin kanitidir. Rust tarafi
// `canonical_message_matches_javascript_vector` testiyle bu degerlere bagli;
// ESP32 firmware'i ayni vektore karsi dogrulanacak (P8c).

import { writeFileSync } from 'node:fs';
import {
  ENT_MSG_LEN, RCPT_MSG_LEN,
  entitlementBytes, entitlementHash, privateKeyFromSeed,
  rawPublicKey, receiptMessage, signBytes, verifyBytes,
} from './lib/receipts.mjs';

const hex = (b) => Buffer.from(b).toString('hex');

// --- Sabit girdiler (rastgelelik yok, tekrar uretilebilir) -----------------
const DEVICE_SEED = Buffer.alloc(32, 0x11);
const OPERATOR_SEED = Buffer.alloc(32, 0x22);
const USER_RAW = Buffer.alloc(32, 0x33);

const deviceKey = privateKeyFromSeed(DEVICE_SEED);
const operatorKey = privateKeyFromSeed(OPERATOR_SEED);
const devicePk = rawPublicKey(deviceKey);
const operatorPk = rawPublicKey(operatorKey);

const ent = {
  userRaw: USER_RAW,
  devicePk,
  event: 'EVT1',
  gate: 'M307',
  fareTry: 10_000,     // 100.00 TL
  rate: 487_850_780,   // 1 USDC = 48.785078 TRY
  maxUses: 5,
  expires: 1_800_000_000,
};

const entBytes = entitlementBytes(ent);
const entHash = entitlementHash(ent);
const entSig = signBytes(operatorKey, entBytes);

// Sozlesme testindeki vektorle ayni olmasi icin sabit ent_hash ve zaman.
const FIXED_ENT_HASH = Buffer.alloc(32, 0xAB);
const FIXED_TS = 1_700_000_001;
const rcptMsg = receiptMessage({ entHash: FIXED_ENT_HASH, seq: 1, fareTry: 10_000, ts: FIXED_TS });
const rcptSig = signBytes(deviceKey, rcptMsg);

// Gercek entitlement uzerinden bir fis (uctan uca ornek).
const realMsg = receiptMessage({ entHash, seq: 1, fareTry: ent.fareTry, ts: FIXED_TS });
const realSig = signBytes(deviceKey, realMsg);

// --- Kendi kendini dogrula -------------------------------------------------
const checks = [
  ['entitlement uzunlugu', entBytes.length === ENT_MSG_LEN],
  ['fis mesaji uzunlugu', rcptMsg.length === RCPT_MSG_LEN],
  ['operator imzasi', verifyBytes(operatorPk, entBytes, entSig)],
  ['cihaz imzasi (sabit vektor)', verifyBytes(devicePk, rcptMsg, rcptSig)],
  ['cihaz imzasi (gercek fis)', verifyBytes(devicePk, realMsg, realSig)],
  ['yanlis anahtar reddediliyor', verifyBytes(operatorPk, rcptMsg, rcptSig) === false],
];
for (const [name, pass] of checks) {
  if (!pass) {
    console.error(`HATA: ${name} dogrulanamadi`);
    process.exit(1);
  }
}

const md = `# OffGate — Kanonik Format Test Vektörü

> Bu dosya \`node scripts/gen-test-vector.mjs\` ile üretilir. Elle düzenleme.

Doğrulama üç platformda çalışır: Soroban sözleşmesi (Rust), web uygulaması
(JavaScript) ve kapı donanımı (ESP32/C++). Üçünün de **aynı baytları** üretmesi
şarttır. Bu dosya o baytları sabitler.

Sözleşme tarafı, \`canonical_message_matches_javascript_vector\` testiyle
aşağıdaki değerlere bağlıdır — format kayarsa derleme zamanında kırılır.

Formatın taşıma katmanından bağımsız olması (karar K-8) bu sabitliğe dayanır:
aynı 67 bayt wifi, QR, BLE veya NFC üzerinden gelebilir, doğrulama değişmez.

---

## 1. Entitlement (bakiye belgesi) — ${ENT_MSG_LEN} bayt

Operatör imzalar, ESP32 operatörün açık anahtarıyla doğrular.

\`\`\`
"OFFGATE-ENT-v1"  14 bayt  ASCII
user_raw          32 bayt  kullanıcının Stellar adresinin ham Ed25519 hali
device_pk         32 bayt  telefonda üretilen cihaz açık anahtarı
event_id          16 bayt  ASCII, sağdan \\0 dolgulu
gate_id           16 bayt  ASCII, sağdan \\0 dolgulu
fare_try           8 bayt  big-endian u64, kuruş
rate               8 bayt  big-endian u64, TRY/USDC × 10^7
max_uses           4 bayt  big-endian u32
expires            8 bayt  big-endian u64, unix saniye
                 = ${ENT_MSG_LEN} bayt
\`\`\`

### Girdiler

| Alan | Değer |
|---|---|
| operator tohumu | \`${hex(OPERATOR_SEED)}\` |
| operator açık anahtarı | \`${hex(operatorPk)}\` |
| cihaz tohumu | \`${hex(DEVICE_SEED)}\` |
| cihaz açık anahtarı | \`${hex(devicePk)}\` |
| user_raw | \`${hex(USER_RAW)}\` |
| event_id | \`${ent.event}\` |
| gate_id | \`${ent.gate}\` |
| fare_try | ${ent.fareTry} (100.00 TL) |
| rate | ${ent.rate} (1 USDC = 48.785078 TRY) |
| max_uses | ${ent.maxUses} |
| expires | ${ent.expires} |

### Çıktılar

\`\`\`
kanonik baytlar (${entBytes.length}):
${hex(entBytes)}

ent_hash = sha256(yukarıdakiler):
${hex(entHash)}

operatör imzası:
${hex(entSig)}
\`\`\`

---

## 2. Fiş (geçiş belgesi) — ${RCPT_MSG_LEN} bayt

Cihaz anahtarı imzalar; hem ESP32 hem sözleşme doğrular.

\`\`\`
"OFFGATE-RCPT-v1" 15 bayt  ASCII
ent_hash          32 bayt  yukarıdaki entitlement'ın sha256'sı
seq                4 bayt  big-endian u32, 1'den başlar
fare_try           8 bayt  big-endian u64, kuruş
ts                 8 bayt  big-endian u64, unix saniye
                 = ${RCPT_MSG_LEN} bayt
\`\`\`

**Kapı kimliği bu mesajda yoktur** — \`ent_hash\` zaten kapıyı bağlar. Bu sayede
sözleşme tarafında \`Symbol\` → bayt dönüşümüne ihtiyaç kalmaz (Soroban'da
\`ToString for Symbol\` yalnızca wasm dışında mevcuttur).

### 2a. Sabit vektör (sözleşme testi bu değerlere bağlı)

| Alan | Değer |
|---|---|
| ent_hash | \`${hex(FIXED_ENT_HASH)}\` (sabit 0xAB) |
| seq | 1 |
| fare_try | 10000 |
| ts | ${FIXED_TS} |

\`\`\`
mesaj (${rcptMsg.length} bayt):
${hex(rcptMsg)}

cihaz imzası:
${hex(rcptSig)}
\`\`\`

### 2b. Uçtan uca örnek (1. bölümdeki gerçek entitlement ile)

| Alan | Değer |
|---|---|
| ent_hash | \`${hex(entHash)}\` |
| seq | 1 |
| fare_try | ${ent.fareTry} |
| ts | ${FIXED_TS} |

\`\`\`
mesaj:
${hex(realMsg)}

cihaz imzası:
${hex(realSig)}
\`\`\`

---

## 3. Doğrulama kuralları

1. **ESP32** iki imza doğrular: entitlement'ı operatörün açık anahtarıyla
   (firmware'e gömülü), fişi entitlement içindeki \`device_pk\` ile.
2. **Sözleşme** yalnızca fiş imzasını doğrular; \`device_pk\` zaten
   \`lock_float\` sırasında zincire yazılmıştır.
3. \`(ent_hash, seq)\` ikilisi her iki tarafta da bir kez harcanır —
   ESP32'de NVS'te, zincirde \`Spent\` altında.
4. Sayı alanları **big-endian**, işaretsiz. Kuruş ve stroop tamsayıdır;
   hiçbir yerde ondalık kayan sayı kullanılmaz.

## 4. Yeniden üretme

\`\`\`sh
node scripts/gen-test-vector.mjs   # bu dosyayı üretir
cargo test -p offgate canonical    # Rust tarafının uyduğunu doğrular
\`\`\`
`;

writeFileSync('docs/test-vector.md', md);
console.log('docs/test-vector.md yazildi');
for (const [name] of checks) console.log(`  ✓ ${name}`);

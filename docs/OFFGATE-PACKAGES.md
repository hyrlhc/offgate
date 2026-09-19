# OFFGATE — Paket Paket Geliştirme Planı

**Kaynak doküman:** `OFFGATE-BUILD-PLAN.md` (mimari, sözlük, anchor referansı)
**Bu doküman:** uygulama sırası, paket sınırları, kabul kriterleri, geri çekilme planları.
**Tarih:** 19 Eylül 2026 · Gün 1 · Deadline: 20 Eylül 12:00

> Kural: **Bir paket bitmeden diğerine geçme.** Her paketin sonunda "Kabul kanıtı" var — o kanıtı üretemiyorsan paket bitmemiştir. Kanıtı üretemiyorsan pakette yazan **B planına geç**, tartışma.

---

## 0. ÖNCE: PLANDA BULDUĞUM 4 YAPISAL SORUN VE ÇÖZÜMLERİ

Bunlar gece 03:00'te demoyu patlatacak türden şeyler. Kararları şimdi veriyoruz, paketlerin içine gömülü geliyorlar.

### K-1 · Freighter offline imza atamaz → **Cihaz anahtarı (device key) devri**

Orijinal plan "kullanıcı fişi kendi Stellar anahtarıyla imzalar" diyor. Ama kullanıcı cüzdanı Wallets Kit/Freighter ile bağlıyor; Freighter uzantısı telefonda uçak modunda ham bayt imzalamaz. Akış kapıda ölür.

**Karar:** Tarayıcı, `lock_float` anında kendi Ed25519 **cihaz anahtar çiftini** üretir. `lock_float` çağrısına `device_pubkey: BytesN<32>` parametresi eklenir ve zincire yazılır. Fişleri cihaz anahtarı imzalar. `settle` imzayı cihaz anahtarına karşı doğrular. Freighter sadece **tek bir kez**, `lock_float` işlemini imzalamak için kullanılır.

Bu ayrıca kontratı basitleştirir: G-adresini strkey decode etmeye gerek kalmaz, ham 32 bayt zaten elimizdedir.

Jüriye anlatımı: *"Cüzdan, kapıda kullanılacak cihaz anahtarına zincir üzerinde yetki devrediyor. Cüzdanın ana anahtarı hiçbir zaman telefonun offline tarafına inmiyor."* — Bu bir zayıflık değil, olgunluk sinyali.

### K-2 · localStorage origin'e bağlıdır → **Ön-imzalı fiş defteri (receipt book)**

Online uygulama `https://offgate.vercel.app`'te çalışıyor. Kapı sayfası `http://192.168.4.1`'de. **Bunlar ayrı origin.** Vercel'de sakladığın entitlement'ı kapı sayfası okuyamaz. Ayrıca Safari'de WebCrypto Ed25519 desteği hâlâ güvenilmez — kapıda canlı imza atmaya bel bağlamak risk.

**Karar:** Kullanıcı daha **online iken** `max_uses` adet fişin tamamını önceden imzalar (`seq = 1..N`, ücret zaten sabit). Entitlement + N adet imzalı fiş tek bir base64 **bundle**'a paketlenir. Kapıda tarayıcı hiç kripto yapmaz, sadece sıradaki fişi gönderir.

Aktarım: online sayfa bundle'ı panoya kopyalar → kapı sayfasında **bir kez** yapıştırılır → kapı sayfası bundle'ı kendi origin'inin localStorage'ına yazar → sonraki geçişler tek tuş.

Bu bir kısayol değil, doğru güvenlik modeli: **seyahat çeki mantığı.** Bundle'ın içinde hiçbir gizli anahtar yok, çalınsa bile o kapıda ve o `seq` aralığında sınırlı.

*(İsteğe bağlı gösteriş: WebCrypto Ed25519 varsa kapıda canlı imza da atılabilir — P7'de "stretch" olarak işaretli, zorunlu değil.)*

### K-3 · Demo rakamları withdraw limitinin altında kalıyor

Plandaki 50 TL yükleme / 5 TL bilet ile 3 geçiş = 15 TL ≈ **0.31 USDC**. Anchor'ın `min_offramp_usdc` limiti **1.0 USDC**. Demo senaryosunun 6. adımı (operatör TL'ye çeker) çalışmaz.

**Karar — yeni demo rakamları:**

| Parametre | Değer | USDC karşılığı (kur ≈ 48.54) |
|---|---|---|
| Yükleme | **500.00 TRY** | ≈ 10.30 USDC |
| Geçiş ücreti | **100.00 TRY** | ≈ 2.06 USDC |
| `max_uses` | **5** | — |
| Demoda geçiş | 3 | 300 TRY ≈ 6.18 USDC → withdraw OK |
| Refund | 2 kullanılmamış | 200 TRY ≈ 4.12 USDC → limit üstü |

Hikâye "metro" değil **"festival / kapalı alan harcaması"** olur: bileklik yüklemesi, kapıda içecek/geçiş 100 TL. Deposit 500 TRY, 50–3000 aralığında. Her iki yön de limitlerin üstünde.

### K-4 · Kapı sayfasını kim servis ediyor?

Kapı sayfası ESP32'nin flash'ından servis edilmeli (internet yok). Yani `/` içeriği firmware'e gömülü bir HTML string olacak; Vercel'deki React uygulamasıyla **aynı kod değil**. İki ayrı frontend var, karıştırma:

- `web/` → online cüzdan + yükleme + bundle üretimi (React, Vercel)
- `firmware/` içindeki gömülü HTML → offline ödeme + `/screen` (vanilla JS, ~150 satır, ESP32 PROGMEM)

---

## 1. REPO YERLEŞİMİ

```
offgate/
├── contracts/offgate/        # Rust / Soroban
│   ├── src/lib.rs
│   └── src/test.rs
├── web/                      # Vite + React + TS  → Vercel
│   └── src/lib/{anchor,wallet,receipts,contract}.ts
├── firmware/offgate-gate/    # Arduino / PlatformIO
│   └── src/main.cpp (+ page_pay.h, page_screen.h)
├── scripts/                  # Node — tek seferlik & operatör işleri
│   ├── 00-setup-accounts.mjs
│   ├── 01-anchor-flow.mjs
│   ├── 02-settle.mjs
│   └── 03-withdraw.mjs
├── docs/
│   ├── OFFGATE-BUILD-PLAN.md
│   └── OFFGATE-PACKAGES.md   # bu dosya
├── .env.example
└── README.md
```

**Teknoloji kararı:** Frontend **Vite + React + TypeScript**. Next.js değil — SSR yok, Stellar SDK'nın Node/browser polyfill sorunları Vite'ta daha az, build 3 saniye, Vercel'e tek komut. Bu saatte SSR hatası ayıklamak lüks.

---

## 2. PAKET HARİTASI

```
P0 Tezgah ──► P1 Zincir Kimliği ──┬──► P2 Anchor Akışı ──┐
                                  │                       │
                                  └──► P3 Kontrat v1 ──► P4 Kontrat v2 ──► P5 Testler
                                                                             │
                        ┌────────────────────────────────────────────────────┘
                        ▼
                   P6 Web Online ──► P7 Fiş Defteri ──► P8 ESP32 ──► P9 Settle Köprüsü
                                                                          │
                                                          P10 Denetim ◄───┘
                                                              │
                                              P11 Uçtan Uca ──┴──► P12 README+Deploy ──► P13 Sunum
```

**Öncelik etiketleri**
`[P0-CRIT]` demo bunsuz olmaz · `[P1-HIGH]` puan kaybı ciddi · `[P2-NICE]` süre kalırsa

| # | Paket | Süre | Öncelik | Kesilebilir mi |
|---|---|---|---|---|
| P0 | Tezgah kurulumu | 30 dk | P0-CRIT | Hayır |
| P1 | Zincir kimliği + boş deploy | 45 dk | P0-CRIT | Hayır |
| P2 | Anchor akışı (script) | 90 dk | P0-CRIT | Hayır — en yüksek ağırlıklı kriter |
| P3 | Kontrat v1 (lock/assign) | 90 dk | P0-CRIT | Hayır |
| P4 | Kontrat v2 (settle/refund) | 120 dk | P0-CRIT | `refund` kesilebilir |
| P5 | Kontrat unit testleri | 45 dk | P1-HIGH | 3 teste indirilebilir |
| P6 | Web — online akış | 150 dk | P0-CRIT | Hayır |
| P7 | Fiş defteri + bundle | 45 dk | P0-CRIT | Hayır |
| P8 | ESP32 firmware | 180 dk | P0-CRIT | B planı var |
| P9 | Settle köprüsü | 60 dk | P0-CRIT | Hayır |
| P10 | Denetim ekranı | 45 dk | P1-HIGH | Evet → CLI çıktısı |
| P11 | Uçtan uca prova | 60 dk | P0-CRIT | Hayır |
| P12 | README + deploy + submit | 60 dk | P0-CRIT | Hayır |
| P13 | Kullanıcı testi + sunum | 60 dk | P1-HIGH | Hayır |
| | **Toplam** | **~17.5 sa** | | uyku hariç |

---

## PAKET 0 — TEZGAH KURULUMU `[P0-CRIT]` · 30 dk

**Amaç:** Tek bir komutun bile "command not found" dememesi.

### Mevcut durum (19 Eylül, ölçüldü)

| Araç | Durum |
|---|---|
| Node v26.5.0 / npm 11.17.0 | ✅ hazır |
| git 2.39.5 | ✅ hazır |
| Homebrew 6.0.12 | ✅ hazır |
| rustc 1.97.1 | ⚠️ var ama **cargo bileşeni bozuk** |
| `stellar` CLI | ❌ yok |
| wasm hedefi | ❌ yok |
| PlatformIO / arduino-cli | ❌ yok |
| Anchor `/health` | ✅ 200 · Horizon ✅ 200 |

### Adımlar

1. **Cargo'yu onar** (rustup shim var ama bileşen kurulu değil):
   ```sh
   rustup toolchain install stable --force --component cargo,rustc,rust-std
   cargo --version   # çalışmalı
   ```
2. **wasm hedefi** (ikisini de ekle, hangisini istediğini build söyleyecek):
   ```sh
   rustup target add wasm32v1-none
   rustup target add wasm32-unknown-unknown
   ```
3. **Stellar CLI** — Homebrew ile, `cargo install` 10 dakika sürer:
   ```sh
   brew install stellar-cli
   stellar --version
   ```
4. **PlatformIO** (Arduino IDE'den hızlı ve betiklenebilir):
   ```sh
   brew install platformio    # veya: pipx install platformio
   pio --version
   ```
5. **Repo:**
   ```sh
   cd ~/Desktop/stellar_hackhaton && git init && gh repo create offgate --public --source=. 
   mkdir -p contracts web firmware scripts docs
   git mv OFFGATE-BUILD-PLAN.md docs/ ; git mv OFFGATE-PACKAGES.md docs/
   ```
6. `.gitignore`: `node_modules/ target/ .env .pio/ dist/`
7. `.env.example` oluştur (gerçek `.env` **asla** commit edilmez).

### Kabul kanıtı
`node -v && cargo --version && stellar --version && pio --version` dördü de sürüm basıyor; GitHub'da public repo görünür.

### Risk
Homebrew'de `stellar-cli` formülü yoksa: `cargo install --locked stellar-cli` (yavaş, arka planda başlat ve P1'in diğer adımlarına devam et).

---

## PAKET 1 — ZİNCİR KİMLİĞİ VE BOŞ DEPLOY `[P0-CRIT]` · 45 dk

**Amaç:** Son gün deploy hatası yememek. **Contract ID bugün alınacak.**

### Üretilecek üç hesap

| Rol | Amaç | Nerede saklanır |
|---|---|---|
| `admin` | Kontratı deploy eder, `init` çağırır | `.env` → `ADMIN_SECRET` |
| `operator` | Entitlement'ları imzalar, hasılatı alır, withdraw eder | `.env` → `OPERATOR_SECRET` |
| `user` | Demo kullanıcısı (Freighter'a da bu import edilir) | `.env` → `USER_SECRET` |

### Adımlar

1. Hesapları üret ve fonla:
   ```sh
   stellar keys generate --global admin    --network testnet --fund
   stellar keys generate --global operator --network testnet --fund
   stellar keys generate --global user     --network testnet --fund
   stellar keys address admin; stellar keys address operator; stellar keys address user
   ```
2. **USDC trustline — `user` ve `operator` için ikisine de aç.** (Operatör de USDC alacak; unutulursa `settle` patlar.)
   ```sh
   # scripts/00-setup-accounts.mjs içinde changeTrust — asset:
   # USDC / GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
   node scripts/00-setup-accounts.mjs
   ```
3. Anchor ayakta mı: `curl -s https://tr-mock-anchor.fly.dev/health | jq .` → `ok:true`, güncel kuru not al.
4. **Boş kontratı derle ve deploy et:**
   ```sh
   stellar contract init contracts --name offgate
   cd contracts/offgate && stellar contract build
   stellar contract deploy --wasm ../../target/wasm32v1-none/release/offgate.wasm \
     --source admin --network testnet --alias offgate
   ```
5. Dönen `C...` ID'sini `.env` → `CONTRACT_ID` ve README taslağına yaz.

### Kabul kanıtı
- `stellar.expert/explorer/testnet/account/<user G...>` sayfasında **USDC trustline satırı** görünüyor (bakiye 0, trustline var).
- `stellar.expert/explorer/testnet/contract/<C...>` sayfası açılıyor.
- Üç işlem hash'i not defterinde.

### Risk
Friendbot 429 verirse 60 sn bekle, tekrar dene. `stellar contract build` "target bulunamadı" derse P0/adım 2'deki diğer hedefi ekle.

---

## PAKET 2 — ANCHOR AKIŞI `[P0-CRIT]` · 90 dk

> **Bu paket jürinin en yüksek ağırlıklı kriteri.** ("Anchor ve yerel ödeme entegrasyonları bu kategoride en yüksek ağırlığa sahiptir.") Zamanı buradan kısma.

**Amaç:** Node scriptiyle 500 TRY → USDC akışını uçtan uca çalıştırmak. Önce script, sonra UI — UI'da hata ayıklamak iki kat yavaş.

### `scripts/01-anchor-flow.mjs` — sıralı adımlar

1. **SEP-1** — `StellarTomlResolver.resolve('tr-mock-anchor.fly.dev')`.
   Endpoint'leri **TOML'dan oku**, koda gömme. (Jüri "hardcode" arıyor; TOML keşfi bunun tam tersi.)
2. **SEP-10** — `GET /auth?account=G...` → challenge XDR → `user` ile imzala → `POST /auth` → JWT.
   JWT'yi bellekte tut, 401 görürsen otomatik yenile (retry sarmalayıcı yaz, bu sorun kesin çıkacak).
3. **SEP-38 quote** — `POST /sep38/quote`
   `sell_asset: iso4217:TRY`, `buy_asset: stellar:USDC:GBBD47...`, `sell_amount: "500"`.
   Dönen `quote.id` ve `quote.price`'ı sakla — **price, kontrata yazılacak kilitli kur.**
4. **SEP-6 deposit** — `GET /sep6/deposit?asset_code=USDC&account=G...&amount=500&quote_id=<id>`
   Dönen `id`, `how` (IBAN + referans) loglanır. *Referans numarası, kullanıcının EFT açıklamasına yazacağı şey — sunumda bunu göster.*
5. **simulate-bank-transfer** — `POST /sep6/tx/<id>/simulate-bank-transfer` body `{amount:"500"}`.
   *Bu, mock anchor'a özgü tek kısayol. README'de açıkça belirtilecek.*
6. **Poll** — `GET /sep6/transaction?id=<id>` → `completed` olana kadar 2 sn aralıkla, 60 sn timeout.
   Durum `pending_trust` olursa → trustline eksik, P1'e dön.
7. **Doğrula** — Horizon'dan `user` hesabının USDC bakiyesini oku, > 10 USDC olmalı.

### Kabul kanıtı — **buradan geçmeden ilerleme**
Stellar Expert'te `user` hesabında **~10.3 USDC bakiye** ve issuer'dan gelen payment işlemi görünüyor. Ekran görüntüsü al, README'ye girecek.

### Risk tablosu (plandan, elinin altında dursun)
| Belirti | Sebep | Çözüm |
|---|---|---|
| 401 | JWT süresi doldu | SEP-10'u tekrarla |
| `pending_trust` | trustline yok | `changeTrust` |
| Deposit gelmiyor | simulate çağrılmadı | adım 5 |
| "below minimum" | < 50 TRY | 500 kullan |

---

## PAKET 3 — SOROBAN KONTRAT v1 `[P0-CRIT]` · 90 dk

**Amaç:** Para kilitleniyor ve kapı atanıyor. Settle henüz yok.

### Veri tipleri

```rust
#[contracttype] pub enum DataKey {
    Admin, Token, OperatorPk, Event(Symbol),
    Float(Address),            // kullanıcının kilitli USDC'si
    Device(Address),           // kullanıcının cihaz açık anahtarı BytesN<32>
    GateLoad(Symbol),          // kapı yükü u32
    Spent(BytesN<32>, u32),    // (ent_hash, seq) -> ()
    Declared(Symbol),          // kapının beyanı u32
}

#[contracttype] pub struct Receipt {
    pub ent_hash: BytesN<32>,
    pub user: Address,
    pub gate: Symbol,
    pub seq: u32,
    pub fare_try: i128,     // kuruş: 10000 = 100.00 TL
    pub ts: u64,
    pub sig: BytesN<64>,
}
```

### Fonksiyonlar (bu pakette)

```rust
fn init(e: Env, admin: Address, usdc: Address, operator_pk: BytesN<32>)
fn register_gate(e: Env, gate: Symbol, event: Symbol)          // admin auth
fn lock_float(e: Env, user: Address, amount: i128,
              event: Symbol, fare_try: i128, rate: i128,
              device_pk: BytesN<32>) -> Symbol                  // user.require_auth()
fn assign_gate(e: Env, event: Symbol) -> Symbol                 // en az yüklü kapı
fn float_of(e: Env, user: Address) -> i128
fn gate_load(e: Env, gate: Symbol) -> u32
```

### Zorunlu kalıplar
- `lock_float` **ilk satırı** `user.require_auth();`
- USDC transferi: `token::Client::new(&e, &usdc).transfer(&user, &e.current_contract_address(), &amount);`
- Her `persistent` yazımdan sonra `e.storage().persistent().extend_ttl(&key, 100_000, 100_000);`
- `instance` → Admin/Token/OperatorPk · `persistent` → Float/Device/GateLoad/Spent/Declared
- `assign_gate`: etkinliğin kapı listesinde `GateLoad` değeri en küçük olanı döndür, sonra +1.

### Kabul kanıtı
```sh
stellar contract invoke --id <C...> --source user --network testnet -- \
  lock_float --user <G_user> --amount 103000000 --event EVT1 \
  --fare_try 10000 --rate 485376030 --device_pk <hex64>
```
→ bir `gate_id` dönüyor; `float_of` 103000000 dönüyor; Stellar Expert'te kontrat adresinde USDC bakiyesi görünüyor.

### Not
`rate` ölçeği: TRY/USDC × 10⁷ (48.537603 → `485376030`). Bu ölçeği README'de yaz, jüri "magic number" sanmasın.

---

## PAKET 4 — SOROBAN KONTRAT v2 `[P0-CRIT]` · 120 dk

**Amaç:** Offline fişlerin zincire yazılması ve paranın operatöre geçmesi. Projenin kalbi.

```rust
fn settle(e: Env, gate: Symbol, receipts: Vec<Receipt>) -> u32
fn gate_report(e: Env, gate: Symbol, counter: u32)
fn refund(e: Env, user: Address)                // user.require_auth()
fn stats(e: Env, event: Symbol) -> (u32, u32, i128)   // beyan, zincirde, toplam
```

### `settle` — her fiş için sırayla

1. `Spent(ent_hash, seq)` var mı? → **varsa `continue`, hata fırlatma.** (İdempotanlık şart: görevli aynı batch'i iki kez gönderirse tüm settle düşmemeli.)
2. Kullanıcının `Device(user)` anahtarını oku.
3. Fişin kanonik baytlarını üret (aşağıya bak) → `e.crypto().ed25519_verify(&device_pk, &msg, &sig)`.
4. `Float(user) >= fare_usdc` mi? Değilse `continue`.
5. `fare_usdc = fare_try * 10^7 / rate` — kilitli kurla, TL sabit kalıyor.
6. `Float(user) -= fare_usdc`; `Spent` işaretle; `extend_ttl`.
7. Toplamı biriktir.
8. Döngü sonunda **tek transfer**: kontrat → operatör, toplam kadar USDC. (Fiş başına transfer değil — ücret ve satır sayısı için.)
9. `e.events().publish(...)` — kaç fiş, toplam tutar.

### Kanonik mesaj formatı — **en kritik uyum noktası**

ESP32, tarayıcı ve Soroban aynı baytları üretmek zorunda. JSON kullanma — anahtar sırası, boşluk, sayı biçimi üç yerde tutmaz.

**Sabit uzunlukta, düz bayt dizisi:**

```
msg = "OFFGATE-RCPT-v1"   (15 bayt ASCII)
    || ent_hash            (32 bayt)
    || gate_id             (16 bayt, sağdan \0 dolgulu ASCII)
    || seq                 (4 bayt, big-endian u32)
    || fare_try_kurus      (8 bayt, big-endian u64)
    || ts                  (8 bayt, big-endian u64)
                           = 83 bayt sabit
```

Bu formatı üç yerde de **kopyala-yapıştır aynı** yaz. Bir test vektörü (bilinen msg → bilinen imza) `docs/test-vector.md`'ye koy; ESP32'yi buna karşı doğrula.

`ent_hash` = entitlement'ın kanonik baytlarının SHA-256'sı (aynı mantık, `"OFFGATE-ENT-v1"` öneki ile).

### `refund`
`user.require_auth()` → kalan `Float(user)`'ı kullanıcıya geri transfer et, `Float` sıfırla.

### Kabul kanıtı
CLI'dan elle 2 fişli bir `settle` çağrısı → `2` dönüyor; `float_of` azalmış; operatör hesabında USDC artmış (Stellar Expert). Aynı çağrıyı tekrarla → `0` dönüyor, hata yok.

### Geri çekilme
Süre biterse: `refund`'u atla (README'de "yol haritası"), `stats`'i atla. **`settle` asla atlanmaz.**

---

## PAKET 5 — KONTRAT UNIT TESTLERİ `[P1-HIGH]` · 45 dk

Jürinin "teknik uygulama" kriteri. `contracts/offgate/src/test.rs`, `soroban_sdk::testutils` ile.

Yazılacak 6 test (süre kısaysa ilk 3'ü yaz):

1. `test_double_spend_rejected` — aynı `(ent_hash, seq)` ikinci kez sayılmıyor, `settle` `0` dönüyor.
2. `test_bad_signature_rejected` — bozuk `sig` ile fiş atlanıyor, float değişmiyor.
3. `test_float_exhaustion` — kalan float ücretin altındayken fiş atlanıyor.
4. `test_lock_requires_auth` — `mock_auths` olmadan `lock_float` panikliyor.
5. `test_gate_assignment_balances` — 3 kapı, 6 kullanıcı → yükler 2/2/2.
6. `test_refund_returns_remainder` — refund sonrası kullanıcı bakiyesi doğru.

**Kabul kanıtı:** `cargo test` → tüm testler yeşil, terminal çıktısı README'ye.

---

## PAKET 6 — WEB: ONLINE AKIŞ `[P0-CRIT]` · 150 dk

**Amaç:** Kripto bilmeyen birinin tek butona basıp bileti olması.

### Ekranlar (3 tane, fazlası değil)

| Ekran | İçerik |
|---|---|
| **1 · Cüzdan** | "Cüzdanı Bağla" — `@creit.tech/stellar-wallets-kit` ile modal. **Integration partner budur, README'de belirt.** |
| **2 · Yükleme** | Tek büyük buton: **"500 TL Yükle"**. Altında canlı adım listesi (aşağıda). |
| **3 · Bilet** | "5 geçiş hakkı · Kapı M-3-07 · 100 TL/geçiş", büyük **"Kapıya Git — Bileti Kopyala"** butonu, Stellar Expert linki. |

### "500 TL Yükle" butonunun arkası — kullanıcıya adım adım gösterilecek

```
[✓] Cüzdan doğrulandı            (SEP-10)
[✓] Kur kilitlendi: 1 USDC = 48.5376 TRY   (SEP-38)
[✓] Ödeme talimatı alındı — Ref: TR-8842   (SEP-6 deposit)
[✓] Banka transferi alındı                 (simulate-bank-transfer)
[✓] 10.30 USDC hesabınıza geçti
[✓] Bakiye zincire kilitlendi — Kapı: M-3-07  (lock_float)
```

Bu liste jüri için altın değerinde: anchor entegrasyonunun iş mantığına gömülü olduğunu **gösteriyor**, anlatmıyor.

### Teknik notlar
- P2'deki script mantığını `web/src/lib/anchor.ts`'e taşı — kod tekrarı yok, kanıtlanmış kod.
- `lock_float` çağrısı: `@stellar/stellar-sdk` `contract.Client` + Wallets Kit `signTransaction`.
- Trustline kontrolü: kullanıcı hesabında USDC trustline yoksa `changeTrust` işlemini akışın başında sessizce imzalat.
- Cihaz anahtarı: `@noble/ed25519` ile üret, gizli anahtar **sadece** localStorage'da, ekranda gösterme.
- Hiçbir secret `.env`'den frontend'e girmiyor — kullanıcı tarafı tamamen cüzdan imzasıyla çalışıyor.

**Kabul kanıtı:** Tarayıcıda butona bas → 6 adım da yeşil → Stellar Expert'te `lock_float` işlemi.

---

## PAKET 7 — FİŞ DEFTERİ VE BUNDLE `[P0-CRIT]` · 45 dk

**Amaç:** Kullanıcı kapıya gitmeden önce tüm fişleri hazırlamak (karar K-2).

1. `lock_float` başarılı olunca **operatör** entitlement'ı imzalar.
   *Demo için:* operatör imzası `scripts/` altındaki küçük bir imza ucundan veya — en basiti — `lock_float`'tan sonra frontend'in operatör anahtarına erişimi olmadığı için **entitlement'ı kontrat durumundan türet**: `ent_hash`, zincirdeki `(user, event, gate, fare, rate, device_pk)` alanlarından hesaplanır. Kapı, operatör imzası yerine bu alanları operatörün açık anahtarıyla imzalanmış tek bir "event key" üzerinden doğrular.
   **Basit yol (önerilen):** operatör anahtarını `scripts/sign-entitlement.mjs` içinde tut, frontend bu ucu çağırır (Vercel serverless function, secret `.env`'de). Frontend'e asla inmez.
2. `seq = 1..max_uses` için fişleri üret, her birini cihaz gizli anahtarıyla imzala (kanonik 83 baytlık format).
3. Paketle: `{ ent, receipts[] }` → JSON → gzip → base64url → **bundle**.
4. Ekranda "Bileti Kopyala" → `navigator.clipboard.writeText(bundle)` + altında seçilebilir `<textarea>` (pano izni reddedilirse elle seç-kopyala).

**Kabul kanıtı:** Bundle panoya düşüyor, `scripts/verify-bundle.mjs` onu açıp 5 imzayı da doğruluyor.

**Not:** `ts` alanı fişler ön-imzalandığı için üretim zamanıdır, geçiş zamanı değil. README'de dürüstçe yaz: *"Fiş zaman damgası üretim anını gösterir; geçiş anı kapının kendi sayacıyla kaydedilir."*

---

## PAKET 8 — ESP32 FİRMWARE `[P0-CRIT]` · 180 dk

**Amaç:** İnternetsiz, gizli anahtarsız, kendi başına karar veren kapı.

### 4 aşama — her aşama ayrı ayrı test edilir

**8a · AP + captive portal (45 dk)**
- `WiFi.softAP("OFFGATE-M307")`, şifresiz
- `DNSServer` → tüm sorgular `192.168.4.1`
- `/` → gömülü HTML (PROGMEM string)
- **Kanıt:** telefon ağa bağlanıyor, sayfa kendiliğinden açılıyor.

**8b · `/pay` POST + JSON (45 dk)**
- `ArduinoJson` ile bundle'ı parse et
- Şimdilik imza doğrulamadan "kabul" dön, LED yak
- **Kanıt:** telefondan gönder, LED yanıyor, `/screen` sayacı artıyor.

**8c · Ed25519 doğrulama (60 dk) — SAAT SINIRI VAR**
- `rweather/Crypto` → `Ed25519::verify(sig, pubkey, msg, 83)`
- **İki imza:** entitlement (operatör açık anahtarı, firmware'e gömülü) + fiş (entitlement içindeki cihaz açık anahtarı)
- `docs/test-vector.md`'deki vektörle doğrula — canlı veriyle uğraşmadan önce
- **⏱ Bu aşamaya başladıktan 90 dk sonra çalışmıyorsa B PLANINA GEÇ. Tartışma yok.**

**8d · NVS + seq + ekran (30 dk)**
- `Preferences` → anahtar `s<ent_hash_ilk8><seq>` → `true`
- Aynı fiş ikinci kez → **RED**, kırmızı LED
- `/screen` → sayaç + son durum, `<meta http-equiv=refresh content=1>`
- `/receipts` → toplanan fişler JSON · `/reset` → demo tekrarı

### B PLANI (8c için)
Doğrulamayı laptopta Node ile yap; ESP32'ye seri porttan `OPEN\n` gönder, LED yansın. Demo görsel olarak **birebir aynı**. README'ye dürüstçe yaz: *"Ed25519 doğrulaması hackathon süresinde ESP32'de tamamlanamadı; doğrulama mantığı aynı kanonik format üzerinde Node tarafında çalışıyor, firmware'e taşınması yol haritasında."* Jüri gizlemeyi cezalandırır, dürüstlüğü değil.

### Donanım notları
- ESP32 **5 GHz görmez** — telefonun 2.4 GHz'e bağlandığından emin ol.
- iOS captive portal mini-tarayıcısı localStorage'da kısıtlı → **demoyu Android telefonla yap**; iOS'ta "İnternet olmadan kullan" deyip Safari'den `192.168.4.1` aç.
- LED: yeşil GPIO2, kırmızı GPIO4, 220Ω direnç.

---

## PAKET 9 — SETTLE KÖPRÜSÜ `[P0-CRIT]` · 60 dk

**Amaç:** "Görevli akşam senkronize eder" hikâyesinin çalışan hali.

`scripts/02-settle.mjs`:
1. `GET http://192.168.4.1/receipts` → fiş dizisi
2. JSON'u `Receipt` struct'ına çevir (BytesN dönüşümlerine dikkat)
3. `settle(gate, receipts)` çağır — `operator` anahtarıyla imzala
4. Dönen sayıyı ve tx hash'ini bas
5. `gate_report(gate, counter)` ile kapının beyanını da yaz

`scripts/03-withdraw.mjs`:
6. SEP-10 auth (operatör) → `GET /sep6/withdraw?asset_code=USDC&type=bank_account&amount=6`
7. `withdraw.account_id`'ye ödeme + **`Memo.id(withdraw.memo)`** — memo unutulursa para kaybolmuş görünür
8. `GET /sep6/transaction?id=...` → `completed`

**Kabul kanıtı:** Terminalde `3 fiş kabul edildi · tx: <hash>` ve operatör withdraw'ı `completed`. İki hash de README'ye.

---

## PAKET 10 — DENETİM EKRANI `[P1-HIGH]` · 45 dk

Web uygulamasında `/audit` rotası:

| Kapı | Beyan | Zincirde | Fark | Toplam TRY |
|---|---|---|---|---|
| M-3-07 | 3 | 3 | **0 ✓** | 300.00 |

Veri: `stats(event)` + `gate_load(gate)` kontrat okumaları. Fark 0 değilse kırmızı.

Bu, sunumun 7. adımı ve "organizatör eksik hasılat beyan edemez" iddiasının **kanıtı**. Süre biterse `scripts/04-audit.mjs` terminal çıktısı da iş görür.

---

## PAKET 11 — UÇTAN UCA PROVA `[P0-CRIT]` · 60 dk

Akışı **baştan sona 3 kez** çalıştır. Her turda `/reset` + yeni kullanıcı hesabı.

Kontrol listesi:
- [ ] Yükleme akışı 6 adım da yeşil
- [ ] Bundle kopyalanıyor, kapıda yapışıyor
- [ ] **Telefon uçak modunda** kapı açılıyor
- [ ] Aynı fiş tekrar → reddediliyor
- [ ] `/screen` ödünç telefonda doğru
- [ ] Settle → operatörde USDC
- [ ] Withdraw → `completed`
- [ ] Denetim tablosu tutuyor
- [ ] Toplam süre **3 dakikanın altında**

**Pil / powerbank / kablo / yedek telefon** kontrolü burada yapılır.

---

## PAKET 12 — README, DEPLOY, SUBMISSION `[P0-CRIT]` · 60 dk

README bölümleri (`OFFGATE-BUILD-PLAN.md` §9 şablonu) + **bu üç zorunlu madde:**

1. **Integration Partner:** Stellar Wallets Kit — hangi dosyada, hangi çağrı.
2. **Kullanılan Stellar Skill dosyaları — dosya yoluyla:** `SKILL.md` (yigitcangokmen/stellar-hackathon-turkiye) — **bu zorunlu, atlanırsa puan gider.**
3. **Deploy edilmiş artefaktlar:** Contract ID, frontend URL, tüm işlem hash'leri.
4. **Yol haritası → "Taşıma katmanı değiştirilebilir"** paragrafı (K-8 metni, yukarıdan kopyala) + `docs/test-vector.md` linki.

Ayrıca:
- Mermaid diyagramı (plandan kopyala, cihaz anahtarı devrini ekle)
- "Tasarım kararları" bölümüne **K-1, K-2, K-3**'ü yaz — bunlar tam olarak jürinin "teknik zorluklar ve çözümleri" diye sorduğu şey
- `simulate-bank-transfer`'ın mock'a özgü olduğunu açıkça belirt
- Kurulum talimatları: kopyala-çalıştır, baştan sona

Deploy: `vercel --prod`. Submission portalı: repo + canlı URL + deck + **track: Genesis**. **12:00'de gönder, 11:59'da değil.**

---

## PAKET 13 — KULLANICI TESTİ VE SUNUM `[P1-HIGH]` · 60 dk

- **10:00-11:00 (Gün 2):** salonda 5-10 kişiye kullandır. İsim + tek cümle geri bildirim + fotoğraf. README'ye "Etkinlikte N kişi test etti" bölümü. *Kriter 5'in yarısı bu ve neredeyse kimse yapmıyor.*
- Pitch deck: resmi şablon, 6-8 slayt.
- Demo senaryosunu (plan §10) **yeni rakamlarla** güncelle: 500 TL / 100 TL / 5 hak.
- 12:00 sonrası: kod dondu, 3 kez prova.

---

## 3. ZAMAN ÇİZELGESİ — PAKETLERİN TAKVİME OTURMASI

| Pencere | Paketler | Bitişte elde olan |
|---|---|---|
| Gün 1 · 11:30-13:30 | **P0, P1, P2 (başla)** | Contract ID + trustline + SEP-10 token |
| Gün 1 · 13:30-15:00 | *(yemek — mentorlarla konuş, 3 kişiye fikri anlat)* | Traction notları |
| Gün 1 · 15:00-16:00 | *(mentor validation)* | "Wallets Kit yeterli mi?" sorusunun cevabı |
| Gün 1 · 16:00-18:30 | **P2 (bitir), P3** | USDC hesapta + `lock_float` çalışıyor |
| Gün 1 · 19:30-23:00 | **P4, P5** | `settle` çalışıyor + testler yeşil |
| Gün 1 · 23:00-02:00 | **P8 (8a-8c)** | Kapı açılıyor · ⏱ 8c saat sınırı |
| Gün 1 · 02:00-02:30 | **P8d** | NVS + tekrar reddi |
| Gün 1 · 02:30-06:30 | **UYKU — tartışmaya kapalı** | |
| Gün 2 · 06:30-09:00 | **P6, P7** | Tek butonlu akış + bundle |
| Gün 2 · 09:00-10:00 | **P9, P10, P11** | Uçtan uca + denetim |
| Gün 2 · 10:00-11:00 | **P13 (kullanıcı testi)** + P12 paralel | Geri bildirimler |
| Gün 2 · 11:00-12:00 | **P12 bitir → SUBMIT** | Gönderildi |
| Gün 2 · 12:00-13:00 | **P13 (prova)** | 3 prova |

**Dikkat:** P6 (frontend) sabaha kaldı. Riskli. Eğer P4 gece 22:00'de biterse **P6'yı öne al**, ESP32'yi sabaha bırak — çünkü ESP32'nin B planı var, frontend'in yok.

---

## 4. KARAR KAYITLARI (README'ye girecek)

| # | Karar | Gerekçe |
|---|---|---|
| K-1 | Fişleri cihaz anahtarı imzalar, cüzdan değil | Cüzdan uzantısı offline ham bayt imzalayamaz; zincir üstü yetki devri daha güvenli |
| K-2 | Fişler online iken ön-imzalanır (fiş defteri) | Origin izolasyonu + Safari WebCrypto Ed25519 riski; seyahat çeki modeli |
| K-3 | 500 TRY yükleme / 100 TRY geçiş | Anchor `min_offramp_usdc = 1.0` limitinin üstünde kalmak |
| K-4 | Kanonik mesaj = sabit 83 bayt, JSON değil | Üç platformda (Rust/JS/C++) bayt-bayt aynı sonucu garanti etmek |
| K-5 | Kapı ataması zincirde | Yük dengeleme ve çifte harcamanın tek kapıya bağlanması denetlenebilir olmalı |
| K-6 | Vite+React, Next.js değil | SSR/polyfill riski yok, 3 sn build |
| K-7 | Kamera/QR yok | `http://` origin'de tarayıcı kamerayı açmaz; sertifika işi saat yakar |
| K-8 | Taşıma katmanı bağımsızlığı | Doğrulama sabit 83 bayt üzerinde; QR/BLE/NFC/mobil uygulama firmware ve sözleşme değişikliği gerektirmeden eklenebilir |

### K-8 ayrıntı — README "Yol haritası" bölümüne girecek metin

> **Taşıma katmanı değiştirilebilir.**
> Fiş doğrulaması, taşıma biçiminden bağımsız olarak tanımlanmış sabit 83 baytlık kanonik mesaj üzerinde çalışır (`docs/test-vector.md`). Kapı firmware'i baytların nereden geldiğini bilmez; bugün yerel wifi üzerinden HTTP POST ile geliyor, aynı baytlar değişiklik gerektirmeden QR kare, BLE karakteristiği veya NFC üzerinden de taşınabilir. Doğrulama, `seq` kontrolü ve `settle` yolu aynı kalır.
>
> QR bu sürümde bilinçli olarak kapsam dışı: tarayıcılar güvenli olmayan origin'de (`http://192.168.4.1`) kamerayı açmıyor. Bu bir mimari sınır değil, tarayıcı kısıtı — native mobil uygulamada geçerli değil. Mobil uygulama bu nedenle web akışının yerine geçmez, yanına **ikinci bir taşıma katmanı** olarak eklenir; sözleşme ve firmware tarafında değişiklik gerektirmez.

**Şart:** Bu iddia ancak `docs/test-vector.md` gerçekten varsa geçerli. P4 ve P8c'de zorunlu.

---

## 5. ÖLDÜRME ŞALTERLERİ (süre biterse sırayla kes)

1. `stats()` + denetim ekranı → terminal çıktısıyla göster
2. `refund()` → "yol haritası"
3. Unit testler 6'dan 3'e
4. `assign_gate` yük dengeleme → sabit tek kapı (**ama bunu README'de belirt**)
5. ESP32 Ed25519 → B planı (Node doğrulama + seri port)

**Asla kesilmeyecekler:** SEP-10/38/6 gerçek akış · `lock_float` + `require_auth` · `settle` + çifte harcama reddi · offline geçiş gösterimi · README.

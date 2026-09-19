# OffGate — Zincir Üstü Artefaktlar

> Hepsi **Stellar Testnet**. Gerçek para yok.
> Network passphrase: `Test SDF Network ; September 2015`

Son güncelleme: 19 Eylül 2026 — Paket 3 sonu

## Kontrat

| Alan | Değer |
|---|---|
| **Contract ID** | `CCEGEHR4Q7PTYUWC3BQE2XUNX4X563UBWG3JUE64HPOSL5EGXG5PT5FR` |
| Gezgin | https://stellar.expert/explorer/testnet/contract/CCEGEHR4Q7PTYUWC3BQE2XUNX4X563UBWG3JUE64HPOSL5EGXG5PT5FR |
| Deploy tx | `c4b5165818731dfddd387bfcf8004b1581792549f0c6abd478434a5816395b51` |
| `init` tx | P3 deploy'u ile birlikte yenilendi |
| soroban-sdk | 27 · hedef `wasm32v1-none` |

> **Not:** `settle` ve `refund` P4'te eklenecek; kontrat o zaman bir kez daha deploy
> edilecek ve bu tablodaki Contract ID güncellenecek. P1'de deploy edilen ilk sürüm
> `CAQORKDW…CXYT` idi (kurulum iskeleti) — deploy hattının çalıştığını kanıtlamak içindi.

## Hesaplar

| Rol | Adres | Görev |
|---|---|---|
| admin | `GDE7PTP774PCYBE5N6QCPG4QKGYCCSOUWUPDISBBKPKI3CDIUEGLG7HJ` | Deploy + `init` |
| operator | `GDICV4EQQZENJLJT4G6P7D3GMDC3CTMVFH3VH3X5WSXLR3723YJGITG4` | Entitlement imzalar, hasılatı alır, withdraw eder |
| user | `GCE2P4ZJAC2FWNJIDMA7DXKM5UUIVHPQ36NKY2PLNLM4QXGF7TV4K7QS` | Demo kullanıcısı |

Üçü de Friendbot ile fonlandı (9999.99 XLM).

Operatörün ham Ed25519 açık anahtarı (ESP32 firmware'ine gömülecek, **gizli değil**):
```
d02af0908648d4ad33e1bcff8f6660c5b14d9529f753eefdb4aeb8effade1264
```

## Varlıklar

| Alan | Değer |
|---|---|
| USDC (klasik) | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| USDC (Soroban/SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

### Trustline'lar (zincirde doğrulandı)

| Hesap | Tx | Durum |
|---|---|---|
| user | `868be52eb7246184e6000e6b0b1ca11bc1a3357be05591ee92f16de3c9a87900` | ✅ USDC 0.0000000 |
| operator | `5fa149ddcc31454269552882713954763c2efa77010132915964ab1e8ebe36b3` | ✅ USDC 0.0000000 |

## Anchor

| Alan | Değer |
|---|---|
| Home domain | `tr-mock-anchor.fly.dev` |
| Kur (19 Eyl 08:00 UTC) | mid 48.781511 · buy 49.025418 · **sell 48.537603** TRY/USDC |
| Limitler | onramp 50–3000 TRY · offramp min 1.0000000 USDC |

## Doğrulama komutları

```sh
# Kontrat kurulumu okunuyor mu
stellar contract invoke --id CCEGEHR4Q7PTYUWC3BQE2XUNX4X563UBWG3JUE64HPOSL5EGXG5PT5FR \
  --source admin --network testnet -- admin

# Trustline zincirde mi
curl -s https://horizon-testnet.stellar.org/accounts/GCE2P4ZJAC2FWNJIDMA7DXKM5UUIVHPQ36NKY2PLNLM4QXGF7TV4K7QS \
  | jq '.balances[] | select(.asset_code=="USDC")'
```

## Paket 2 — anchor akışı kanıtı

`node scripts/01-anchor-flow.mjs` ile üretildi.

| Alan | Değer |
|---|---|
| Yatırılan | 500.00 TRY |
| Alınan | 10.1980454 USDC |
| Kilitli kur (SEP-38) | 1 USDC = 48.785078 TRY |
| Anchor emir no | `sep_rqfwubo3cp7lcwau39jz` |
| Ödeme yolu | SEP-6 **deposit-exchange** (quote_id ile kur kilitli) |
| Banka referansı | `TRMA-QY34-AHDG` (EFT açıklamasına yazılan kod) |
| Zincir işlemi | `1f0b02e9bcb876874bd016358eef6b15ad4f67ff9a9294d62e38525ed83cec19` |
| Gezgin | https://stellar.expert/explorer/testnet/tx/1f0b02e9bcb876874bd016358eef6b15ad4f67ff9a9294d62e38525ed83cec19 |

### Entegrasyon notları

- **Hiçbir endpoint kodda sabit değil.** Hepsi SEP-1 (`/.well-known/stellar.toml`)
  üzerinden keşfediliyor. Başka bir anchor'a geçmek için tek değişen şey home domain.
- **SEP-10 challenge doğrulaması:** gelen challenge işleminin anchor'ın `SIGNING_KEY`'i
  tarafından imzalandığı kontrol ediliyor (ortadaki adam koruması). JWT 401 dönerse
  oturum kendini bir kez yeniliyor.
- **SEP-6 `deposit-exchange`** kullanılıyor, düz `deposit` değil. `quote_id` ile kur
  kilitleniyor; biletin TL fiyatı bu andan itibaren sabit. Düz `deposit` yalnızca
  yedek yol olarak kodda duruyor.
- **Parametre biçimi:** `destination_asset` düz varlık kodu (`USDC`),
  `source_asset` SEP-38 biçimi (`iso4217:TRY`). SEP-38 biçimi ikisinde de
  kullanılırsa anchor 400 döner.
- **`simulate-bank-transfer` yalnızca mock anchor'da vardır.** Gerçekte kullanıcı
  EFT açıklamasına referans kodunu yazar, anchor ödemeyi Stellar hesabıyla eşleştirir.

## Paket 3 — kilitleme ve kapı ataması

Kontrat `lock_float` + `assign_gate` ile yeniden deploy edildi.

| Alan | Değer |
|---|---|
| Contract ID | `CCEGEHR4Q7PTYUWC3BQE2XUNX4X563UBWG3JUE64HPOSL5EGXG5PT5FR` |
| Deploy tx | `c4b5165818731dfddd387bfcf8004b1581792549f0c6abd478434a5816395b51` |
| Kayıtlı kapılar | `M307`, `M308`, `M309` (etkinlik `EVT1`) |
| `lock_float` tx | `360e2752e000a634d6d11b23928c642bf5b00fb85bd0073edcbc77d87628c5e1` |

### Gerçek çağrının sonucu

```
lock_float(user, 102000000, EVT1, fare_try=10000, rate=487850780, device_pk=98d1ab95…)
  -> "M307"

float_of(user)      = 102000000   (10.2 USDC)
uses_left(user)     = 4           (100 TL / 48.785078 = 2.0498 USDC per geçiş)
gate_load(M307)     = 1
gate_load(M308)     = 0
assign_gate(EVT1)   = "M308"      (yük dengeli: sıradaki en boş kapı)

kullanıcı USDC      : 20.3960908 -> 10.1960908
kontrat USDC        : 0          -> 10.2000000
```

Yayınlanan olaylar (`stellar contract invoke` çıktısından):
- SAC `transfer`: kullanıcı → kontrat, 102000000
- OffGate `FloatLocked`: user, event, gate, amount, fare_try, rate

### Uygulama notları

- **`require_auth`** `lock_float`'ın ilk satırında. Para yalnızca sahibinin imzasıyla hareket eder.
- **Kapı ataması para hareketinden önce** yapılıyor: atama başarısız olursa hiç USDC hareket etmez
  (test: `lock_without_gates_fails_and_moves_no_money`).
- **Cihaz anahtarı zincire yazılıyor** (karar K-1). Fişleri bu anahtar imzalayacak, cüzdanın
  ana anahtarı telefonun offline tarafına hiç inmiyor.
- **Ücret matematiği:** `stroop = fare_try × 10⁷ × 10⁷ / (100 × rate)`.
  `fare_try` kuruş, `rate` TRY/USDC × 10⁷. Kilitli kur `Acct`'te saklandığı için
  piyasa oynasa da kullanıcının geçiş başına ödediği TL değişmez.
- **TTL:** her `persistent` yazımdan sonra `extend_ttl` çağrılıyor (eşik 100.000, uzatma 500.000).
- **Olaylar** `#[contractevent]` makrosu ile tanımlı (SDK 27'nin güncel yolu), eski
  `events().publish()` değil.

### Testler

`cargo test -p offgate` → **12/12 geçiyor**

| Test | Ne kanıtlıyor |
|---|---|
| `init_stores_config_and_rejects_second_call` | Kurulum tek seferlik |
| `register_gate_adds_once_and_rejects_duplicate` | Kapı iki kez kaydedilemez |
| `lock_without_gates_fails_and_moves_no_money` | Başarısız atamada para hareket etmez |
| `lock_float_moves_usdc_and_assigns_gate` | Ana akış + olay yayını |
| `lock_float_rejects_amount_below_one_fare` | Bir geçişe yetmeyen tutar reddedilir |
| `lock_float_rejects_second_lock_for_same_user` | Çifte kilit engelli |
| `lock_float_rejects_nonpositive_values` | Sıfır/negatif tutar, ücret, kur reddedilir |
| `lock_float_requires_user_auth` | İmzasız çağrı panikler |
| `gate_assignment_spreads_load_evenly` | 3 kapı / 6 kullanıcı → 2-2-2 |
| `assign_gate_picks_least_loaded` | En az yüklü kapı seçiliyor |
| `assign_gate_fails_for_unknown_event` | Bilinmeyen etkinlik reddedilir |
| `fare_conversion_matches_locked_rate` | Kur matematiği ve TL sabitliği |

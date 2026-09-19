# OffGate — Zincir Üstü Artefaktlar

> Hepsi **Stellar Testnet**. Gerçek para yok.
> Network passphrase: `Test SDF Network ; September 2015`

Son güncelleme: 19 Eylül 2026 — Paket 2 sonu

## Kontrat

| Alan | Değer |
|---|---|
| **Contract ID** | `CAQORKDWXS4MQNMOYQ6AMRVZWMBAGSQYXQQF5P3TV7AUBSND6NRACXYT` |
| Gezgin | https://stellar.expert/explorer/testnet/contract/CAQORKDWXS4MQNMOYQ6AMRVZWMBAGSQYXQQF5P3TV7AUBSND6NRACXYT |
| Deploy tx | `8dbd6da07e46dead6fc627288d43337c28aa03949cea6e91b90be07e5d808dfb` |
| `init` tx | `dc9ab79d78a23886f8b23a734d329af487807eff0a50abe6b7ee933107c9a5f9` |
| soroban-sdk | 27 · hedef `wasm32v1-none` |

> **Not:** P1'de deploy edilen sürüm kurulum iskeletidir (`init`, okuma fonksiyonları).
> `lock_float`/`settle` P3-P4'te eklenecek ve kontrat yeniden deploy edilecek — o zaman
> bu tablodaki Contract ID güncellenecek. P1'in amacı deploy hattının çalıştığını
> **bugün** kanıtlamaktı.

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
stellar contract invoke --id CAQORKDWXS4MQNMOYQ6AMRVZWMBAGSQYXQQF5P3TV7AUBSND6NRACXYT \
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

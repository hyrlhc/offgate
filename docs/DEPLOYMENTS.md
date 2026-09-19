# OffGate — Zincir Üstü Artefaktlar

> Hepsi **Stellar Testnet**. Gerçek para yok.
> Network passphrase: `Test SDF Network ; September 2015`

Son güncelleme: 19 Eylül 2026 — Paket 10 sonu

## Kontrat

| Alan | Değer |
|---|---|
| **Contract ID** | `CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX` |
| Gezgin | https://stellar.expert/explorer/testnet/contract/CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX |
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

## Paket 4 — settle, refund ve denetim

Kontrat `settle` + `refund` + denetim fonksiyonlarıyla yeniden deploy edildi.

| Alan | Değer |
|---|---|
| **Contract ID** | `CBXZ34NZR2R7TVHFGKJZYSIVFBXSYJ5UM2QQ67NQC6ZRPVW5VNPC42BL` |
| Gezgin | https://stellar.expert/explorer/testnet/contract/CBXZ34NZR2R7TVHFGKJZYSIVFBXSYJ5UM2QQ67NQC6ZRPVW5VNPC42BL |
| Kayıtlı kapılar | `M307`, `M308`, `M309` (etkinlik `EVT1`) |

### Uçtan uca testnet kanıtı — gerçek Ed25519 imzalarıyla

```
1. assign_gate(EVT1)                        -> "M307"     (yük dengeli seçim)
2. lock_float(user, 10.0 USDC, ..., ent_hash) -> "M307"
     float_of = 100000000   uses_left = 4

3. settle(M307, [fiş 1, 2, 3])              -> 3 kabul
     Settled olayı: accepted 3, submitted 3, amount 61494213
     SAC transfer : kontrat -> operatör, 6.1494213 USDC

4. settle(M307, [aynı 3 fiş])               -> 0 kabul     ← idempotanlık
     Settled olayı: accepted 0, submitted 3, amount 0
     Bakiye değişmedi.

5. gate_report(M307, 3)
   stats(EVT1)                              -> [3, 3, "61494213"]
     beyan 3 = zincir 3  ✓ denetim tutuyor

6. refund(user)                             -> 38505787   (3.8505787 USDC)
     kontrat bakiyesi 0, kapı yükü 0
     is_spent(ent_hash, 1) hâlâ true  ← eski fişler yeniden kullanılamaz
```

Kullanılan gerçek entitlement:
```
ent_hash  af3c43f2ea671f04d41fc77ad1fcf76940e4c1de2a427dd14227b277ef803713
device_pk 98d1ab9592829c8f97ff9e730c777dc55b1e219c2817ce5cd983a83e39362ed8
fare_try  10000 (100.00 TL)   rate 487850780 (1 USDC = 48.785078 TRY)
```

### K-3 doğrulandı

Operatöre geçen 6.1494213 USDC, anchor'ın `min_offramp_usdc = 1.0` limitinin
**üstünde**. Eski demo rakamlarıyla (50 TL / 5 TL) bu tutar 0.31 USDC olacak ve
withdraw adımı çalışmayacaktı.

### Güvenlik kararları

- **`settle` idempotenttir.** Aynı fiş ikinci kez gelirse sessizce atlanır, batch
  düşmez. Görevli aynı senkronizasyonu iki kez çalıştırabilir.
- **Geçersiz imza batch'i durdurur.** Soroban'ın `ed25519_verify` fonksiyonu
  başarısızlıkta panik atar, değer döndürmez. Kapı her fişi kabul anında
  doğruladığı için normal akışta sahte fiş `settle`'a hiç ulaşmaz. Bu davranış
  bilinçli: sahte fiş taşıyan bir batch sessizce kısmen işlenmez.
- **Fiş, hesabın kapısına bağlıdır.** Başka kapının fişi sayılmaz; `ent_hash`
  tutmayan fiş sayılmaz; `fare_try` oynatılmış fiş imza doğrulamasında düşer.
- **`refund` sonrası `Spent` kayıtları silinmez.** Aynı entitlement ile yeniden
  kilitlense bile eski fişler harcanmış sayılır (test:
  `refund_keeps_spent_receipts_unusable_after_relock`).
- **Yük dengesi zincirde zorlanıyor.** `lock_float`, seçilen kapının yükünün
  en az yüklü kapıdan `GATE_LOAD_TOLERANCE = 2`'den fazla yüksek olmasına izin
  vermez. Tolerans, eşzamanlı isteklerdeki yarışa alan bırakır.

### Kanonik format (karar K-4)

Fiş imzası **sabit 67 bayt** üzerinde: `"OFFGATE-RCPT-v1"` (15) + `ent_hash` (32)
+ `seq` (4, BE) + `fare_try` (8, BE) + `ts` (8, BE).

Kapı kimliği mesajda yok — `ent_hash` zaten kapıyı bağlıyor. Bu sayede sözleşmede
`Symbol` → bayt dönüşümüne gerek kalmıyor (Soroban'da `ToString for Symbol`
yalnızca wasm dışında mevcut).

Rust ve JavaScript'in aynı baytı ve aynı imzayı ürettiği
[docs/test-vector.md](test-vector.md) ile sabitlendi; `cargo test -p offgate canonical`
bunu derleme zamanında zorluyor. ESP32 firmware'i (P8c) aynı vektöre karşı
doğrulanacak.

### Testler

`cargo test -p offgate` → **26/26 geçiyor**, gerçek Ed25519 imzalarıyla
(`ed25519-dalek`, yalnızca dev-dependency).

Öne çıkanlar:

| Test | Ne kanıtlıyor |
|---|---|
| `settle_accepts_valid_receipts_and_pays_operator` | Ana akış, hasılat operatöre geçiyor |
| `settle_is_idempotent_for_repeated_batches` | Mükerrer gönderim zararsız |
| `settle_rejects_replayed_sequence_number` | Tekrar saldırısı `seq` ile engelli |
| `settle_rejects_forged_signature` | Başka anahtarla imzalı fiş batch'i durduruyor |
| `settle_rejects_tampered_amount` | Ücret oynatma imzada düşüyor |
| `settle_skips_receipts_from_another_gate` | Fiş tek kapıya bağlı |
| `settle_stops_when_balance_is_exhausted` | 6 fiş gönderildi, 4'ü kabul |
| `refund_keeps_spent_receipts_unusable_after_relock` | İade sonrası eski fişler ölü |
| `lock_float_enforces_load_balance_on_chain` | Yük dengesi zincirde zorunlu |
| `stats_reveal_underreporting_gate` | Eksik beyan denetimde görünüyor |
| `canonical_message_matches_javascript_vector` | Rust ve JS bayt-bayt aynı |

## Paket 8 — kapı donanımı

ESP32 açılışta `docs/test-vector.md`'ye karşı öz-test çalıştırır. Seri port çıktısı:

```
OffGate — kanonik format öz-testi
  ✓ fiş kanonik baytları (67) doğru
  ✓ Ed25519 doğrulaması geçti (97 ms)
  ✓ bozuk imza reddedildi
  ✓ entitlement kanonik baytları (138) doğru
  ✓ SHA-256 ent_hash doğru
OffGate kapı hazır
  kapı     : M308
  wifi     : OFFGATE-M308 (şifresiz)
  adres    : http://192.168.4.1
  internet : YOK — doğrulama tamamen yerel
  öz-test  : GEÇTI
```

Böylece **dört platform da aynı baytı üretiyor**: Soroban (Rust), Node, tarayıcı, ESP32.

| Ölçüm | Değer |
|---|---|
| Ed25519 doğrulama | 97 ms |
| RAM | %14.1 (46 KB / 320 KB) |
| Flash | %62.4 (817 KB / 1.3 MB) |

Kapı kimliği derleme bayrağında (`-DOFFGATE_GATE_ID='"M308"'`) — aynı firmware
farklı kapılara farklı kimlikle yüklenir.

## Paket 9 — görevli senkronizasyonu ve TL çıkışı

### `node scripts/02-settle.mjs`

```
kapı M308 · beyan 3 geçiş · 3 fiş
3/3 fiş yerel doğrulamadan geçti
settle       -> 3 fiş kabul  ·  b895867afacc364b9adf25ffc0744ef1d152bf4e27cb87ce4f495efd93e46855
gate_report  -> kapı 3 geçiş beyan etti  ·  0cb88626f200784309d14a1d1e61d95e85c1927933a48847ec0d07f961a7c007
stats(EVT1)  -> beyan 6 · zincirde 6 · hasılat 12.2988426 USDC   ✓ tutuyor
```

Script fişleri **zincire yazmadan önce yerel olarak doğrular**. Geçersiz imza
sözleşmede tüm batch'i durdurduğu için, bozuk fiş burada elenip sebebi gösterilir.
Kaynak esnek: canlı kapı (`--from http://192.168.4.1`), kaydedilmiş dosya, ya da
başka bir aktarım — fişler kendi kendini doğruladığı için kaynağın güvenilir
olması gerekmiyor.

### `node scripts/03-withdraw.mjs`

```
operatör bakiyesi : 12.2988426 USDC
SEP-6 withdraw    : sep_0kt4lsb6yfnox7k2ik1g
hedef             : GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6
memo              : 842492621887 (id)
USDC ödemesi      : 4e4accc0fec4864438a53806cd3d7a3befdd5e05f41aff3a96a05c0c04453593
durum             : pending_user_transfer_start -> completed
ödenen            : 596.99 TRY
kalan bakiye      : 0.0000000 USDC
```

**Tam döngü kapandı:** 500 TRY → USDC → sözleşmede kilitli → internetsiz geçişler
→ fişler zincire → hasılat operatöre → **596.99 TRY** operatörün banka hesabında.

Memo zorunlu tutuluyor: anchor memo döndürmezse script ödemeyi göndermeden duruyor.

## Paket 10 — denetim ekranı

Web uygulamasında `#audit`. Zincirden okunan canlı veri:

| Kapı | Beyan | Zincirde | Fark | Yük |
|---|---|---|---|---|
| M307 | 3 | 3 | 0 ✓ | 1 |
| M308 | 3 | 3 | 0 ✓ | 1 |
| M309 | 0 | 0 | 0 ✓ | 0 |
| **Toplam** | **6** | **6** | **0 ✓** | hasılat 12.2988426 USDC |

Kapı sayacı `gate_report` ile, fişler `settle` ile zincire yazılır. İki sayı
bağımsız kaynaklardan gelir; operatör yalnızca birini eksiltemez.

## Demo dağıtımı — temiz başlangıç

Sözleşme son kez deploy edildi; demo bu adres üzerinden çalışır.

| Alan | Değer |
|---|---|
| **Contract ID** | `CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX` |
| Gezgin | https://stellar.expert/explorer/testnet/contract/CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX |
| Demo etkinliği | `FEST26` |
| Kayıtlı kapı | `M307` (fiziksel ESP32) |

### Neden yeni bir dağıtım

Kapı sayaçları (`Declared`, `Settled`) kapı bazında tutuluyor. Aynı kapı iki
etkinlikte kayıtlı olsaydı `stats` bir etkinliğin geçişlerini diğerine de sayar
ve denetim ekranı yanlış sonuç verirdi — bunu `FEST26` kurarken bizzat gördük:
M307 hem `EVT1`'de hem `FEST26`'da kayıtlıydı ve `EVT1`'in 3 geçişi `FEST26`'nın
denetiminde göründü.

Sözleşmeye `GateEvent` eşlemesi eklendi: **bir kapı yalnızca tek bir etkinliğe
ait olabilir**, ikinci kayıt reddedilir. Böylece kapı bazlı sayaçlar
tek anlamlı hale geldi. Kural `gate_belongs_to_exactly_one_event` testiyle ve
testnet'te elle doğrulandı.

Demo etkinliğinde tek kapı kayıtlı olduğu için `assign_gate` her zaman `M307`
döndürür ve prova tekrarlanabilir. Yük dengeleme kodu aynen duruyor;
`assign_gate_spreads_load_evenly` ve `lock_float_enforces_load_balance_on_chain`
testleri kanıtı.

---

## Kapı seçimi kullanıcıya verildi — yeni dağıtım

| Alan | Değer |
|---|---|
| **Contract ID** | `CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX` |
| Gezgin | https://stellar.expert/explorer/testnet/contract/CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX |
| Etkinlik | `FEST26` |
| Kayıtlı kapılar | `M307` (Kapı 1) · `M308` (Kapı 2) — iki fiziksel ESP32 |

### Neden yeni bir dağıtım gerekti

Önceki dağıtımda `FEST26`'da tek kapı (M307) kayıtlıydı ve yükü 4'tü. İkinci
kapıyı eklediğimiz anda `GATE_LOAD_TOLERANCE` kuralı M307'yi kilitlerdi:
yeni kapının yükü 0, M307'ninki 4, aradaki fark toleransın (2) üstünde.
Kullanıcı M307'yi seçemezdi. İki kapı da sıfırdan başlasın diye yeniden
dağıttık.

### Sözleşme değişikliği — tükenen bilet kapı yerini bırakır

Kapı yükü yalnızca `refund` ile düşüyordu. Bakiyesi biten bir kullanıcı
kapıda sonsuza kadar "açık bilet" olarak sayılıyor, kapı haksız yere dolu
görünüyordu. `settle` artık bakiye bir geçişin altına düştüğünde yükü
bırakıyor. Koşul tam olarak bir kez tutar; sonraki fiş zaten
`acct.balance < fare` kontrolüne takılır.

Kanıt: `settle_releases_gate_slot_when_ticket_is_used_up` (28 test geçiyor).

### Kullanıcı seçimi — zincirde doğrulandı

Web arayüzünden **Kapı 2** seçilerek uçtan uca akış çalıştırıldı:

| Kontrol | Sonuç |
|---|---|
| Akış adımları | 10/10 yeşil, ilk adım "Kapı seçildi · M308 — kullanıcı seçti" |
| Anchor | 500 TL → 10.1980454 USDC (referans TRMA-LNXP-4TAU) |
| `gate_load(M308)` | **1** |
| `gate_load(M307)` | **0** |

Seçim `lock_float`ın kendi argümanı olarak zincire gidiyor; bakiye o kapıya
kilitleniyor, entitlement o kapı için imzalanıyor, fişler başka kapıda kabul
edilmiyor. `assign_gate` yalnızca varsayılan öneri olarak duruyor.

---

## Temiz dağıtım + K-9 güvenlik düzeltmesi

| Alan | Değer |
|---|---|
| **Contract ID** | `CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX` |
| Gezgin | https://stellar.expert/explorer/testnet/contract/CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX |
| Etkinlik | `FEST26` — kapılar `M307` (Kapı 1), `M308` (Kapı 2), ikisi de sıfır yük |

Önceki dağıtımlardaki test kilitleri `refund` gerektiriyordu ve o cüzdanların
anahtarları tek kullanımlık tarayıcı oturumlarındaydı. Temiz başlangıç için
yeniden dağıttık.

### Doğrulanan davranışlar

| Test | Beklenen | Sonuç |
|---|---|---|
| 250 TL yükle, Kapı 1 | 2 geçiş, yük M307'ye | ✓ |
| 700 TL yükle, Kapı 2 | 6 geçiş, yük M308'e | ✓ |
| İstemci gövdesi | yalnızca `{ user, expires }` | ✓ |
| Gövdeye `maxUses: 999` enjekte et | yok sayılsın | ✓ `max_uses: 6` döndü |
| Entitlement'ı zincirdekinden saptır | imza verilmesin | ✓ HTTP 409 |
| 48 saatten uzun bilet iste | reddedilsin | ✓ "gecersiz bilet suresi" |

Üretimde de doğrulandı:

```
POST https://offgate.vercel.app/api/sign-entitlement
{"user":"GCWN…5NL6","expires":1789925817,"maxUses":999}
-> {"ent_hash":"8855afda…","max_uses":6,...}
```

### Geçiş hakkı önizlemesi

TL / ücret **değil**. TL, anchor'ın alış kuruyla USDC'ye çevrilir; ücret ise
SEP-38 kuruyla USDC olarak hesaplanır. Aradaki makas kadar kayıp olur:

| Yüklenen | Naif hesap | Gerçek |
|---|---|---|
| 250 TL | 2 | 2 |
| 500 TL | 5 | **4** |
| 700 TL | 7 | **6** |
| 1000 TL | 10 | 9 |

Arayüz %1.5 pay bırakıp aşağı yuvarlıyor ve "≈" ile gösteriyor; kesin sayı kur
kilitlendikten sonra bilette yazıyor.

---

## Tekrar bilet alma (`top_up`) — yeni dağıtım

| Alan | Değer |
|---|---|
| **Contract ID** | `CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX` |
| Gezgin | https://stellar.expert/explorer/testnet/contract/CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX |
| Etkinlik | `FEST26` — `M307` (Kapı 1), `M308` (Kapı 2) |

### Sorun

Bileti harcayıp yenisini almak imkânsızdı. `lock_float` açık hesap varsa
`AlreadyLocked` (#7) döndürüyor, `settle` ise hesabı hiç silmiyor — bakiye
sıfırlansa bile kayıt duruyordu. Tek çıkış `refund`'dı, o da bütün kilidi
bozuyor.

### Çözüm — `top_up`

Açık bilete bakiye ekler ve **yeni bir entitlement** yürürlüğe koyar. İade
gerekmez. Asıl soru yeni biletin kaç geçiş vermesi gerektiği.

Kapılar çevrimdışı olduğu için, eski biletin imzalanmış haklarının kapıda
harcanıp harcanmadığını zincir **bilemez**. En kötü ihtimali varsayıyoruz:

```
açıkta_kalan = granted - used          (hepsi harcanmış say)
yeni_hak     = bakiye / ücret - açıkta_kalan
```

Böylece imzalanan toplam hak, yatırılan paranın karşıladığı geçiş sayısını
hiçbir zaman aşmaz — kapılar birbirinden ve zincirden habersiz olsa bile.

`Acct` üç alan kazandı: `granted` (bugüne kadar imzalanan toplam hak),
`used` (zincire düşen fiş sayısı), `ent_uses` (yürürlükteki biletin hakkı).
`max_uses` artık istemciden hiç alınmıyor; `lock_float` da kendi hesaplıyor.
İmza ucu geçiş hakkını `ent_uses`'ten okuyor.

`next_grant(user, amount)` istemciye, `top_up` çağrılsa kaç hak verileceğini
önceden söylüyor — entitlement özetini kurabilmesi için gerekli (K-9).

### Zincirde doğrulandı

| Adım | Sonuç |
|---|---|
| 250 TL yükle, Kapı 2 | 2 geçiş, yeni bilet |
| Aynı cüzdanla dön | "Zincirde açık biletin var… İmzalanan 2 geçişin 0 tanesi zincire düştü" |
| 500 TL ekle | **5 geçiş** (kapasite 7 − açıkta 2), yeni `ent_hash` |
| Toplam imzalanan | 2 + 5 = 7 = paranın karşıladığı |
| `gate_load(M308)` | 1 (ek yükleme ikinci kez yük saymıyor) |

Testler: `top_up_never_grants_more_passes_than_the_money_covers`,
`top_up_counts_settled_receipts_as_no_longer_outstanding`,
`top_up_rejects_amount_that_adds_no_pass`, `top_up_requires_an_open_ticket`.
**32 test geçiyor.**

### Açık kalan risk — iade

`refund` hâlâ kullanıcı tarafından her an çağrılabiliyor ve kilidi tamamen
bozuyor. Kullanıcı kapıdan geçip, operatör senkronize etmeden önce iade alırsa
o geçişler bedava kalır. Kullanıcının kararıyla ayrı ele alınacak.

---

## Fiyatlandırma düzeltmesi — banknot mantığı

### Sorun

Arayüz 500 TL karşılığında 4 geçiş veriyordu. Geçiş ücreti 100 TL olduğu halde.

### Kök neden

Geçiş ücretinin kuru SEP-38 quote'unun `price` alanından alınıyordu. O alan
spread'i **hariç** tutuyor; kullanıcının fiilen ödediği kur `total_price`.

```
GET /sep38/price?sell_amount=400&...
  "price":       "48.785078"     <- kullandığımız (yanlış)
  "total_price": "49.0290033"    <- fiilen ödenen
  "buy_amount":  "8.1584363"
```

TL, `total_price` ile USDC'ye çevriliyor ama ücret `price` ile
hesaplanıyordu. Aradaki %0.5 makas her geçişte birikip bir geçişi yutuyordu.

### Düzeltme

**1. Doğru kur.** Ücretin kuru artık `total_price`.

**2. Kur gerçekleşen yatırmadan geri hesaplanıyor.**

```js
ücret_hedef = yatırılan_stroop / geçiş_sayısı        // aşağı yuvarla
kur         = ceil(fare_try · 10⁷ · 10⁷ / (100 · ücret_hedef))
```

Sadece (1) yeterli değildi: `total_price` 7 haneye yuvarlanmış bir sayı ve
ondan çıkan ücretle çarpınca elde kalan pay 100 TL'de **tek bir stroop**'a
iniyordu. Kur kıpırdasa geçiş sayısı bire düşerdi. Geri hesaplama, kullanıcının
fiilen ödediği kurun yuvarlanmamış hali — payı garantiye alıyor.

Gerçek anchor fiyatlarıyla doğrulandı:

| Ödenen | Beklenen | Çıkan | Artan |
|---|---|---|---|
| 100 TL | 1 | 1 | 1 stroop |
| 200 TL | 2 | 2 | 3 |
| 400 TL | 4 | 4 | 7 |
| 500 TL | 5 | 5 | 9 |
| 3000 TL | 30 | 30 | 55 |

### Arayüz

Serbest TL girişi kaldırıldı. Kullanıcı **kaç geçiş** istediğini seçiyor,
tutar çarpımla çıkıyor: `5 × 100 TL = 500 TL`. Seçilen sayı kadar banknot
simgesi gösteriliyor — nakit sezgisi.

Ek yüklemede kur zincirde kilitli kalır; kullanıcının geçiş başına ödediği TL
piyasa oynasa da değişmez.

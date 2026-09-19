# OffGate — Basit Akış

Bu dosya sistemi baştan sona, sade dille anlatır. Amaç: kendi sistemimizi
tek oturuşta kavramak. Her iddianın altında hangi dosyada hangi kontrolün
yaptığı yazıyor, böylece merak ettiğinde koda gidebilirsin.

---

## 1. Tek cümlede ne yapıyoruz

Kullanıcı TL yatırır, bu TL zincirde USDC olarak kilitlenir, karşılığında
**imzalı bir bilet** alır; turnike internetsiz olduğu halde o bileti
doğrulayıp kapıyı açar, para sonradan zincir üzerinden organizatöre geçer.

Kritik nokta: **turnike hiçbir şeye bağlı değil.** Ne internete, ne zincire,
ne de merkezî bir sunucuya. Elinde sadece bir Ed25519 açık anahtarı var.

---

## 2. Üç oyuncu, üç anahtar

Sistemdeki her şey "kim neyi imzalar" sorusuna dayanıyor.

| Anahtar | Kim üretir | Özel kısmı nerede durur | Neyi imzalar |
|---|---|---|---|
| **Cüzdan** (Freighter vb.) | Kullanıcı | Cüzdan eklentisinde | Zincir işlemlerini |
| **Operatör** | Biz | Vercel Secret — sunucuda | Bileti (entitlement) |
| **Cihaz** | Kullanıcının tarayıcısı | localStorage — telefonda | Geçiş fişlerini |

**Turnikenin anahtar çifti yoktur.** Hiçbir şey imzalamaz, yalnızca doğrular.
Firmware'ine gömülü tek sır olmayan şey operatörün **açık** anahtarıdır
(`main.cpp` → `OPERATOR_PK`). Turnike çalınsa içinden para da sır da çıkmaz.

Neden cihaz anahtarı ayrı? Çünkü Freighter çevrimdışı imza atamaz — kullanıcı
kapıda internetsizken cüzdanını açamaz. Bu yüzden tarayıcıda tek kullanımlık
bir anahtar üretiyoruz ve **fişleri daha internet varken önceden imzalıyoruz**.
(Karar K-1 ve K-2.)

---

## 3. Kullanıcının akışı

İnternet **varken** olanlar (telefonda ya da PC'de, cüzdan eklentisiyle):

| # | Adım | Ne oluyor |
|---|---|---|
| 1 | Kapı seç | Kullanıcı Kapı 1 (M307) veya Kapı 2 (M308) seçer |
| 2 | Tutar gir | 50–3000 TL arası, kaç geçiş edeceğini ekranda görür |
| 3 | Güven hattı | Cüzdanda USDC trustline yoksa açılır |
| 4 | SEP-10 | Cüzdan imzasıyla anchor'a giriş — şifre yok |
| 5 | SEP-38 | Kur kilitlenir (1 USDC = 48.78 ₺ gibi) |
| 6 | SEP-6 | Yatırma emri + banka referansı alınır |
| 7 | Banka | (Demoda mock) TL geldi sayılır |
| 8 | USDC | Anchor gerçek testnet USDC'yi cüzdana gönderir |
| 9 | **Kilit** | `lock_float` ile USDC sözleşmeye kilitlenir |
| 10 | **İmza** | Operatör bileti imzalar |
| 11 | **Fiş defteri** | Tarayıcı N adet fişi peşinen imzalar |

Sonuçta elde tek bir metin parçası kalır: **bundle**. İçinde bilet, operatör
imzası ve önceden imzalanmış fişler var. Hiçbir gizli anahtar yok.

İnternet **yokken** olanlar (turnikede):

| # | Adım | Ne oluyor |
|---|---|---|
| 12 | Kapının wifi'sine bağlan | `OFFGATE-M307` — şifresiz, internet yok |
| 13 | Captive portal açılır | Sayfayı **turnike** servis eder, internetten gelmez |
| 14 | Bundle'ı yapıştır | Sayfa bundle'ı localStorage'a yazar |
| 15 | "Geç" | Sayfa sıradaki fişi seçip `/pay`'e POST eder |
| 16 | Turnike karar verir | 9 kontrol (bkz. bölüm 5) |
| 17 | Kapı açılır | LED yanar, fiş turnikenin hafızasına yazılır |

Sonra internet **tekrar varken**:

| # | Adım | Ne oluyor |
|---|---|---|
| 18 | Senkronizasyon | Turnikeden `/receipts` çekilir |
| 19 | `settle` | Fişler zincire yazılır, para operatöre geçer |
| 20 | `gate_report` | Turnikenin kendi sayacı zincire beyan edilir |

---

## 4. İki belge: bilet ve fiş

Sistemin tamamı bu iki sabit uzunluklu bayt dizisine dayanıyor.

### Bilet (entitlement) — 138 bayt, operatör imzalar

```
"OFFGATE-ENT-v1"(14) || user_raw(32) || device_pk(32) || event(16)
  || gate(16) || fare_try(8) || rate(8) || max_uses(4) || expires(8)
```

Bu baytların sha256'sı = **`ent_hash`**. Biletin kimlik numarası budur.

Ne söylüyor: *"Şu kullanıcı, şu cihaz anahtarıyla, şu kapıda, geçiş başına şu
ücretle, en fazla şu kadar kez geçebilir."* Operatör imzaladığı için
değiştirilemez — tek bir bit oynatırsan imza tutmaz.

### Fiş (receipt) — 67 bayt, cihaz anahtarı imzalar

```
"OFFGATE-RCPT-v1"(15) || ent_hash(32) || seq(4) || fare_try(8) || ts(8)
```

Ne söylüyor: *"Şu biletin şu numaralı geçişini kullanıyorum."*

Kapı kimliği burada **yok**, çünkü `ent_hash` zaten kapıyı bağlıyor. (Bu,
sözleşmede `Symbol`'ü bayta çeviremediğimiz için verdiğimiz karar — K-4.)

### Neden sabit uzunluk

Aynı baytları dört ayrı yerde üretiyoruz: Rust (sözleşme), Node (scriptler),
tarayıcı (web), C++ (ESP32). Dördü de birebir aynı çıkmazsa imza hiçbir yerde
tutmaz. `docs/test-vector.md` bunun kanıtı — dördü de aynı imzayı üretiyor.

---

## 5. Turnike internetsiz nasıl çözüyor

Bu, sistemin kalbi. Turnikeye gelen istekte iki şey var: **bilet + bir fiş**.
Turnike sırayla şunlara bakar (`firmware/offgate-gate/src/main.cpp`,
`handle_pay`):

| # | Kontrol | Ne engeller |
|---|---|---|
| 1 | Bileti ve fişi okuyabildim mi | Bozuk veri |
| 2 | `ent.gate == GATE_ID` | Başka kapının biletini kullanmayı |
| 3 | Fişte kullanıcı adresi var mı | Zincire yazılamayacak fişi |
| 4 | Fişteki ücret biletle aynı mı | Ücret oynamayı |
| 5 | **Operatör imzası geçerli mi** | Sahte bilet |
| 6 | Fişin `ent_hash`'i bu bilete mi ait | Başka biletin fişini |
| 7 | `1 ≤ seq ≤ max_uses` | Hak sınırını aşmayı |
| 8 | **Bu `seq` daha önce harcandı mı** | Aynı fişi tekrar kullanmayı |
| 9 | **Fiş imzası cihaz anahtarıyla geçerli mi** | Uydurma fiş |

5, 8 ve 9 kalın çünkü asıl iş onlarda.

**Neden internet gerekmiyor:** turnike operatörün açık anahtarını zaten
biliyor. Bileti onunla doğruluyor. Bilet içinde cihazın açık anahtarı yazıyor,
fişi de onunla doğruluyor. Zincire sormaya ihtiyaç yok — imza zincirinin
tamamı elinde.

**Harcanan fişler nerede:** ESP32'nin NVS'inde (kalıcı flash), anahtar
`s<ent_hash'in ilk 8 hanesi>_<seq>` biçiminde. Elektrik kesilse de kalır.

---

## 6. Çifte harcama nasıl engelleniyor

Dört ayrı katman var; biri delinse diğeri tutar.

**Katman 1 — Fiş sırası, kapıda.** Her fişin bir `seq` numarası var. Turnike
kabul ettiğini NVS'e yazıyor. Aynı fişi ikinci kez getirirsen `already_spent`.

**Katman 2 — Bilet tek kapıya bağlı.** Bilette `gate` yazıyor ve operatör
imzalamış. Kapı 1'in biletiyle Kapı 2'ye gidemezsin; Kapı 2 `wrong_gate` der.
Bu yüzden iki turnikenin birbirinden habersiz olması sorun değil — aynı bilet
zaten ikisine birden gidemiyor.

**Katman 3 — `Spent` kaydı, zincirde.** Turnike bir şekilde atlatılsa bile,
`settle` sırasında sözleşme `Spent(ent_hash, seq)` var mı diye bakıyor. Varsa
o fişi sessizce atlıyor. Aynı fiş ikinci kez asla paraya dönüşmüyor.

**Katman 4 — Bakiye, zincirde.** Her fiş bakiyeden bir geçiş ücreti düşüyor.
Bakiye bittiğinde `settle` fişleri kabul etmiyor. Yani en kötü ihtimalde bile
zincirden yatırılandan fazla para çıkmıyor.

---

## 7. Geçiş hakkı nasıl belirleniyor (en ince nokta)

Burası sistemin en kolay hata yapılacak yeri — nitekim bir kez yaptık.

**Turnike bakiyeyi bilmez, bilemez.** Elindeki tek sınır bilette yazan
`max_uses`. Peki o sayı doğru mu?

Eski kurguda istemci `max_uses`'i kendi söylüyordu, operatör sormadan
imzalıyordu. Yani kurcalanmış bir tarayıcı 100 TL kilitleyip 50 geçişlik
**geçerli imzalı** bilet alabilirdi. Turnike kabul ederdi — çünkü imza gerçek.

Şimdi iki şey yapıyoruz (karar K-9):

**Sırayı ters çevirdik.** Önce bakiye zincire kilitleniyor, sonra imza
isteniyor. Operatör imza ucu zinciri okuyup bileti **oradaki** değerlerden
yeniden kuruyor ve ürettiği özet zincirdeki `ent_hash` ile tutmazsa imza
vermiyor. İstemci gövdede yalnızca `{ user, expires }` gönderiyor.

**Geçiş hakkını sözleşme hesaplıyor.** `lock_float` içinde:

```
max_uses = kilitlenen_bakiye / bir_geçişin_fiyatı
```

İstemciden hiçbir sayı alınmıyor.

> **Dikkat:** geçiş sayısı "TL ÷ ücret" değildir. TL, anchor'ın **alış**
> kuruyla USDC'ye çevrilir; ücret ise SEP-38 kuruyla hesaplanır. Aradaki makas
> kadar kayıp olur. 500 TL, 100 TL'lik ücretle **5 değil 4** geçiş eder.

---

## 8. Tekrar bilet alma — `top_up`

Bileti harcadın, yenisini istiyorsun. Sorun şu: **zincir, çevrimdışı
harcamayı göremez.** Turnikeden 2 kez geçtin ama henüz senkronizasyon
yapılmadı; zincirde bakiyen hâlâ dolu görünüyor. Yeni hak versek ikisini
birden kullanırsın.

Çözüm: en kötü ihtimali varsay.

```
açıkta_kalan = granted - used          ← imzaladım ama harcandığını göremiyorum
yeni_hak     = bakiye / ücret - açıkta_kalan
```

- `granted` = bugüne kadar bu hesap için imzalanan **toplam** hak
- `used` = zincire düşmüş (settle edilmiş) fiş sayısı
- `ent_uses` = yürürlükteki biletin kendi hakkı — turnikenin gördüğü sayı

Örnek:

| Adım | Bakiye | granted | used | Yeni bilet |
|---|---|---|---|---|
| 250 TL kilitle | 2 geçişlik | 2 | 0 | 2 geçiş |
| (turnikeden 2 kez geç, senkron yok) | aynı | 2 | 0 | — |
| +500 TL ekle | 7 geçişlik | 7 | 0 | **5 geçiş** |

Açıkta 2 hak vardı, kapasite 7'ye çıktı, yeni bilet 5 veriyor. Toplam imzalanan
2 + 5 = 7 = paranın karşıladığı. Turnikeden 2'sini geçmiş olsan da olmasan da
7'yi aşamıyorsun.

Her `top_up` yeni bir `ent_hash` üretir, yani turnikede **yeni bir sıra
numarası uzayı** başlar. Eski fişler eski `ent_hash`'e bağlı kaldığı için
karışmaz.

---

## 9. Para operatöre nasıl geçiyor — `settle`

Görevli turnikeden `/receipts` çeker ve `settle(gate, receipts)` çağırır.
Sözleşme her fiş için sırayla bakar:

1. Bu kullanıcının hesabı var mı
2. Fiş bu kapıya ve bu bilete mi ait
3. `Spent(ent_hash, seq)` — daha önce harcanmış mı
4. Bakiye bir geçişe yetiyor mu
5. **Fiş imzası cihaz anahtarıyla geçerli mi** (zincir üstünde Ed25519)

Geçerse: `Spent` işaretlenir, bakiyeden ücret düşülür, `used` artar, hasılat
biriktirilir. Sonunda toplam USDC operatörün adresine aktarılır.

İki önemli özellik:

- **Idempotent.** Aynı batch iki kez gönderilirse ikincisi sessizce atlanır.
  Görevli aynı senkronizasyonu tekrar çalıştırabilir.
- **Sahte imza batch'i durdurur.** `ed25519_verify` başarısızlıkta panik atar,
  işlem tümden geri alınır.

Bilet tükendiğinde (bakiye bir geçişin altına düştüğünde) kapının yükü de
otomatik serbest kalır.

---

## 10. Denetim — operatöre neden güvenmek zorunda değiliz

İki sayı iki **bağımsız** kaynaktan geliyor:

- `Declared(gate)` — turnikenin kendi sayacı, `gate_report` ile beyan edilir
- `Settled(gate)` — zincire gerçekten düşmüş fiş sayısı

Bu ikisi tutmuyorsa bir şey yanlış. Operatör hasılatı eksik gösteremez, çünkü
turnikenin sayacını da o beyan ediyor ve iki sayı herkese açık. Web
arayüzünde `#audit` sekmesi bunu canlı gösterir.

---

## 11. Bilinen açıklar — dürüst liste

**İade (`refund`) korumasız.** Kullanıcı her an çağırabiliyor ve tüm kilidi
bozuyor. Turnikeden 4 kez geçip, operatör senkronize etmeden iade alırsan
paranı tam geri alırsın — 4 bedava geçiş. Ayrıca ele alınacak.

**Turnike son kullanma tarihini kontrol etmiyor.** `expires` bilette var ve
imzalı, ama ESP32'nin saati yok (çevrimdışı, NTP yok). Şu an bu alan sadece
imza ucunda kontrol ediliyor (48 saatten uzun bilet imzalanmıyor).

**Turnike rapor imzalamıyor.** `gate_report`'u operatör beyan ediyor.
Turnikenin kendi anahtar çifti olsaydı raporu imzalar, denetim operatörden
tamamen bağımsız hale gelirdi. Yol haritasında.

**Banka ayağı mock.** `simulate-bank-transfer` demo anchor'ına özgü. Stellar
ayağı gerçek testnet; TL ayağı simüle.

**Bundle hamiline geçerli.** Bilet metnini kopyalayan da kullanabilir. İçinde
gizli anahtar yok ama fişler zaten imzalı olduğu için imzaya da gerek yok.
Etkinlik bilekliği gibi düşün: kimde ise onundur. Kimin olduğu bilette yazıyor
(`user_raw`) ve zincirde bakiye o adrese kilitli, ama turnike karşısındakinin
o kişi olduğunu **doğrulayamaz** — bunun için PIN gerekir (bkz. bölüm 13).

---

## 12. Hangi dosya neyi yapıyor

| Dosya | Sorumluluk |
|---|---|
| `contracts/offgate/src/lib.rs` | Kilit, bilet muhasebesi, settle, denetim |
| `contracts/offgate/src/test.rs` | 32 test, gerçek Ed25519 imzalarıyla |
| `web/src/lib/flow.ts` | Kullanıcının 11 adımlık akışı |
| `web/src/lib/receipts.ts` | Kanonik baytlar + fiş defteri (tarayıcı) |
| `web/api/sign-entitlement.js` | Operatör imzası — zinciri doğrular |
| `firmware/offgate-gate/src/main.cpp` | Kapı: AP, portal, 9 kontrol, NVS |
| `firmware/offgate-gate/src/offgate.h` | Kanonik baytlar + doğrulama (C++) |
| `scripts/02-settle.mjs` | Turnikeden fiş çek → zincire yaz |
| `docs/test-vector.md` | Dört platformun aynı baytı ürettiğinin kanıtı |
| `docs/DEPLOYMENTS.md` | Her dağıtım, her işlem hash'i |
| `docs/OFFGATE-PACKAGES.md` | Paket planı ve tasarım kararları K-1…K-9 |


---

## 13. Bilet kime ait — ve neden turnike bunu doğrulayamıyor

Bilette `user_raw` var, operatör imzalamış, zincirde bakiye o adrese kilitli.
Yani **biletin sahibi bellidir**. Arayüzde de bilet ekranında hangi cüzdana ait
olduğu yazıyor ve Stellar Expert'e link veriyor.

Ama turnike, karşısındaki kişinin o cüzdanın sahibi olduğunu **doğrulayamaz**.
Sebep: doğrulamanın tek yolu kullanıcının o anda bir şey imzalaması olurdu,
imza da cihaz anahtarını gerektirir — o anahtar `offgate.vercel.app`
origin'inin localStorage'ında. Turnikenin sayfası `192.168.4.1` origin'inde.
Tarayıcı bu ikisi arasında veri paylaşımına izin vermez. **Fişleri peşinen
imzalamamızın sebebi tam olarak bu** (karar K-2).

Dolayısıyla bundle hamiline geçerli bir belge. Bu bilinçli bir kabul, kaza
değil — ama dokunulmadan bırakılırsa bilet metnini kopyalayan da geçer.

### Çözüm yolu: PIN

Kullanıcı bilet alırken 4–6 haneli bir PIN seçer. Entitlement'a
`pin_hash = sha256(alan_ayırıcı || user_raw || pin)` eklenir ve **operatör
imzalar**. Turnike PIN'i sorar, hashler, karşılaştırır. Tamamen çevrimdışı
doğrulanabilir; bilet metnini kopyalamak yetmez, PIN'i de bilmek gerekir.

Maliyeti: entitlement 138 → 170 bayt. Bu format dört yerde birebir aynı
üretiliyor (Rust, Node, tarayıcı, ESP32), dolayısıyla dördü de değişir; iki
ESP32 yeniden yakılır; `docs/test-vector.md` yenilenir.

Henüz yapılmadı — yapılıp yapılmayacağı zaman durumuna bağlı.
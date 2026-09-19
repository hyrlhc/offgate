# OffGate — İnternetsiz Geçiş ve Ödeme Altyapısı

**Rise In x Stellar Pro Hackathon 2026 · Genesis Track**

> 🚧 Geliştirme sürüyor. Tam README, Paket 12'de yazılacak.

İnternetsiz çalışan, kapı başına maliyeti bir ESP32 olan, TL cinsinden bilet satan
etkinlik geçiş sistemi. Kullanıcı TL yatırır, Stellar anchor üzerinden USDC alır,
Soroban sözleşmesine "offline float" olarak kilitler. İnternet olmadan geçer.
Organizatör TL olarak tahsil eder.

## Durum

| Paket | Durum |
|---|---|
| P0 Tezgah kurulumu | ✅ |
| P1 Zincir kimliği + deploy | ✅ |
| P2 Anchor akışı (SEP-1/10/38/6) | ✅ |
| P3 Kontrat v1 (lock_float, assign_gate) | ✅ |
| P4 Kontrat v2 (settle, refund, denetim) | ✅ |
| P5 Kontrat testleri | ✅ (28 test) |
| P6 Web — online akış | ✅ |
| P7 Fiş defteri + bundle | ✅ |
| P8 ESP32 firmware | ✅ iki kapı: `pio run -e gate1/-e gate2` |
| P9 Settle köprüsü + withdraw | ✅ |
| P10 Denetim ekranı | ✅ |
| P11 Uçtan uca prova | ⏳ sırada |
| P12–P13 | ⬜ |

**Contract ID:** `CBSHKY6KARP25OXKNYXSVA5LNXAYD2NKMTRELQUXFL4JXTFGHSP3DCDG` (testnet)
**Kayıtlı kapılar:** `M307` (Kapı 1) · `M308` (Kapı 2) — kapıyı ve tutarı kullanıcı seçer
Tüm zincir üstü artefaktlar: [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md)

## Dokümanlar

- [docs/OFFGATE-BUILD-PLAN.md](docs/OFFGATE-BUILD-PLAN.md) — mimari, veri yapıları, anchor referansı
- [docs/OFFGATE-PACKAGES.md](docs/OFFGATE-PACKAGES.md) — paket paket geliştirme planı ve karar kayıtları
- [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md) — contract ID, hesaplar, işlem hash'leri
- [docs/test-vector.md](docs/test-vector.md) — kanonik imza formatı, platformlar arası test vektörü

## Hızlı başlangıç

```sh
cp .env.example .env          # sonra kendi anahtarlarını doldur
npm install                   # operatör/kurulum scriptleri
cargo test -p offgate         # sözleşme testleri (28)
stellar contract build

cd web && npm install         # web uygulaması
npm run dev                   # OPERATOR_SECRET'i kök .env'den okur
```

---
*Testnet. Gerçek para hareketi yoktur.*

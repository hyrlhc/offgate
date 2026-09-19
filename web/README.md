# OffGate — web uygulaması

Kullanıcının TL yükleyip bilet aldığı online arayüz. Vite + React + TypeScript.

```sh
npm install
npm run dev                           # http://localhost:5173
npm run build
```

`OPERATOR_SECRET`'i geliştirme sunucusu depo kökündeki `.env`'den okur
(bkz. `vite.config.ts`). Yalnızca sunucu tarafında kullanılır (`api/sign-entitlement.js`),
`VITE_` öneki almaz ve tarayıcıya hiçbir zaman inmez. Yapılandırılabilir değerler
için `.env.example`.

| Dosya | Sorumluluk |
|---|---|
| `src/lib/receipts.ts` | Kanonik imza formatı (`docs/test-vector.md` ile aynı baytlar) |
| `src/lib/anchor.ts` | SEP-1/10/38/6 istemcisi |
| `src/lib/contract.ts` | Soroban okuma/yazma, trustline |
| `src/lib/signer.ts` | Stellar Wallets Kit ve oturum bilekliği |
| `src/lib/flow.ts` | "500 TL Yükle" akışının tamamı |
| `api/sign-entitlement.js` | Operatör imzası (sunucu tarafı) |

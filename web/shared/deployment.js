// Dagitim sabitlerinin TEK kaynagi.
//
// Bu degerler iki ayri yerde calisan koda birden lazim: tarayicidaki
// uygulamaya (src/config.ts) ve sunucudaki imza ucuna (api/sign-entitlement.js).
// Daha once ikisinde de ayri ayri yaziliydi; sozlesme yeniden dagitildiginda
// birini guncelleyip digerini unutmak, tarayicinin bir sozlesmeye, imza ucunun
// baskasina bakmasi demekti. Bu da "bilet zincirdeki kilitle uyusmuyor"
// hatasini, sebebi gorunmeden uretirdi.
//
// Ortam degiskeni her zaman onceliklidir; buradakiler yalnizca varsayilan.
// Sozlesme yeniden dagitilinca DEGISECEK TEK SATIR asagidaki CONTRACT_ID.

export const DEPLOYMENT = {
  contractId: 'CCXEH644FOYINJERTUOD7TFWKNJNHHL252E3KGTEQQU47476M7KXWPLX',
  eventId: 'FEST26',

  networkPassphrase: 'Test SDF Network ; September 2015',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',

  anchorHomeDomain: 'tr-mock-anchor.fly.dev',
  usdcCode: 'USDC',
  usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',

  // Imzasiz okuma cagrilarinin kaynak hesabi. Simulasyon var olan bir hesap
  // ister; bu adres herkese acik, gizli hicbir sey icermez.
  readAccount: 'GDE7PTP774PCYBE5N6QCPG4QKGYCCSOUWUPDISBBKPKI3CDIUEGLG7HJ',
};

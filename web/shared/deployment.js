// Dagitim sabitlerinin TEK kaynagi.
//
// Bu degerler iki ayri yerde calisan koda birden lazim: tarayicidaki
// uygulamaya (src/config.ts) ve sunucudaki imza ucuna (api/sign-entitlement.js).
// Daha once ikisinde de ayri ayri yaziliydi; sozlesme yeniden dagitildiginda
// birini guncelleyip digerini unutmak, tarayicinin bir sozlesmeye, imza ucunun
// baskasina bakmasi demekti.
//
// IKI PROFIL VAR
//
//   live     Gercek anchor (tr-mock-anchor.fly.dev) ve gercek USDC.
//            Varsayilan budur; urunun asil entegrasyonu bu yoldur.
//
//   local    Yedek. Anchor'in odeme isleyicisi coktugunde demo tamamen
//            duruyordu: SEP-10/38/6 uclari 200 donuyor, siparis aciliyor,
//            ama USDC hic odenmiyordu (`pending_anchor`de kaliyor).
//            Yedek profil kendi test varligini (TUSDC) kendi ihraccimizdan
//            dagitir ve ona bagli AYRI bir sozlesme kullanir.
//
// Gercek anchor yolu yedekten hic etkilenmez: ayri sozlesme, ayri varlik.
// Yedek acilmadigi surece tek satiri bile calismaz.

const LIVE = {
  profile: 'live',
  label: 'Anchor',
  contractId: 'CAYBDH2AUVXOYJPRBE7MZ46ZOLW3O53PIDOKGWWOV4Z4PONHWILA7AZH',
  anchorHomeDomain: 'tr-mock-anchor.fly.dev',
  usdcCode: 'USDC',
  usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

const LOCAL = {
  profile: 'local',
  label: 'Yedek',
  contractId: 'CB6AUNVOKLY4W23BHIR52V4F7H7SXCXW2B7CFK4KZVCQD6DOGKBMRXDI',
  // Yedekte anchor yok: USDC'yi kendi ihraccimiz dogrudan gonderiyor.
  anchorHomeDomain: null,
  usdcCode: 'TUSDC',
  usdcIssuer: 'GAV2C4IL66QQZWB24OPPFNNHUHP6RJEZ3E5KUU4CCJVXFOEHTHDD5HRH',
};

/** Her iki profilde de ayni olan sabitler. */
const COMMON = {
  eventId: 'FEST26',
  networkPassphrase: 'Test SDF Network ; September 2015',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',

  // Imzasiz okuma cagrilarinin kaynak hesabi. Simulasyon var olan bir hesap
  // ister; bu adres herkese acik, gizli hicbir sey icermez.
  readAccount: 'GDE7PTP774PCYBE5N6QCPG4QKGYCCSOUWUPDISBBKPKI3CDIUEGLG7HJ',
};

export const PROFILES = {
  live: { ...COMMON, ...LIVE },
  local: { ...COMMON, ...LOCAL },
};

/** Gecerli profil adi mi — istemciden gelen deger dogrudan kullanilmaz. */
export const isProfile = (name) => name === 'live' || name === 'local';

/** Varsayilan: gercek anchor. */
export const DEPLOYMENT = PROFILES.live;

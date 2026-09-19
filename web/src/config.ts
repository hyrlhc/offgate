// Tum degerler VITE_ ile disaridan gecilebilir; varsayilanlar testnet demosu.
// Burada hicbir gizli anahtar yok — operator imzasi sunucu tarafinda atiliyor.

// Vite disinda (tarayicisiz uctan uca testte) `import.meta.env` yoktur;
// o durumda process.env'e dusuyoruz.
const env: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ??
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ??
  {};

export const CONFIG = {
  networkPassphrase: env.VITE_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  horizonUrl: env.VITE_HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
  rpcUrl: env.VITE_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  friendbotUrl: env.VITE_FRIENDBOT_URL ?? 'https://friendbot.stellar.org',

  anchorHomeDomain: env.VITE_ANCHOR_HOME_DOMAIN ?? 'tr-mock-anchor.fly.dev',
  usdcCode: env.VITE_USDC_CODE ?? 'USDC',
  usdcIssuer: env.VITE_USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',

  contractId: env.VITE_CONTRACT_ID ?? 'CBXZ34NZR2R7TVHFGKJZYSIVFBXSYJ5UM2QQ67NQC6ZRPVW5VNPC42BL',

  // Operator imza ucunun koku. Tarayicida bos (ayni origin); tarayicisiz
  // uctan uca testte gelistirme sunucusunun adresi verilir.
  apiBase: env.VITE_API_BASE ?? '',

  // Imzasiz okuma cagrilari icin kaynak hesap. Simulasyon bir var olan
  // hesap istiyor; bu adres herkese acik bilgidir, gizli hicbir sey icermez.
  readAccount: env.VITE_READ_ACCOUNT ?? 'GDE7PTP774PCYBE5N6QCPG4QKGYCCSOUWUPDISBBKPKI3CDIUEGLG7HJ',

  // Demo parametreleri — karar K-3 (docs/OFFGATE-PACKAGES.md)
  eventId: env.VITE_EVENT_ID ?? 'EVT1',
  depositTry: env.VITE_DEPOSIT_TRY ?? '500',
  fareTryKurus: Number(env.VITE_FARE_TRY_KURUS ?? 10_000),
  maxUses: Number(env.VITE_MAX_USES ?? 5),
} as const;

export const SEP38_TRY = 'iso4217:TRY';
export const SEP38_USDC = `stellar:${CONFIG.usdcCode}:${CONFIG.usdcIssuer}`;

/** Kurus -> "100.00 TL" */
export const formatTry = (kurus: number) =>
  `${(kurus / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL`;

/** rate (TRY/USDC * 1e7) -> "48.785078" */
export const formatRate = (rate: number) => (rate / 1e7).toFixed(6);

export const expertAccount = (a: string) =>
  `https://stellar.expert/explorer/testnet/account/${a}`;
export const expertTx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
export const expertContract = (c: string) =>
  `https://stellar.expert/explorer/testnet/contract/${c}`;

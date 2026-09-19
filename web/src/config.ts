// Tum degerler VITE_ ile disaridan gecilebilir; varsayilanlar testnet demosu.
// Burada hicbir gizli anahtar yok — operator imzasi sunucu tarafinda atiliyor.

import { DEPLOYMENT } from '../shared/deployment.js';

// Vite disinda (tarayicisiz uctan uca testte) `import.meta.env` yoktur;
// o durumda process.env'e dusuyoruz.
const env: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ??
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ??
  {};

export const CONFIG = {
  networkPassphrase: env.VITE_NETWORK_PASSPHRASE ?? DEPLOYMENT.networkPassphrase,
  horizonUrl: env.VITE_HORIZON_URL ?? DEPLOYMENT.horizonUrl,
  rpcUrl: env.VITE_RPC_URL ?? DEPLOYMENT.rpcUrl,
  friendbotUrl: env.VITE_FRIENDBOT_URL ?? DEPLOYMENT.friendbotUrl,

  anchorHomeDomain: env.VITE_ANCHOR_HOME_DOMAIN ?? DEPLOYMENT.anchorHomeDomain,
  usdcCode: env.VITE_USDC_CODE ?? DEPLOYMENT.usdcCode,
  usdcIssuer: env.VITE_USDC_ISSUER ?? DEPLOYMENT.usdcIssuer,

  contractId: env.VITE_CONTRACT_ID ?? DEPLOYMENT.contractId,

  // Operator imza ucunun koku. Tarayicida bos (ayni origin); tarayicisiz
  // uctan uca testte gelistirme sunucusunun adresi verilir.
  apiBase: env.VITE_API_BASE ?? '',

  readAccount: env.VITE_READ_ACCOUNT ?? DEPLOYMENT.readAccount,

  // Demo parametreleri — karar K-3 (docs/OFFGATE-PACKAGES.md)
  // Demo etkinliginde iki fiziksel kapi kayitli: M307 ve M308. Kapiyi
  // kullanici secer; `assign_gate` yalnizca oneri olarak durur.
  eventId: env.VITE_EVENT_ID ?? DEPLOYMENT.eventId,
  depositTry: env.VITE_DEPOSIT_TRY ?? '500',
  fareTryKurus: Number(env.VITE_FARE_TRY_KURUS ?? 10_000),

  // Yatirma limitleri. Anchor bunlari SEP-6 `/info` ya da `/health` uzerinden
  // BEYAN ETMIYOR (ikisi de bos donuyor), bu yuzden belgelenmis degerleri
  // istemci tarafinda uyguluyoruz. Disina cikan tutari anchor zaten reddeder;
  // kullaniciya once burada soyluyoruz.
  minDepositTry: Number(env.VITE_MIN_DEPOSIT_TRY ?? 50),
  maxDepositTry: Number(env.VITE_MAX_DEPOSIT_TRY ?? 3000),
} as const;

/**
 * Kapinin zincirdeki kimligi (Symbol) turnikenin uzerindeki donanim
 * numarasidir; kullaniciya "Kapi 1 / Kapi 2" diye gosteriyoruz. Zincirde ve
 * firmware'de her zaman donanim numarasi gecer — ikisi karisirsa fis hicbir
 * kapiya uymaz.
 */
export const GATE_LABELS: Record<string, string> = { M307: 'Kapı 1', M308: 'Kapı 2' };

export const gateLabel = (gate: string, index = 0) =>
  GATE_LABELS[gate] ?? `Kapı ${index + 1}`;

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

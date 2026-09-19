// Ortam degiskenlerini yukler ve dogrular.
// .env dosyasi git'e girmez; degerler P1'de uretildi.
import 'dotenv/config';

function need(key) {
  const v = process.env[key];
  if (!v) throw new Error(`.env icinde ${key} eksik. .env.example'a bak.`);
  return v;
}

export const NETWORK_PASSPHRASE = need('NETWORK_PASSPHRASE');
export const HORIZON_URL = need('HORIZON_URL');
export const RPC_URL = process.env.RPC_URL ?? 'https://soroban-testnet.stellar.org';

export const ANCHOR_HOME_DOMAIN = need('ANCHOR_HOME_DOMAIN');
export const USDC_CODE = need('USDC_CODE');
export const USDC_ISSUER = need('USDC_ISSUER');
export const USDC_SAC = process.env.USDC_SAC ?? '';

export const CONTRACT_ID = process.env.CONTRACT_ID ?? '';

export const ACCOUNTS = {
  admin: { public: need('ADMIN_PUBLIC'), secret: need('ADMIN_SECRET') },
  operator: { public: need('OPERATOR_PUBLIC'), secret: need('OPERATOR_SECRET') },
  user: { public: need('USER_PUBLIC'), secret: need('USER_SECRET') },
};

// Demo parametreleri — karar K-3 (docs/OFFGATE-PACKAGES.md)
export const DEMO = {
  eventId: process.env.DEMO_EVENT_ID ?? 'FEST26',
  depositTry: process.env.DEMO_DEPOSIT_TRY ?? '500',
  fareTryKurus: Number(process.env.DEMO_FARE_TRY_KURUS ?? 10000),
  maxUses: Number(process.env.DEMO_MAX_USES ?? 5),
};

/** SEP-38 varlik tanimlayicilari */
export const SEP38_TRY = 'iso4217:TRY';
export const SEP38_USDC = `stellar:${USDC_CODE}:${USDC_ISSUER}`;

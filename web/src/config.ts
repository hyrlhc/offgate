// Tum degerler VITE_ ile disaridan gecilebilir; varsayilanlar testnet demosu.
// Burada hicbir gizli anahtar yok — operator imzasi sunucu tarafinda atiliyor.

import { DEPLOYMENT, PROFILES, isProfile, type Profile, type ProfileName } from '../shared/deployment.js';
import { getLang, locale } from './lib/i18n.ts';

// --- Profil secimi ---------------------------------------------------------
//
// `live`  gercek anchor + gercek USDC. Varsayilan ve urunun asil yolu.
// `local` yedek: anchor'in odeme isleyicisi coktugunde demoyu ayakta tutar.
//         Kendi test varligini kendi ihraccimizdan dagitir, AYRI bir
//         sozlesme kullanir. Gercek yolu hic etkilemez.
//
// Secim localStorage'da kalir; kullanici sekme degistirince profil
// degisirse alinan bilet baska bir sozlesmede kalir ve tasima yolu tutmaz.

const PROFILE_KEY = 'offgate.profile';

function readProfile(): Profile {
  try {
    const saved = localStorage.getItem(PROFILE_KEY);
    if (isProfile(saved)) return PROFILES[saved];
  } catch { /* gizli sekme / depolama kapali — varsayilana dus */ }
  return DEPLOYMENT;
}

const ACTIVE: Profile = typeof localStorage === 'undefined' ? DEPLOYMENT : readProfile();

export const activeProfile = () => ACTIVE.profile;

/** Profili degistirir ve sayfayi yeniler: CONFIG modul yuklenirken donuyor. */
export function setProfile(name: ProfileName) {
  try { localStorage.setItem(PROFILE_KEY, name); } catch { /* yoksay */ }
  window.location.reload();
}

// Vite disinda (tarayicisiz uctan uca testte) `import.meta.env` yoktur;
// o durumda process.env'e dusuyoruz.
const env: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ??
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ??
  {};

export const CONFIG = {
  networkPassphrase: env.VITE_NETWORK_PASSPHRASE ?? ACTIVE.networkPassphrase,
  horizonUrl: env.VITE_HORIZON_URL ?? ACTIVE.horizonUrl,
  rpcUrl: env.VITE_RPC_URL ?? ACTIVE.rpcUrl,
  friendbotUrl: env.VITE_FRIENDBOT_URL ?? ACTIVE.friendbotUrl,

  anchorHomeDomain: env.VITE_ANCHOR_HOME_DOMAIN ?? ACTIVE.anchorHomeDomain,
  usdcCode: env.VITE_USDC_CODE ?? ACTIVE.usdcCode,
  usdcIssuer: env.VITE_USDC_ISSUER ?? ACTIVE.usdcIssuer,

  contractId: env.VITE_CONTRACT_ID ?? ACTIVE.contractId,

  /** 'live' = gercek anchor · 'local' = yedek (kendi varligimiz). */
  profile: ACTIVE.profile,

  // Operator imza ucunun koku. Tarayicida bos (ayni origin); tarayicisiz
  // uctan uca testte gelistirme sunucusunun adresi verilir.
  apiBase: env.VITE_API_BASE ?? '',

  readAccount: env.VITE_READ_ACCOUNT ?? ACTIVE.readAccount,

  // Demo parametreleri — karar K-3 (docs/OFFGATE-PACKAGES.md)
  // Demo etkinliginde iki fiziksel kapi kayitli: M307 ve M308. Kapiyi
  // kullanici secer; `assign_gate` yalnizca oneri olarak durur.
  eventId: env.VITE_EVENT_ID ?? ACTIVE.eventId,
  // Bir gecis = bir banknot. Tutar her zaman gecis sayisi x bu ucret.
  fareTryKurus: Number(env.VITE_FARE_TRY_KURUS ?? 10_000),
  defaultPasses: Number(env.VITE_DEFAULT_PASSES ?? 3),

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
const GATE_INDEX: Record<string, number> = { M307: 1, M308: 2 };

export const gateLabel = (gate: string, index = 0) => {
  const n = GATE_INDEX[gate] ?? index + 1;
  return getLang() === 'tr' ? `Kapı ${n}` : `Gate ${n}`;
};

export const SEP38_TRY = 'iso4217:TRY';
export const SEP38_USDC = `stellar:${CONFIG.usdcCode}:${CONFIG.usdcIssuer}`;

/** Kurus -> "100.00 TRY". Ayrac ve etiket dile bagli. */
export const formatTry = (kurus: number) =>
  `${(kurus / 100).toLocaleString(locale(), { minimumFractionDigits: 2 })} ${
    getLang() === 'tr' ? 'TL' : 'TRY'}`;

/** rate (TRY/USDC * 1e7) -> "48.785078" */
export const formatRate = (rate: number) => (rate / 1e7).toFixed(6);

export const expertAccount = (a: string) =>
  `https://stellar.expert/explorer/testnet/account/${a}`;
export const expertTx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
export const expertContract = (c: string) =>
  `https://stellar.expert/explorer/testnet/contract/${c}`;

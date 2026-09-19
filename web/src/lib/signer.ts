// Imza saglayici — iki mod.
//
// 1) "wallet"    : Stellar Wallets Kit (Freighter, Lobstr, Albedo...).
//                  Hackathon'un zorunlu entegrasyon ortagi budur.
// 2) "wristband" : Tarayicida uretilen oturum cuzdani ("bileklik").
//                  Kripto cuzdani olmayan kullanici icin — urunun hedef
//                  kitlesi zaten bu. Mobil tarayicida eklenti bulunmadigi
//                  icin demo yolu da budur. Testnet, Friendbot ile fonlanir.
//
// Her iki modda da zincire giden her sey gercek: gercek hesap, gercek
// trustline, gercek anchor deposit, gercek lock_float.

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { RabetModule } from '@creit.tech/stellar-wallets-kit/modules/rabet';
import { HanaModule } from '@creit.tech/stellar-wallets-kit/modules/hana';
import { CONFIG } from '../config.ts';

export type SignerKind = 'wallet' | 'wristband';

export interface Signer {
  kind: SignerKind;
  address: string;
  label: string;
  /** Imzali XDR dondurur. */
  signTransaction(xdr: string): Promise<string>;
}

// --- Wallets Kit -----------------------------------------------------------

let kitReady = false;

function initKit() {
  if (kitReady) return;
  StellarWalletsKit.init({
    modules: [
      new FreighterModule(),
      new AlbedoModule(),
      new LobstrModule(),
      new RabetModule(),
      new HanaModule(),
    ],
    network: CONFIG.networkPassphrase as never,
  });
  kitReady = true;
}

export async function connectWallet(): Promise<Signer> {
  initKit();
  const { address } = await StellarWalletsKit.authModal();
  return {
    kind: 'wallet',
    address,
    label: 'Stellar Wallets Kit',
    async signTransaction(xdr: string) {
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        address,
        networkPassphrase: CONFIG.networkPassphrase,
      });
      return signedTxXdr;
    },
  };
}

// --- Oturum bilekligi ------------------------------------------------------

const WRISTBAND_STORAGE = 'offgate.wristband.secret';

/**
 * Oturum bilekligi.
 *
 * `fresh` verilmezse tarayicida kayitli bileklik varsa o kullanilir. Bu,
 * ayni bilgisayardan giren ikinci kisiye BIRINCININ hesabini verir — demoda
 * tam olarak bu oldu. Bu yuzden arayuz kayitli bileklik varken artik sessizce
 * devam etmiyor, kime ait oldugunu gosterip soruyor (bkz. TopUpFlow).
 */
export async function createWristband(
  onStep?: (msg: string) => void,
  forceNew = false,
): Promise<Signer> {
  let secret = forceNew ? null : localStorage.getItem(WRISTBAND_STORAGE);
  let fresh = false;
  if (!secret) {
    secret = Keypair.random().secret();
    localStorage.setItem(WRISTBAND_STORAGE, secret);
    fresh = true;
  }
  const kp = Keypair.fromSecret(secret);

  if (fresh) {
    onStep?.('Bileklik oluşturuluyor…');
    const res = await fetch(`${CONFIG.friendbotUrl}?addr=${kp.publicKey()}`);
    if (!res.ok && res.status !== 400) {
      throw new Error(`Friendbot fonlaması başarısız (HTTP ${res.status})`);
    }
    onStep?.('Bileklik ağa kaydedildi');
  }

  return {
    kind: 'wristband',
    address: kp.publicKey(),
    label: 'Oturum bilekliği',
    async signTransaction(xdr: string) {
      const tx = TransactionBuilder.fromXDR(xdr, CONFIG.networkPassphrase);
      tx.sign(kp);
      return tx.toXDR();
    },
  };
}

/** Kayitli bilekligin adresi — uretmeden, fonlamadan, sadece bakmak icin. */
export function savedWristbandAddress(): string | null {
  const secret = localStorage.getItem(WRISTBAND_STORAGE);
  if (!secret) return null;
  try {
    return Keypair.fromSecret(secret).publicKey();
  } catch {
    return null;
  }
}


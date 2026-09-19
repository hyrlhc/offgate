// "500 TL Yukle" butonunun arkasindaki zincir.
//
// Kullanici tek dugmeye basar; auth -> kur kilitle -> yatir -> banka ->
// kapi ata -> entitlement imzala -> zincire kilitle -> fis defteri
// sirasi kendiliginden akar. Anchor'i urunun is mantigina gomen sey budur.

import { StrKey } from '@stellar/stellar-sdk';
import { CONFIG } from '../config.ts';
import {
  depositExchange, discover, makeSession, requestQuote, simulateBankTransfer, waitForCompletion,
} from './anchor.ts';
import { assignGate, ensureTrustline, lockFloat, usdcToStroops } from './contract.ts';
import {
  buildReceiptBook, entitlementHash, loadOrCreateDeviceKey, toHex, type Entitlement, type SignedReceipt,
} from './receipts.ts';
import type { Signer } from './signer.ts';

export type StepId =
  | 'trustline' | 'auth' | 'quote' | 'deposit' | 'bank' | 'settled'
  | 'gate' | 'entitlement' | 'lock' | 'book';

export type StepState = 'bekliyor' | 'calisiyor' | 'tamam' | 'hata';

export type Step = { id: StepId; label: string; detail?: string; state: StepState };

export const INITIAL_STEPS: Step[] = [
  { id: 'trustline', label: 'USDC güven hattı', state: 'bekliyor' },
  { id: 'auth', label: 'Cüzdan doğrulandı', detail: 'SEP-10', state: 'bekliyor' },
  { id: 'quote', label: 'Kur kilitlendi', detail: 'SEP-38', state: 'bekliyor' },
  { id: 'deposit', label: 'Ödeme talimatı alındı', detail: 'SEP-6', state: 'bekliyor' },
  { id: 'bank', label: 'Banka transferi alındı', state: 'bekliyor' },
  { id: 'settled', label: 'USDC hesabınıza geçti', state: 'bekliyor' },
  { id: 'gate', label: 'Kapı atandı', state: 'bekliyor' },
  { id: 'entitlement', label: 'Bilet imzalandı', state: 'bekliyor' },
  { id: 'lock', label: 'Bakiye zincire kilitlendi', state: 'bekliyor' },
  { id: 'book', label: 'Geçiş fişleri hazırlandı', state: 'bekliyor' },
];

/** Kapida yapistirlacak paket. Icinde hicbir gizli anahtar yok. */
export type Bundle = {
  v: 1;
  event: string;
  gate: string;
  user: string;
  device_pk: string;
  fare_try: number;
  rate: number;
  max_uses: number;
  expires: number;
  ent_hash: string;
  operator_sig: string;
  receipts: SignedReceipt[];
};

export type Ticket = {
  bundle: Bundle;
  bundleText: string;
  lockHash: string;
  anchorTxId: string;
  usdcReceived: string;
  bankReference?: string;
};

type Emit = (id: StepId, state: StepState, detail?: string) => void;

export async function runTopUp(signer: Signer, emit: Emit): Promise<Ticket> {
  const run = async <T>(id: StepId, fn: () => Promise<T>, detail?: (v: T) => string) => {
    emit(id, 'calisiyor');
    try {
      const value = await fn();
      emit(id, 'tamam', detail?.(value));
      return value;
    } catch (err) {
      emit(id, 'hata', (err as Error).message);
      throw err;
    }
  };

  const endpoints = await discover();
  const session = makeSession(endpoints, signer);

  await run('trustline', async () => ensureTrustline(signer), (created) =>
    created ? 'yeni güven hattı açıldı' : 'zaten açıktı');

  await run('auth', async () => session.ensure(), () => 'şifre yok, cüzdan imzası');

  const quote = await run('quote', () => requestQuote(session, endpoints, CONFIG.depositTry),
    (q) => `1 USDC = ${Number(q.price).toFixed(6)} TRY`);

  const deposit = await run('deposit',
    () => depositExchange(session, endpoints, {
      account: signer.address, quoteId: quote.id, amountTry: CONFIG.depositTry,
    }),
    (d) => {
      const ref = d.instructions?.external_transfer_memo?.value;
      return ref ? `referans ${ref}` : `emir ${d.id.slice(0, 12)}…`;
    });

  const bankReference = deposit.instructions?.external_transfer_memo?.value;

  await run('bank', () => simulateBankTransfer(session, endpoints, deposit.id, CONFIG.depositTry),
    () => 'mock anchor: simulate-bank-transfer');

  const anchorTx = await run('settled',
    () => waitForCompletion(session, endpoints, deposit.id),
    (t) => `${t.amount_out ?? '?'} USDC`);

  const gate = await run('gate', () => assignGate(signer.address), (g) => `kapı ${g}`);

  // Cihaz anahtari (karar K-1): fisleri cuzdan degil bu anahtar imzalar.
  const device = loadOrCreateDeviceKey();
  const usdcAmount = anchorTx.amount_out ?? '0';
  const amountStroops = usdcToStroops(usdcAmount);
  const rate = Math.round(Number(quote.price) * 1e7);
  const expires = Math.floor(Date.now() / 1000) + 86_400;

  const entitlement: Entitlement = {
    userRaw: StrKey.decodeEd25519PublicKey(signer.address),
    devicePk: device.publicKey,
    event: CONFIG.eventId,
    gate,
    fareTry: CONFIG.fareTryKurus,
    rate,
    maxUses: CONFIG.maxUses,
    expires,
  };
  const entHash = entitlementHash(entitlement);

  // Operator imzasi sunucu tarafinda atilir; gizli anahtar tarayiciya inmez.
  const signed = await run('entitlement', async () => {
    const res = await fetch(`${CONFIG.apiBase}/api/sign-entitlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userRaw: toHex(entitlement.userRaw),
        devicePk: toHex(entitlement.devicePk),
        event: entitlement.event,
        gate: entitlement.gate,
        fareTry: entitlement.fareTry,
        rate: entitlement.rate,
        maxUses: entitlement.maxUses,
        expires: entitlement.expires,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `imza ucu HTTP ${res.status}`);
    if (body.ent_hash !== toHex(entHash)) {
      throw new Error('sunucu farklı bir entitlement özeti hesapladı — format uyuşmuyor');
    }
    return body as { ent_hash: string; operator_sig: string; operator_pk: string };
  }, () => 'operatör imzası alındı');

  const lock = await run('lock',
    () => lockFloat(signer, {
      amount: amountStroops, gate, fareTry: entitlement.fareTry,
      rate, devicePk: device.publicKey, entHash,
    }),
    () => `kapı ${gate}`);

  const bundle = await run('book', async (): Promise<Bundle> => ({
    v: 1,
    event: entitlement.event,
    gate,
    user: signer.address,
    device_pk: toHex(device.publicKey),
    fare_try: entitlement.fareTry,
    rate,
    max_uses: entitlement.maxUses,
    expires,
    ent_hash: toHex(entHash),
    operator_sig: signed.operator_sig,
    receipts: buildReceiptBook(device.seed, {
      entHash, user: signer.address, fareTry: entitlement.fareTry, maxUses: entitlement.maxUses,
    }),
  }), (b) => `${b.receipts.length} fiş imzalandı`);

  return {
    bundle,
    bundleText: encodeBundle(bundle),
    lockHash: lock.hash,
    anchorTxId: deposit.id,
    usdcReceived: usdcAmount,
    bankReference,
  };
}

/** Paketi panoya kopyalanabilir tek satira cevirir. Gizli anahtar icermez. */
export function encodeBundle(b: Bundle): string {
  const json = JSON.stringify(b);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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
import {
  accountOf, contractErrorMessage, ensureTrustline, fareInStroops, grossWithFee,
  lockFloat, netOfFee, nextGrant, rateForExactPasses, topUp, usdcToStroops,
} from './contract.ts';
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
  { id: 'gate', label: 'Kapı seçildi', state: 'bekliyor' },
  { id: 'trustline', label: 'USDC güven hattı', state: 'bekliyor' },
  { id: 'auth', label: 'Cüzdan doğrulandı', detail: 'SEP-10', state: 'bekliyor' },
  { id: 'quote', label: 'Kur kilitlendi', detail: 'SEP-38', state: 'bekliyor' },
  { id: 'deposit', label: 'Ödeme talimatı alındı', detail: 'SEP-6', state: 'bekliyor' },
  { id: 'bank', label: 'Banka transferi alındı', state: 'bekliyor' },
  { id: 'settled', label: 'USDC hesabınıza geçti', state: 'bekliyor' },
  { id: 'lock', label: 'Bakiye zincire kilitlendi', state: 'bekliyor' },
  { id: 'entitlement', label: 'Bilet imzalandı', detail: 'zincirden doğrulandı', state: 'bekliyor' },
  { id: 'book', label: 'Geçiş fişleri hazırlandı', state: 'bekliyor' },
];

/** Kapida yapistirlacak paket. Icinde hicbir gizli anahtar yok. */
export type Bundle = {
  v: 1;
  event: string;
  gate: string;
  user: string;
  /** Kullanicinin ham Ed25519 acik anahtari — ESP32 entitlement'i bununla dogrular. */
  user_raw: string;
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
  depositTry: string;
  usdcReceived: string;
  bankReference?: string;
};

type Emit = (id: StepId, state: StepState, detail?: string) => void;

/**
 * `amountTry` kullanicinin yukledigi tutar, `gate` sectigi kapidir. Secim zincire `lock_float`in kendi
 * argumani olarak gider: bakiye o kapiya kilitlenir, entitlement o kapi icin
 * imzalanir ve fisler baska kapida kabul edilmez. Sozlesme yalnizca iki sey
 * dogrular — kapi bu etkinlige kayitli mi, ve yuk dengesi disina cikiyor mu.
 */
export async function runTopUp(
  signer: Signer, gate: string, passes: number, emit: Emit,
): Promise<Ticket> {
  // Fiyat ilkokul matematigi: bir gecis bir banknot, banknot 100 TL.
  // Ustune %5 teminat. Teminat kaybolmuyor: kapi verisini zincire tasiyinca
  // %80'i cuzdana geri donuyor, yani tasiyan icin net maliyet %1.
  const fareTotalKurus = passes * CONFIG.fareTryKurus;
  const amountTry = (Number(grossWithFee(BigInt(fareTotalKurus))) / 100).toFixed(2);
  const run = async <T>(id: StepId, fn: () => Promise<T>, detail?: (v: T) => string) => {
    emit(id, 'calisiyor');
    try {
      const value = await fn();
      emit(id, 'tamam', detail?.(value));
      return value;
    } catch (err) {
      const message = contractErrorMessage(err);
      emit(id, 'hata', message);
      throw new Error(message);
    }
  };

  // Secim en basta kesinlesir: sonraki her adim bu kapiya gore sekillenir.
  // Acik bilet varsa kapi zaten zincirde bagli; ek yukleme oraya gider.
  const existing = await accountOf(signer.address);
  await run('gate', async () => existing?.gate ?? gate,
    (g) => (existing ? `${g} — açık bilet bu kapıda` : `${g} — kullanıcı seçti`));

  const endpoints = await discover();
  const session = makeSession(endpoints, signer);

  await run('trustline', async () => ensureTrustline(signer), (created) =>
    created ? 'yeni güven hattı açıldı' : 'zaten açıktı');

  await run('auth', async () => session.ensure(), () => 'şifre yok, cüzdan imzası');

  const quote = await run('quote', () => requestQuote(session, endpoints, amountTry),
    (q) => `1 USDC = ${Number(q.total_price).toFixed(6)} TRY`);

  const deposit = await run('deposit',
    () => depositExchange(session, endpoints, {
      account: signer.address, quoteId: quote.id, amountTry,
    }),
    (d) => {
      const ref = d.instructions?.external_transfer_memo?.value;
      return ref ? `referans ${ref}` : `emir ${d.id.slice(0, 12)}…`;
    });

  const bankReference = deposit.instructions?.external_transfer_memo?.value;

  await run('bank', () => simulateBankTransfer(session, endpoints, deposit.id, amountTry),
    () => 'mock anchor: simulate-bank-transfer');

  const anchorTx = await run('settled',
    () => waitForCompletion(session, endpoints, deposit.id),
    (t) => `${t.amount_out ?? '?'} USDC`);

  // Cihaz anahtari (karar K-1): fisleri cuzdan degil bu anahtar imzalar.
  const device = loadOrCreateDeviceKey(signer.address);
  const usdcAmount = anchorTx.amount_out ?? '0';
  const amountStroops = usdcToStroops(usdcAmount);
  const expires = Math.floor(Date.now() / 1000) + 86_400;

  // Acik bilet varsa kilit bozulmaz, uzerine eklenir. O durumda kapi, ucret
  // ve kur zincirdeki kayittan gelir — bilet zincirdekiyle birebir tutmali.
  const fareTry = existing ? Number(existing.fare_try) : CONFIG.fareTryKurus;
  const targetGate = existing ? existing.gate : gate;
  // Yeni bilette kur, GERCEKLESEN yatirmadan geri hesaplanir; boylece
  // N banknot her zaman tam N gecis eder. Ek yuklemede kur zincirde kilitli
  // kalir — kullanicinin gecis basina odedigi TL degismesin diye.
  // Kur, hizmet bedeli DUSULDUKTEN sonraki bakiyeden hesaplanir: sozlesme de
  // gecis hakkini o bakiyeden sayiyor. Brut tutardan hesaplasaydik N banknot
  // N+1 gecis gorunur, sonra zincirde N cikardi.
  const netStroops = netOfFee(amountStroops);
  const lockedRate = existing
    ? Number(existing.rate)
    : rateForExactPasses(netStroops, fareTry, passes);

  // Gecis hakki uydurulmaz. Yeni bilette bakiyenin karsiladigi kadar; ek
  // yuklemede ise kontrat, kapida harcanmis olabilecek eski haklari dusup
  // soyluyor (`next_grant`). Operator imza ucu ayni sayiyi zincirden okur.
  const maxUses = existing
    ? await nextGrant(signer.address, amountStroops)
    : Number(netStroops / fareInStroops(fareTry, lockedRate));
  if (maxUses < 1) throw new Error('Bu tutar bir geçiş daha eklemeye yetmiyor.');

  const entitlement: Entitlement = {
    userRaw: StrKey.decodeEd25519PublicKey(signer.address),
    devicePk: device.publicKey,
    event: CONFIG.eventId,
    gate: targetGate,
    fareTry,
    rate: lockedRate,
    maxUses,
    expires,
  };
  const entHash = entitlementHash(entitlement);

  // Once zincir, sonra imza. Sira onemli: operator imzayi ancak zincirdeki
  // kaydi gorup dogruladiktan sonra atiyor (karar K-9).
  const lock = await run('lock',
    () => (existing
      ? topUp(signer, { amount: amountStroops, entHash })
      : lockFloat(signer, {
          amount: amountStroops, gate: targetGate, fareTry,
          rate: lockedRate, devicePk: device.publicKey, entHash,
        })),
    () => `${maxUses} geçiş · kapı ${targetGate}`);

  // Operator imzasi sunucu tarafinda atilir; gizli anahtar tarayiciya inmez.
  const signed = await run('entitlement', async () => {
    const res = await fetch(`${CONFIG.apiBase}/api/sign-entitlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: signer.address, expires }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `imza ucu HTTP ${res.status}`);
    if (body.ent_hash !== toHex(entHash)) {
      throw new Error('sunucu farklı bir entitlement özeti hesapladı — format uyuşmuyor');
    }
    return body as { ent_hash: string; max_uses: number; operator_sig: string; operator_pk: string };
  }, (b) => `operatör ${b.max_uses} geçiş için imzaladı`);

  const bundle = await run('book', async (): Promise<Bundle> => ({
    v: 1,
    event: entitlement.event,
    gate: targetGate,
    user: signer.address,
    user_raw: toHex(entitlement.userRaw),
    device_pk: toHex(device.publicKey),
    fare_try: fareTry,
    rate: lockedRate,
    max_uses: maxUses,
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
    depositTry: amountTry,
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

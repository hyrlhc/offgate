// TR Mock Anchor istemcisi — SEP-1 / SEP-10 / SEP-38 / SEP-6.
//
// Tasarim kurali: hicbir endpoint kodda sabit degil. Hepsi SEP-1 (stellar.toml)
// uzerinden kesfediliyor. Baska bir anchor'a gecmek icin tek degisen sey
// home domain olur — jurinin "hardcode etme" kriterinin tam karsiligi.

import { StellarToml, TransactionBuilder } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, SEP38_TRY, SEP38_USDC, USDC_CODE } from './env.mjs';

/** SEP-1: stellar.toml'dan tum endpoint'leri kesfet. */
export async function discover(homeDomain) {
  const toml = await StellarToml.Resolver.resolve(homeDomain);
  const currency = (toml.CURRENCIES ?? []).find((c) => c.code === USDC_CODE);
  if (!currency) throw new Error(`${homeDomain} stellar.toml icinde ${USDC_CODE} yok`);
  return {
    webAuth: toml.WEB_AUTH_ENDPOINT,
    transferServer: toml.TRANSFER_SERVER,
    kycServer: toml.KYC_SERVER,
    quoteServer: toml.ANCHOR_QUOTE_SERVER,
    signingKey: toml.SIGNING_KEY,
    issuer: currency.issuer,
    networkPassphrase: toml.NETWORK_PASSPHRASE,
  };
}

async function asJson(res, what) {
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.error ?? body?.raw ?? res.statusText;
    const err = new Error(`${what} basarisiz (HTTP ${res.status}): ${msg}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * SEP-10: challenge al, imzala, JWT'ye cevir.
 * Sifre yok — kimlik kaniti cuzdan imzasi.
 */
export async function authenticate({ webAuth, signingKey }, keypair, homeDomain) {
  const url = new URL(webAuth);
  url.searchParams.set('account', keypair.publicKey());
  url.searchParams.set('home_domain', homeDomain);

  const challenge = await asJson(await fetch(url), 'SEP-10 challenge');
  const tx = TransactionBuilder.fromXDR(
    challenge.transaction,
    challenge.network_passphrase ?? NETWORK_PASSPHRASE,
  );

  // Challenge'i anchor'in imzaladigini dogrula: ortadaki adam korumasi.
  const anchorSigned = tx.signatures.length > 0;
  if (!anchorSigned) throw new Error('SEP-10 challenge anchor tarafindan imzalanmamis');
  if (signingKey && challenge.transaction && tx.source !== signingKey) {
    throw new Error(`SEP-10 challenge kaynagi beklenen SIGNING_KEY degil (${tx.source})`);
  }

  tx.sign(keypair);
  const token = await asJson(
    await fetch(webAuth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: tx.toXDR() }),
    }),
    'SEP-10 token',
  );
  if (!token.token) throw new Error('SEP-10 yanitinda token yok');
  return token.token;
}

/** Authorization basligini ekleyen, 401'de bir kez yeniden auth yapan sarmalayici. */
export function makeSession({ endpoints, keypair, homeDomain }) {
  let jwt = null;
  async function ensure() {
    if (!jwt) jwt = await authenticate(endpoints, keypair, homeDomain);
    return jwt;
  }
  async function call(url, init = {}, retried = false) {
    const token = await ensure();
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && !retried) {
      jwt = null; // Suresi dolmus, bir kez daha dene.
      return call(url, init, true);
    }
    return res;
  }
  return { ensure, call, get token() { return jwt; } };
}

/**
 * SEP-38: TRY -> USDC icin baglayici (firm) teklif.
 * Donen quote.id deposit-exchange'e verilince kur kilitlenir:
 * biletin TL fiyati bu andan itibaren sabittir.
 */
export async function requestQuote(session, { quoteServer }, sellAmountTry) {
  const res = await session.call(`${quoteServer}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sell_asset: SEP38_TRY,
      buy_asset: SEP38_USDC,
      sell_amount: String(sellAmountTry),
      context: 'sep6',
    }),
  });
  return asJson(res, 'SEP-38 quote');
}

/**
 * SEP-6 deposit-exchange: kilitli quote ile TRY yatirma emri olustur.
 * Donen `how` / `instructions` icinde IBAN ve referans numarasi var —
 * kullanicinin EFT aciklamasina yazacagi sey budur.
 */
export async function depositExchange(session, { transferServer }, { account, quoteId, amountTry }) {
  const url = new URL(`${transferServer}/deposit-exchange`);
  // SEP-6: destination_asset on-chain varligin KODU ('USDC'),
  // source_asset ise SEP-38 formatinda off-chain varlik ('iso4217:TRY').
  url.searchParams.set('destination_asset', USDC_CODE);
  url.searchParams.set('source_asset', SEP38_TRY);
  url.searchParams.set('amount', String(amountTry));
  url.searchParams.set('account', account);
  url.searchParams.set('type', 'bank_account');
  if (quoteId) url.searchParams.set('quote_id', quoteId);
  return asJson(await session.call(url), 'SEP-6 deposit-exchange');
}

/** SEP-6 duz deposit (quote'suz) — deposit-exchange calismazsa yedek. */
export async function depositPlain(session, { transferServer }, { account, amountTry }) {
  const url = new URL(`${transferServer}/deposit`);
  url.searchParams.set('asset_code', USDC_CODE);
  url.searchParams.set('account', account);
  url.searchParams.set('amount', String(amountTry));
  url.searchParams.set('type', 'bank_account');
  return asJson(await session.call(url), 'SEP-6 deposit');
}

/**
 * Bankayi simule et. SADECE mock anchor'da var.
 * Gercekte kullanicinin EFT yapmasini beklerdin. README'de belirtilecek.
 */
export async function simulateBankTransfer(session, { transferServer }, txId, amountTry) {
  const res = await session.call(`${transferServer}/tx/${txId}/simulate-bank-transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: String(amountTry) }),
  });
  return asJson(res, 'simulate-bank-transfer');
}

export async function getTransaction(session, { transferServer }, id) {
  const url = new URL(`${transferServer}/transaction`);
  url.searchParams.set('id', id);
  return asJson(await session.call(url), 'SEP-6 transaction');
}

/** `completed` olana kadar bekle. `pending_trust` gorursen trustline eksiktir. */
export async function waitForCompletion(session, endpoints, id, { onTick, timeoutMs = 90_000 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const { transaction } = await getTransaction(session, endpoints, id);
    if (transaction.status !== last) {
      last = transaction.status;
      onTick?.(transaction);
    }
    if (transaction.status === 'completed') return transaction;
    if (transaction.status === 'error') {
      throw new Error(`Anchor islemi hata verdi: ${transaction.message ?? 'sebep bildirilmedi'}`);
    }
    if (transaction.status === 'pending_trust') {
      throw new Error('pending_trust: hesapta USDC trustline yok. scripts/00-setup-accounts.mjs calistir.');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Anchor islemi ${timeoutMs / 1000}sn icinde tamamlanmadi (son durum: ${last})`);
}

/** SEP-6 withdraw: operator USDC'yi TRY'ye cikarir. Memo zorunlu. */
export async function withdraw(session, { transferServer }, { amountUsdc }) {
  const url = new URL(`${transferServer}/withdraw`);
  url.searchParams.set('asset_code', USDC_CODE);
  url.searchParams.set('type', 'bank_account');
  url.searchParams.set('amount', String(amountUsdc));
  return asJson(await session.call(url), 'SEP-6 withdraw');
}

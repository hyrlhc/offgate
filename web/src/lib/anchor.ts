// TR Mock Anchor istemcisi — SEP-1 / SEP-10 / SEP-38 / SEP-6.
//
// scripts/lib/anchor.mjs'in tarayici surumu. Mantik ayni, imza cuzdandan
// geliyor. Hicbir endpoint kodda sabit degil: hepsi SEP-1 (stellar.toml)
// uzerinden kesfediliyor. Baska bir anchor'a gecmek icin tek degisen sey
// home domain.

import { FeeBumpTransaction, StellarToml, TransactionBuilder } from '@stellar/stellar-sdk';
import { CONFIG, SEP38_TRY } from '../config.ts';
import type { Signer } from './signer.ts';

export type Endpoints = {
  webAuth: string;
  transferServer: string;
  kycServer?: string;
  quoteServer: string;
  signingKey?: string;
  issuer: string;
};

/** SEP-1: stellar.toml'dan tum uclari kesfet. */
export async function discover(homeDomain = CONFIG.anchorHomeDomain): Promise<Endpoints> {
  const toml = await StellarToml.Resolver.resolve(homeDomain);
  const currency = (toml.CURRENCIES ?? []).find((c) => c.code === CONFIG.usdcCode);
  if (!currency?.issuer) {
    throw new Error(`${homeDomain} stellar.toml içinde ${CONFIG.usdcCode} yok`);
  }
  if (!toml.WEB_AUTH_ENDPOINT || !toml.TRANSFER_SERVER || !toml.ANCHOR_QUOTE_SERVER) {
    throw new Error(`${homeDomain} stellar.toml eksik uç bildiriyor`);
  }
  return {
    webAuth: toml.WEB_AUTH_ENDPOINT,
    transferServer: toml.TRANSFER_SERVER,
    kycServer: toml.KYC_SERVER,
    quoteServer: toml.ANCHOR_QUOTE_SERVER,
    signingKey: toml.SIGNING_KEY,
    issuer: currency.issuer,
  };
}

async function asJson(res: Response, what: string) {
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = (body.error ?? body.raw ?? res.statusText) as string;
    throw Object.assign(new Error(`${what} başarısız (HTTP ${res.status}): ${msg}`), {
      status: res.status,
    });
  }
  return body;
}

/**
 * SEP-10: anchor bir challenge islemi verir, cuzdan imzalar, JWT doner.
 * Sifre yok — kimlik kaniti cuzdan imzasidir.
 */
export async function authenticate(ep: Endpoints, signer: Signer): Promise<string> {
  const url = new URL(ep.webAuth);
  url.searchParams.set('account', signer.address);
  url.searchParams.set('home_domain', CONFIG.anchorHomeDomain);

  const challenge = await asJson(await fetch(url), 'SEP-10 challenge');
  const xdr = challenge.transaction as string;
  const passphrase = (challenge.network_passphrase as string) ?? CONFIG.networkPassphrase;

  // Challenge'i anchor'in kendi SIGNING_KEY'i imzalamis olmali: ortadaki adam korumasi.
  const tx = TransactionBuilder.fromXDR(xdr, passphrase);
  if (tx instanceof FeeBumpTransaction) throw new Error('SEP-10 challenge fee-bump olamaz');
  if (tx.signatures.length === 0) throw new Error('SEP-10 challenge imzasız geldi');
  if (ep.signingKey && tx.source !== ep.signingKey) {
    throw new Error(`SEP-10 challenge kaynağı beklenen SIGNING_KEY değil (${tx.source})`);
  }

  const signed = await signer.signTransaction(xdr);
  const token = await asJson(
    await fetch(ep.webAuth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: signed }),
    }),
    'SEP-10 token',
  );
  if (!token.token) throw new Error('SEP-10 yanıtında token yok');
  return token.token as string;
}

/** JWT'yi tasiyan, 401'de bir kez yenileyen oturum. */
export function makeSession(ep: Endpoints, signer: Signer) {
  let jwt: string | null = null;
  const ensure = async () => {
    if (!jwt) jwt = await authenticate(ep, signer);
    return jwt;
  };
  const call = async (url: URL | string, init: RequestInit = {}, retried = false): Promise<Response> => {
    const token = await ensure();
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && !retried) {
      jwt = null;
      return call(url, init, true);
    }
    return res;
  };
  return { ensure, call, get token() { return jwt; } };
}

export type Session = ReturnType<typeof makeSession>;

/**
 * SEP-38: baglayici TRY -> USDC teklifi.
 * Donen quote.id deposit-exchange'e verilince kur kilitlenir; biletin
 * TL fiyati bu andan itibaren sabittir.
 */
export async function requestQuote(s: Session, ep: Endpoints, sellAmountTry: string) {
  const res = await s.call(`${ep.quoteServer}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sell_asset: SEP38_TRY,
      buy_asset: `stellar:${CONFIG.usdcCode}:${CONFIG.usdcIssuer}`,
      sell_amount: sellAmountTry,
      context: 'sep6',
    }),
  });
  return asJson(res, 'SEP-38 quote') as Promise<{
    id: string; price: string; buy_amount: string; sell_amount: string; expires_at: string;
  }>;
}

/**
 * SEP-6 deposit-exchange: kilitli quote ile TRY yatirma emri.
 * `destination_asset` duz varlik kodu, `source_asset` SEP-38 bicimi —
 * ikisine de SEP-38 bicimi verilirse anchor 400 doner.
 */
export async function depositExchange(
  s: Session,
  ep: Endpoints,
  o: { account: string; quoteId: string; amountTry: string },
) {
  const url = new URL(`${ep.transferServer}/deposit-exchange`);
  url.searchParams.set('destination_asset', CONFIG.usdcCode);
  url.searchParams.set('source_asset', SEP38_TRY);
  url.searchParams.set('amount', o.amountTry);
  url.searchParams.set('account', o.account);
  url.searchParams.set('type', 'bank_account');
  url.searchParams.set('quote_id', o.quoteId);
  return asJson(await s.call(url), 'SEP-6 deposit-exchange') as Promise<{
    id: string;
    instructions?: Record<string, { value: string; description?: string }>;
    how?: string;
    more_info_url?: string;
  }>;
}

/**
 * Bankayi simule et. SADECE mock anchor'da vardir — gercekte kullanici
 * EFT aciklamasina referans kodunu yazar, anchor odemeyi hesapla eslestirir.
 */
export async function simulateBankTransfer(s: Session, ep: Endpoints, id: string, amountTry: string) {
  const res = await s.call(`${ep.transferServer}/tx/${id}/simulate-bank-transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountTry }),
  });
  return asJson(res, 'simulate-bank-transfer');
}

export type AnchorTx = {
  id: string;
  status: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  message?: string;
};

export async function getTransaction(s: Session, ep: Endpoints, id: string) {
  const url = new URL(`${ep.transferServer}/transaction`);
  url.searchParams.set('id', id);
  const body = (await asJson(await s.call(url), 'SEP-6 transaction')) as { transaction: AnchorTx };
  return body.transaction;
}

/** `completed` olana kadar bekler. `pending_trust` gorurse trustline eksiktir. */
export async function waitForCompletion(
  s: Session,
  ep: Endpoints,
  id: string,
  onStatus?: (t: AnchorTx) => void,
  timeoutMs = 90_000,
) {
  const started = Date.now();
  let last: string | null = null;
  while (Date.now() - started < timeoutMs) {
    const tx = await getTransaction(s, ep, id);
    if (tx.status !== last) {
      last = tx.status;
      onStatus?.(tx);
    }
    if (tx.status === 'completed') return tx;
    if (tx.status === 'error') throw new Error(`Anchor hatası: ${tx.message ?? 'sebep bildirilmedi'}`);
    if (tx.status === 'pending_trust') {
      throw new Error('pending_trust: hesapta USDC trustline yok.');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Anchor işlemi ${timeoutMs / 1000}sn içinde tamamlanmadı (son durum: ${last})`);
}

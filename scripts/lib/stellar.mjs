// Horizon yardimcilari: bakiye okuma ve trustline acma.
import { Asset, Horizon, Keypair, Operation, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import { HORIZON_URL, NETWORK_PASSPHRASE, USDC_CODE, USDC_ISSUER } from './env.mjs';

export const horizon = new Horizon.Server(HORIZON_URL);
export const USDC = new Asset(USDC_CODE, USDC_ISSUER);

export async function balances(publicKey) {
  const acc = await horizon.loadAccount(publicKey);
  const out = {};
  for (const b of acc.balances) {
    const key = b.asset_type === 'native' ? 'XLM' : b.asset_code;
    out[key] = b.balance;
  }
  return out;
}

export async function usdcBalance(publicKey) {
  return (await balances(publicKey))[USDC_CODE] ?? null; // null = trustline yok
}

/** Trustline yoksa acar, varsa dokunmaz (idempotent). */
export async function ensureTrustline(secret) {
  const kp = Keypair.fromSecret(secret);
  const current = await usdcBalance(kp.publicKey());
  if (current !== null) return { created: false, publicKey: kp.publicKey() };

  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  return { created: true, publicKey: kp.publicKey(), hash: res.hash };
}

export const expertTx = (h) => `https://stellar.expert/explorer/testnet/tx/${h}`;
export const expertAccount = (a) => `https://stellar.expert/explorer/testnet/account/${a}`;

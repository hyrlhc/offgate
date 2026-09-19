// OffGate sozlesmesiyle ve Horizon'la konusan katman.
//
// Okuma cagrilari simulasyonla yapilir (ucretsiz, imzasiz). Yazma cagrilari
// hazirlanir, cuzdana imzalatilir, aga gonderilir ve sonuclanana kadar beklenir.

import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { CONFIG } from '../config.ts';
import type { Signer } from './signer.ts';
import { fromHex } from './receipts.ts';

export const server = new rpc.Server(CONFIG.rpcUrl);
export const horizon = new Horizon.Server(CONFIG.horizonUrl);
export const USDC = new Asset(CONFIG.usdcCode, CONFIG.usdcIssuer);

const contract = () => new Contract(CONFIG.contractId);

// --- Arguman yardimcilari --------------------------------------------------

export const addressArg = (a: string) => new Address(a).toScVal();
export const symbolArg = (s: string) => nativeToScVal(s, { type: 'symbol' });
export const i128Arg = (n: bigint | number | string) => nativeToScVal(BigInt(n), { type: 'i128' });
export const u32Arg = (n: number) => nativeToScVal(n, { type: 'u32' });
export const u64Arg = (n: number) => nativeToScVal(BigInt(n), { type: 'u64' });
export const bytesArg = (hexOrBytes: string | Uint8Array) =>
  xdr.ScVal.scvBytes(
    Buffer.from(typeof hexOrBytes === 'string' ? fromHex(hexOrBytes) : hexOrBytes),
  );

// --- Okuma -----------------------------------------------------------------

/** Imzasiz, ucretsiz simulasyon. Zincirin durumunu okumak icin. */
export async function readContract<T>(method: string, args: xdr.ScVal[], from: string): Promise<T> {
  const account = await server.getAccount(from);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: CONFIG.networkPassphrase,
  })
    .addOperation(contract().call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`${method} okunamadı: ${sim.error}`);
  }
  if (!sim.result?.retval) throw new Error(`${method} boş sonuç döndü`);
  return scValToNative(sim.result.retval) as T;
}

// --- Yazma -----------------------------------------------------------------

export type SentTx = { hash: string };

/** Hazirla -> cuzdana imzalat -> gonder -> sonuclanana kadar bekle. */
export async function invokeContract(
  signer: Signer,
  method: string,
  args: xdr.ScVal[],
): Promise<{ hash: string; returnValue: unknown }> {
  const account = await server.getAccount(signer.address);
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: CONFIG.networkPassphrase,
  })
    .addOperation(contract().call(method, ...args))
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(built);
  const signedXdr = await signer.signTransaction(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, CONFIG.networkPassphrase);

  const sent = await server.sendTransaction(signed as never);
  if (sent.status === 'ERROR') {
    throw new Error(`${method} gönderilemedi: ${JSON.stringify(sent.errorResult)}`);
  }
  const final = await waitForTx(sent.hash);
  return {
    hash: sent.hash,
    returnValue: final.returnValue ? scValToNative(final.returnValue) : null,
  };
}

async function waitForTx(hash: string, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const got = await server.getTransaction(hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) return got;
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`İşlem başarısız: ${hash}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`İşlem ${timeoutMs / 1000}sn içinde sonuçlanmadı: ${hash}`);
}

// --- Trustline -------------------------------------------------------------

export async function usdcBalance(address: string): Promise<string | null> {
  try {
    const acc = await horizon.loadAccount(address);
    const line = acc.balances.find(
      (b) => 'asset_code' in b && b.asset_code === CONFIG.usdcCode && b.asset_issuer === CONFIG.usdcIssuer,
    );
    return line ? line.balance : null; // null = trustline yok
  } catch {
    return null;
  }
}

/** Trustline yoksa acar. Deposit'in `pending_trust`'ta takilmamasi icin sart. */
export async function ensureTrustline(signer: Signer): Promise<boolean> {
  if ((await usdcBalance(signer.address)) !== null) return false;

  const account = await horizon.loadAccount(signer.address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: CONFIG.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(120)
    .build();

  const signedXdr = await signer.signTransaction(tx.toXDR());
  await horizon.submitTransaction(
    TransactionBuilder.fromXDR(signedXdr, CONFIG.networkPassphrase) as never,
  );
  return true;
}

// --- OffGate cagrilari -----------------------------------------------------

export const assignGate = (from: string) =>
  readContract<string>('assign_gate', [symbolArg(CONFIG.eventId)], from);

export const floatOf = (user: string) =>
  readContract<bigint>('float_of', [addressArg(user)], user);

export const usesLeft = (user: string) =>
  readContract<number>('uses_left', [addressArg(user)], user);

export const gateLoad = (gate: string, from: string) =>
  readContract<number>('gate_load', [symbolArg(gate)], from);

export const statsOf = (from = CONFIG.readAccount) =>
  readContract<[number, number, bigint]>('stats', [symbolArg(CONFIG.eventId)], from);

export const gatesOf = (from = CONFIG.readAccount) =>
  readContract<string[]>('gates_of', [symbolArg(CONFIG.eventId)], from);

export const declaredOf = (gate: string, from = CONFIG.readAccount) =>
  readContract<number>('declared_of', [symbolArg(gate)], from);

export const settledOf = (gate: string, from = CONFIG.readAccount) =>
  readContract<number>('settled_of', [symbolArg(gate)], from);

export function lockFloat(
  signer: Signer,
  o: { amount: bigint; gate: string; fareTry: number; rate: number; devicePk: Uint8Array; entHash: Uint8Array },
) {
  return invokeContract(signer, 'lock_float', [
    addressArg(signer.address),
    i128Arg(o.amount),
    symbolArg(CONFIG.eventId),
    symbolArg(o.gate),
    i128Arg(o.fareTry),
    i128Arg(o.rate),
    bytesArg(o.devicePk),
    bytesArg(o.entHash),
  ]);
}

export const refund = (signer: Signer) =>
  invokeContract(signer, 'refund', [addressArg(signer.address)]);

/** USDC stroop (10^7) -> "10.2000000" */
export const stroopsToUsdc = (n: bigint | number) => (Number(n) / 1e7).toFixed(7);
/** "10.1980454" -> stroop */
export const usdcToStroops = (s: string) => BigInt(Math.round(Number(s) * 1e7));

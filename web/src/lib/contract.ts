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

// --- Hata cevirisi ---------------------------------------------------------

/**
 * Sozlesme hatalarinin `Error(Contract, #N)` kodlarini kullanicinin
 * anlayacagi cumleye cevirir. Numaralar `contracts/offgate/src/lib.rs`
 * icindeki `enum Error` ile birebir ayni sirada.
 */
const CONTRACT_ERRORS: Record<number, string> = {
  1: 'Sözleşme zaten kurulmuş.',
  2: 'Sözleşme henüz kurulmamış.',
  3: 'Bu etkinliğe kayıtlı kapı yok.',
  4: 'Bu kapı zaten kayıtlı.',
  5: 'Tutar, ücret veya kur geçersiz.',
  6: 'Yüklenen tutar bir geçişe bile yetmiyor.',
  7: 'Bu cüzdanın zincirde açık bir bileti zaten var. '
    + 'Yeni bilet almak için önce mevcut bakiyeyi çöz.',
  8: 'Bu cüzdana ait bir bilet bulunamadı.',
  9: 'Seçilen kapı bu etkinliğe kayıtlı değil.',
  10: 'Seçilen kapı şu an diğerinden çok daha dolu. Diğer kapıyı seç.',
};

/** Zincirden gelen ham hatayi okunur hale getirir; taniyamazsa aynen birakir. */
export function contractErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = /Error\(Contract,\s*#(\d+)\)/.exec(raw);
  if (code) {
    const known = CONTRACT_ERRORS[Number(code[1])];
    if (known) return known;
    return `Sözleşme isteği reddetti (kod ${code[1]}).`;
  }
  return raw;
}

// --- OffGate cagrilari -----------------------------------------------------

/** Etkinligin kapilari, zincirdeki anlik yukleriyle. Kapi secimi bunu gosterir. */
export type GateInfo = { gate: string; load: number };

export async function listGates(from = CONFIG.readAccount): Promise<GateInfo[]> {
  const gates = await gatesOf(from);
  return Promise.all(
    gates.map(async (gate) => ({ gate, load: await gateLoad(gate, from) })),
  );
}

/** Zincirdeki acik bilet. Hesap yoksa `null` — hata degil, normal durum. */
export type ChainAccount = {
  balance: bigint; locked: bigint; event: string; gate: string;
  fare_try: bigint; rate: bigint; device_pk: Uint8Array; ent_hash: Uint8Array;
  granted: number; used: number; ent_uses: number;
  /** Alinan ama henuz iade edilmemis hizmet bedeli, stroop. */
  fee_held: bigint;
};

export async function accountOf(user: string): Promise<ChainAccount | null> {
  try {
    return await readContract<ChainAccount>('account_of', [addressArg(user)], user);
  } catch (err) {
    // Sozlesme "hesap yok" (kod 8) donduruyorsa bu bir hata degil.
    if (/#8\b/.test(String(err))) return null;
    throw err;
  }
}

/** `top_up` cagrilsa kac gecis hakki verilecegini onceden sorar. */
export const nextGrant = (user: string, amount: bigint) =>
  readContract<number>('next_grant', [addressArg(user), i128Arg(amount)], user);

export function topUp(signer: Signer, o: { amount: bigint; entHash: Uint8Array }) {
  return invokeContract(signer, 'top_up', [
    addressArg(signer.address),
    i128Arg(o.amount),
    bytesArg(o.entHash),
  ]);
}

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

/** Su anda `refund` cagrilsa ne kadar geri gelir (acik haklar rezerve). */
export const refundableOf = (user: string) =>
  readContract<bigint>('refundable_of', [addressArg(user)], user);

// --- Kapinin imzaladigi tahsilat belgesi ------------------------------------

/**
 * Kapinin `/pay` yanitinda verdigi kayit. Kullanici bunu yaninda tasiyip
 * zincire yaziyor; karsiliginda para ustu ve hizmet bedelinin %80'i geri
 * geliyor.
 */
export type CarriedReceipt = {
  ent_hash: string;
  user: string;
  seq: number;
  fare_try: string;
  ts: number;
  sig: string;
  gate: string;
  charged_try: string;
  gate_sig: string;
};

/**
 * `Receipt` struct'ini ScVal'e cevirir.
 *
 * Elle kuruyoruz cunku `nativeToScVal` bir nesnenin anahtarlarini `scvString`
 * yapiyor; Soroban struct'lari ise `scvSymbol` anahtar bekliyor ve string
 * anahtarli map'i reddediyor. Ayrica ScMap anahtarlari SIRALI olmak zorunda.
 */
function receiptArg(r: CarriedReceipt): xdr.ScVal {
  const fields: Array<[string, xdr.ScVal]> = [
    ['charged_try', i128Arg(r.charged_try)],
    ['ent_hash', bytesArg(r.ent_hash)],
    ['fare_try', i128Arg(r.fare_try)],
    ['gate_sig', bytesArg(r.gate_sig)],
    ['seq', nativeToScVal(r.seq, { type: 'u32' })],
    ['sig', bytesArg(r.sig)],
    ['ts', nativeToScVal(BigInt(r.ts), { type: 'u64' })],
    ['user', addressArg(r.user)],
  ];
  fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return xdr.ScVal.scvMap(
    fields.map(([name, val]) =>
      new xdr.ScMapEntry({ key: nativeToScVal(name, { type: 'symbol' }), val }),
    ),
  );
}

/**
 * Fisleri zincire yazar. **Izin gerektirmez** — imzayi kapi ve kullanici
 * attigi icin veriyi kimin tasidiginin onemi yok. Cagiran taraf yalnizca
 * islem ucretini oder (~0.00001 XLM).
 */
export function settle(signer: Signer, gate: string, receipts: CarriedReceipt[]) {
  return invokeContract(signer, 'settle', [
    symbolArg(gate),
    xdr.ScVal.scvVec(receipts.map(receiptArg)),
  ]);
}

/** Kapinin imzali sayac beyanini zincire tasir. */
export function gateReport(
  signer: Signer,
  o: { gate: string; counter: number; ts: number; sig: string },
) {
  return invokeContract(signer, 'gate_report', [
    symbolArg(o.gate),
    nativeToScVal(o.counter, { type: 'u32' }),
    nativeToScVal(BigInt(o.ts), { type: 'u64' }),
    bytesArg(o.sig),
  ]);
}

const USDC_SCALE = 10_000_000n;
const RATE_SCALE = 10_000_000n;
const TRY_SCALE = 100n;

// --- Hizmet bedeli ---------------------------------------------------------
//
// Sozlesmedeki `FEE_BPS` / `REBATE_PCT` ile AYNI olmak zorunda. Bu bir
// komisyon degil teminat: kapi verisini zincire tasiyan kullaniciya %80'i
// geri odeniyor. Tasiyan icin net maliyet %1, yani anchor makasi kadar.
export const FEE_BPS = 500n;
export const REBATE_PCT = 80n;

/** Odenen tutardan kullanilabilir bakiye (sozlesme de boyle boluyor). */
export const netOfFee = (gross: bigint) => (gross * 10_000n) / (10_000n + FEE_BPS);
/** Istenen bakiye icin odenmesi gereken tutar. Yukari yuvarlar. */
export const grossWithFee = (net: bigint) =>
  (net * (10_000n + FEE_BPS) + 9_999n) / 10_000n;
/** Bir gecis tasindiginda geri gelen bedel. */
export const rebateFor = (charged: bigint) =>
  (charged * FEE_BPS * REBATE_PCT) / (10_000n * 100n);

/**
 * Bir gecisin stroop karsiligi. Sozlesmedeki `fare_in_stroops` ile birebir
 * ayni tam sayi aritmetigi — kayan nokta kullanilmaz, aksi halde tarayici ile
 * zincir farkli gecis hakki hesaplar.
 */
export const fareInStroops = (fareTry: number, rate: number) =>
  (BigInt(fareTry) * USDC_SCALE * RATE_SCALE) / (TRY_SCALE * BigInt(rate));

/**
 * `passes` adet gecisi TAM OLARAK karsilayan kuru bulur.
 *
 * Neden gerekli: kullanici 4 banknot alip 400 TL odedigi halde 3 gecis
 * gormemeli. Anchor'in verdigi `total_price` 7 haneye yuvarlanmis bir sayi;
 * ondan cikan ucretle carpilinca elde kalan pay bazen tek bir stroop'a kadar
 * iniyor ve kur birazcik oynasa gecis sayisi bire dusuyor.
 *
 * Bunun yerine kuru, GERCEKLESEN yatirmadan geri hesapliyoruz: gecis basina
 * dusen tam tutar `amount / passes`. Bu, kullanicinin fiilen odedigi kurdur —
 * uydurma degil, `total_price`in yuvarlanmamis hali.
 */
export function rateForExactPasses(amount: bigint, fareTry: number, passes: number): number {
  const target = amount / BigInt(passes);          // gecis basina stroop (asagi yuvarlar)
  if (target <= 0n) throw new Error('Tutar bir geçişe bile yetmiyor.');
  const num = BigInt(fareTry) * USDC_SCALE * RATE_SCALE;
  // Yukari yuvarla: kur buyudukce ucret kuculur, boylece pay hep pozitif kalir.
  const rate = (num + TRY_SCALE * target - 1n) / (TRY_SCALE * target);
  return Number(rate);
}

/** USDC stroop (10^7) -> "10.2000000" */
export const stroopsToUsdc = (n: bigint | number) => (Number(n) / 1e7).toFixed(7);
/** "10.1980454" -> stroop */
export const usdcToStroops = (s: string) => BigInt(Math.round(Number(s) * 1e7));

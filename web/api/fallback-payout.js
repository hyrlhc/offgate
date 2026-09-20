// Yedek anchor — odeme ucu.
//
// NEDEN VAR
//   Gercek anchor'in (tr-mock-anchor.fly.dev) SEP uclari 200 donmeye devam
//   ederken odeme isleyicisi cokebiliyor: siparis aciliyor, tutar
//   hesaplaniyor, anchor "TRY received; paying USDC on Stellar" diyor ve
//   USDC hic gelmiyor — islem `pending_anchor`de kaliyor. 20 Eylul sabahi
//   olculdu: 85 sorgu, 5.5 dakika, durum hic degismedi.
//
//   Bu durumda demonun tamami duruyordu. Yedek profil, zincirin ve kapilarin
//   calistigini gosterebilmek icin varligi DOGRUDAN gonderir.
//
// NE DEGIL
//   Bu bir anchor taklidi DEGIL ve gercek entegrasyonun yerine gecmez.
//   Kendi test varligimizi (TUSDC) kendi ihraccimizdan dagitir ve yalnizca
//   ona bagli AYRI sozlesmeyle calisir. Arayuzde "Yedek" diye gorunur.
//   Gercek anchor yolu (SEP-1/10/38/6) hic degismedi ve varsayilan odur.
//
// GUVENLIK
//   Hazine anahtari YALNIZCA burada, sunucu tarafinda. Tarayiciya inmez.
//   Testnet oyun parasi oldugu icin tutar siniri disinda kisitlama yok;
//   yine de tek istekte verilebilecek tutari sinirliyoruz ki bir hata
//   hazineyi bosaltmasin.

import {
  Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder,
} from '@stellar/stellar-sdk';
import { PROFILES } from '../shared/deployment.js';

const LOCAL = PROFILES.local;

/** Tek istekte gonderilebilecek en buyuk tutar — kaza sigortasi. */
const MAX_PAYOUT = 200;

/** Yedekte kur sabit: anchor yok, pazarlik edecek karsi taraf da yok. */
const RATE_TRY_PER_UNIT = 48.785078;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });

  const secret = process.env.FALLBACK_TREASURY_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'yedek anchor yapilandirilmamis' });
  }

  try {
    const { account, amountTry } = req.body ?? {};
    if (typeof account !== 'string' || !account.startsWith('G') || account.length !== 56) {
      return res.status(400).json({ error: 'gecersiz hesap' });
    }
    const try_ = Number(amountTry);
    if (!Number.isFinite(try_) || try_ <= 0 || try_ > 3000) {
      return res.status(400).json({ error: 'gecersiz tutar' });
    }

    const amount = (try_ / RATE_TRY_PER_UNIT).toFixed(7);
    if (Number(amount) > MAX_PAYOUT) {
      return res.status(400).json({ error: 'tutar sinirin uzerinde' });
    }

    const horizon = new Horizon.Server(LOCAL.horizonUrl);
    const asset = new Asset(LOCAL.usdcCode, LOCAL.usdcIssuer);

    // Guven hatti yoksa odeme basarisiz olur; sebebini net soyleyelim.
    const dest = await horizon.loadAccount(account).catch(() => null);
    if (!dest) return res.status(400).json({ error: 'hesap zincirde yok' });
    const hasTrust = dest.balances.some(
      (b) => b.asset_code === LOCAL.usdcCode && b.asset_issuer === LOCAL.usdcIssuer,
    );
    if (!hasTrust) {
      return res.status(409).json({ error: `${LOCAL.usdcCode} guven hatti yok` });
    }

    const treasury = Keypair.fromSecret(secret);
    const source = await horizon.loadAccount(treasury.publicKey());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination: account, asset, amount }))
      .setTimeout(60)
      .build();
    tx.sign(treasury);

    const sent = await horizon.submitTransaction(tx);
    return res.status(200).json({
      hash: sent.hash,
      amount,
      asset: LOCAL.usdcCode,
      rate: String(RATE_TRY_PER_UNIT),
      amountTry: try_.toFixed(2),
    });
  } catch (err) {
    const detail = err?.response?.data?.extras?.result_codes;
    return res.status(400).json({
      error: detail ? `odeme reddedildi: ${JSON.stringify(detail)}` : err.message,
    });
  }
}

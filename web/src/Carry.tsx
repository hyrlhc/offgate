// Kapi verisini zincire tasima ekrani.
//
// Kullanici kapida gecti; kapi ona imzali bir tahsilat belgesi verdi. Burada
// onu zincire yaziyor ve karsiliginda parasini aliyor:
//
//   1. PARA USTU — kapi biletin ust sinirindan az tahsil ettiyse (100 TL'lik
//      hakla 80 TL'lik kapi) fark bakiyesinde kalir.
//   2. HIZMET BEDELI IADESI — tasidigi her gecis icin %5'lik teminatin %80'i
//      cuzdanina doner.
//   3. IADE HAKKI — acikta kalan imzali hak kapandigi icin `refund` ile
//      geri alabilecegi tutar buyur.
//
// Ucu de ayni islemde. Yani senkronizasyon isini operatorun yapmasina gerek
// yok: kullanicilarin kendi cikari onlari zincire getiriyor, kapi verisi
// bedavaya tasinmis oluyor.
//
// Neden ayri bir ekran: kapi sayfasi `http://192.168.4.1` origin'inde,
// uygulama `https://offgate.vercel.app`'te. Tarayici ikisi arasinda veri
// gecisine izin vermiyor (karar K-2). Cozum bilet paketiyle ayni: kopyala-
// yapistir. Metnin icinde gizli anahtar yok, yalnizca imzali kayitlar var.

import { useCallback, useEffect, useState } from 'react';
import Nav from './components/Nav.tsx';
import { formatTry, gateLabel } from './config.ts';
import {
  contractErrorMessage, gateReport, rebateFor, refundableOf, settle, stroopsToUsdc,
  type CarriedReceipt,
} from './lib/contract.ts';
import { createWristband, savedWristbandAddress, type Signer } from './lib/signer.ts';

type GateReport = { gate: string; counter: number; ts: number; sig: string };
type Parsed = { receipts: CarriedReceipt[]; report?: GateReport };

/** Kapi sayfasinin urettigi base64 metni cozer. */
function decode(text: string): Parsed {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Metin boş.');
  let json: string;
  try {
    let s = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    json = decodeURIComponent(escape(atob(s)));
  } catch {
    throw new Error('Metin okunamadı — kapı sayfasından kopyaladığından emin ol.');
  }
  const o = JSON.parse(json) as Parsed;
  if (!Array.isArray(o.receipts) || o.receipts.length === 0) {
    throw new Error('İçinde geçiş kaydı yok.');
  }
  for (const r of o.receipts) {
    if (!r.ent_hash || !r.gate_sig || !r.gate) {
      throw new Error('Kayıt eksik — kapı imzası yok.');
    }
  }
  return o;
}

/** `settle` tek seferde tek kapinin fisini alir; kapiya gore gruplayalim. */
function byGate(receipts: CarriedReceipt[]) {
  const map = new Map<string, CarriedReceipt[]>();
  for (const r of receipts) {
    const list = map.get(r.gate) ?? [];
    list.push(r);
    map.set(r.gate, list);
  }
  return [...map.entries()];
}

type Result = { accepted: number; rebate: bigint; before: bigint; after: bigint };

export default function Carry() {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const saved = savedWristbandAddress();

  useEffect(() => {
    if (!text.trim()) { setParsed(null); setError(null); return; }
    try { setParsed(decode(text)); setError(null); } catch (err) {
      setParsed(null);
      setError((err as Error).message);
    }
  }, [text]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try { setSigner(await createWristband()); } catch (err) {
      setError(contractErrorMessage(err));
    } finally { setBusy(false); }
  }, []);

  const carry = useCallback(async () => {
    if (!signer || !parsed) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const before = await refundableOf(signer.address).catch(() => 0n);
      let accepted = 0;
      let rebate = 0n;

      for (const [gate, list] of byGate(parsed.receipts)) {
        await settle(signer, gate, list);
        accepted += list.length;
        for (const r of list) rebate += rebateFor(BigInt(r.charged_try));
      }
      // Kapinin imzali sayac beyani varsa o da tasinir — denetimin bagimsiz
      // ikinci kaynagi bu.
      if (parsed.report) await gateReport(signer, parsed.report);

      const after = await refundableOf(signer.address).catch(() => 0n);
      setResult({ accepted, rebate, before, after });
      setText('');
    } catch (err) {
      setError(contractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [signer, parsed]);

  const total = parsed?.receipts.reduce(
    (sum, r) => sum + rebateFor(BigInt(r.charged_try)), 0n,
  ) ?? 0n;

  return (
    <div className="page">
      <Nav active="carry" />
      <div className="doc-head compact">
        <span className="eyebrow">Ağa katkı</span>
        <h1>Kapı verisini zincire taşı</h1>
        <p className="lede">
          Turnikeden geçtiğinde kapı sana imzalı bir tahsilat belgesi verdi.
          Sözleşme imzanın gerçekten o turnikeye ait olduğunu doğrular ve
          karşılığında paranı geri verir.
        </p>
      </div>

      <section className="card">
        <h2>Neden taşıyorsun</h2>
        <dl className="kv">
          <dt>Para üstü</dt>
          <dd>Kapı daha az tahsil ettiyse fark bakiyende kalır.</dd>
          <dt>Teminat iadesi</dt>
          <dd>Taşıdığın her geçiş için %5’lik teminatın %80’i cüzdanına döner.</dd>
          <dt>İade hakkı</dt>
          <dd>Açık kalan hak kapandığı için geri çekebileceğin tutar büyür.</dd>
        </dl>
        <p className="sub" style={{ marginBottom: 0 }}>
          İşlem ücreti Stellar’da kuruşun altında — bu yüzden böyle bir mikro
          ödül ekonomisi burada mantıklı.
        </p>
      </section>

      <section className="card">
        <h2>Veriyi yapıştır</h2>
        {!signer ? (
          <button className="primary" onClick={connect} disabled={busy}>
            {busy ? 'Bağlanıyor…' : saved ? 'Cüzdanı bağla' : 'Cüzdan bağla'}
          </button>
        ) : (
          <p className="sub">Cüzdan: <span className="mono">{signer.address}</span></p>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Kapı sayfasında 'Kopyala' dediğin metni buraya yapıştır…"
          style={{ width: '100%', marginTop: 12 }}
        />

        {error && <div className="err-box">{error}</div>}

        {parsed && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="audit">
                <thead>
                  <tr><th>Kapı</th><th>Fiş</th><th>Tahsil edilen</th><th>Sana dönen</th></tr>
                </thead>
                <tbody>
                  {parsed.receipts.map((r) => (
                    <tr key={`${r.ent_hash}-${r.seq}`}>
                      <td>{gateLabel(r.gate)} <span className="mono">{r.gate}</span></td>
                      <td>#{r.seq}</td>
                      <td>{formatTry(Number(r.charged_try))}</td>
                      <td className="good">
                        +{stroopsToUsdc(rebateFor(BigInt(r.charged_try)))} USDC
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sub">
              Toplam iade: <b>{stroopsToUsdc(total)} USDC</b>
              {parsed.report && <> · kapı beyanı da taşınacak (sayaç {parsed.report.counter})</>}
            </p>
            <button className="primary" onClick={carry} disabled={!signer || busy}>
              {busy ? 'Zincire yazılıyor…' : 'Zincire yaz ve paramı al'}
            </button>
            {!signer && <p className="sub">Önce cüzdanını bağla.</p>}
          </>
        )}
      </section>

      {result && (
        <section className="card">
          <h2>Oldu</h2>
          <dl className="kv">
            <dt>Zincire yazılan geçiş</dt><dd>{result.accepted}</dd>
            <dt>Cüzdanına dönen teminat</dt>
            <dd className="good">{stroopsToUsdc(result.rebate)} USDC</dd>
            <dt>Geri çekebileceğin tutar</dt>
            <dd>
              {stroopsToUsdc(result.before)} → <b>{stroopsToUsdc(result.after)}</b> USDC
            </dd>
          </dl>
          <p className="sub" style={{ marginBottom: 0 }}>
            Kapı verisi artık zincirde. Operatörün senkronizasyon yapmasına gerek
            kalmadı — sen yaptın, karşılığını da aldın.
          </p>
        </section>
      )}
    </div>
  );
}

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
import { t, useLang } from './lib/i18n.ts';
import {
  contractErrorMessage, gateReport, rebateFor, refundableOf, settle, stroopsToUsdc,
  type CarriedReceipt,
} from './lib/contract.ts';
import { createWristband, type Signer } from './lib/signer.ts';

type GateReport = { gate: string; counter: number; ts: number; sig: string };
type Parsed = { receipts: CarriedReceipt[]; report?: GateReport };

/** Kapi sayfasinin urettigi base64 metni cozer. */
function decode(text: string): Parsed {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(t('carry.errEmpty'));
  let json: string;
  try {
    let s = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    json = decodeURIComponent(escape(atob(s)));
  } catch {
    throw new Error(t('carry.errUnreadable'));
  }
  const o = JSON.parse(json) as Parsed;
  if (!Array.isArray(o.receipts) || o.receipts.length === 0) {
    throw new Error(t('carry.errNoReceipts'));
  }
  for (const r of o.receipts) {
    if (!r.ent_hash || !r.gate_sig || !r.gate) {
      throw new Error(t('carry.errNoGateSig'));
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
  useLang();

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
        <span className="eyebrow">{t('carry.eyebrow')}</span>
        <h1>{t('carry.title')}</h1>
        <p className="lede">{t('carry.lead')}</p>
      </div>

      <section className="card">
        <h2>{t('carry.whyTitle')}</h2>
        <dl className="kv">
          <dt>{t('carry.change')}</dt><dd>{t('carry.changeBody')}</dd>
          <dt>{t('carry.rebate')}</dt><dd>{t('carry.rebateBody')}</dd>
          <dt>{t('carry.refundable')}</dt><dd>{t('carry.refundableBody')}</dd>
        </dl>
        <p className="sub" style={{ marginBottom: 0 }}>{t('carry.feeNote')}</p>
      </section>

      <section className="card">
        <h2>{t('carry.pasteTitle')}</h2>
        {!signer ? (
          <button className="primary" onClick={connect} disabled={busy}>
            {busy ? t('flow.connecting') : t('flow.connect')}
          </button>
        ) : (
          <p className="sub">{t('carry.wallet')}: <span className="mono">{signer.address}</span></p>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={t('carry.placeholder')}
          style={{ width: '100%', marginTop: 12 }}
        />

        {error && <div className="err-box">{error}</div>}

        {parsed && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="audit">
                <thead>
                  <tr><th>{t('carry.colGate')}</th><th>{t('carry.colReceipt')}</th><th>{t('carry.colCharged')}</th><th>{t('carry.colBack')}</th></tr>
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
              {t('carry.totalBack')}: <b>{stroopsToUsdc(total)} USDC</b>
              {parsed.report && <> · {t('carry.alsoReport', { n: parsed.report.counter })}</>}
            </p>
            <button className="primary" onClick={carry} disabled={!signer || busy}>
              {busy ? t('carry.submitting') : t('carry.submit')}
            </button>
            {!signer && <p className="sub">{t('carry.connectFirst')}</p>}
          </>
        )}
      </section>

      {result && (
        <section className="card">
          <h2>{t('carry.doneTitle')}</h2>
          <dl className="kv">
            <dt>{t('carry.donePasses')}</dt><dd>{result.accepted}</dd>
            <dt>{t('carry.doneRebate')}</dt>
            <dd className="good">{stroopsToUsdc(result.rebate)} USDC</dd>
            <dt>{t('carry.doneRefundable')}</dt>
            <dd>
              {stroopsToUsdc(result.before)} → <b>{stroopsToUsdc(result.after)}</b> USDC
            </dd>
          </dl>
          <p className="sub" style={{ marginBottom: 0 }}>{t('carry.doneNote')}</p>
        </section>
      )}
    </div>
  );
}

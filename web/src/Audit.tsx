import { useCallback, useEffect, useState } from 'react';
import Nav from './components/Nav.tsx';
import { CONFIG, expertContract, formatTry } from './config.ts';
import { t, useLang } from './lib/i18n.ts';
import { declaredOf, gateLoad, gatesOf, settledOf, statsOf, stroopsToUsdc } from './lib/contract.ts';

type GateRow = { gate: string; declared: number; settled: number; load: number };

/**
 * Denetim ekrani.
 *
 * Kapinin kendi beyani ile zincire dusen fis sayisini yan yana koyar.
 * Tutmuyorsa operator eksik hasilat beyan etmis demektir — bu tablo,
 * "organizator hasilati gizleyemez" iddiasinin kaniti.
 */
export default function Audit() {
  const [rows, setRows] = useState<GateRow[] | null>(null);
  const [totals, setTotals] = useState<{ declared: number; settled: number; revenue: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useLang();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const gates = await gatesOf();
      const out: GateRow[] = [];
      for (const gate of gates) {
        const [declared, settled, load] = await Promise.all([
          declaredOf(gate), settledOf(gate), gateLoad(gate, CONFIG.readAccount),
        ]);
        out.push({ gate, declared, settled, load });
      }
      const [declared, settled, revenue] = await statsOf();
      setRows(out);
      setTotals({ declared, settled, revenue });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const matches = totals ? totals.declared === totals.settled : true;

  return (
    <div className="page">
      <Nav active="audit" />
      <div className="doc-head compact">
        <span className="eyebrow">{t('audit.eyebrow', { event: CONFIG.eventId })}</span>
        <h1>{t('audit.title')}</h1>
        <p className="lede">{t('audit.lead')}</p>
      </div>

      {error && <div className="err-box">{error}</div>}

      <section className="card">
        <h2>{t('audit.gates')}</h2>
        {!rows && <p className="sub" style={{ margin: 0 }}>{t('audit.loading')}</p>}
        {rows && rows.length === 0 && <p className="sub" style={{ margin: 0 }}>{t('audit.none')}</p>}
        {rows && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="audit">
              <thead>
                <tr><th>{t('audit.colGate')}</th><th>{t('audit.colDeclared')}</th><th>{t('audit.colChain')}</th><th>{t('audit.colDiff')}</th><th>{t('audit.colLoad')}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const diff = r.declared - r.settled;
                  return (
                    <tr key={r.gate}>
                      <td className="mono">{r.gate}</td>
                      <td>{r.declared}</td>
                      <td>{r.settled}</td>
                      {/* Farkin yonu iki ayri sey anlatiyor: beyan zincirden
                          fazlaysa fisler kayip (denetimin aradigi durum),
                          azsa yalnizca kapinin imzali beyani henuz
                          tasinmamis — hasilat kaybi degil. */}
                      <td className={diff > 0 ? 'bad' : 'good'}>
                        {diff === 0
                          ? '0 ✓'
                          : diff > 0
                            ? t('audit.missing', { n: diff })
                            : t('audit.behind', { n: -diff })}
                      </td>
                      <td>{r.load}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {totals && (
        <section className="card">
          <h2>{t('audit.total')}</h2>
          <dl className="kv">
            <dt>{t('audit.totalDeclared')}</dt><dd>{totals.declared}</dd>
            <dt>{t('audit.totalChain')}</dt><dd>{totals.settled}</dd>
            <dt>{t('audit.revenue')}</dt><dd>{stroopsToUsdc(totals.revenue)} {CONFIG.usdcCode}</dd>
            <dt>{t('flow.fare')}</dt><dd>{formatTry(CONFIG.fareTryKurus)}</dd>
          </dl>
          <div className={`res-line ${matches ? 'good' : 'bad'}`}>
            {matches
              ? t('audit.match')
              : totals.declared > totals.settled
                ? t('audit.mismatch', { n: totals.declared - totals.settled })
                : t('audit.behindNote', { n: totals.settled - totals.declared })}
          </div>
          <div className="note">{t('audit.note')}</div>
        </section>
      )}

      <div className="row">
        <button onClick={() => void load()} disabled={loading}>
          {loading ? t('audit.reading') : t('audit.refresh')}
        </button>
        <a href="#"><button className="ghost" style={{ width: '100%' }}>{t('audit.back')}</button></a>
      </div>

      <footer>
        <a href={expertContract(CONFIG.contractId)} target="_blank" rel="noreferrer">
          {t('audit.expert')}
        </a>
      </footer>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import Nav from './components/Nav.tsx';
import { CONFIG, expertContract, formatTry } from './config.ts';
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
        <span className="eyebrow">Etkinlik {CONFIG.eventId}</span>
        <h1>Denetim</h1>
        <p className="lede">Kapının kendi beyanı ile zincirdeki kayıt yan yana.</p>
      </div>

      {error && <div className="err-box">{error}</div>}

      <section className="card">
        <h2>Kapılar</h2>
        {!rows && <p className="sub" style={{ margin: 0 }}>Zincirden okunuyor…</p>}
        {rows && rows.length === 0 && <p className="sub" style={{ margin: 0 }}>Kayıtlı kapı yok.</p>}
        {rows && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="audit">
              <thead>
                <tr><th>Kapı</th><th>Beyan</th><th>Zincirde</th><th>Fark</th><th>Yük</th></tr>
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
                        {diff === 0 ? '0 ✓' : diff > 0 ? `${diff} eksik` : `beyan ${-diff} geride`}
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
          <h2>Toplam</h2>
          <dl className="kv">
            <dt>Beyan edilen geçiş</dt><dd>{totals.declared}</dd>
            <dt>Zincire düşen fiş</dt><dd>{totals.settled}</dd>
            <dt>Hasılat</dt><dd>{stroopsToUsdc(totals.revenue)} USDC</dd>
            <dt>Geçiş ücreti</dt><dd>{formatTry(CONFIG.fareTryKurus)}</dd>
          </dl>
          <div className={`res-line ${matches ? 'good' : 'bad'}`}>
            {matches
              ? 'Beyan ile zincir tutuyor — eksik hasılat yok.'
              : `FARK VAR: ${totals.declared - totals.settled} geçiş zincire düşmemiş.`}
          </div>
          <div className="note">
            Kapı sayacı <strong>gate_report</strong> ile, fişler <strong>settle</strong> ile
            zincire yazılır. İki sayı bağımsız kaynaklardan gelir; operatör yalnızca birini
            eksiltemez.
          </div>
        </section>
      )}

      <div className="row">
        <button onClick={() => void load()} disabled={loading}>
          {loading ? 'Okunuyor…' : 'Yenile'}
        </button>
        <a href="#"><button className="ghost" style={{ width: '100%' }}>Demoya dön</button></a>
      </div>

      <footer>
        <a href={expertContract(CONFIG.contractId)} target="_blank" rel="noreferrer">
          Sözleşmeyi Stellar Expert'te aç
        </a>
      </footer>
    </div>
  );
}

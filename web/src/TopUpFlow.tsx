import { useCallback, useMemo, useState } from 'react';
import { CONFIG, expertAccount, expertTx, formatRate, formatTry } from './config.ts';
import { INITIAL_STEPS, runTopUp, type Step, type StepId, type StepState, type Ticket } from './lib/flow.ts';
import { connectWallet, createWristband, type Signer } from './lib/signer.ts';

const MARKS: Record<StepState, string> = { bekliyor: '○', calisiyor: '◐', tamam: '✓', hata: '✕' };
const short = (s: string, h = 6, t = 4) => (s.length > h + t + 2 ? `${s.slice(0, h)}…${s.slice(-t)}` : s);

/**
 * Kullanicinin telefonda gorecegi akis. Uc ekran: cuzdan, yukleme, bilet.
 *
 * Demo masaustunden surulur (cuzdan eklentisi orada calisir), ama arayuz
 * telefon icin tasarlandi — cercevenin icinde birebir bu gorunuyor.
 */
export default function TopUpFlow({ onTicket }: { onTicket?: (t: Ticket) => void }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const started = useMemo(() => steps.some((s) => s.state !== 'bekliyor'), [steps]);

  const emit = useCallback((id: StepId, state: StepState, detail?: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, state, detail: detail ?? s.detail } : s)));
  }, []);

  const connect = async (mode: 'wallet' | 'wristband') => {
    setError(null);
    setBusy(true);
    try {
      setSigner(mode === 'wallet' ? await connectWallet() : await createWristband());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const topUp = async () => {
    if (!signer) return;
    setError(null);
    setBusy(true);
    setSteps(INITIAL_STEPS);
    try {
      const t = await runTopUp(signer, emit);
      setTicket(t);
      onTicket?.(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!ticket) return;
    try {
      await navigator.clipboard.writeText(ticket.bundleText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Pano izni yok — aşağıdaki kutudan elle kopyalayın.');
    }
  };

  return (
    <div className="flow">
      <div className="flow-head">
        <span className="flow-brand">OffGate</span>
        {signer && <span className="flow-addr mono">{short(signer.address, 4, 4)}</span>}
      </div>

      {error && <div className="err-box">{error}</div>}

      {!signer && (
        <>
          <p className="flow-lead">
            Etkinlik içinde geçerli bakiyeni yükle. İnternet olmadan geç.
          </p>
          <button className="primary" onClick={() => connect('wallet')} disabled={busy}>
            {busy ? 'Bekleniyor…' : 'Cüzdanı bağla'}
          </button>
          <p className="flow-note">
            Freighter, Lobstr, Albedo ve diğerleri — <b>Stellar Wallets Kit</b>.
          </p>
          <button className="link-btn" onClick={() => connect('wristband')} disabled={busy}>
            Cüzdanım yok, etkinlik bilekliği ver
          </button>
        </>
      )}

      {signer && !ticket && (
        <>
          <div className="flow-amount">
            <span className="n">{Number(CONFIG.depositTry).toLocaleString('tr-TR')}</span>
            <span className="c">TL</span>
          </div>
          <dl className="kv tight">
            <dt>Geçiş ücreti</dt><dd>{formatTry(CONFIG.fareTryKurus)}</dd>
            <dt>Geçiş hakkı</dt><dd>{CONFIG.maxUses}</dd>
            <dt>Etkinlik</dt><dd>{CONFIG.eventId}</dd>
          </dl>
          <button className="primary" onClick={topUp} disabled={busy}>
            {busy ? 'Yükleniyor…' : 'Yükle'}
          </button>
          {started && <StepList steps={steps} />}
        </>
      )}

      {ticket && (
        <>
          <div className="ticket-head">
            <div className="big-n">{ticket.bundle.max_uses}</div>
            <div className="big-l">geçiş hakkı</div>
            <div className="gate-chip">Kapı {ticket.bundle.gate}</div>
          </div>
          <dl className="kv tight">
            <dt>Geçiş ücreti</dt><dd>{formatTry(ticket.bundle.fare_try)}</dd>
            <dt>Kilitli kur</dt><dd>1 USDC = {formatRate(ticket.bundle.rate)} ₺</dd>
            <dt>Yatırılan</dt><dd>{Number(CONFIG.depositTry).toLocaleString('tr-TR')} TL</dd>
            {ticket.bankReference && (<><dt>Banka referansı</dt><dd className="mono">{ticket.bankReference}</dd></>)}
          </dl>
          <button className="primary" onClick={copy}>
            {copied ? 'Kopyalandı ✓' : 'Kapıya git — bileti kopyala'}
          </button>
          <p className="flow-note">
            Fişler <b>şimdiden imzalandı</b>. Kapıda internet gerekmez.
          </p>
          <textarea className="bundle" readOnly value={ticket.bundleText} onFocus={(e) => e.currentTarget.select()} />
          <div className="flow-links">
            <a href={expertTx(ticket.lockHash)} target="_blank" rel="noreferrer">Kilitleme işlemi ↗</a>
            <a href={expertAccount(ticket.bundle.user)} target="_blank" rel="noreferrer">Hesap ↗</a>
          </div>
          <StepList steps={steps} />
        </>
      )}
    </div>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ul className="steps">
      {steps.map((s) => (
        <li key={s.id} data-s={s.state}>
          <span className="mark">{MARKS[s.state]}</span>
          <span>
            <span className="lbl">{s.label}</span>
            {s.detail && s.state !== 'bekliyor' && <span className="det">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

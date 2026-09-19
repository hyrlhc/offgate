import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONFIG, expertAccount, expertTx, formatRate, formatTry, gateLabel } from './config.ts';
import { contractErrorMessage, listGates, refund, type GateInfo } from './lib/contract.ts';
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
  const [gates, setGates] = useState<GateInfo[] | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  // Kapilari ve yuklerini zincirden okuyoruz; liste sabit kodlanmis degil.
  const loadGates = useCallback(async () => {
    try {
      const list = await listGates();
      setGates(list);
      setGate((current) => current ?? leastLoaded(list));
    } catch (e) {
      setError(contractErrorMessage(e));
    }
  }, []);

  useEffect(() => { void loadGates(); }, [loadGates]);

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
    if (!signer || !gate) return;
    setError(null);
    setLocked(false);
    setBusy(true);
    setSteps(INITIAL_STEPS);
    try {
      const t = await runTopUp(signer, gate, emit);
      setTicket(t);
      onTicket?.(t);
      void loadGates();
    } catch (e) {
      const message = contractErrorMessage(e);
      setError(message);
      // Acik bilet hatasi (kod 7) tek tikla cozulebilir; kullaniciyi
      // konsola bakmaya birakmiyoruz.
      setLocked(message.startsWith('Bu cüzdanın zincirde açık bir bileti'));
    } finally {
      setBusy(false);
    }
  };

  /** Zincirdeki acik bileti kapatip kalan USDC'yi cuzdana geri gonderir. */
  const release = async () => {
    if (!signer) return;
    setError(null);
    setBusy(true);
    try {
      await refund(signer);
      setLocked(false);
      setSteps(INITIAL_STEPS);
      void loadGates();
    } catch (e) {
      setError(contractErrorMessage(e));
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

      {error && (
        <div className="err-box">
          {error}
          {locked && (
            <button className="link-btn danger" onClick={release} disabled={busy}>
              {busy ? 'Çözülüyor…' : 'Bakiyeyi çöz ve cüzdana geri al'}
            </button>
          )}
        </div>
      )}

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

          <GatePicker gates={gates} chosen={gate} busy={busy} onPick={setGate} />

          <button className="primary" onClick={topUp} disabled={busy || !gate}>
            {busy ? 'Yükleniyor…' : gate ? `Yükle — ${gateLabelOf(gates, gate)}` : 'Kapı seç'}
          </button>
          {started && <StepList steps={steps} />}
        </>
      )}

      {ticket && (
        <>
          <div className="ticket-head">
            <div className="big-n">{ticket.bundle.max_uses}</div>
            <div className="big-l">geçiş hakkı</div>
            <div className="gate-chip">
              {gateLabelOf(gates, ticket.bundle.gate)}
              <span className="gate-hw mono">{ticket.bundle.gate}</span>
            </div>
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

/** Kapi secimi. Yuk zincirden gelir; secim tamamen kullanicinindir. */
function GatePicker({
  gates, chosen, busy, onPick,
}: {
  gates: GateInfo[] | null;
  chosen: string | null;
  busy: boolean;
  onPick: (g: string) => void;
}) {
  if (!gates) return <p className="flow-note">Kapılar zincirden okunuyor…</p>;
  if (gates.length === 0) return <p className="flow-note">Bu etkinliğe kayıtlı kapı yok.</p>;

  const min = Math.min(...gates.map((g) => g.load));

  return (
    <div className="gate-pick">
      <p className="gate-pick-lead">Hangi kapıdan gireceksin?</p>
      <div className="gate-opts">
        {gates.map((g, i) => {
          // Sozlesme, en bos kapidan iki kisiden fazla acilmis kapiyi reddeder
          // (GATE_LOAD_TOLERANCE). Kurali burada da gosteriyoruz ki kullanici
          // reddedilen bir istegi hic gondermesin.
          const blocked = g.load > min + 2;
          return (
            <button
              key={g.gate}
              type="button"
              className="gate-opt"
              aria-pressed={chosen === g.gate}
              disabled={busy || blocked}
              onClick={() => onPick(g.gate)}
            >
              <span className="gate-opt-name">{gateLabel(g.gate, i)}</span>
              <span className="gate-opt-hw mono">{g.gate}</span>
              <span className="gate-opt-load">
                {blocked ? 'şu an dolu' : `${g.load} açık bilet`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Zincirdeki kapi sirasina gore "Kapi 1 / Kapi 2" etiketi. */
function gateLabelOf(gates: GateInfo[] | null, gate: string) {
  const i = gates?.findIndex((g) => g.gate === gate) ?? -1;
  return gateLabel(gate, i < 0 ? 0 : i);
}

/** Varsayilan secim: en az yuklu kapi. Kullanici degistirebilir. */
function leastLoaded(gates: GateInfo[]): string | null {
  if (gates.length === 0) return null;
  return gates.reduce((a, b) => (b.load < a.load ? b : a)).gate;
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONFIG, expertAccount, expertTx, formatRate, formatTry, gateLabel } from './config.ts';
import {
  accountOf, contractErrorMessage, listGates, refund,
  type ChainAccount, type GateInfo,
} from './lib/contract.ts';
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
  const [amount, setAmount] = useState(CONFIG.depositTry);
  const [open, setOpen] = useState<ChainAccount | null>(null);

  // Cuzdan baglaninca zincirdeki acik bileti okuyoruz: "zaten bilet var"
  // durumu bir hata degil, gosterilmesi gereken bir durum.
  const loadOpen = useCallback(async (address: string) => {
    try {
      setOpen(await accountOf(address));
    } catch {
      setOpen(null);
    }
  }, []);

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

  // Tutar kontrolu: anchor limitleri ve "en az bir gecis" kurali.
  //
  // Gecis sayisi TL / ucret degildir. TL once USDC'ye cevrilir (anchor'in ALIS
  // kuru), ucret ise USDC olarak SEP-38 kuruyla hesaplanir; aradaki makas
  // kadar kayip olur. Burada yaklasik gosteriyoruz — kesin sayi kur
  // kilitlendiginde belli olur ve bilette yazar. Kasten asagi yuvarliyoruz:
  // eksik soz vermek, fazla soz verip kapida mahcup olmaktan iyidir.
  const SPREAD_HAIRCUT = 0.985;
  const amountTry = Number(amount.replace(',', '.'));
  const uses = Number.isFinite(amountTry)
    ? Math.floor((amountTry * SPREAD_HAIRCUT * 100) / CONFIG.fareTryKurus)
    : 0;
  const amountError = !Number.isFinite(amountTry) || amountTry <= 0
    ? 'Geçerli bir tutar gir.'
    : amountTry < CONFIG.minDepositTry
      ? `En az ${CONFIG.minDepositTry} TL yüklenebilir.`
      : amountTry > CONFIG.maxDepositTry
        ? `En fazla ${CONFIG.maxDepositTry.toLocaleString('tr-TR')} TL yüklenebilir.`
        : uses < 1
          ? 'Bu tutar bir geçişe bile yetmiyor.'
          : null;

  const emit = useCallback((id: StepId, state: StepState, detail?: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, state, detail: detail ?? s.detail } : s)));
  }, []);

  const connect = async (mode: 'wallet' | 'wristband') => {
    setError(null);
    setBusy(true);
    try {
      const s = mode === 'wallet' ? await connectWallet() : await createWristband();
      setSigner(s);
      void loadOpen(s.address);
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
      const t = await runTopUp(signer, gate, String(amountTry), emit);
      setTicket(t);
      onTicket?.(t);
      void loadGates();
      void loadOpen(signer.address);
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
      setOpen(null);
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
          <label className="amount-field">
            <span className="amount-label">Ne kadar yükleyeceksin?</span>
            <span className="amount-input">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                disabled={busy}
                onChange={(e) => setAmount(e.currentTarget.value)}
                aria-label="Yüklenecek tutar"
              />
              <span className="c">TL</span>
            </span>
          </label>
          <div className="amount-quick">
            {['250', '500', '1000'].map((v) => (
              <button
                key={v}
                type="button"
                className="chip"
                aria-pressed={amount === v}
                disabled={busy}
                onClick={() => setAmount(v)}
              >
                {Number(v).toLocaleString('tr-TR')}
              </button>
            ))}
          </div>
          <dl className="kv tight">
            <dt>Geçiş ücreti</dt><dd>{formatTry(CONFIG.fareTryKurus)}</dd>
            <dt>{open ? 'Eklenecek hak' : 'Geçiş hakkı'}</dt>
            <dd>{amountError ? '—' : `≈ ${uses} geçiş`}</dd>
            <dt>Etkinlik</dt><dd>{CONFIG.eventId}</dd>
          </dl>
          {amountError && <p className="amount-warn">{amountError}</p>}

          {open ? (
            <div className="open-note">
              <b>Zincirde açık biletin var.</b> Ek yükleme aynı kapıya ve aynı
              kilitli kura gider: <b>{gateLabelOf(gates, open.gate)}</b>,
              1 USDC = {formatRate(Number(open.rate))} ₺.
              {' '}İmzalanan {open.granted} geçişin {open.used} tanesi zincire düştü.
            </div>
          ) : (
            <GatePicker gates={gates} chosen={gate} busy={busy} onPick={setGate} />
          )}

          <button className="primary" onClick={topUp} disabled={busy || !gate || !!amountError}>
            {busy
              ? 'Yükleniyor…'
              : open
                ? `Bakiye ekle — ${gateLabelOf(gates, open.gate)}`
                : gate ? `Yükle — ${gateLabelOf(gates, gate)}` : 'Kapı seç'}
          </button>
          {open && (
            <button className="link-btn danger" onClick={release} disabled={busy}>
              Bileti kapat, kalan bakiyeyi cüzdana geri al
            </button>
          )}
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
            <dt>Yatırılan</dt><dd>{Number(ticket.depositTry).toLocaleString('tr-TR')} TL</dd>
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

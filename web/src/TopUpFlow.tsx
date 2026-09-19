import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONFIG, expertAccount, expertTx, formatRate, formatTry, gateLabel } from './config.ts';
import {
  accountOf, contractErrorMessage, listGates, refund,
  type ChainAccount, type GateInfo,
} from './lib/contract.ts';
import { INITIAL_STEPS, runTopUp, type Step, type StepId, type StepState, type Ticket } from './lib/flow.ts';
import {
  connectWallet, createWristband, savedWristbandAddress, type Signer,
} from './lib/signer.ts';

const MARKS: Record<StepState, string> = { bekliyor: '○', calisiyor: '◐', tamam: '✓', hata: '✕' };
const short = (s: string, h = 6, t = 4) => (s.length > h + t + 2 ? `${s.slice(0, h)}…${s.slice(-t)}` : s);

/**
 * Biletin okunabilir kimligi: `ent_hash`'in ilk 10 hane hex'i, dorderli
 * gruplanmis. Her bilet icin farklidir — kullanici, cuzdan, kapi, tutar ve
 * sure bu ozetin icinde.
 *
 * Bunu gostermemizin sebebi: paketin kendisi base64 ve ilk 63 karakteri her
 * kullanicida AYNI (`{"v":1,"event":"FEST26","gate":"M307","user":"` kismi).
 * Ekranda bakan "herkese ayni sifre veriliyor" saniyordu.
 */
const ticketCode = (entHash: string) =>
  entHash.slice(0, 10).toUpperCase().replace(/(.{4})(.{4})(.{2})/, '$1-$2-$3');

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
  // Fiyatlandirma banknot mantigi: bir gecis = bir banknot = bir gecis ucreti.
  // Kullanici kac gecis istedigini secer, tutar carpimla cikar.
  const [passes, setPasses] = useState(CONFIG.defaultPasses);
  const [open, setOpen] = useState<ChainAccount | null>(null);
  const saved = useMemo(() => savedWristbandAddress(), []);

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

  const fareTry = CONFIG.fareTryKurus / 100;                 // bir geçişin TL fiyatı
  const amountTry = passes * fareTry;                        // toplam, tam sayı
  const maxPasses = Math.floor(CONFIG.maxDepositTry / fareTry);
  const minPasses = Math.max(1, Math.ceil(CONFIG.minDepositTry / fareTry));

  const emit = useCallback((id: StepId, state: StepState, detail?: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, state, detail: detail ?? s.detail } : s)));
  }, []);

  const connect = async (mode: 'wallet' | 'wristband', forceNew = false) => {
    setError(null);
    setBusy(true);
    try {
      const s = mode === 'wallet'
        ? await connectWallet()
        : await createWristband(undefined, forceNew);
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
      const t = await runTopUp(signer, gate, passes, emit);
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
          {saved ? (
            <div className="saved-band">
              <span className="saved-band-lead">
                Bu tarayıcıda kayıtlı bir bileklik var:
              </span>
              <span className="mono saved-band-addr">{short(saved, 8, 6)}</span>
              <div className="row">
                <button className="ghost" onClick={() => connect('wristband')} disabled={busy}>
                  Bu benim, devam et
                </button>
                <button className="ghost" onClick={() => connect('wristband', true)} disabled={busy}>
                  Ben başkasıyım
                </button>
              </div>
            </div>
          ) : (
            <button className="link-btn" onClick={() => connect('wristband')} disabled={busy}>
              Cüzdanım yok, etkinlik bilekliği ver
            </button>
          )}
        </>
      )}

      {signer && !ticket && (
        <>
          <div className="buy">
            <span className="buy-label">Kaç geçiş alacaksın?</span>
            <div className="buy-row">
              <button
                type="button"
                className="step"
                aria-label="Bir azalt"
                disabled={busy || passes <= minPasses}
                onClick={() => setPasses((n) => Math.max(minPasses, n - 1))}
              >
                −
              </button>
              <span className="buy-count">
                <b>{passes}</b>
                <small>geçiş</small>
              </span>
              <button
                type="button"
                className="step"
                aria-label="Bir artır"
                disabled={busy || passes >= maxPasses}
                onClick={() => setPasses((n) => Math.min(maxPasses, n + 1))}
              >
                +
              </button>
            </div>
            {/* Her gecis bir banknot — sayiyi gozle saymak icin. */}
            <div className="buy-notes" aria-hidden="true">
              {Array.from({ length: Math.min(passes, 12) }, (_, i) => (
                <span key={i} className="note" />
              ))}
              {passes > 12 && <span className="note-more">+{passes - 12}</span>}
            </div>
            <p className="buy-math">
              {passes} × {fareTry} TL = <b>{amountTry.toLocaleString('tr-TR')} TL</b>
            </p>
          </div>
          <dl className="kv tight">
            <dt>Geçiş ücreti</dt><dd>{formatTry(CONFIG.fareTryKurus)}</dd>
            <dt>Etkinlik</dt><dd>{CONFIG.eventId}</dd>
          </dl>

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

          <button className="primary" onClick={topUp} disabled={busy || !gate}>
            {busy
              ? 'Yükleniyor…'
              : open
                ? `${amountTry.toLocaleString('tr-TR')} TL ekle`
                : gate
                  ? `${amountTry.toLocaleString('tr-TR')} TL öde — ${gateLabelOf(gates, gate)}`
                  : 'Kapı seç'}
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
          <div className="owner">
            <span className="owner-lead">Bilet kodu</span>
            <span className="mono ticket-code">{ticketCode(ticket.bundle.ent_hash)}</span>
            <span className="owner-note">
              Her bilete özel. Cüzdan, kapı, tutar ve süre bu özetin içinde.
            </span>
            <span className="owner-sep" />
            <span className="owner-lead">Sahibi</span>
            <a
              className="mono owner-addr"
              href={expertAccount(ticket.bundle.user)}
              target="_blank"
              rel="noreferrer"
            >
              {short(ticket.bundle.user, 10, 8)} ↗
            </a>
            <span className="owner-lead">İmza anahtarın</span>
            <span className="mono owner-addr dim">
              {short(ticket.bundle.device_pk, 8, 6)}
            </span>
            <span className="owner-note">
              Kapı her geçişte fişin imzasını <b>bu anahtarla</b> doğruluyor —
              başkasının anahtarıyla imzalanmış fiş kabul edilmiyor.
            </span>
          </div>
          <dl className="kv tight">
            <dt>Geçiş ücreti</dt><dd>{formatTry(ticket.bundle.fare_try)}</dd>
            <dt>Kilitli kur</dt><dd>1 USDC = {formatRate(ticket.bundle.rate)} ₺</dd>
            <dt>Ödenen</dt>
            <dd>
              {ticket.bundle.max_uses} × {formatTry(ticket.bundle.fare_try)} ={' '}
              {Number(ticket.depositTry).toLocaleString('tr-TR')} TL
            </dd>
            {ticket.bankReference && (<><dt>Banka referansı</dt><dd className="mono">{ticket.bankReference}</dd></>)}
          </dl>
          <button className="primary" onClick={copy}>
            {copied ? 'Kopyalandı ✓' : 'Kapıya git — bileti kopyala'}
          </button>
          <p className="flow-note">
            Fişler <b>şimdiden imzalandı</b>. Kapıda internet gerekmez.
            Bu metin <b>hamiline</b> geçerlidir — kopyalayan da kullanabilir,
            etkinlik bilekliği gibi düşün.
          </p>
          <details className="bundle-box">
            <summary>Ham paket ({ticket.bundleText.length} karakter)</summary>
            <textarea
              className="bundle"
              readOnly
              value={ticket.bundleText}
              onFocus={(e) => e.currentTarget.select()}
            />
          </details>
          <div className="flow-links">
            <a href={expertTx(ticket.lockHash)} target="_blank" rel="noreferrer">Kilitleme işlemi ↗</a>
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

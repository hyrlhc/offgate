import { useCallback, useEffect, useMemo, useState } from 'react';
import { CONFIG, expertAccount, expertTx, formatRate, formatTry, gateLabel } from './config.ts';
import { t, useLang } from './lib/i18n.ts';
import {
  accountOf, contractErrorMessage, grossWithFee, listGates, REBATE_PCT, refund,
  type ChainAccount, type GateInfo,
} from './lib/contract.ts';
import { initialSteps, runTopUp, type Step, type StepId, type StepState, type Ticket } from './lib/flow.ts';
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
  const [steps, setSteps] = useState<Step[]>(initialSteps);
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
  useLang();

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
  const passesTry = passes * fareTry;                        // banknotların toplamı
  // Üstüne %5 teminat. Kaybolmuyor: kapı verisini zincire taşıyınca %80'i
  // cüzdana geri dönüyor (#tasi ekranı), yani taşıyan için net maliyet %1.
  const totalKurus = Number(grossWithFee(BigInt(passes * CONFIG.fareTryKurus)));
  const feeTry = totalKurus / 100 - passesTry;
  const amountTry = totalKurus / 100;
  const backTry = (feeTry * Number(REBATE_PCT)) / 100;
  const maxPasses = Math.floor(CONFIG.maxDepositTry / (fareTry * 1.05));
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
    setSteps(initialSteps());
    try {
      const issued = await runTopUp(signer, gate, passes, emit);
      setTicket(issued);
      onTicket?.(issued);
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
      setSteps(initialSteps());
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
      setError(t('ticket.clipboardFail'));
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
              {busy ? t('flow.waiting') : t('flow.closeTicket')}
            </button>
          )}
        </div>
      )}

      {!signer && (
        <>
          <p className="flow-lead">{t('flow.intro')}</p>
          <button className="primary" onClick={() => connect('wallet')} disabled={busy}>
            {busy ? t('flow.waiting') : t('flow.connect')}
          </button>
          <p className="flow-note">{t('flow.connectNote')}</p>
          {saved ? (
            <div className="saved-band">
              <span className="saved-band-lead">{t('flow.savedBand')}</span>
              <span className="mono saved-band-addr">{short(saved, 8, 6)}</span>
              <div className="row">
                <button className="ghost" onClick={() => connect('wristband')} disabled={busy}>
                  {t('flow.thisIsMe')}
                </button>
                <button className="ghost" onClick={() => connect('wristband', true)} disabled={busy}>
                  {t('flow.notMe')}
                </button>
              </div>
            </div>
          ) : (
            <button className="link-btn" onClick={() => connect('wristband')} disabled={busy}>
              {t('flow.wristband')}
            </button>
          )}
        </>
      )}

      {signer && !ticket && (
        <>
          <div className="buy">
            <span className="buy-label">{t('flow.howMany')}</span>
            <div className="buy-row">
              <button
                type="button"
                className="step"
                aria-label={t('flow.minus')}
                disabled={busy || passes <= minPasses}
                onClick={() => setPasses((n) => Math.max(minPasses, n - 1))}
              >
                −
              </button>
              <span className="buy-count">
                <b>{passes}</b>
                <small>{t('flow.passes')}</small>
              </span>
              <button
                type="button"
                className="step"
                aria-label={t('flow.plus')}
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
              {passes} × {formatTry(CONFIG.fareTryKurus)} ={' '}
              <b>{formatTry(passesTry * 100)}</b>
            </p>
            <p className="buy-fee">
              {t('flow.feeLine', {
                fee: formatTry(Math.round(feeTry * 100)),
                total: formatTry(Math.round(amountTry * 100)),
              })}
            </p>
          </div>
          <dl className="kv tight">
            <dt>{t('flow.fare')}</dt><dd>{formatTry(CONFIG.fareTryKurus)}</dd>
            <dt>{t('flow.feeLabel')}</dt>
            <dd>{t('flow.feeBack', { amount: formatTry(Math.round(backTry * 100)) })}</dd>
            <dt>{t('flow.event')}</dt><dd>{CONFIG.eventId}</dd>
          </dl>

          {open ? (
            <div className="open-note">
              <b>{t('flow.openTicket')}</b>{' '}
              {t('flow.openTicketBody', {
                gate: gateLabelOf(gates, open.gate),
                rate: formatRate(Number(open.rate)),
                granted: open.granted,
                used: open.used,
              })}
            </div>
          ) : (
            <GatePicker gates={gates} chosen={gate} busy={busy} onPick={setGate} />
          )}

          <button className="primary" onClick={topUp} disabled={busy || !gate}>
            {busy
              ? t('flow.loading')
              : open
                ? t('flow.addAmount', { amount: formatTry(Math.round(amountTry * 100)) })
                : gate
                  ? t('flow.pay', {
                      amount: formatTry(Math.round(amountTry * 100)),
                      gate: gateLabelOf(gates, gate),
                    })
                  : t('flow.pickGate')}
          </button>
          {open && (
            <button className="link-btn danger" onClick={release} disabled={busy}>
              {t('flow.closeTicket')}
            </button>
          )}
          {started && <StepList steps={steps} />}
        </>
      )}

      {ticket && (
        <>
          <div className="ticket-head">
            <div className="big-n">{ticket.bundle.max_uses}</div>
            <div className="big-l">{t('ticket.passes')}</div>
            <div className="gate-chip">
              {gateLabelOf(gates, ticket.bundle.gate)}
              <span className="gate-hw mono">{ticket.bundle.gate}</span>
            </div>
          </div>
          <div className="owner">
            <span className="owner-lead">{t('ticket.code')}</span>
            <span className="mono ticket-code">{ticketCode(ticket.bundle.ent_hash)}</span>
            <span className="owner-note">{t('ticket.codeNote')}</span>
            <span className="owner-sep" />
            <span className="owner-lead">{t('ticket.owner')}</span>
            <a
              className="mono owner-addr"
              href={expertAccount(ticket.bundle.user)}
              target="_blank"
              rel="noreferrer"
            >
              {short(ticket.bundle.user, 10, 8)} ↗
            </a>
            <span className="owner-lead">{t('ticket.deviceKey')}</span>
            <span className="mono owner-addr dim">
              {short(ticket.bundle.device_pk, 8, 6)}
            </span>
            <span className="owner-note">{t('ticket.deviceNote')}</span>
          </div>
          <dl className="kv tight">
            <dt>{t('flow.fare')}</dt><dd>{formatTry(ticket.bundle.fare_try)}</dd>
            <dt>{t('ticket.rate')}</dt><dd>1 USDC = {formatRate(ticket.bundle.rate)} ₺</dd>
            <dt>{t('ticket.paid')}</dt>
            <dd>{formatTry(Math.round(Number(ticket.depositTry) * 100))}</dd>
            {ticket.bankReference && (<><dt>{t('ticket.bankRef')}</dt><dd className="mono">{ticket.bankReference}</dd></>)}
          </dl>
          <button className="primary" onClick={copy}>
            {copied ? t('ticket.copied') : t('ticket.copy')}
          </button>
          <p className="flow-note">{t('ticket.note')}</p>
          <details className="bundle-box">
            <summary>{t('ticket.raw', { n: ticket.bundleText.length })}</summary>
            <textarea
              className="bundle"
              readOnly
              value={ticket.bundleText}
              onFocus={(e) => e.currentTarget.select()}
            />
          </details>
          <div className="flow-links">
            <a href={expertTx(ticket.lockHash)} target="_blank" rel="noreferrer">{t('ticket.lockTx')}</a>
            <a href="#tasi">{t('ticket.carryCta')}</a>
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
  if (!gates) return <p className="flow-note">{t('flow.gatesLoading')}</p>;
  if (gates.length === 0) return <p className="flow-note">{t('flow.noGates')}</p>;

  const min = Math.min(...gates.map((g) => g.load));

  return (
    <div className="gate-pick">
      <p className="gate-pick-lead">{t('flow.whichGate')}</p>
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
                {blocked ? t('flow.full') : t('flow.openTickets', { n: g.load })}
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

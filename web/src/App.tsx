import { useCallback, useMemo, useState } from 'react';
import './App.css';
import { CONFIG, expertAccount, expertContract, expertTx, formatRate, formatTry } from './config.ts';
import { INITIAL_STEPS, runTopUp, type Step, type StepId, type StepState, type Ticket } from './lib/flow.ts';
import { connectWallet, createWristband, forgetWristband, hasWristband, type Signer } from './lib/signer.ts';

const MARKS: Record<StepState, string> = {
  bekliyor: '○', calisiyor: '◐', tamam: '✓', hata: '✕',
};

function short(s: string, head = 6, tail = 4) {
  return s.length > head + tail + 2 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export default function App() {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const started = useMemo(() => steps.some((s) => s.state !== 'bekliyor'), [steps]);

  const emit = useCallback((id: StepId, state: StepState, detail?: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, state, detail: detail ?? s.detail } : s)));
  }, []);

  const connect = async (mode: 'wallet' | 'wristband') => {
    setError(null);
    setConnecting(true);
    try {
      setSigner(mode === 'wallet' ? await connectWallet() : await createWristband());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const topUp = async () => {
    if (!signer) return;
    setError(null);
    setRunning(true);
    setSteps(INITIAL_STEPS);
    try {
      setTicket(await runTopUp(signer, emit));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const copyBundle = async () => {
    if (!ticket) return;
    try {
      await navigator.clipboard.writeText(ticket.bundleText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Pano izni yok — aşağıdaki kutudan elle seçip kopyalayın.');
    }
  };

  const reset = () => {
    forgetWristband();
    setSigner(null);
    setTicket(null);
    setSteps(INITIAL_STEPS);
    setError(null);
  };

  return (
    <div className="shell">
      <header className="brand">
        <h1>OffGate</h1>
        <span className="tag">testnet</span>
      </header>
      <p className="sub">İnternetsiz geçiş ve ödeme. Kripto görmeden, TL ile.</p>

      {error && <div className="err-box">{error}</div>}

      {/* 1 — Cüzdan */}
      <section className="card">
        <h2><span className="num">1</span>Cüzdan</h2>
        {signer ? (
          <>
            <dl className="kv">
              <dt>Bağlantı</dt><dd>{signer.label}</dd>
              <dt>Adres</dt>
              <dd className="mono">
                <a href={expertAccount(signer.address)} target="_blank" rel="noreferrer">
                  {short(signer.address, 8, 6)}
                </a>
              </dd>
            </dl>
            {!started && (
              <div className="row" style={{ marginTop: 12 }}>
                <button className="ghost" onClick={reset}>Bağlantıyı kes</button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="row">
              <button onClick={() => connect('wallet')} disabled={connecting}>
                Cüzdanımı bağla
              </button>
              <button onClick={() => connect('wristband')} disabled={connecting}>
                {hasWristband() ? 'Bilekliğime dön' : 'Bileklik oluştur'}
              </button>
            </div>
            <div className="note">
              <strong>Cüzdanım bağla</strong> — Freighter, Lobstr, Albedo ve diğerleri
              (Stellar Wallets Kit).<br />
              <strong>Bileklik</strong> — kripto cüzdanı olmayan ziyaretçi için, tarayıcıda
              oluşturulan oturum cüzdanı. Telefonda eklenti gerekmez. Zincire giden her şey
              yine gerçek.
            </div>
          </>
        )}
      </section>

      {/* 2 — Yükleme */}
      {signer && !ticket && (
        <section className="card">
          <h2><span className="num">2</span>Bakiye yükle</h2>
          <button className="primary" onClick={topUp} disabled={running}>
            {running ? 'Yükleniyor…' : `${Number(CONFIG.depositTry).toLocaleString('tr-TR')} TL Yükle`}
          </button>
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Geçiş ücreti</dt><dd>{formatTry(CONFIG.fareTryKurus)}</dd>
            <dt>Geçiş hakkı</dt><dd>{CONFIG.maxUses} adet</dd>
            <dt>Etkinlik</dt><dd>{CONFIG.eventId}</dd>
          </dl>
          {started && <StepList steps={steps} />}
        </section>
      )}

      {/* 3 — Bilet */}
      {ticket && (
        <>
          <section className="card">
            <h2><span className="num">3</span>Biletiniz hazır</h2>
            <div className="big">
              <div className="amount">{ticket.bundle.max_uses} geçiş</div>
              <div className="gate">
                Kapı {ticket.bundle.gate} · geçiş başı {formatTry(ticket.bundle.fare_try)}
              </div>
            </div>
            <button className="primary" onClick={copyBundle}>
              {copied ? 'Kopyalandı ✓' : 'Kapıya Git — Bileti Kopyala'}
            </button>
            <div className="note">
              Kapının wifi ağına bağlanın, açılan sayfaya bu bileti <strong>bir kez</strong>
              {' '}yapıştırın. Sonraki geçişler tek dokunuş. Paket <strong>hiçbir gizli
              anahtar içermez</strong>; fişler şimdiden imzalandı, kapıda internet gerekmez.
            </div>
            <textarea className="bundle" readOnly value={ticket.bundleText} onFocus={(e) => e.currentTarget.select()} />
          </section>

          <section className="card">
            <h2><span className="num">4</span>Zincirdeki kanıt</h2>
            <dl className="kv">
              <dt>Yatırılan</dt><dd>{Number(CONFIG.depositTry).toLocaleString('tr-TR')} TL</dd>
              <dt>Alınan</dt><dd>{ticket.usdcReceived} USDC</dd>
              <dt>Kilitli kur</dt><dd>1 USDC = {formatRate(ticket.bundle.rate)} TRY</dd>
              {ticket.bankReference && (<><dt>Banka referansı</dt><dd className="mono">{ticket.bankReference}</dd></>)}
              <dt>Anchor emri</dt><dd className="mono">{short(ticket.anchorTxId, 8, 4)}</dd>
            </dl>
            <div className="row" style={{ marginTop: 14 }}>
              <a href={expertTx(ticket.lockHash)} target="_blank" rel="noreferrer">
                <button className="ghost" style={{ width: '100%' }}>Kilitleme işlemi</button>
              </a>
              <a href={expertContract(CONFIG.contractId)} target="_blank" rel="noreferrer">
                <button className="ghost" style={{ width: '100%' }}>Sözleşme</button>
              </a>
            </div>
            <StepList steps={steps} />
          </section>
        </>
      )}

      <footer>
        <a href="#audit">Denetim ekranı</a> · Stellar Testnet · gerçek para hareketi yoktur<br />
        Sözleşme <span className="mono">{short(CONFIG.contractId, 6, 4)}</span> ·
        {' '}anchor <span className="mono">{CONFIG.anchorHomeDomain}</span>
      </footer>
    </div>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ul className="steps" style={{ marginTop: 16 }}>
      {steps.map((s) => (
        <li key={s.id} data-s={s.state}>
          <span className="mark">{MARKS[s.state]}</span>
          <span>
            <span className="lbl">{s.label}</span>
            {s.detail && s.state !== 'bekliyor' && <div className="det">{s.detail}</div>}
          </span>
          <span className="badge">{s.id === 'auth' ? 'SEP-10' : s.id === 'quote' ? 'SEP-38' : s.id === 'deposit' ? 'SEP-6' : ''}</span>
        </li>
      ))}
    </ul>
  );
}

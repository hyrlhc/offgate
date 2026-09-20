import Nav from './components/Nav.tsx';
import { CONFIG, expertContract } from './config.ts';
import { useLang, type Lang } from './lib/i18n.ts';

/**
 * Anlatim sekmesi. Demo sahnesi temiz kalsin diye butun metin burada.
 *
 * Metin yogun oldugu icin anahtar-anahtar sozluge dagitmiyoruz: iki dilin
 * icerigi asagida yan yana duruyor. Bir paragrafi degistirirken karsiligini
 * gormemek zor — ceviriler boyle birbirinden kopmuyor.
 */
type Content = {
  eyebrow: string; title: string; lede: React.ReactNode;
  stats: Array<[string, string]>;
  stepsKicker: string; stepsTitle: string;
  steps: Array<[string, string]>;
  whyKicker: string; whyTitle: string;
  why: Array<[string, React.ReactNode]>;
  stellarKicker: string; stellarTitle: string;
  stellar: Array<[string, React.ReactNode]>;
  contractLabel: string;
  fmtKicker: string; fmtTitle: string; fmtBody: React.ReactNode; fmtTotal: string;
  footNote: string; footDemo: string; footAudit: string; footSource: string;
};

const EN: Content = {
  eyebrow: 'Rise In × Stellar Pro Hackathon 2026 · Genesis',
  title: 'How it works',
  lede: (
    <>
      Access points at concerts, stadiums and transit depend on the internet. When the
      connection drops, queues build, cash booths open and revenue stops being auditable.
      OffGate <b>locks the balance on chain</b> and lets the gate <b>verify it offline</b>.
      Cost per gate: one ESP32.
    </>
  ),
  stats: [['0', 'internet at the gate'], ['98 ms', 'signature verification'], ['₺', 'the only unit the user sees']],
  stepsKicker: 'Four steps',
  stepsTitle: 'The flow',
  steps: [
    ['Online: the balance is locked',
     'The user deposits lira. It is converted to USDC through the anchor and locked into the contract. The same transaction records where (which gate), how much (the fare) and at what rate it will be spent.'],
    ['The ticket lands on the phone',
     'The contract assigns the gate and the operator signs the ticket. Every pass receipt is signed while still online — like traveller’s cheques. No secret key travels on the phone.'],
    ['Offline: the gate verifies',
     'The gate checks two signatures: the ticket against the operator’s public key, the receipt against the device key. The same receipt is never accepted twice. The decision does not change even if the internet stays down for ten days.'],
    ['Settlement and audit',
     'Receipts are written on chain, the revenue moves to the operator and is withdrawn as lira. The gate’s declaration sits next to the on-chain record, so the operator cannot under-report.'],
  ],
  whyKicker: 'The first question a judge asks',
  whyTitle: 'Why a chain is genuinely needed',
  why: [
    ['A central server cannot do this',
     'With no internet nobody can reach the server, and nobody can prove the balance is really locked. Here the lock is publicly visible and the gate verifies it offline.'],
    ['Trust rests on signatures, not a server',
     'There is no secret key inside the gate — only the operator’s public key is embedded. Even if the device is opened and read, no forged ticket can be produced.'],
    ['Revenue cannot be hidden',
     'The gate counter and the receipts on chain are two independent sources. The operator cannot shrink only one; the gap shows up on the audit screen.'],
  ],
  stellarKicker: 'What, where',
  stellarTitle: 'Stellar integration',
  stellar: [
    ['Anchor — SEP-1/10/38/6',
     <>No endpoint is hardcoded; everything is discovered through <code>stellar.toml</code>.
       SEP-38 locks the rate, SEP-6 <code>deposit-exchange</code> takes the lira deposit, and
       revenue leaves as lira through <code>withdraw</code>.</>],
    ['Stellar Wallets Kit',
     <>The wallet-connection integration partner: Freighter, Lobstr, Albedo, Rabet, Hana.
       The user signs exactly once; the wallet never appears at the gate.</>],
    ['Soroban contract',
     <><code>lock_float</code>, <code>settle</code>, <code>refund</code> and the audit reads.
       <code> require_auth</code> on every function that moves money, <code>extend_ttl</code> on
       every persistent write. 46 unit tests.</>],
  ],
  contractLabel: 'Contract',
  fmtKicker: 'Design decision',
  fmtTitle: 'The transport layer is replaceable',
  fmtBody: (
    <>
      Verification runs on a <b>fixed 67-byte</b> canonical message defined independently of
      transport. The gate does not know where the bytes came from: today they arrive over local
      wifi as HTTP; the same bytes could be carried by QR, BLE or NFC without any change. The
      contract (Rust), the browser (JavaScript) and the gate (C++) all produce the same bytes,
      and a test vector enforces that at build time.
    </>
  ),
  fmtTotal: '67 bytes',
  footNote: '· Stellar Testnet · no real money moves',
  footDemo: 'Demo', footAudit: 'Audit', footSource: 'Source code ↗',
};

const TR: Content = {
  eyebrow: 'Rise In × Stellar Pro Hackathon 2026 · Genesis',
  title: 'Nasıl çalışır',
  lede: (
    <>
      Konser, maç ve toplu taşımada geçiş noktaları internete bağımlı. Bağlantı düşünce
      kuyruk oluşur, nakit gişe açılır, hasılat denetlenemez. OffGate bakiyeyi
      <b> zincirde kilitler</b>, kapı onu <b>çevrimdışı doğrular</b>. Kapı başına
      maliyet: bir ESP32.
    </>
  ),
  stats: [['0', 'kapıda internet'], ['98 ms', 'imza doğrulama'], ['₺', 'kullanıcının gördüğü tek birim']],
  stepsKicker: 'Dört adım',
  stepsTitle: 'Akış',
  steps: [
    ['Çevrimiçi: bakiye kilitlenir',
     'Kullanıcı TL yatırır. Anchor üzerinden USDC’ye çevrilir ve sözleşmeye kilitlenir. Aynı işlemde nerede (hangi kapı), ne kadar (geçiş ücreti) ve hangi kurdan harcanacağı zincire yazılır.'],
    ['Bilet telefona iner',
     'Sözleşme kapıyı atar, operatör bileti imzalar. Tüm geçiş fişleri daha çevrimiçiyken imzalanır — seyahat çeki gibi. Telefonda gizli anahtar taşınmaz.'],
    ['Çevrimdışı: kapı doğrular',
     'Kapı iki imzayı kontrol eder: bileti operatörün açık anahtarıyla, fişi cihaz anahtarıyla. Aynı fiş ikinci kez kabul edilmez. İnternet on gün gelmese de karar değişmez.'],
    ['Senkronizasyon ve denetim',
     'Fişler zincire yazılır, hasılat operatöre geçer ve TL olarak çekilir. Kapının beyanı ile zincirdeki kayıt yan yana durur; operatör eksik beyan edemez.'],
  ],
  whyKicker: 'Jürinin ilk sorusu',
  whyTitle: 'Neden zincir gerçekten gerekli',
  why: [
    ['Merkezî sunucu bu işi yapamaz',
     'İnternet yokken kimse sunucuya erişemez ve bakiyenin gerçekten kilitli olduğunu kimse doğrulayamaz. Burada kilit herkesçe görülebilir, kapı bunu çevrimdışı doğrular.'],
    ['Güven sunucuya değil imzaya dayanır',
     'Kapının içinde gizli anahtar yoktur — yalnızca operatörün açık anahtarı gömülüdür. Cihaz sökülüp okunsa bile sahte bilet üretilemez.'],
    ['Hasılat gizlenemez',
     'Kapı sayacı ve zincire düşen fişler bağımsız iki kaynaktır. Operatör yalnızca birini eksiltemez; fark denetim ekranında görünür.'],
  ],
  stellarKicker: 'Ne, nerede',
  stellarTitle: 'Stellar entegrasyonu',
  stellar: [
    ['Anchor — SEP-1/10/38/6',
     <>Hiçbir uç kodda sabit değil; hepsi <code>stellar.toml</code> üzerinden keşfediliyor.
       SEP-38 ile kur kilitleniyor, SEP-6 <code>deposit-exchange</code> ile TL yatırılıyor,
       hasılat <code>withdraw</code> ile TL’ye çıkıyor.</>],
    ['Stellar Wallets Kit',
     <>Cüzdan bağlama entegrasyon ortağı. Freighter, Lobstr, Albedo, Rabet, Hana.
       Kullanıcı tek bir kez imza atar; kapıda cüzdan devreye girmez.</>],
    ['Soroban sözleşmesi',
     <><code>lock_float</code>, <code>settle</code>, <code>refund</code> ve denetim okumaları.
       Para hareketi olan her fonksiyonda <code>require_auth</code>, her kalıcı yazımda
       <code> extend_ttl</code>. 46 birim testi.</>],
  ],
  contractLabel: 'Sözleşme',
  fmtKicker: 'Tasarım kararı',
  fmtTitle: 'Taşıma katmanı değiştirilebilir',
  fmtBody: (
    <>
      Doğrulama, taşıma biçiminden bağımsız tanımlanmış <b>sabit 67 baytlık</b> kanonik mesaj
      üzerinde çalışır. Kapı, baytların nereden geldiğini bilmez: bugün yerel wifi üzerinden
      HTTP ile geliyor; aynı baytlar değişiklik gerektirmeden QR, BLE veya NFC üzerinden de
      taşınabilir. Sözleşme (Rust), tarayıcı (JavaScript) ve kapı (C++) aynı baytı üretir;
      bu, derleme zamanında bir test vektörüyle zorlanır.
    </>
  ),
  fmtTotal: '67 bayt',
  footNote: '· Stellar Testnet · gerçek para hareketi yoktur',
  footDemo: 'Demo', footAudit: 'Denetim', footSource: 'Kaynak kod ↗',
};

const CONTENT: Record<Lang, Content> = { en: EN, tr: TR };

export default function How() {
  const c = CONTENT[useLang()];

  return (
    <div className="page">
      <Nav active="nasil" />

      <header className="doc-head">
        <span className="eyebrow">{c.eyebrow}</span>
        <h1>{c.title}</h1>
        <p className="lede">{c.lede}</p>
        <div className="hero-stats">
          {c.stats.map(([n, l]) => (
            <div className="stat" key={l}>
              <span className="sn">{n}</span><span className="sl">{l}</span>
            </div>
          ))}
        </div>
      </header>

      <Section id="adimlar" kicker={c.stepsKicker} title={c.stepsTitle}>
        <ol className="flowsteps">
          {c.steps.map(([title, body], i) => (
            <li key={title}>
              <span className="fn">{i + 1}</span>
              <div><h4>{title}</h4><p>{body}</p></div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="neden" kicker={c.whyKicker} title={c.whyTitle}>
        <div className="cols">
          {c.why.map(([title, body]) => (
            <div className="c-card" key={title}><h4>{title}</h4><p>{body}</p></div>
          ))}
        </div>
      </Section>

      <Section id="stellar" kicker={c.stellarKicker} title={c.stellarTitle}>
        <div className="cols">
          {c.stellar.map(([title, body]) => (
            <div className="c-card" key={title}><h4>{title}</h4><p>{body}</p></div>
          ))}
        </div>
        <div className="proof">
          <span className="proof-l">{c.contractLabel}</span>
          <a className="mono" href={expertContract(CONFIG.contractId)} target="_blank" rel="noreferrer">
            {CONFIG.contractId} ↗
          </a>
        </div>
      </Section>

      <Section id="format" kicker={c.fmtKicker} title={c.fmtTitle}>
        <p className="prose">{c.fmtBody}</p>
        <div className="bytes">
          <span>"OFFGATE-RCPT-v1"</span><i>15</i>
          <span>ent_hash</span><i>32</i>
          <span>seq</span><i>4</i>
          <span>fare_try</span><i>8</i>
          <span>ts</span><i>8</i>
          <em>{c.fmtTotal}</em>
        </div>
      </Section>

      <footer className="foot">
        <div><b>OffGate</b> {c.footNote}</div>
        <div className="foot-links">
          <a href="#">{c.footDemo}</a>
          <a href="#audit">{c.footAudit}</a>
          <a href="https://github.com/hyrlhc/offgate" target="_blank" rel="noreferrer">{c.footSource}</a>
        </div>
      </footer>
    </div>
  );
}

function Section({ id, title, kicker, children }:
  { id: string; title: string; kicker: string; children: React.ReactNode }) {
  return (
    <section className="sec" id={id}>
      <div className="sec-head"><span className="kicker">{kicker}</span><h2>{title}</h2></div>
      {children}
    </section>
  );
}

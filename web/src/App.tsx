import { useState } from 'react';
import './App.css';
import GateChain from './components/GateChain.tsx';
import PhoneFrame from './components/PhoneFrame.tsx';
import TopUpFlow from './TopUpFlow.tsx';
import { CONFIG, expertContract } from './config.ts';
import type { Ticket } from './lib/flow.ts';

export default function App() {
  const [ticket, setTicket] = useState<Ticket | null>(null);

  return (
    <div className="page">
      <Nav />

      <header className="hero">
        <span className="eyebrow">Rise In × Stellar Pro Hackathon 2026 · Genesis</span>
        <h1>
          İnternet yokken de<br />geçiş devam eder.
        </h1>
        <p className="lede">
          Konser, maç ve toplu taşımada geçiş noktaları internete bağımlı. Bağlantı düşünce
          kuyruk oluşur, nakit gişe açılır, hasılat denetlenemez. OffGate bakiyeyi
          <b> zincirde kilitler</b>, kapı onu <b>çevrimdışı doğrular</b>. Kapı başına maliyet:
          bir ESP32.
        </p>
        <div className="hero-stats">
          <Stat n="0" l="kapıda internet" />
          <Stat n="97 ms" l="imza doğrulama" />
          <Stat n="₺" l="kullanıcının gördüğü tek birim" />
        </div>
      </header>

      <section className="stage" id="demo">
        <div className="stage-left">
          <GateChain />
          <div className="stage-copy">
            <h3>Kapılar birbirinden habersiz çalışır</h3>
            <p>
              Her kapı kendi wifi ağını kurar ve fişleri yerel olarak doğrular. Görevli
              internete bağlandığında fişler zincire yazılır — her senkronizasyon zincire
              bir halka ekler. Kullanıcı tek kapıya bağlı olduğu için çifte harcama
              baştan imkânsızdır: harcandığı yer ile hatırlayan yer aynı cihazdır.
            </p>
          </div>
        </div>

        <div className="stage-right">
          <PhoneFrame caption="Demo masaüstünden, cüzdan eklentisiyle sürülüyor. İçindeki her şey gerçek: butonlar çalışır, zincire gerçek işlem gider.">
            <TopUpFlow onTicket={setTicket} />
          </PhoneFrame>
        </div>
      </section>

      <Section id="nasil" title="Nasıl çalışır" kicker="Dört adım">
        <ol className="flowsteps">
          <Flow n="1" t="Çevrimiçi: bakiye kilitlenir"
            d="Kullanıcı TL yatırır. Anchor üzerinden USDC'ye çevrilir ve sözleşmeye kilitlenir. Aynı işlemde nerede (hangi kapı), ne kadar (geçiş ücreti) ve hangi kurdan harcanacağı zincire yazılır." />
          <Flow n="2" t="Bilet telefona iner"
            d="Sözleşme kapıyı atar, operatör bileti imzalar. Tüm geçiş fişleri daha çevrimiçiyken imzalanır — seyahat çeki gibi. Telefonda gizli anahtar taşınmaz." />
          <Flow n="3" t="Çevrimdışı: kapı doğrular"
            d="Kapı iki imzayı kontrol eder: bileti operatörün açık anahtarıyla, fişi cihaz anahtarıyla. Aynı fiş ikinci kez kabul edilmez. İnternet on gün gelmese de karar değişmez." />
          <Flow n="4" t="Senkronizasyon ve denetim"
            d="Görevli fişleri zincire yazar, hasılat operatöre geçer ve TL olarak çekilir. Kapının beyanı ile zincirdeki kayıt yan yana durur; operatör eksik beyan edemez." />
        </ol>
      </Section>

      <Section id="neden" title="Neden zincir gerçekten gerekli" kicker="Jürinin ilk sorusu">
        <div className="cols">
          <Card t="Merkezî sunucu bu işi yapamaz">
            İnternet yokken kimse sunucuya erişemez ve bakiyenin gerçekten kilitli olduğunu
            kimse doğrulayamaz. Burada kilit herkesçe görülebilir, kapı bunu çevrimdışı
            doğrular.
          </Card>
          <Card t="Güven sunucuya değil imzaya dayanır">
            Kapının içinde gizli anahtar yoktur — yalnızca operatörün açık anahtarı gömülüdür.
            Cihaz sökülüp okunsa bile sahte bilet üretilemez.
          </Card>
          <Card t="Hasılat gizlenemez">
            Kapı sayacı ve zincire düşen fişler bağımsız iki kaynaktır. Operatör yalnızca
            birini eksiltemez; fark denetim ekranında görünür.
          </Card>
        </div>
      </Section>

      <Section id="stellar" title="Stellar entegrasyonu" kicker="Ne, nerede">
        <div className="cols">
          <Card t="Anchor — SEP-1/10/38/6">
            Hiçbir uç kodda sabit değil; hepsi <code>stellar.toml</code> üzerinden keşfediliyor.
            SEP-38 ile kur kilitleniyor, SEP-6 <code>deposit-exchange</code> ile TL yatırılıyor,
            hasılat <code>withdraw</code> ile TL'ye çıkıyor.
          </Card>
          <Card t="Stellar Wallets Kit">
            Cüzdan bağlama entegrasyon ortağı. Freighter, Lobstr, Albedo, Rabet, Hana.
            Kullanıcı tek bir kez imza atar; kapıda cüzdan devreye girmez.
          </Card>
          <Card t="Soroban sözleşmesi">
            <code>lock_float</code>, <code>settle</code>, <code>refund</code>, denetim okumaları.
            Para hareketi olan her fonksiyonda <code>require_auth</code>, her kalıcı yazımda
            <code> extend_ttl</code>. 27 birim testi.
          </Card>
        </div>
        <div className="proof">
          <span className="proof-l">Sözleşme</span>
          <a className="mono" href={expertContract(CONFIG.contractId)} target="_blank" rel="noreferrer">
            {CONFIG.contractId} ↗
          </a>
        </div>
      </Section>

      <Section id="format" title="Taşıma katmanı değiştirilebilir" kicker="Tasarım kararı">
        <p className="prose">
          Doğrulama, taşıma biçiminden bağımsız tanımlanmış <b>sabit 67 baytlık</b> kanonik
          mesaj üzerinde çalışır. Kapı, baytların nereden geldiğini bilmez: bugün yerel wifi
          üzerinden HTTP ile geliyor; aynı baytlar değişiklik gerektirmeden QR, BLE veya NFC
          üzerinden de taşınabilir. Sözleşme (Rust), tarayıcı (JavaScript) ve kapı (C++)
          aynı baytı üretir; bu, derleme zamanında bir test vektörüyle zorlanır.
        </p>
        <div className="bytes">
          <span>"OFFGATE-RCPT-v1"</span><i>15</i>
          <span>ent_hash</span><i>32</i>
          <span>seq</span><i>4</i>
          <span>fare_try</span><i>8</i>
          <span>ts</span><i>8</i>
          <em>67 bayt</em>
        </div>
      </Section>

      <footer className="foot">
        <div>
          <b>OffGate</b> · Stellar Testnet · gerçek para hareketi yoktur
          {ticket && <> · son bilet: kapı {ticket.bundle.gate}</>}
        </div>
        <div className="foot-links">
          <a href="#audit">Denetim ekranı</a>
          <a href="https://github.com/hyrlhc/offgate" target="_blank" rel="noreferrer">Kaynak kod ↗</a>
        </div>
      </footer>
    </div>
  );
}

function Nav() {
  return (
    <nav className="nav">
      <a className="nav-brand" href="#top">
        <span className="dot" />OffGate
      </a>
      <div className="nav-links">
        <a href="#demo">Demo</a>
        <a href="#nasil">Nasıl çalışır</a>
        <a href="#stellar">Stellar</a>
        <a href="#audit">Denetim</a>
      </div>
      <span className="nav-tag">testnet</span>
    </nav>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return <div className="stat"><span className="sn">{n}</span><span className="sl">{l}</span></div>;
}

function Section({ id, title, kicker, children }:
  { id: string; title: string; kicker: string; children: React.ReactNode }) {
  return (
    <section className="sec" id={id}>
      <div className="sec-head">
        <span className="kicker">{kicker}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Card({ t, children }: { t: string; children: React.ReactNode }) {
  return <div className="c-card"><h4>{t}</h4><p>{children}</p></div>;
}

function Flow({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <li>
      <span className="fn">{n}</span>
      <div><h4>{t}</h4><p>{d}</p></div>
    </li>
  );
}

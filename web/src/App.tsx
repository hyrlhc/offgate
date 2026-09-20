import { useState } from 'react';
import './App.css';
import GateChain from './components/GateChain.tsx';
import PhoneFrame from './components/PhoneFrame.tsx';
import TopUpFlow from './TopUpFlow.tsx';
import Nav from './components/Nav.tsx';
import { t, useLang } from './lib/i18n.ts';
import type { Ticket } from './lib/flow.ts';

/**
 * Acilis: sadece demo.
 *
 * Anlatim "#nasil" sekmesinde. Burada yalnizca sahne var — solda kapilar ve
 * zincir, sagda gercek calisan uygulama. Dalgalar sayfanin zemini uzerinde,
 * telefonun arkasindan gecip soner.
 */
export default function App() {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  useLang();

  return (
    <div className="page demo-page">
      <Nav active="demo" />

      <main className="stage">
        <GateChain />

        <div className="stage-title">
          <h1>{t('stage.title')}</h1>
          <p>{t('stage.sub')}</p>
          <a className="more" href="#nasil">{t('stage.more')}</a>
        </div>

        <div className="stage-phone">
          <PhoneFrame>
            <TopUpFlow onTicket={setTicket} />
          </PhoneFrame>
        </div>
      </main>

      <p className="stage-foot">
        {t('stage.foot')}
        {ticket && <> · {t('stage.lastTicket', { gate: ticket.bundle.gate })}</>}
      </p>
    </div>
  );
}

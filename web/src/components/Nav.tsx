import { t, useLang } from '../lib/i18n.ts';
import LangToggle from './LangToggle.tsx';
import ProfileToggle from './ProfileToggle.tsx';

/** Dort sekme: demo, anlatim, veri tasima, denetim. */
export default function Nav({ active }: { active: 'demo' | 'nasil' | 'carry' | 'audit' }) {
  useLang(); // dil degisince yeniden cizilsin
  return (
    <nav className="nav">
      <a className="nav-brand" href="#"><span className="dot" />OffGate</a>
      <div className="nav-links">
        <a href="#" className={active === 'demo' ? 'on' : ''}>{t('nav.demo')}</a>
        <a href="#nasil" className={active === 'nasil' ? 'on' : ''}>{t('nav.how')}</a>
        <a href="#tasi" className={active === 'carry' ? 'on' : ''}>{t('nav.carry')}</a>
        <a href="#audit" className={active === 'audit' ? 'on' : ''}>{t('nav.audit')}</a>
      </div>
      <div className="nav-right">
        <LangToggle />
        <ProfileToggle />
        <span className="nav-tag">{t('nav.testnet')}</span>
      </div>
    </nav>
  );
}

import ProfileToggle from './ProfileToggle.tsx';

/** Dort sekme: demo, anlatim, veri tasima, denetim. */
export default function Nav({ active }: { active: 'demo' | 'nasil' | 'carry' | 'audit' }) {
  return (
    <nav className="nav">
      <a className="nav-brand" href="#"><span className="dot" />OffGate</a>
      <div className="nav-links">
        <a href="#" className={active === 'demo' ? 'on' : ''}>Demo</a>
        <a href="#nasil" className={active === 'nasil' ? 'on' : ''}>Nasıl çalışır</a>
        <a href="#tasi" className={active === 'carry' ? 'on' : ''}>Veriyi taşı</a>
        <a href="#audit" className={active === 'audit' ? 'on' : ''}>Denetim</a>
      </div>
      <div className="nav-right">
        <ProfileToggle />
        <span className="nav-tag">testnet</span>
      </div>
    </nav>
  );
}

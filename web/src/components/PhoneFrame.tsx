import type { ReactNode } from 'react';

/**
 * iPhone cercevesi.
 *
 * Demo masaustunden, cuzdan eklentisiyle surulur; cerceve kullanicinin
 * telefonda gorecegi arayuzu gosterir. Icindeki her sey gercek: butonlar
 * calisir, zincire gercek islem gider.
 */
export default function PhoneFrame({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="phone-wrap">
      <div className="phone">
        <div className="phone-side left" />
        <div className="phone-side right" />
        <div className="phone-screen">
          <div className="phone-island" />
          <div className="phone-status">
            <span>9:41</span>
            <span className="phone-status-right">
              <SignalOff />
              <Battery />
            </span>
          </div>
          <div className="phone-content">{children}</div>
          <div className="phone-home" />
        </div>
      </div>
      {caption && <p className="phone-caption">{caption}</p>}
    </div>
  );
}

/** Ucak modu: kapida internet yok. */
function SignalOff() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 4 20h16L12 3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Battery() {
  return (
    <svg width="22" height="12" viewBox="0 0 26 13" fill="none" aria-hidden="true">
      <rect x="0.6" y="0.6" width="21" height="11.8" rx="3" stroke="currentColor" strokeOpacity=".5" />
      <rect x="2.2" y="2.2" width="15" height="8.6" rx="1.8" fill="currentColor" />
      <path d="M23.4 4.4v4.2a2.2 2.2 0 0 0 0-4.2Z" fill="currentColor" fillOpacity=".5" />
    </svg>
  );
}

import { CONFIG, setProfile } from '../config.ts';
import { t, useLang } from '../lib/i18n.ts';

/**
 * Anchor / Yedek anahtari.
 *
 * `live`  gercek anchor (SEP-1/10/38/6) + gercek USDC. Varsayilan.
 * `local` yedek: anchor'in odeme isleyicisi coktugunde demoyu ayakta tutar.
 *         Kendi test varligimiz, ayri sozlesme. Gercek yolu etkilemez.
 *
 * Gorunur olmasi bilincli: yedek modda calisildigini kullanici da juri de
 * gormeli. Sahte bir seyi gercekmis gibi gostermiyoruz.
 */
export default function ProfileToggle() {
  useLang();
  const local = CONFIG.profile === 'local';
  return (
    <button
      type="button"
      className={`profile-toggle${local ? ' on' : ''}`}
      onClick={() => setProfile(local ? 'live' : 'local')}
      title={local ? t('profile.tipLocal') : t('profile.tipLive')}
    >
      <span className="profile-dot" />
      {local ? t('profile.local') : t('profile.live')}
    </button>
  );
}

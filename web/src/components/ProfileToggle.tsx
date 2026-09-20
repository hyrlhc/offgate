import { CONFIG, setProfile } from '../config.ts';

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
  const local = CONFIG.profile === 'local';
  return (
    <button
      type="button"
      className={`profile-toggle${local ? ' on' : ''}`}
      onClick={() => setProfile(local ? 'live' : 'local')}
      title={
        local
          ? 'Yedek mod: kendi test varlığımız, ayrı sözleşme. Gerçek anchor’a dönmek için tıkla.'
          : 'Gerçek anchor (SEP-1/10/38/6). Anchor ödeme yapmıyorsa yedeğe geç.'
      }
    >
      <span className="profile-dot" />
      {local ? 'Yedek' : 'Anchor'}
    </button>
  );
}

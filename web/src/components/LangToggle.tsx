import { setLang, useLang } from '../lib/i18n.ts';

/**
 * EN / TR anahtari. Varsayilan Ingilizce: juri ve ekosistem agirlikli
 * Ingilizce okuyor. Secim localStorage'da kaliyor.
 */
export default function LangToggle() {
  const lang = useLang();
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button
        type="button"
        className={lang === 'en' ? 'on' : ''}
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
      >
        EN
      </button>
      <button
        type="button"
        className={lang === 'tr' ? 'on' : ''}
        onClick={() => setLang('tr')}
        aria-pressed={lang === 'tr'}
      >
        TR
      </button>
    </div>
  );
}

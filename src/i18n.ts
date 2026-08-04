/**
 * i18next configuration, following the same shape as the other Sudobility
 * apps: an HTTP backend loading `public/locales/{{lng}}/{{ns}}.json`, plus a
 * language detector reading the URL path first and then localStorage.
 *
 * Every language lives in `public/locales/<code>/app.json` and is fetched at
 * runtime — none is compiled in. That is the sudojo_app pattern, and it is what
 * keeps adding a language a matter of dropping in a directory: no import to
 * add, no rebuild to ship it. It also sidesteps Vite's rule that files under
 * `public/` must not be imported, since a served-and-imported file is inlined
 * into the bundle *and* shipped again as a static asset.
 *
 * `i18next-http-backend` is not optional here even though only English ships
 * today: `@sudobility/building_blocks` imports it unconditionally at module
 * top level, despite declaring it an optional peer. Without it installed the
 * bundle simply fails to resolve — which is what broke `App.test`/
 * `router.test` in CI while passing locally, where the package happened to be
 * present in `node_modules`.
 *
 * Nothing is bundled, so jsdom tests have no server to fetch from. `src/test/
 * setup.ts` loads the English bundle off disk instead — see its comment. Doing
 * it there rather than here is the point: the app's own configuration stays
 * exactly what ships, instead of carrying a branch that only tests take.
 *
 * Initialization is a side effect of importing this module, which is what
 * `main.tsx` and `src/test/setup.ts` both rely on.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { CONSTANTS } from '@/config/constants';
import { SUPPORTED_LANGUAGES, isLanguageSupported } from '@/config/languages';

export { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, isLanguageSupported } from '@/config/languages';
export type { SupportedLanguage } from '@/config/languages';

/** URL path first (so `/fr/...` wins), then the saved preference, then English. */
function detectLanguageFromPath(): string {
  if (typeof window === 'undefined') return 'en';

  const pathLang = window.location.pathname.split('/')[1];
  if (pathLang && isLanguageSupported(pathLang)) return pathLang;

  try {
    const stored = localStorage.getItem('language');
    if (stored && isLanguageSupported(stored)) return stored;
  } catch {
    // localStorage throws in Safari private browsing.
  }

  return 'en';
}

void i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: detectLanguageFromPath(),
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    initImmediate: false,
    debug: false,

    ns: ['app'],
    defaultNS: 'app',

    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    detection: {
      order: ['path', 'localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'language',
      lookupFromPathIndex: 0,
    },

    load: 'currentOnly',
    cleanCode: false,
    lowerCaseLng: true,
    nonExplicitSupportedLngs: false,

    interpolation: {
      escapeValue: false,
      defaultVariables: { appName: CONSTANTS.APP_NAME },
    },
    react: { useSuspense: false },
  });

export default i18n;

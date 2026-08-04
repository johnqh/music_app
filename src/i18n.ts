/**
 * i18next configuration, following the same shape as the other Sudobility
 * apps: an HTTP backend loading `public/locales/{{lng}}/{{ns}}.json`, plus a
 * language detector reading the URL path first and then localStorage.
 *
 * The bundled language lives in `src/locales/`, NOT `public/locales/`, and the
 * split is deliberate. Vite copies `public/` verbatim and forbids importing
 * from it: a file that is both served and imported gets inlined into the
 * bundle *and* shipped again as a static asset, which is why importing one
 * warns. So the two roles get two homes — `src/locales/` for what is compiled
 * in, `public/locales/` for what is fetched at runtime.
 *
 * `i18next-http-backend` is not optional here even though only English ships
 * today: `@sudobility/building_blocks` imports it unconditionally at module
 * top level, despite declaring it an optional peer. Without it installed the
 * bundle simply fails to resolve — which is what broke `App.test`/
 * `router.test` in CI while passing locally, where the package happened to be
 * present in `node_modules`.
 *
 * English is *also* bundled statically, with `partialBundledLanguages` telling
 * i18next to use the backend only for what isn't bundled — so with English the
 * only supported language, the backend currently fetches nothing at all. That keeps the
 * default language available on first paint with no network round trip, and
 * keeps jsdom tests deterministic — they have no server to fetch from, and
 * several assert on real translated strings rather than key names.
 *
 * Initialization is a side effect of importing this module, which is what
 * `main.tsx` and `src/test/setup.ts` both rely on.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '@/locales/en/app.json';
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

    // Bundled English + backend for anything else.
    resources: { en: { app: en } },
    partialBundledLanguages: true,

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

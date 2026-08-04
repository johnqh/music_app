/**
 * Language configuration. `SUPPORTED_LANGUAGES` is the single source of truth
 * for which languages the app supports, and must stay in sync with the
 * translation files. `src/i18n.ts` reads it for `supportedLngs`.
 *
 * To add a language:
 * 1. Add its code here.
 * 2. Add its display name to `LANGUAGE_NAMES`.
 * 3. Create `public/locales/<code>/app.json`.
 *
 * Only `en` is bundled into the app, and it lives in `src/locales/en/app.json`
 * for that reason — Vite forbids importing out of `public/`, so the compiled-in
 * language and the fetched-at-runtime ones cannot share a directory (see
 * `i18n.ts`). Every other language is fetched at runtime, so adding one stays
 * purely additive.
 */
export const SUPPORTED_LANGUAGES = ['en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
};

export function isLanguageSupported(code: string): code is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

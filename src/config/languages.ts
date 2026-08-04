/**
 * Language configuration. `SUPPORTED_LANGUAGES` is the single source of truth
 * for which languages the app supports, and must stay in sync with the
 * translation directories under `public/locales/`. `src/i18n.ts` reads it for
 * `supportedLngs`.
 *
 * To add a language:
 * 1. Add its code here.
 * 2. Add its display name to `LANGUAGE_NAMES`.
 * 3. Create `public/locales/<code>/app.json`.
 *
 * No language is compiled into the bundle: every one is fetched at runtime from
 * `public/locales/`, so a new one ships without an import or a rebuild.
 * `languages.test.ts` checks each code here has a matching directory whose keys
 * match English, since the two going out of sync is silent — i18next falls back
 * to English for a missing key and shows the raw key for a missing file.
 */
export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  fr: 'Français',
};

export function isLanguageSupported(code: string): code is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

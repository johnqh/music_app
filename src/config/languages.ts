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
export const SUPPORTED_LANGUAGES = ['en', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  // Native name, as every other app in the family lists it: a reader looking
  // for their own language is not scanning for the English word for it.
  zh: '简体中文',
};

export function isLanguageSupported(code: string): code is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

/**
 * The shape the top bar's `LanguageSelector` wants — code, native name, flag.
 *
 * Derived from `SUPPORTED_LANGUAGES` rather than written out again, so a
 * language cannot end up offered in the picker without a bundle behind it. That
 * matters because the selector ships its own default list of 16 languages: hand
 * it that and it offers locales this app has no translations for, and every
 * string renders as its raw key.
 *
 * Flags are a rough convention, not a claim about nationhood — a language is
 * not a country, and several here are spoken in many.
 */
const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  en: '\u{1F1FA}\u{1F1F8}',
  zh: '\u{1F1E8}\u{1F1F3}',
};

export const LANGUAGE_OPTIONS: Array<{ code: string; name: string; flag: string }> =
  SUPPORTED_LANGUAGES.map((code) => ({
    code,
    name: LANGUAGE_NAMES[code],
    flag: LANGUAGE_FLAGS[code],
  }));

/*
 * The language to open when the URL does not name one is music_types'
 * `preferredLanguage`, called with `SUPPORTED_LANGUAGES` — see `router.tsx`.
 *
 * The *rule* used to live here and, separately, in music_app_rn, where it
 * compared whole tags rather than language subtags: a reader who had chosen
 * Chinese there and so had a stored `zh-Hans` was quietly given English. Which
 * languages a build ships is a fact about the build (the web fetches a
 * directory per language, the native app bundles a JSON) and stays here; how a
 * stored tag is matched against them is not, and is shared.
 */

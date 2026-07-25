/**
 * i18next configuration — English-only this phase, with the URL-language
 * scaffolding in place so more locales are additive later. The en bundle is
 * imported statically (no http backend needed for a single locale, and it
 * keeps jsdom tests deterministic).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../public/locales/en/app.json';

export const supportedLanguages = ['en'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const languageNames: Record<SupportedLanguage, string> = { en: 'English' };

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...supportedLanguages],
  ns: ['app'],
  defaultNS: 'app',
  resources: { en: { app: en } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;

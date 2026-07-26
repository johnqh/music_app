/**
 * Language-prefixed navigation helpers. English-only this phase, but every
 * route lives under `/:lang` so more locales are additive (APP.md pattern).
 */
import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supportedLanguages, type SupportedLanguage } from '@/i18n';

export function useCurrentLanguage(): SupportedLanguage {
  const { lang } = useParams<{ lang: string }>();
  return (supportedLanguages as readonly string[]).includes(lang ?? '')
    ? (lang as SupportedLanguage)
    : 'en';
}

/** Navigate to a language-relative path (e.g. `/projects`, `/project/abc`). */
export function useLocalizedNavigate(): (path: string) => void {
  const navigate = useNavigate();
  const lang = useCurrentLanguage();
  return useCallback(
    (path: string) => {
      navigate(`/${lang}${path.startsWith('/') ? path : `/${path}`}`);
    },
    [navigate, lang],
  );
}

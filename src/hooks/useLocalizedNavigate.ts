/**
 * Language-prefixed navigation helpers. Every route lives under `/:lang`, so
 * adding a locale is additive (APP.md pattern).
 */
import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import i18n from 'i18next';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';

export function useCurrentLanguage(): SupportedLanguage {
  const { lang } = useParams<{ lang: string }>();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang ?? '')
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

/**
 * Switches language *in place*: same page, same params, new locale.
 *
 * Rewrites only the leading path segment rather than navigating somewhere
 * known-good, so switching language while reading a project keeps you on that
 * project. Sending everyone home instead would be the easy version and would
 * lose their place every time.
 *
 * i18next is told separately because the URL is only one of the three inputs
 * its detector reads; `caches: ['localStorage']` then persists the choice, so
 * it survives a later visit to an unprefixed URL.
 */
export function useSwitchLanguage(): (next: SupportedLanguage) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const current = useCurrentLanguage();

  return useCallback(
    (next: SupportedLanguage) => {
      if (next === current) return;
      void i18n.changeLanguage(next);

      const segments = location.pathname.split('/');
      // segments[0] is the empty string before the leading slash; [1] is the
      // language. A path with no language segment at all gets one.
      if ((SUPPORTED_LANGUAGES as readonly string[]).includes(segments[1] ?? '')) {
        segments[1] = next;
      } else {
        segments.splice(1, 0, next);
      }
      navigate(`${segments.join('/')}${location.search}${location.hash}`, { replace: true });
    },
    [navigate, location, current],
  );
}

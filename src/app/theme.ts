/**
 * The colour scheme the app is drawn in, and how the browser is asked for it.
 *
 * The *rule* — `system` follows the device, `light`/`dark` override it — is
 * music_lib's `resolveThemeMode`, shared with the native app, which asks
 * its own device the same question. What stays here is the part only a browser
 * can do: the `prefers-color-scheme` media query, and applying the answer to
 * the document.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { resolveThemeMode } from '@sudobility/music_lib';
import type { ThemeMode } from '@sudobility/music_lib';

/** User-facing colour scheme preference: the store's `themeMode`. */
export type ColorSchemeMode = ThemeMode;

/** A concrete (non-`system`) color scheme, as applied to the document. */
export type ResolvedColorScheme = Exclude<ThemeMode, 'system'>;

const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

function prefersDarkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(PREFERS_DARK_QUERY);
}

/** Reads the OS/browser color-scheme preference. Defaults to light when unavailable (e.g. SSR/tests). */
export function getSystemColorScheme(): ResolvedColorScheme {
  return prefersDarkQuery()?.matches ? 'dark' : 'light';
}

/**
 * Resolves a user preference (which may defer to the system) into a concrete
 * `light`/`dark` scheme, **once**. Anything rendered from the answer should use
 * `useResolvedColorScheme` instead, or it will not follow the OS.
 */
export function resolveColorScheme(mode: ColorSchemeMode): ResolvedColorScheme {
  return resolveThemeMode(mode, getSystemColorScheme() === 'dark');
}

/**
 * The scheme to draw in, re-rendering when the OS flips while in `system` mode.
 *
 * The notation canvas and the piano keyboard paint literal colours from a
 * render theme — VexFlow never reads CSS — so the Tailwind `dark` class on
 * `<html>` following the OS is not enough on its own: a surface that resolved
 * the scheme from `themeMode` alone kept drawing in the old one, because in
 * system mode `themeMode` does not change when the OS does. Every surface
 * reading this follows the flip, the document class included.
 *
 * `useSyncExternalStore` because the media query *is* an external store, and
 * subscribing through it cannot tear between two readers mid-render.
 */
export function useResolvedColorScheme(mode: ColorSchemeMode): ResolvedColorScheme {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = mode === 'system' ? prefersDarkQuery() : null;
      if (!media) return () => undefined;
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [mode],
  );
  const get = (): ResolvedColorScheme => resolveColorScheme(mode);
  return useSyncExternalStore(subscribe, get, get);
}

const PREFERS_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Spec §27: whether the user's OS/browser prefers reduced motion. Guarded
 * for SSR/tests/older browsers, where `matchMedia` doesn't exist (or
 * throws on an unrecognized query, which some older browsers do).
 *
 * Post-MUI (T13): this app has no theme-level transition system left to
 * zero out, so the only remaining consumer is `ScoreEditorView`'s
 * scroll-into-view-during-playback effect, which reads this directly to
 * pick `'auto'` vs `'smooth'` scroll behavior. Kept as a standalone export
 * (rather than inlined there) since it's still the single shared
 * implementation of the media-query read, guards, and try/catch.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(PREFERS_REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Applies a resolved color scheme to the document by toggling the `dark`
 * class on `<html>` (Tailwind `darkMode: 'class'`, see `tailwind.config.js`
 * and the `.dark { ... }` variable block in `src/index.css`). No-op outside
 * a DOM environment (SSR/tests that don't set up jsdom's `document`).
 */
export function applyDocumentTheme(scheme: ResolvedColorScheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', scheme === 'dark');
}

/**
 * User-facing color scheme preference. `system` follows the OS/browser
 * `prefers-color-scheme` media query; `light`/`dark` are manual overrides.
 *
 * The manual-override toggle UI is out of scope for this task; this type and
 * `resolveColorScheme` exist so the app shell can wire a settings toggle to
 * it later without changing the theme contract.
 */
export type ColorSchemeMode = 'system' | 'light' | 'dark';

/** A concrete (non-`system`) color scheme, as applied to the document. */
export type ResolvedColorScheme = 'light' | 'dark';

const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

/** Reads the OS/browser color-scheme preference. Defaults to light when unavailable (e.g. SSR/tests). */
export function getSystemColorScheme(): ResolvedColorScheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia(PREFERS_DARK_QUERY).matches ? 'dark' : 'light';
}

/** Resolves a user preference (which may defer to the system) into a concrete `light`/`dark` scheme. */
export function resolveColorScheme(mode: ColorSchemeMode): ResolvedColorScheme {
  if (mode === 'system') {
    return getSystemColorScheme();
  }
  return mode;
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

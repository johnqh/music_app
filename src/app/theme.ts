import { createTheme, type PaletteMode, type Theme } from '@mui/material/styles';

/**
 * User-facing color scheme preference. `system` follows the OS/browser
 * `prefers-color-scheme` media query; `light`/`dark` are manual overrides.
 *
 * The manual-override toggle UI is out of scope for this task; this type and
 * `resolveColorScheme` exist so the app shell can wire a settings toggle to
 * it later without changing the theme contract.
 */
export type ColorSchemeMode = 'system' | 'light' | 'dark';

const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

/** Reads the OS/browser color-scheme preference. Defaults to light when unavailable (e.g. SSR/tests). */
export function getSystemColorScheme(): PaletteMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia(PREFERS_DARK_QUERY).matches ? 'dark' : 'light';
}

/** Resolves a user preference (which may defer to the system) into a concrete MUI palette mode. */
export function resolveColorScheme(mode: ColorSchemeMode): PaletteMode {
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
 * The single shared implementation — `createAppTheme` uses it to disable
 * MUI's default Fade/Grow/Collapse/Slide transitions (dialogs, menus,
 * popovers, the toast snackbar all use these with no per-instance
 * override, so a theme-level fix covers every one of them at once, rather
 * than needing a change at each call site); `ScoreEditorView`'s
 * scroll-into-view-during-playback effect uses the same function for its
 * own (non-CSS, imperative `scrollTo`) animation.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(PREFERS_REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/** Builds the MUI theme for the given resolved palette mode. */
export function createAppTheme(mode: PaletteMode): Theme {
  const reducedMotion = prefersReducedMotion();

  return createTheme({
    palette: {
      mode,
      primary: {
        main: mode === 'dark' ? '#90caf9' : '#1565c0',
      },
      secondary: {
        main: mode === 'dark' ? '#ce93d8' : '#7b1fa2',
      },
    },
    shape: {
      borderRadius: 6,
    },
    // Spec §27 "reduced-motion support": every MUI Dialog/Menu/Popover
    // (default Fade/Grow transition) and the toast Snackbar (default Grow)
    // in this app use their default transition with no per-instance
    // `transitionDuration`/`TransitionProps` override, so zeroing the
    // theme's own transition timing here — both the CSS `create()` output
    // and every named `duration` (react-transition-group's mount/unmount
    // timeout reads `duration.enteringScreen`/`leavingScreen`) — disables
    // all of them at once instead of touching each call site.
    ...(reducedMotion
      ? {
          transitions: {
            create: () => 'none',
            duration: {
              shortest: 0,
              shorter: 0,
              short: 0,
              standard: 0,
              complex: 0,
              enteringScreen: 0,
              leavingScreen: 0,
            },
          },
        }
      : {}),
  });
}

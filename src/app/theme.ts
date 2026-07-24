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

/** Builds the MUI theme for the given resolved palette mode. */
export function createAppTheme(mode: PaletteMode): Theme {
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
  });
}

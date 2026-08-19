/**
 * The app-wide font size preference.
 *
 * Device-scoped like the theme, and stored the way `sudojo_app` stores its
 * own — a `localStorage` key under an app-specific name — rather than in
 * `music_lib`'s device prefs, whose type ships from a separate package.
 *
 * Applied as `data-font-size` on the document element rather than the shared
 * provider's `font-<size>` classes: `font-medium` is also a Tailwind
 * font-weight utility, so putting it on `<html>` sets `font-weight: 500` on
 * the whole app and changes no size at all. The scaling rules live in
 * `index.css`.
 */
import { useCallback, useEffect, useState } from 'react';

export const FONT_SIZES = ['small', 'medium', 'large'] as const;
export type FontSizePref = (typeof FONT_SIZES)[number];

const STORAGE_KEY = 'moosiac-font-size';
const DEFAULT: FontSizePref = 'medium';

function isFontSize(value: string | null): value is FontSizePref {
  return value !== null && (FONT_SIZES as readonly string[]).includes(value);
}

function read(): FontSizePref {
  if (typeof localStorage === 'undefined') return DEFAULT;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isFontSize(stored) ? stored : DEFAULT;
  } catch {
    // Private browsing and blocked storage both throw here; the preference is
    // a convenience, so fall back rather than take the app down with it.
    return DEFAULT;
  }
}

export function useFontSize(): {
  fontSize: FontSizePref;
  setFontSize: (size: FontSizePref) => void;
} {
  const [fontSize, setState] = useState<FontSizePref>(read);

  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', fontSize);
  }, [fontSize]);

  const setFontSize = useCallback((size: FontSizePref) => {
    setState(size);
    try {
      localStorage.setItem(STORAGE_KEY, size);
    } catch {
      // Unpersisted is still usable for this session.
    }
  }, []);

  return { fontSize, setFontSize };
}

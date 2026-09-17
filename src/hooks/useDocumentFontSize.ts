/**
 * Applies the font size preference to the document.
 *
 * The preference itself is a device pref in the store (`fontSize` /
 * `setFontSize`), loaded and persisted by music_lib's `bindDevicePrefs` with
 * the theme and the rest — it used to be kept here under a `localStorage` key
 * of its own, which `loadPrefs` still reads as a fallback so nobody's choice
 * is stranded. Only the part a library cannot do stays: writing it onto
 * `<html>`.
 *
 * Mounted once, at the app root. It used to be read only by the settings page,
 * so a remembered size was not applied until somebody opened that page.
 *
 * Applied as `data-font-size` on the document element rather than the shared
 * provider's `font-<size>` classes: `font-medium` is also a Tailwind
 * font-weight utility, so putting it on `<html>` sets `font-weight: 500` on
 * the whole app and changes no size at all. The scaling rules live in
 * `index.css`.
 */
import { useEffect } from 'react';
import type { EditorStoreApi } from '@/app-library';

export function useDocumentFontSize(store: EditorStoreApi): void {
  const fontSize = store((s) => s.fontSize);
  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', fontSize);
  }, [fontSize]);
}

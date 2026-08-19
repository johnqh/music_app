/**
 * Keeps `<html lang>` and `<html dir>` in step with the active language.
 *
 * Not cosmetic: a screen reader picks its pronunciation from `lang`, and search
 * engines read it to tell one translation of a page from another. Without this
 * the document claimed to be English while rendering Chinese — the markup and
 * the content disagreed, and only the markup is machine-readable.
 *
 * `sudojo_app` does exactly this, and mounts it once near the root.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** No RTL locale ships yet; listed so adding one needs no second change here. */
const RTL_LANGUAGES = ['he', 'fa', 'ur', 'ar'];

export function useDocumentLanguage(): void {
  const { i18n } = useTranslation();

  useEffect(() => {
    const language = i18n.language || 'en';
    const direction = RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [i18n.language]);
}

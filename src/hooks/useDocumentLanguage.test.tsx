/**
 * The document's own claim about what language it is in.
 *
 * Machine-readable and invisible, which is why it drifted: the page rendered
 * Chinese while `<html lang>` still said English, and nothing on screen showed
 * it. Screen readers pick pronunciation from this attribute.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import i18n from '@/i18n';
import { useDocumentLanguage } from '@/hooks/useDocumentLanguage';

function Probe() {
  useDocumentLanguage();
  return null;
}

describe('useDocumentLanguage', () => {
  it('states the active language on the document', async () => {
    await i18n.changeLanguage('zh');
    render(<Probe />);
    expect(document.documentElement.lang).toBe('zh');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('follows a language change', async () => {
    render(<Probe />);
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

/**
 * The library's message catalogue must actually reach words.
 *
 * `setLibraryMessages` was exported by `music_lib`, referenced in a comment
 * here, and called by nothing — so all five of its messages rendered as empty
 * strings in production, a failed-autosave toast among them. Nothing failed:
 * the contract's own default is the empty string (deliberately, so a missing
 * message is visible rather than silently English), and an unwired catalogue
 * looks exactly like a wired one until a message fires.
 *
 * So the wiring is pinned from both ends: every key the builder supplies has a
 * string in the locale, and every key the locale carries is supplied. The
 * first half catches a message added to `music_lib` and never translated; the
 * second catches one removed from the contract and left in the files.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { libraryMessages } from './lib-copy';

function localeBlock(lang: string): Record<string, string> {
  const json = JSON.parse(readFileSync(`public/locales/${lang}/app.json`, 'utf8')) as {
    library?: Record<string, string>;
  };
  return json.library ?? {};
}

describe('library messages', () => {
  it('supplies exactly the keys the locales define', () => {
    const supplied = Object.keys(libraryMessages()).sort();
    expect(supplied).toEqual(Object.keys(localeBlock('en')).sort());
    expect(supplied).toEqual(Object.keys(localeBlock('zh')).sort());
  });

  it('resolves every key to a non-empty string in both locales', () => {
    for (const lang of ['en', 'zh']) {
      const block = localeBlock(lang);
      for (const [key, value] of Object.entries(block)) {
        expect(value.trim(), `${lang}.library.${key} is empty`).not.toBe('');
      }
    }
  });

  it('resolves through a function, so a language change is picked up', () => {
    // The contract's values are resolvers, not captured strings. A plain
    // string here would compile and then strand whichever language happened to
    // be loaded when `initializeApp` ran.
    for (const value of Object.values(libraryMessages())) {
      expect(typeof value).toBe('function');
    }
  });
});

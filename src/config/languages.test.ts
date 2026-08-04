/**
 * Guards the one thing about translations that fails silently.
 *
 * Nothing is compiled in — every language is fetched from `public/locales/` at
 * runtime — so a missing directory or a missing key produces no build error and
 * no test failure anywhere else. It shows up only in the browser, in the
 * language nobody on the team is reading: a missing file leaves every string as
 * its raw key, and a missing key quietly falls back to English.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LANGUAGE_NAMES,
  LANGUAGE_OPTIONS,
  SUPPORTED_LANGUAGES,
  isLanguageSupported,
} from '@/config/languages';

const LOCALES_DIR = resolve(process.cwd(), 'public/locales');

function bundlePath(lang: string): string {
  return resolve(LOCALES_DIR, lang, 'app.json');
}

function load(lang: string): Record<string, unknown> {
  return JSON.parse(readFileSync(bundlePath(lang), 'utf8')) as Record<string, unknown>;
}

/** Every leaf key, dotted — `home.cta` rather than `home`. */
function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** `{{name}}` placeholders, which must survive translation or interpolation breaks. */
function placeholders(text: string): string[] {
  return (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();
}

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value !== 'object' || value === null) return { [prefix]: String(value) };
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, child]) => Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key)),
    {},
  );
}

describe('language configuration', () => {
  it('names every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(LANGUAGE_NAMES[lang], lang).toBeTruthy();
    }
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('ships a bundle for every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(existsSync(bundlePath(lang)), `public/locales/${lang}/app.json`).toBe(true);
    }
  });

  it('offers exactly the supported languages in the picker', () => {
    // The top bar's LanguageSelector defaults to its own list of 16 languages.
    // Offering one this app has no bundle for is silent -- the switch succeeds
    // and every string renders as its raw key.
    expect(LANGUAGE_OPTIONS.map((option) => option.code)).toEqual([...SUPPORTED_LANGUAGES]);
    for (const option of LANGUAGE_OPTIONS) {
      expect(option.name, option.code).toBeTruthy();
      expect(option.flag, option.code).toBeTruthy();
    }
  });

  it('recognises exactly the supported codes', () => {
    expect(isLanguageSupported('en')).toBe(true);
    expect(isLanguageSupported('fr')).toBe(true);
    expect(isLanguageSupported('de')).toBe(false);
    expect(isLanguageSupported('')).toBe(false);
  });

  describe.each(SUPPORTED_LANGUAGES.filter((lang) => lang !== 'en'))('%s', (lang) => {
    it('has exactly English\'s keys — no missing, no stale', () => {
      expect(leafKeys(load(lang)).sort()).toEqual(leafKeys(load('en')).sort());
    });

    it('keeps every interpolation placeholder', () => {
      // A translator dropping `{{appName}}` is the classic way this breaks, and
      // it renders as a sentence with a hole in it rather than as an error.
      const english = flatten(load('en'));
      const translated = flatten(load(lang));
      for (const [key, source] of Object.entries(english)) {
        expect(placeholders(translated[key]), key).toEqual(placeholders(source));
      }
    });

    it('actually translates — it is not a copy of English', () => {
      const english = flatten(load('en'));
      const translated = flatten(load(lang));
      // Some values are legitimately identical (a bare placeholder, a proper
      // noun), so this asserts on the bulk rather than on every entry.
      const differing = Object.keys(english).filter((key) => translated[key] !== english[key]);
      expect(differing.length).toBeGreaterThan(Object.keys(english).length / 2);
    });
  });
});

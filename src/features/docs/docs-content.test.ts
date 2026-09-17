/**
 * Every key the documentation asks for must exist in both locales.
 *
 * The page builds most of its keys rather than writing them out — a topic's
 * paragraphs are `docs.<topic>.<section>.p1`, `p2` and so on — so a section
 * declared with three paragraphs and translated with two produces a page that
 * renders the raw key as its own text. i18next falls back silently, which
 * means nothing fails and nobody notices until a reader hits it. That is the
 * same failure `locale-parity.test.ts` exists for; this catches the half of it
 * that parity cannot see, because a key absent from BOTH locales is perfectly
 * consistent.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOCS_TOPICS } from '@/app-library';
import { DOCS_GROUPS } from '@sudobility/music_types';
import { EXPORT_FORMATS, IMPORT_FORMATS } from './formats';
import { SHORTCUT_GROUPS } from '@sudobility/music_types';

function load(lang: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `public/locales/${lang}/app.json`), 'utf8'),
  );
}

function lookup(bundle: Record<string, unknown>, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      bundle,
    );
}

/** Every key the docs render, built the same way the page builds them. */
function requiredKeys(): string[] {
  const keys = ['docs.title', 'docs.navLabel', 'nav.docs'];
  for (const group of DOCS_GROUPS) keys.push(`docs.group.${group}`);
  for (const topic of DOCS_TOPICS) {
    keys.push(topic.title, topic.summary);
    for (const section of topic.sections) {
      keys.push(section.heading, ...section.body);
    }
  }
  for (const group of SHORTCUT_GROUPS) keys.push(`docs.shortcuts.group.${group}`);
  for (const column of [
    'search',
    'showing',
    'colProgram',
    'colName',
    'colFamily',
    'colRange',
    'colPolyphony',
    'colTranspose',
    'colBasis',
    'polyUnlimited',
  ]) {
    keys.push(`docs.instruments.${column}`);
  }
  for (const basis of ['measured', 'tunable', 'synthetic', 'unpitched', 'assumed']) {
    keys.push(`docs.instruments.basis.${basis}`);
  }
  keys.push('docs.formats.importsHeading', 'docs.formats.exportsHeading');
  for (const entry of [...IMPORT_FORMATS, ...EXPORT_FORMATS]) {
    keys.push(`docs.formats.name.${entry.id}`, entry.noteKey);
  }
  return [...new Set(keys)];
}

describe('documentation strings', () => {
  it.each(['en', 'zh'])('resolves every key it renders in %s', (lang) => {
    const bundle = load(lang);
    const missing = requiredKeys().filter((key) => typeof lookup(bundle, key) !== 'string');
    expect(missing).toEqual([]);
  });

  it('covers every basis the instrument catalogue can carry', async () => {
    // A new basis added upstream would render its own key as the cell text.
    const { INSTRUMENT_BASES } = await import('@sudobility/music_lib');
    const bundle = load('en');
    for (const basis of INSTRUMENT_BASES) {
      expect(
        typeof lookup(bundle, `docs.instruments.basis.${basis}`),
        `no label for basis "${basis}"`,
      ).toBe('string');
    }
  });

  it('gives every topic a unique id and at least one section', () => {
    const ids = DOCS_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of DOCS_TOPICS) {
      expect(topic.sections.length, topic.id).toBeGreaterThan(0);
      for (const section of topic.sections) {
        expect(section.body.length, section.heading).toBeGreaterThan(0);
      }
    }
  });
});

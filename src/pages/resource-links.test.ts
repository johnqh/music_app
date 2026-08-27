/**
 * A link with no description renders its own key, and nothing fails.
 *
 * The page builds `resources.link.<key>` and `resources.group.<key>.title`
 * rather than writing them out, so adding a link here and forgetting the two
 * locale strings produces a card whose body reads `resources.link.midkar`.
 * i18next falls back silently, which is the same failure `locale-parity` was
 * written for — and the half parity cannot see, since a key missing from BOTH
 * locales is perfectly consistent.
 *
 * The rest guards the list itself: a duplicated key would collide as a React
 * key and share one description, a duplicated URL is a link listed twice under
 * two names, and a non-https URL on a page of outbound links is a downgrade.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESOURCE_GROUPS, hostOf, iconFor, iconKeys, monogramFor } from './resource-links';

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

/** Every key the page renders, built the same way the page builds them. */
function requiredKeys(): string[] {
  const keys = ['resources.title', 'resources.intro', 'nav.resources'];
  for (const group of RESOURCE_GROUPS) {
    keys.push(`resources.group.${group.key}.title`, `resources.group.${group.key}.route`);
    for (const link of group.links) keys.push(`resources.link.${link.key}`);
  }
  return keys;
}

const ALL_LINKS = RESOURCE_GROUPS.flatMap((group) => group.links);

describe('resource links', () => {
  it.each(['en', 'zh'])('resolves every key it renders in %s', (lang) => {
    const bundle = load(lang);
    const missing = requiredKeys().filter((key) => typeof lookup(bundle, key) !== 'string');
    expect(missing).toEqual([]);
  });

  it('translates no more than it renders', () => {
    // An entry left behind after a link is removed is dead weight the parity
    // test happily keeps translated forever.
    const listed = new Set(ALL_LINKS.map((link) => link.key));
    const orphans = Object.keys(lookup(load('en'), 'resources.link') as object).filter(
      (key) => !listed.has(key),
    );
    expect(orphans).toEqual([]);
  });

  it('gives every link a unique key and a unique destination', () => {
    const keys = ALL_LINKS.map((link) => link.key);
    expect(new Set(keys).size, 'duplicate link keys').toBe(keys.length);
    const urls = ALL_LINKS.map((link) => link.url);
    expect(new Set(urls).size, 'the same URL listed twice').toBe(urls.length);
    const groupKeys = RESOURCE_GROUPS.map((group) => group.key);
    expect(new Set(groupKeys).size, 'duplicate group keys').toBe(groupKeys.length);
  });

  it('leaves the app over https, always', () => {
    for (const link of ALL_LINKS) {
      expect(link.url, link.key).toMatch(/^https:\/\//);
      expect(link.name.trim(), link.key).not.toBe('');
    }
  });

  it('puts links in every group', () => {
    for (const group of RESOURCE_GROUPS) {
      expect(group.links.length, group.key).toBeGreaterThan(0);
    }
  });

  it('ships no icon that belongs to no link', () => {
    // An icon left in src/assets after its link is removed is dead weight that
    // nothing renders and nothing else would ever notice.
    const listed = new Set(ALL_LINKS.map((link) => link.key));
    expect(iconKeys().filter((key) => !listed.has(key))).toEqual([]);
  });

  it('falls back to a monogram for the sites that publish no icon', () => {
    // Four of them do not: CPDL, MIDIWORLD, Modland and colinraffel.com each
    // answer /favicon.ico with an error page or a 1x1 GIF. The point is not the
    // number but that a link with no file renders something rather than a
    // broken image.
    const iconless = ALL_LINKS.filter((link) => iconFor(link.key) === undefined);
    for (const link of iconless) {
      expect(monogramFor(link.name), link.key).toMatch(/^[A-Z0-9]$/);
    }
    // And most links must actually have one, or the fetch script silently
    // stopped working and every tile quietly became a letter.
    expect(ALL_LINKS.length - iconless.length).toBeGreaterThan(ALL_LINKS.length / 2);
  });

  it('reads the host off the URL rather than the name', () => {
    expect(hostOf('https://www.vgmusic.com/')).toBe('vgmusic.com');
    expect(hostOf('https://archive.org/details/audio')).toBe('archive.org');
    expect(hostOf('https://files.scene.org/browse/music/')).toBe('files.scene.org');
  });
});

/**
 * The site icons this page draws, and nothing else.
 *
 * **The links themselves moved to `@sudobility/music_editing`** — two apps show
 * this page now, and a forty-two entry list transcribed into the second is
 * forty-two chances for the two to disagree about what this app can open. What
 * stays here is the one part a library cannot hold: files on disk, read through
 * Vite's own glob.
 *
 * `resource-links.test.ts` is what stops a link added upstream from shipping
 * with no description — i18next falls back to the key itself, so a missing
 * string renders as `resources.link.midkar` and nothing fails.
 */
export { RESOURCE_GROUPS, hostOf, monogramFor } from '@sudobility/music_editing';
export type { Resource, ResourceGroup } from '@sudobility/music_editing';

const ICON_URLS = import.meta.glob('../assets/resource-icons/*.{png,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(ICON_URLS).map(([path, url]) => [
    path.replace(/^.*\/([^/]+)\.(png|svg)$/, '$1'),
    url,
  ]),
);

/** The site's own icon, or `undefined` when it publishes none. */
export function iconFor(key: string): string | undefined {
  return ICONS[key];
}

/** Every key an icon file exists for, so a test can spot an orphaned one. */
export function iconKeys(): string[] {
  return Object.keys(ICONS).sort();
}

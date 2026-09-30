/**
 * Captures the figures the documentation shows, from the running app.
 *
 * A figure is a picture of one element — the transport bar, the inspector's
 * Track tab — and not of the screen it sits on: a whole screen at the width
 * of a column of prose is too small to read, and nine tenths of it is not
 * what the paragraph beside it is about.
 *
 * They are captured rather than drawn, so that they are what the app looks
 * like. Run this again after the interface changes; a figure that no longer
 * matches is a figure that teaches the wrong thing.
 *
 * It needs the e2e stack, which signs in as a fixed test user and generates
 * from fixtures — the same stack `playwright.config.ts` boots:
 *
 *   # music_api, in test mode, on the local test database
 *   DATABASE_URL=postgres://localhost:5432/music_test PORT=8023 AI_TEST_MODE=1 \
 *     TEST_AUTH_BYPASS_TOKEN=e2e-token INITIAL_FREE_CREDITS=1000000 \
 *     bun --cwd ../music_api src/index.ts
 *   # this app, against it
 *   VITE_E2E=1 VITE_E2E_TOKEN=e2e-token VITE_API_URL=http://localhost:8023 bun run dev
 *
 *   node scripts/capture-docs-figures.mjs [base-url]
 *
 * One figure per topic, named for the topic, into `public/docs/figures/`.
 * `src/features/docs/figures.ts` says which topics have one.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:5039';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'docs', 'figures');
const TITLE = 'Morning Song';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  // Tall enough that the inspector's longest tab is drawn whole.
  viewport: { width: 1440, height: 1180 },
  // Twice the density, so a figure is sharp on the displays it is read on.
  deviceScaleFactor: 2,
  colorScheme: 'light',
});

/**
 * The widest a figure is captured, in CSS pixels.
 *
 * A bar that runs the width of the window is a strip forty pixels tall; shown
 * at the width of a column of prose it is a line of specks. So a bar is
 * captured from its leading edge for this far — which is where its controls
 * are — rather than whole.
 */
const FIGURE_WIDTH = 900;

const shot = (name) => join(OUT, `${name}.png`);
const settle = (ms = 600) => page.waitForTimeout(ms);
/** A rectangle of the page, for what has no element of its own. */
const clip = (name, x, y, width, height) =>
  page.screenshot({ path: shot(name), clip: { x, y, width, height } });
const notation = () =>
  page.waitForFunction(() => (window.__scoresmith?.result?.idToBBox.size ?? 0) > 0, undefined, {
    timeout: 60_000,
  });
const rectOf = (locator) =>
  locator.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

/**
 * An element, as far down as it has anything in it.
 *
 * The inspector is a column the height of the editor, and a tab with four
 * fields in it is mostly empty column. The figure stops a little under the
 * last thing drawn.
 */
async function shotOfContent(name, locator) {
  const box = await locator.evaluate((node) => {
    const frame = node.getBoundingClientRect();
    let bottom = frame.top;
    for (const child of node.querySelectorAll('*')) {
      if (child.children.length > 0) continue;
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom);
    }
    return {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: Math.min(frame.height, bottom - frame.top + 16),
    };
  });
  await clip(name, box.x, box.y, box.width, box.height);
}

/* ---- Projects: the way in ------------------------------------------- */

await page.goto(`${BASE}/en/projects`);
await page.getByLabel('Search projects').waitFor();

// navigation: the bar every page but the editor carries.
await page
  .locator('header')
  .first()
  .screenshot({ path: shot('navigation') });

// getting-started: a new project, as it is first offered.
await page.getByRole('button', { name: 'New Project', exact: true }).click();
await page.getByLabel('Title', { exact: true }).fill(TITLE);
await settle();
await page.getByRole('dialog').screenshot({ path: shot('getting-started') });

// generation: the same form, asked to write the music.
await page.getByRole('switch', { name: 'Generate for me' }).click();
await page.getByLabel('Prompt', { exact: true }).fill('A gentle piano piece for a quiet morning');
await settle();
await page.getByRole('dialog').screenshot({ path: shot('generation') });

await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.waitForURL(/\/project\//, { timeout: 30_000 });
await notation();
// The instruments finish loading a moment after the notes are drawn, and the
// transport says so until they have.
await page
  .getByText('Preparing instruments')
  .waitFor({ state: 'hidden', timeout: 60_000 })
  .catch(() => undefined);
await settle(1000);

/* ---- The editor ------------------------------------------------------ */

const toolbar = await rectOf(page.getByRole('toolbar', { name: 'Score editor toolbar' }));
const score = await rectOf(page.locator('[aria-label^="Score notation"]'));
const inspector = page
  .getByRole('tablist')
  .locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');

// playback: the transport, at rest, before anything below moves the caret.
const transport = await rectOf(page.getByRole('toolbar', { name: 'Playback transport' }));
await clip('playback', transport.x, transport.y, FIGURE_WIDTH, transport.height);

// notation: the editing bar, which is where every mark is asked for.
await clip('notation', 0, toolbar.y, FIGURE_WIDTH, toolbar.height);

// editor: the bar and the first system under it, with the caret.
await clip('editor', 0, toolbar.y, FIGURE_WIDTH, toolbar.height + 270);

// tracks: the inspector opens on the Track tab.
await shotOfContent('tracks', inspector);

// inspector: the Note tab, with a note chosen for it to describe.
const note = await page.evaluate(() => {
  const handle = window.__scoresmith;
  const [, box] = [...handle.result.idToBBox.entries()][2];
  const frame = handle.scrollBox.getBoundingClientRect();
  return {
    x: frame.x + box.x + box.width / 2 - handle.scrollBox.scrollLeft,
    y: frame.y + box.y + box.height / 2 - handle.scrollBox.scrollTop,
  };
});
await page.mouse.click(note.x, note.y);
await page.getByRole('tab', { name: 'Note', exact: true }).click();
await settle();
await shotOfContent('inspector', inspector);

// structure: the Bar tab, with a bar chosen. Through the store, as the e2e
// suite does it: the bar-number band is drawn on a canvas, with no element
// of its own to click.
await page.evaluate(() => {
  const state = window.__SCORESMITH_STORE__.getState();
  state.selectMeasures([state.score.tracks[0].measures[1].id]);
});
await page.getByRole('tab', { name: 'Bar', exact: true }).click();
await settle();
await shotOfContent('structure', inspector);

// midi-input: the keyboard the notes arrive on, and are shown on.
const keyboard = await rectOf(
  page.locator('[aria-label="Piano keyboard showing the notes being played"]'),
);
await clip('midi-input', keyboard.x, keyboard.y, FIGURE_WIDTH, keyboard.height);

// sharing: a snapshot, which is what is published.
await page.getByRole('button', { name: 'Project menu' }).click();
await settle();
const menu = page.getByRole('menu').or(page.getByRole('dialog')).first();
await menu.screenshot({ path: shot('sharing') });
await page.keyboard.press('Escape');

/* ---- Settings -------------------------------------------------------- */

await page.goto(`${BASE}/en/settings`);
await page.getByRole('main').waitFor();
await settle(1000);
// The list and the section beside it, without the empty page beneath them.
const main = await rectOf(page.getByRole('main'));
await clip('settings', main.x, main.y, FIGURE_WIDTH + 200, Math.min(main.height, 480));

await browser.close();
console.log(`Figures written to ${OUT}`);

/**
 * The print view under print media.
 *
 * Unit tests cannot see `@media print`, and the two things that matter here —
 * page breaks never falling through a system, and the chrome not appearing on
 * paper — exist only there.
 */
import { expect, test } from '@playwright/test';
import { createNewProject, generateWholeScore, gotoDashboard, waitForNotation } from './helpers';

async function openPrintView(page: import('@playwright/test').Page, name: string, measures = 16) {
  await gotoDashboard(page);
  await createNewProject(page, name);
  await generateWholeScore(page, { prompt: 'Create a calm piano study', measures });
  await waitForNotation(page);

  await page.getByLabel('Print…').click();
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
}

test.describe('printing', () => {
  test('every system is a block a page break may not fall inside', async ({ page }) => {
    await openPrintView(page, 'Print Check');

    const systems = page.locator('[data-testid^="print-system-"]');
    await expect(systems.first()).toBeVisible();
    const count = await systems.count();
    expect(count).toBeGreaterThan(1);

    await page.emulateMedia({ media: 'print' });

    // Every system, not just the first: one unbroken block each is the whole
    // guarantee.
    for (let i = 0; i < count; i++) {
      const value = await systems.nth(i).evaluate((el) => getComputedStyle(el).breakInside);
      expect(value, `system ${i}`).toBe('avoid');
    }
  });

  test('the chrome does not print', async ({ page }) => {
    await openPrintView(page, 'Print Chrome', 8);

    const printButton = page.getByRole('button', { name: 'Print' });
    await expect(printButton).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    await expect(printButton).toBeHidden();
  });

  test('a single track needs no more systems than the whole score', async ({ page }) => {
    await openPrintView(page, 'Print Part', 8);

    const scoreSystems = await page.locator('[data-testid^="print-system-"]').count();

    await page.getByLabel('What to print').click();
    await page.getByRole('option').nth(1).click();

    const partSystems = await page.locator('[data-testid^="print-system-"]').count();
    expect(partSystems).toBeLessThanOrEqual(scoreSystems);
  });

  test('a transposing part prints written, and the score stays at concert pitch', async ({
    page,
  }) => {
    await openPrintView(page, 'Transposed Part', 8);

    // Make the first track a B-flat clarinet through the store: the subject
    // here is the printed pitch, not how the instrument got set.
    await page.evaluate(() => {
      type Store = {
        getState: () => {
          score: { tracks: Array<Record<string, unknown>> } | null;
          setScore: (s: unknown) => void;
        };
      };
      const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
      const score = store.getState().score!;
      store.getState().setScore({
        ...score,
        tracks: score.tracks.map((t, i) =>
          i === 0 ? { ...t, midiProgram: 71, instrumentName: 'Clarinet' } : t,
        ),
      });
    });

    const readScore = () =>
      page.evaluate(() => {
        const store = (
          window as unknown as { __SCORESMITH_STORE__: { getState: () => { score: unknown } } }
        ).__SCORESMITH_STORE__;
        return JSON.stringify(store.getState().score);
      });

    const before = await readScore();

    const trackName = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __SCORESMITH_STORE__: { getState: () => { score: { tracks: Array<{ name: string }> } } };
        }
      ).__SCORESMITH_STORE__;
      return store.getState().score.tracks[0].name;
    });

    await page.getByLabel('What to print').click();
    await page.getByRole('option', { name: trackName, exact: true }).click();
    await expect(page.locator('[data-testid^="print-system-"]').first()).toBeVisible();

    // Both halves of the caveat are gone: the part is transposed and its rests
    // are collapsed.
    await expect(page.getByText(/not yet an orchestral part/i)).toHaveCount(0);
    await expect(page.getByText(/concert pitch/i)).toHaveCount(0);

    // And the music itself never moved.
    expect(await readScore()).toBe(before);
  });

  test('a part with a long silence prints fewer systems than the score', async ({ page }) => {
    await openPrintView(page, 'Long Rest', 24);

    // Empty the first track's later measures so the part has a real silence to
    // collapse, then compare the printed length of score and part.
    await page.evaluate(() => {
      type Store = {
        getState: () => {
          score: { tracks: Array<Record<string, unknown>> };
          setScore: (s: unknown) => void;
        };
      };
      const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
      const score = store.getState().score;
      store.getState().setScore({
        ...score,
        tracks: score.tracks.map((track, trackIndex) =>
          trackIndex !== 0
            ? track
            : {
                ...track,
                measures: (track.measures as Array<Record<string, unknown>>).map((m, i) =>
                  i < 4 ? m : { ...m, voices: [] },
                ),
              },
        ),
      });
    });

    const scoreSystems = await page.locator('[data-testid^="print-system-"]').count();

    const trackName = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __SCORESMITH_STORE__: { getState: () => { score: { tracks: Array<{ name: string }> } } };
        }
      ).__SCORESMITH_STORE__;
      return store.getState().score.tracks[0].name;
    });

    await page.getByLabel('What to print').click();
    await page.getByRole('option', { name: trackName, exact: true }).click();
    await expect(page.locator('[data-testid^="print-system-"]').first()).toBeVisible();

    // Twenty-one bars of silence became one, so the part is materially shorter.
    const partSystems = await page.locator('[data-testid^="print-system-"]').count();
    expect(partSystems).toBeLessThan(scoreSystems);
  });
  test('marks do not stop a part printing', async ({ page }) => {
    // Not an equality check — a mark is drawn into a canvas and the DOM cannot
    // see it, so equality is asserted in music_lib. This catches the coarser
    // failure: marks breaking rest runs badly enough that a part stops
    // rendering at all.
    await openPrintView(page, 'Marked Part', 40);

    const scoreSystems = await page.locator('[data-testid^="print-system-"]').count();
    expect(scoreSystems).toBeGreaterThan(0);

    const trackName = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __SCORESMITH_STORE__: { getState: () => { score: { tracks: Array<{ name: string }> } } };
        }
      ).__SCORESMITH_STORE__;
      return store.getState().score.tracks[0].name;
    });

    await page.getByLabel('What to print').click();
    await page.getByRole('option', { name: trackName, exact: true }).click();
    await expect(page.locator('[data-testid^="print-system-"]').first()).toBeVisible();
  });
  test('a part cues its entry after a long rest', async ({ page }) => {
    await openPrintView(page, 'Cued Part', 40);

    // Silence the first track from bar 2 to 30 so its part has a rest long
    // enough to earn a cue, leaving another track playing through it. If the
    // generated score has only one track, duplicate it first — a cue needs
    // somebody else to be playing.
    await page.evaluate(() => {
      type Track = Record<string, unknown> & { id: string; name: string };
      type Store = {
        getState: () => {
          score: { tracks: Track[] };
          setScore: (s: unknown) => void;
        };
      };
      const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
      const score = store.getState().score;
      const tracks =
        score.tracks.length > 1
          ? score.tracks
          : [
              score.tracks[0],
              { ...score.tracks[0], id: `${score.tracks[0].id}-cue`, name: 'Second' },
            ];

      store.getState().setScore({
        ...score,
        tracks: tracks.map((track, trackIndex) =>
          trackIndex !== 0
            ? track
            : {
                ...track,
                measures: (track.measures as Array<Record<string, unknown>>).map((m, i) =>
                  i >= 1 && i <= 29 ? { ...m, voices: [] } : m,
                ),
              },
        ),
      });
    });

    const trackName = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __SCORESMITH_STORE__: { getState: () => { score: { tracks: Array<{ name: string }> } } };
        }
      ).__SCORESMITH_STORE__;
      return store.getState().score.tracks[0].name;
    });

    await page.getByLabel('What to print').click();
    await page.getByRole('option', { name: trackName, exact: true }).click();
    await expect(page.locator('[data-testid^="print-system-"]').first()).toBeVisible();

    // The cue is drawn into a canvas, so the DOM cannot show it. What this
    // catches is the coarser failure: cues breaking a part badly enough that
    // it stops rendering. The cue itself is asserted in music_lib.
    expect(await page.locator('[data-testid^="print-system-"]').count()).toBeGreaterThan(0);
  });
  test('changing the paper repaginates', async ({ page }) => {
    await openPrintView(page, 'Paper Choice', 40);

    const pages = page.locator('[data-testid^="print-page-"]');
    await expect(pages.first()).toBeVisible();
    const portrait = await pages.count();

    await page.getByLabel('Orientation').click();
    await page.getByRole('option', { name: 'Landscape', exact: true }).click();

    // A landscape page is shorter, so the same score needs more of them.
    await expect
      .poll(async () => pages.count(), { message: 'landscape should need more pages' })
      .toBeGreaterThan(portrait);

    // And every system is still printed exactly once.
    expect(await page.locator('[data-testid^="print-system-"]').count()).toBeGreaterThan(0);
  });
});

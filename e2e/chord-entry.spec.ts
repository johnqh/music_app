/**
 * Entering a chord from the piano keyboard.
 *
 * Unit tests can only observe this through a mocked `playbackController`, so
 * they check how often the caret was advanced rather than where notes landed.
 * Here the caret really moves, which is the difference between a chord and an
 * arpeggio — the thing the feature exists to get right.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  gotoDashboard,
  readScoreSummary,
  waitForNotation,
} from './helpers';

/**
 * Presses every key together, holds, then lifts them — one chord, as played.
 *
 * Dispatched as pointer events with distinct `pointerId`s rather than driven
 * through `page.mouse`, because a mouse is one pointer and physically cannot
 * hold three keys down. Distinct pointer ids *are* what multi-touch is, so this
 * is the faithful simulation, not a shortcut around one.
 */
async function playChord(page: import('@playwright/test').Page, midis: number[], heldMs = 300) {
  await page.evaluate(
    async ({ midis, heldMs }) => {
      const fire = (midi: number, type: 'pointerdown' | 'pointerup') => {
        const el = document.querySelector(`[data-testid="piano-key-${midi}"]`);
        if (!el) throw new Error(`no key on screen for midi ${midi}`);
        const box = el.getBoundingClientRect();
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: midi,
            pointerType: 'touch',
            isPrimary: midi === midis[0],
            clientX: box.x + box.width / 2,
            clientY: box.y + box.height - 6,
          }),
        );
      };
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

      for (const midi of midis) {
        fire(midi, 'pointerdown');
        // Real fingers never land on the same millisecond, and the grouping
        // must not depend on them doing so.
        await wait(20);
      }
      await wait(heldMs);
      for (const midi of midis) {
        fire(midi, 'pointerup');
        await wait(20);
      }
    },
    { midis, heldMs },
  );
}

test.describe('chord entry', () => {
  test('keys held together become one chord, not an arpeggio', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Chord Entry');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 4 });
    await waitForNotation(page);

    const before = await readScoreSummary(page);
    expect(before).not.toBeNull();

    await playChord(page, [60, 64, 67]);

    const after = await readScoreSummary(page);
    const added = after!.notes.filter((note) => !before!.notes.some((old) => old.id === note.id));

    // Three new notes, all starting together and all the same length: that is
    // a chord. An arpeggio would give three different start ticks.
    expect(added).toHaveLength(3);
    expect(new Set(added.map((n) => n.startTick)).size).toBe(1);
    expect(new Set(added.map((n) => n.durationTicks)).size).toBe(1);

    expect(getErrors()).toEqual([]);
  });

  test('separate taps still write a melody', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Melody Entry');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 4 });
    await waitForNotation(page);

    const before = await readScoreSummary(page);

    for (const label of ['C4', 'D4', 'E4']) {
      const key = page.getByLabel(label, { exact: true });
      const box = await key.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height - 6);
      await page.mouse.down();
      await page.waitForTimeout(250);
      await page.mouse.up();
      // Released before the next goes down, so nothing overlaps.
      await page.waitForTimeout(120);
    }

    const after = await readScoreSummary(page);
    const added = after!.notes.filter((note) => !before!.notes.some((old) => old.id === note.id));

    expect(added.length).toBeGreaterThanOrEqual(3);
    // The opposite of the chord case: each tap gets its own place in time.
    expect(new Set(added.map((n) => n.startTick)).size).toBeGreaterThanOrEqual(3);

    expect(getErrors()).toEqual([]);
  });
});

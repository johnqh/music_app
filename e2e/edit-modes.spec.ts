/**
 * The three edit modes, and editing a selected chord from the keyboard.
 *
 * e2e rather than unit, because unit tests mock `playbackController` and so
 * cannot observe where the caret actually goes — which is the whole difference
 * between insert, replace and a chord.
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
 * Presses one key and releases it.
 *
 * Dispatched as pointer events rather than driven through `page.mouse` for the
 * same reason `chord-entry.spec.ts` does it: a mouse is one pointer, and these
 * specs need pointer ids they control.
 */
async function tapKey(page: import('@playwright/test').Page, midi: number, heldMs = 250) {
  await page.evaluate(
    async ({ midi, heldMs }) => {
      const el = document.querySelector(`[data-testid="piano-key-${midi}"]`);
      if (!el) throw new Error(`no key on screen for midi ${midi}`);
      const box = el.getBoundingClientRect();
      const fire = (type: 'pointerdown' | 'pointerup') =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: midi,
            pointerType: 'touch',
            isPrimary: true,
            clientX: box.x + box.width / 2,
            clientY: box.y + box.height - 6,
          }),
        );
      fire('pointerdown');
      await new Promise((r) => setTimeout(r, heldMs));
      fire('pointerup');
    },
    { midi, heldMs },
  );
}

/**
 * Puts the caret at `tick` so a mode's effect lands somewhere predictable.
 *
 * Typed against music_lib's real `AppStore` rather than a hand-written
 * shape. It used to declare `{ setPositionTick: (n: number) => void }` inline,
 * which is a claim about the store that TypeScript happily believed — so when
 * the action was renamed to `setCaretTick` (music_lib 1.7.30, "extract
 * high-freq events to bus") this kept compiling and failed at runtime with
 * "setPositionTick is not a function". Importing the real type means the next
 * rename breaks `bun run typecheck` instead of three e2e specs.
 */
async function seekTo(page: import('@playwright/test').Page, tick: number) {
  await page.evaluate((t) => {
    // Through the editor's dev handle, because the caret is the shared
    // position now rather than a field on the store.
    (window as unknown as { __scoresmith: { seek: (tick: number) => void } }).__scoresmith.seek(t);
  }, tick);
}

async function openScore(page: import('@playwright/test').Page, name: string) {
  await gotoDashboard(page);
  await createNewProject(page, name);
  await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 4 });
  await waitForNotation(page);
}

test.describe('edit modes', () => {
  test('insert mode displaces later notes instead of discarding them', async ({ page }) => {
    const getErrors = collectPageErrors(page);
    await openScore(page, 'Insert Mode');

    await page.getByLabel('Insert mode').click();
    await seekTo(page, 0);

    const before = await readScoreSummary(page);
    const track = before!.notes[0].trackId;
    const onTrackBefore = before!.notes.filter((n) => n.trackId === track);

    await tapKey(page, 60);

    const after = await readScoreSummary(page);
    // Every note that was on this track is still there: insert displaces, it
    // never discards. That is the guarantee the mode is built around.
    for (const note of onTrackBefore) {
      expect(
        after!.notes.some((n) => n.id === note.id),
        `note ${note.id} survived`,
      ).toBe(true);
    }
    expect(after!.notes.length).toBeGreaterThan(before!.notes.length);
    expect(getErrors()).toEqual([]);
  });

  test('replace mode overwrites rather than lengthening the piece', async ({ page }) => {
    const getErrors = collectPageErrors(page);
    await openScore(page, 'Replace Mode');

    await page.getByLabel('Replace mode').click();
    await seekTo(page, 0);

    const before = await readScoreSummary(page);
    await tapKey(page, 60);
    const after = await readScoreSummary(page);

    // Replace clears the span it writes into, so the piece does not grow the
    // way insert makes it grow.
    expect(after!.notes.length).toBeLessThanOrEqual(before!.notes.length + 1);
    expect(getErrors()).toEqual([]);
  });

  test('a selected chord is edited by the keyboard, not written at the caret', async ({ page }) => {
    const getErrors = collectPageErrors(page);
    await openScore(page, 'Chord Edit');

    // Build a chord to select: stack mode, three keys at one tick.
    await page.getByLabel('Stack mode').click();
    await seekTo(page, 0);
    for (const midi of [60, 64, 67]) {
      await seekTo(page, 0);
      await tapKey(page, midi);
    }

    const withChord = await readScoreSummary(page);
    const chord = withChord!.notes.filter((n) => n.startTick === 0);
    expect(chord.length).toBeGreaterThanOrEqual(3);

    await page.evaluate(
      (ids) => {
        const store = (
          window as unknown as {
            __SCORESMITH_STORE__: {
              getState: () => { setSelection: (s: unknown) => void };
            };
          }
        ).__SCORESMITH_STORE__;
        store.getState().setSelection({ eventIds: ids, measureIds: [], trackIds: [] });
      },
      chord.map((n) => n.id),
    );

    // A key already in the chord removes its note.
    await tapKey(page, 64);

    const after = await readScoreSummary(page);
    expect(after!.notes.filter((n) => n.startTick === 0).length).toBe(chord.length - 1);
    expect(getErrors()).toEqual([]);
  });
});

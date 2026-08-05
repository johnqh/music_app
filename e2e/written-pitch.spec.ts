import { expect, test } from '@playwright/test';
import { createNewProject, generateWholeScore, gotoDashboard, waitForNotation } from './helpers';

/** Every stored pitch on track 0, as JSON, straight out of the store. */
async function soundingPitches(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __SCORESMITH_STORE__: {
          getState: () => {
            score: {
              tracks: Array<{
                measures: Array<{ voices: Array<{ events: Array<Record<string, unknown>> }> }>;
              }>;
            };
          };
        };
      }
    ).__SCORESMITH_STORE__;
    const events = store
      .getState()
      .score.tracks[0].measures.flatMap((m) => m.voices.flatMap((v) => v.events));
    return JSON.stringify(events.map((e) => e.pitch ?? null));
  });
}

test.describe('written pitch', () => {
  test('changes the notation but never the score', async ({ page }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Written Pitch');
    await generateWholeScore(page, { prompt: 'Create a calm study', measures: 8 });
    await waitForNotation(page);

    // Make track 0 a clarinet, which reads a tone above concert pitch.
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
        tracks: score.tracks.map((t, i) => (i === 0 ? { ...t, midiProgram: 71 } : t)),
      });
    });

    const before = await soundingPitches(page);

    await page.getByRole('button', { name: 'Show written pitch' }).click();
    // The button now offers the way back, which is how we know it took.
    await expect(page.getByRole('button', { name: 'Show concert pitch' })).toBeVisible();

    // The lens must not become the model.
    expect(await soundingPitches(page)).toBe(before);

    // And back again, still untouched.
    await page.getByRole('button', { name: 'Show concert pitch' }).click();
    await expect(page.getByRole('button', { name: 'Show written pitch' })).toBeVisible();
    expect(await soundingPitches(page)).toBe(before);
  });
});

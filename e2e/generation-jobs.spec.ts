/**
 * Generation as a background job: the editor locks, the work survives
 * navigating away, and cancelling releases the project without changing it.
 *
 * These are the behaviours the job model exists for, and none of them can be
 * verified anywhere but end to end — the server owns the work.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  generateWholeScore,
  gotoDashboard,
  readScoreSummary,
  selectMeasuresByIndex,
  waitForGenerationSettled,
} from './helpers';

/** Starts a Replace Bars job and returns once the editor has locked. */
async function startReplaceJob(page: import('@playwright/test').Page): Promise<void> {
  await selectMeasuresByIndex(page, [1, 2]);
  await page.getByRole('tab', { name: 'Bar' }).click();
  await page.getByRole('button', { name: 'Replace Bars' }).click();
  await page.getByLabel('Instruction', { exact: true }).fill('Make this more dramatic');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByText('Generating notes…')).toBeVisible();
}

test.describe('generation jobs', () => {
  test('locks the editor, survives navigating away, and lands', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    const title = await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano melody in C major',
      measures: 8,
    });
    const projectUrl = page.url();

    await startReplaceJob(page);

    // Leaving is ordinary navigation: nothing is held in the browser.
    await gotoDashboard(page);
    /*
      Scoped to this test's own card, not to the page. Two workers share one
      `music_test` database, so another spec's project can be generating at the
      same moment — and an unscoped `getByText` then matches two badges and
      fails strict mode, which is a property of the schedule rather than of the
      code under test.
    */
    await expect(
      page
        .getByRole('button', { name: `Open project: ${title}`, exact: true })
        .getByText('Generating…'),
    ).toBeVisible();

    // Come back: the project reopens mid-job, still locked — the strip is
    // there before the job lands. Wait for the lock to appear before waiting
    // for it to clear: "no strip" is true while the project is still loading
    // too, and settling alone then reads a store with no score in it yet.
    await page.goto(projectUrl);
    await expect(page.getByText('Generating notes…')).toBeVisible({ timeout: 15_000 });
    await waitForGenerationSettled(page);
    const after = await readScoreSummary(page);
    expect(after).not.toBeNull();
    expect(after!.measureCount).toBe(8);

    expect(getErrors()).toEqual([]);
  });

  test('cancelling unlocks the editor and leaves the score untouched', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano melody in C major',
      measures: 8,
    });
    const before = await readScoreSummary(page);

    await startReplaceJob(page);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Unlocks immediately, not after the provider finally returns.
    await expect(page.getByText('Generating notes…')).toHaveCount(0);

    const after = await readScoreSummary(page);
    expect(after!.measureCount).toBe(before!.measureCount);
    expect(after!.notes).toEqual(before!.notes);

    expect(getErrors()).toEqual([]);
  });

  test('a generating project can be cancelled from the projects list', async ({ page }) => {
    const title = await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano melody in C major',
      measures: 8,
    });

    await startReplaceJob(page);
    await gotoDashboard(page);

    // Scoped to this test's own project: e2e files run in parallel against
    // one database, so another worker's project may also be generating.
    await page.getByRole('button', { name: `Cancel generation: ${title}` }).click();

    await expect(page.getByRole('button', { name: `Cancel generation: ${title}` })).toHaveCount(0);
  });
});

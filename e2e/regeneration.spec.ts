/**
 * Replacing a region: select measures, ask for a replacement, and confirm
 * only the selected measures change.
 *
 * There is no candidate list and no accept step any more — a job produces one
 * result and applies it server-side, so "done" is the editor unlocking with
 * different music in the selected measures.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  findMeasureGutterClickPoint,
  generateWholeScore,
  readScoreSummary,
  selectMeasuresByIndex,
  waitForGenerationSettled,
} from './helpers';

test.describe('region replacement', () => {
  test('selects a measure via a real click on its number in the gutter', async ({ page }) => {
    // The one place a genuine mouse gesture drives measure selection; the
    // workflow test below uses the store hook, because real click coordinates
    // depend on engraving details a workflow test should not hard-code.
    const getErrors = collectPageErrors(page);

    await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano melody in C major',
      measures: 8,
    });

    const point = await findMeasureGutterClickPoint(page, 2); // measure 3 (0-based)
    await page.mouse.click(point.x, point.y);

    await page.getByRole('tab', { name: 'Bar' }).click();
    await expect(page.getByRole('button', { name: 'Replace Bars' })).toBeEnabled();

    expect(getErrors()).toEqual([]);
  });

  test('replaces only the selected measures, as one server-side job', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano melody in C major',
      measures: 8,
    });

    const before = await readScoreSummary(page);
    expect(before).not.toBeNull();

    await selectMeasuresByIndex(page, [2, 3]);
    await page.getByRole('tab', { name: 'Bar' }).click();
    await page.getByRole('button', { name: 'Replace Bars' }).click();

    const dialog = page.getByRole('dialog', { name: 'Replace Bars' });
    await expect(dialog).toBeVisible();
    // States what it will overwrite before doing it.
    await expect(dialog.getByText(/Replaces \d+ notes?/)).toBeVisible();

    await page.getByLabel('Instruction', { exact: true }).fill('Make this more dramatic');
    await page.getByRole('button', { name: 'Replace', exact: true }).click();

    // The editor locks while the job owns the project.
    await expect(page.getByText('Generating notes…')).toBeVisible();
    await waitForGenerationSettled(page);

    const after = await readScoreSummary(page);
    expect(after).not.toBeNull();
    // Same shape, different music: the measure grid is preserved...
    expect(after!.measureCount).toBe(before!.measureCount);
    // ...but the selected measures genuinely changed. Asserting only the
    // measure count would pass even if nothing had been replaced at all.
    const m = before!.measures;
    const inRange = (tick: number): boolean =>
      tick >= m[2].startTick && tick < m[3].startTick + m[3].durationTicks;
    expect(after!.notes.filter((n) => inRange(n.startTick))).not.toEqual(
      before!.notes.filter((n) => inRange(n.startTick)),
    );
    expect(after!.notes.filter((n) => !inRange(n.startTick))).toEqual(
      before!.notes.filter((n) => !inRange(n.startTick)),
    );

    expect(getErrors()).toEqual([]);
  });

  test('offers no candidate list — one result is produced and applied', async ({ page }) => {
    await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano melody in C major',
      measures: 8,
    });

    await selectMeasuresByIndex(page, [1]);
    await page.getByRole('tab', { name: 'Bar' }).click();
    await page.getByRole('button', { name: 'Replace Bars' }).click();

    const dialog = page.getByRole('dialog', { name: 'Replace Bars' });
    await expect(dialog.getByLabel(/candidate/i)).toHaveCount(0);
  });
});

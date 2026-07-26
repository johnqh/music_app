/**
 * Spec §30 scenarios 7-10: select measures 3 and 4, request regeneration
 * alternatives, preview them, and accept one -- verifying only the
 * selected measures actually change (spec §37.9/10, §39 items 8-13).
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  createNewProject,
  findMeasureStaveClickPoint,
  generateWholeScore,
  gotoDashboard,
  readCandidates,
  readScoreSummary,
  selectMeasuresByIndex,
} from './helpers';

test.describe('region regeneration: preview and accept', () => {
  // Spec §30 scenario 7's actual click gesture, exercised for real: the
  // main regeneration-workflow test below drives measure selection through
  // the `__SCORESMITH_STORE__` hook instead (see `helpers.ts`'s module
  // doc for why -- real click coordinates depend on engraving details a
  // workflow test has no reason to hard-code). This test instead asserts
  // that a genuine `page.mouse.click` on a measure's own rendered stave
  // (found via real hit-testing, not guessed pixels) selects it, so
  // `ScoreEditorView`'s click-based measure hit-test path itself is
  // covered by a real browser gesture at least once.
  test('selects a measure via a real click on its rendered stave', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Measure Click');
    await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano melody in C major',
      measures: 8,
    });

    const point = await findMeasureStaveClickPoint(page, 2); // measure 3 (0-based index 2)
    await page.mouse.click(point.x, point.y);

    await expect(page.getByText('1 measure(s) selected')).toBeVisible();
    await expect(page.locator('[aria-label="Regeneration panel"]')).toBeVisible();

    expect(getErrors()).toEqual([]);
  });

  test('generates alternatives for measures 3-4, previews them, and accepts one', async ({
    page,
  }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page);
    await generateWholeScore(page, {
      prompt: 'Create a cinematic sixteen-measure theme in D minor',
      measures: 8,
    });

    const before = await readScoreSummary(page);
    expect(before).not.toBeNull();

    // Select measures 3 and 4 (0-based indices 2-3) -- spec §39 item 8.
    await selectMeasuresByIndex(page, [2, 3]);
    await expect(page.getByText('2 measure(s) selected')).toBeVisible();

    // The regeneration panel replaces the generation panel once a region is selected.
    const regenerationPanel = page.locator('[aria-label="Regeneration panel"]');
    await expect(regenerationPanel).toBeVisible();
    await expect(regenerationPanel.getByText(/Measures 3.4/)).toBeVisible();

    await page
      .getByLabel('Regeneration instruction')
      .fill('Make this section more dramatic while preserving the melody.');
    await page.getByRole('button', { name: 'Generate alternatives' }).click();

    // Three alternatives (spec §39 item 10).
    const candidateCards = page.locator('[role="group"][aria-label^="Candidate card:"]');
    await expect(candidateCards).toHaveCount(3, { timeout: 15_000 });

    const candidates = await readCandidates(page);
    expect(candidates).toHaveLength(3);

    // Preview each (spec §39 item 11): selecting a card's label button marks it active.
    for (const candidate of candidates) {
      const card = page.getByRole('group', { name: `Candidate card: ${candidate.label}` });
      await card.getByRole('button', { name: candidate.label, exact: true }).click();
      await expect(
        card.getByRole('button', { name: candidate.label, exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
    }

    // Accept the last-previewed candidate (spec §39 item 12).
    const acceptedLabel = candidates[candidates.length - 1].label;
    const acceptedCard = page.getByRole('group', { name: `Candidate card: ${acceptedLabel}` });
    await acceptedCard.getByRole('button', { name: `Accept ${acceptedLabel}` }).click();

    // Candidates are cleared once accepted.
    await expect(candidateCards).toHaveCount(0);

    // Regression coverage (Task 19 review finding I2): accepting a
    // candidate must not strand the selection on the measures it just
    // replaced -- the status bar should still report the same region
    // selected, the regeneration panel should still be showing it (not
    // fallen back to "nothing selected"), and regenerating that same,
    // now-live region again must work immediately, with no manual
    // reselect in between.
    await expect(page.getByText('2 measure(s) selected')).toBeVisible();
    await expect(regenerationPanel).toBeVisible();
    await expect(regenerationPanel.getByText(/Measures 3.4/)).toBeVisible();

    await page.getByLabel('Regeneration instruction').fill('Simplify this passage.');
    await page.getByRole('button', { name: 'Generate alternatives' }).click();
    await expect(candidateCards).toHaveCount(3, { timeout: 15_000 });

    // Reject this second round so the score below only reflects the first
    // accepted change.
    await page.getByRole('button', { name: 'Reject all' }).click();
    await expect(candidateCards).toHaveCount(0);

    // Only measures 3 and 4 changed (spec §39 item 13).
    const after = await readScoreSummary(page);
    expect(after).not.toBeNull();

    const m3 = before!.measures[2];
    const m4 = before!.measures[3];
    const inRegen = (tick: number): boolean =>
      tick >= m3.startTick && tick < m4.startTick + m4.durationTicks;

    const beforeOutside = before!.notes.filter((n) => !inRegen(n.startTick));
    const afterOutside = after!.notes.filter((n) => !inRegen(n.startTick));
    expect(afterOutside).toEqual(beforeOutside);

    const beforeInside = before!.notes.filter((n) => inRegen(n.startTick));
    const afterInside = after!.notes.filter((n) => inRegen(n.startTick));
    expect(afterInside).not.toEqual(beforeInside);

    expect(getErrors()).toEqual([]);
  });
});

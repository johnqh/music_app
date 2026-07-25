/**
 * Spec §30 scenarios 7-10: select measures 3 and 4, request regeneration
 * alternatives, preview them, and accept one -- verifying only the
 * selected measures actually change (spec §37.9/10, §39 items 8-13).
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  gotoDashboard,
  readCandidates,
  readScoreSummary,
  selectMeasuresByIndex,
} from './helpers';

test.describe('region regeneration: preview and accept', () => {
  test('generates alternatives for measures 3-4, previews them, and accepts one', async ({ page }) => {
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
      await expect(card.getByRole('button', { name: candidate.label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }

    // Accept the last-previewed candidate (spec §39 item 12).
    const acceptedLabel = candidates[candidates.length - 1].label;
    const acceptedCard = page.getByRole('group', { name: `Candidate card: ${acceptedLabel}` });
    await acceptedCard.getByRole('button', { name: `Accept ${acceptedLabel}` }).click();

    // Candidates are cleared once accepted.
    await expect(candidateCards).toHaveCount(0);

    // Only measures 3 and 4 changed (spec §39 item 13).
    const after = await readScoreSummary(page);
    expect(after).not.toBeNull();

    const m3 = before!.measures[2];
    const m4 = before!.measures[3];
    const inRegen = (tick: number): boolean => tick >= m3.startTick && tick < m4.startTick + m4.durationTicks;

    const beforeOutside = before!.notes.filter((n) => !inRegen(n.startTick));
    const afterOutside = after!.notes.filter((n) => !inRegen(n.startTick));
    expect(afterOutside).toEqual(beforeOutside);

    const beforeInside = before!.notes.filter((n) => inRegen(n.startTick));
    const afterInside = after!.notes.filter((n) => inRegen(n.startTick));
    expect(afterInside).not.toEqual(beforeInside);

    expect(getErrors()).toEqual([]);
  });
});

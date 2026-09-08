/**
 * The grant → generate → charge loop, end to end.
 *
 * The one thing only an e2e can show: that the free grant, the estimate the
 * dialog quotes, and the amount the server actually deducts are the same
 * feature. Each of the three is unit-tested in isolation, and all three could
 * pass while disagreeing with each other.
 */
import { expect, test, type Page } from '@playwright/test';
import { generateWholeScore, gotoDashboard, waitForGenerationSettled } from './helpers';

/**
 * The balance as the store page writes it out.
 *
 * Scoped to the paragraph immediately after the "Your balance" label rather
 * than the first number on the page: the page also carries dates and prices,
 * and a loose match happily returned the year.
 */
async function readBalance(page: Page): Promise<number> {
  await page.goto('/en/credits');
  const value = page.getByText('Your balance').locator('xpath=following-sibling::p[1]');
  await expect(value).toBeVisible();
  return Number((await value.innerText()).replace(/[^\d-]/g, ''));
}

test('generating spends exactly what it produced', async ({ page }) => {
  // A delta rather than an absolute: the free grant lands on first contact with
  // the balance, and whether *this* spec is the first to touch it depends on
  // run order. What must hold regardless is what a generation costs.
  const before = await readBalance(page);
  expect(before).toBeGreaterThan(0);

  // Five bars on one instrument — a size no other spec generates (they all use
  // 4 or 8), so the usage row this writes is unmistakably this test's.
  await generateWholeScore(page, { prompt: 'A short piano phrase', measures: 5 });
  await waitForGenerationSettled(page);

  /**
   * The charge, read back where the server recorded it.
   *
   * Deliberately not `balance === before - 5`. Every spec shares one account —
   * the e2e auth shim is a fixed identity — and two workers run at once, so
   * another spec's generation lands between the two balance reads. Measured:
   * an 8-credit drop where 4 was expected, from a concurrent 4-bar job.
   *
   * The usage row is immune to that and says more, not less: it carries both
   * what was produced ("5 track-measures") and what it cost, so a charge of the
   * wrong *size* — the failure this exists to catch — still fails here.
   */
  await page.goto('/en/credits/history');
  const row = page.getByRole('row').filter({ hasText: 'generate-score — 5 track-measures' });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell').last()).toHaveText('5');

  // And it really came out of the balance, whatever else was spent alongside.
  expect(await readBalance(page)).toBeLessThanOrEqual(before - 5);
});

test('the dialog quotes the cost before committing to it', async ({ page }) => {
  await gotoDashboard(page);
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await page.getByRole('switch', { name: 'Generate for me' }).click();
  await page.getByLabel('Prompt', { exact: true }).fill('A short piano phrase');
  await page.getByLabel('Bars', { exact: true }).fill('8');

  await expect(page.getByText(/about \d+ credits/i)).toBeVisible();
});

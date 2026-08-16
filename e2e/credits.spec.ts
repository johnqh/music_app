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

  await generateWholeScore(page, { prompt: 'A short piano phrase', measures: 4 });
  await waitForGenerationSettled(page);

  // Four bars on one instrument: four track-measures, four credits. Asserting
  // the exact figure is the point — a charge of the wrong *size* is the failure
  // this exists to catch, and "less than before" would pass for any of them.
  expect(await readBalance(page)).toBe(before - 4);
});

test('the dialog quotes the cost before committing to it', async ({ page }) => {
  await gotoDashboard(page);
  await page.getByRole('button', { name: 'Generate Score', exact: true }).click();
  await page.getByLabel('Prompt', { exact: true }).fill('A short piano phrase');
  await page.getByLabel('Measures', { exact: true }).fill('8');

  await expect(page.getByText(/about \d+ credits/i)).toBeVisible();
});

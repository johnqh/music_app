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

  await page.getByLabel('Export menu').click();
  await page.getByRole('menuitem', { name: 'Print…' }).click();
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

    await expect(page.getByText(/not yet an orchestral part/i)).toBeVisible();
    const partSystems = await page.locator('[data-testid^="print-system-"]').count();
    expect(partSystems).toBeLessThanOrEqual(scoreSystems);
  });
});

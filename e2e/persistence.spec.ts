/**
 * Spec §30 scenario 13 / spec §39 item 24: save a project and reopen it,
 * both via a hard page reload at the same URL and via navigating back to
 * the dashboard and reopening it from the project grid.
 */
import { expect, test } from '@playwright/test';
import { collectPageErrors, createNewProject, generateWholeScore, gotoDashboard, readScoreSummary } from './helpers';

test.describe('project persistence: save and reopen', () => {
  test('saves a project and reopens it with the score intact', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Persistence Check');
    await generateWholeScore(page, {
      prompt: 'Create a calm ambient piano piece',
      measures: 8,
    });

    const before = await readScoreSummary(page);
    expect(before).not.toBeNull();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[aria-label="Save state: Saved"]')).toBeVisible({ timeout: 10_000 });

    const projectUrl = page.url();

    // Reopen via a hard reload at the same URL.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit project title' })).toHaveText('Persistence Check');
    await expect
      .poll(async () => (await readScoreSummary(page))?.notes.length ?? 0, { timeout: 10_000 })
      .toBe(before!.notes.length);
    const afterReload = await readScoreSummary(page);
    expect(afterReload).toEqual(before);

    // Reopen via the dashboard's project grid.
    await page.getByRole('button', { name: 'Back to dashboard' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Open project: Persistence Check' })).toBeVisible();

    await page.getByRole('button', { name: 'Open project: Persistence Check' }).click();
    await expect(page).toHaveURL(projectUrl);
    await expect
      .poll(async () => (await readScoreSummary(page))?.notes.length ?? 0, { timeout: 10_000 })
      .toBe(before!.notes.length);
    const afterReopen = await readScoreSummary(page);
    expect(afterReopen).toEqual(before);

    expect(getErrors()).toEqual([]);
  });
});

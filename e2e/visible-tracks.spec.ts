/**
 * The visible-tracks round trip.
 *
 * Every layer below this is unit-tested against a fake, and the failure this
 * feature is actually exposed to — a field lost somewhere between the browser
 * and Postgres — is invisible to all of them. Only the round trip catches it,
 * and it very nearly happened: `music_api` validated request bodies against a
 * schema that stripped unknown keys, so `visibleTrackIds` would have been
 * silently discarded on its way to the database while every other test passed.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  gotoDashboard,
  waitForNotation,
} from './helpers';

test.describe('visible tracks', () => {
  test('a hidden track stays hidden across a reload', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Visible Tracks Check');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 8 });
    await waitForNotation(page);

    // A second track, so there is something that can be hidden while leaving
    // one visible — the control does not appear below two tracks.
    await page.getByRole('button', { name: 'Add track' }).click();
    await expect(page.getByRole('region', { name: 'Track editor' })).toBeVisible();

    const control = page.getByLabel('Visible tracks');
    await expect(control).toBeVisible();

    // Hide the second track.
    await control.click();
    const boxes = page.getByRole('checkbox', { name: /^Show / });
    await expect(boxes).toHaveCount(2);
    await boxes.nth(1).uncheck();
    await page.keyboard.press('Escape');

    // The notation must actually lose it, not merely record the preference.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          type Handle = { result: { plan: { tracks: Array<{ id: string }> } } | null };
          return (window as unknown as { __scoresmith?: Handle }).__scoresmith?.result?.plan.tracks
            .length;
        }),
      )
      .toBe(1);

    // Wait for the choice to reach the server before reloading, or the
    // assertion races the autosave rather than testing persistence.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[aria-label="Save state: Saved"]')).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await waitForNotation(page);

    await page.getByLabel('Visible tracks').click();
    const afterReload = page.getByRole('checkbox', { name: /^Show / });
    await expect(afterReload).toHaveCount(2);
    await expect(afterReload.nth(1)).not.toBeChecked();
    await expect(afterReload.nth(0)).toBeChecked();

    expect(getErrors()).toEqual([]);
  });
});

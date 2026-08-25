/**
 * The documentation is reachable and navigable without an account.
 *
 * It is public on purpose — someone deciding whether to sign up has to be able
 * to read what the app does — so this deliberately never signs in.
 */
import { expect, test } from '@playwright/test';

test.describe('documentation', () => {
  test('opens from the top bar and navigates between topics', async ({ page }) => {
    await page.goto('/en');

    await page.getByRole('link', { name: 'Docs', exact: true }).first().click();
    await expect(page).toHaveURL(/\/en\/docs\/getting-started$/);

    // The master list is present and the detail follows it.
    const nav = page.getByRole('navigation', { name: 'Documentation topics' });
    await expect(nav.getByRole('link', { name: 'Instruments' })).toBeVisible();

    await nav.getByRole('link', { name: 'Instruments' }).click();
    await expect(page).toHaveURL(/\/en\/docs\/instruments$/);
    await expect(page.getByRole('heading', { name: 'Instruments' })).toBeVisible();
  });

  test('generates the instrument table from the catalogue', async ({ page }) => {
    await page.goto('/en/docs/instruments');

    // 128 programs plus a header row, straight from the data.
    await expect(page.getByRole('row')).toHaveCount(129);

    const search = page.getByLabel('Search by name, family or program number');
    await search.fill('trumpet');
    await expect(page.getByText('Muted Trumpet')).toBeVisible();
    // General MIDI has exactly two trumpets: 56 open and 59 muted.
    await expect(page.getByRole('row')).toHaveCount(3); // header + both
  });

  test('a deep link into one topic works on its own', async ({ page }) => {
    await page.goto('/en/docs/shortcuts');
    await expect(page.getByText('Shift+F')).toBeVisible();
  });
});

test.describe('documentation from the editor', () => {
  test('the editor links to the docs in a new tab', async ({ page }) => {
    // The editor hides the top bar, so this is the only way to the docs from
    // inside a score — and it must not navigate away from the open project.
    await page.goto('/en');
    await page.getByRole('link', { name: 'Projects' }).first().click();
    await page.getByRole('button', { name: 'New Project' }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/project\//);

    const link = page.getByRole('link', {
      name: 'Open the documentation in a new tab',
    });
    await expect(link).toHaveAttribute('target', '_blank');
    // Without `rel` the opened page keeps a live handle on this one.
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('href', '/en/docs');

    // The project is still open: the link opened a tab, it did not navigate.
    await expect(page).toHaveURL(/\/project\//);
  });
});

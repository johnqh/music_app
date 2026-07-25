import { expect, test } from '@playwright/test';

test('renders the home page hero', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Compose with AI, refine by hand' })
  ).toBeVisible();
});

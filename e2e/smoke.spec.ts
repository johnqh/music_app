import { expect, test } from '@playwright/test';

test('renders the ScoreSmith app bar title', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ScoreSmith' })).toBeVisible();
});

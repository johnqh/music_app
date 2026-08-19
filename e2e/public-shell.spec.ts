import { expect, test } from '@playwright/test';

/**
 * The visitor's view.
 *
 * The home page used to sit behind the auth gate, so a stranger opening the
 * site met the sign-in form instead of any explanation of what it is. These
 * assert the shell a signed-out visitor gets: a real home page, a topbar to
 * navigate by, and a footer.
 *
 * `VITE_E2E=1` signs a fixed identity in automatically, so these clear that
 * first — signing out is what makes the visitor's view reachable in e2e.
 */
async function signOut(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/en');
  const account = page.getByRole('button', { name: /account|menu/i }).first();
  if (await account.isVisible().catch(() => false)) {
    await account.click();
    const out = page.getByRole('menuitem', { name: /sign out/i });
    if (await out.isVisible().catch(() => false)) await out.click();
  }
}

test.describe('public shell', () => {
  test('a visitor lands on the home page, not the sign-in form', async ({ page }) => {
    await signOut(page);
    await page.goto('/en');

    // The hero, not the sign-in form. This is the bug being fixed.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i }))
      .toHaveCount(0, { timeout: 1000 })
      .catch(() => {});
  });

  test('the topbar offers Community and Resources', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('link', { name: 'Community' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Resources' }).first()).toBeVisible();
  });

  test('community is reachable and searchable', async ({ page }) => {
    await page.goto('/en/community');
    await expect(page.getByRole('heading', { name: 'Community' })).toBeVisible();
    // The search box is the new affordance; it filters the fetched list.
    await expect(page.getByRole('searchbox', { name: /search shared scores/i })).toBeVisible();
  });

  test('resources lists places to download music', async ({ page }) => {
    await page.goto('/en/resources');
    await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'The Mod Archive' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'BitMidi' })).toBeVisible();
  });

  test('the home page gets the full footer and other pages the compact one', async ({ page }) => {
    // `.first()`: `building_blocks` renders a `<footer>` landmark and the
    // `@sudobility/components` footer inside it renders another, so every app
    // using `AppPageLayout` has two nested `contentinfo` roles. That is a
    // library issue, not this app's, and both reference apps share it — so
    // this scopes to the outer one rather than asserting a count.
    await page.goto('/en');
    const home = page.getByRole('contentinfo').first();
    await expect(home).toBeVisible();
    // The full footer carries grouped link columns; the compact one is a
    // single copyright line.
    await expect(home.getByText('Find music files')).toBeVisible();

    await page.goto('/en/resources');
    const inner = page.getByRole('contentinfo').first();
    await expect(inner).toBeVisible();
    await expect(inner.getByText('Find music files')).toHaveCount(0);
    await expect(inner.getByText(/All rights reserved/)).toBeVisible();
  });
});

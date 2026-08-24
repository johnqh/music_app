import { expect, test } from '@playwright/test';
import { createNewProject, generateWholeScore, gotoDashboard, waitForNotation } from './helpers';

test.describe('publishing', () => {
  test('a published snapshot opens for somebody with no account', async ({ page, browser }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Publish Test');
    await generateWholeScore(page, { prompt: 'Create a calm study', measures: 4 });
    await waitForNotation(page);

    await page.getByLabel('Project menu').click();
    await page.getByRole('menuitem', { name: 'Create snapshot…' }).click();
    await page.getByRole('checkbox', { name: 'Publish' }).check();
    await page.getByLabel('Publisher name').fill('Jane');
    // The suggested public title is the project and snapshot names; take it as
    // offered, so the assertion below also pins the default.
    await expect(page.getByLabel('Public name')).toHaveValue('Publish Test Version 1');
    await page.getByLabel(/full copyright/i).check();
    await page.getByRole('button', { name: 'Create snapshot' }).click();
    // The overlay intercepts clicks until it is gone — this cost the snapshots
    // e2e two debugging rounds.
    await expect(page.getByLabel('Snapshot name')).toBeHidden();

    const toast = page.getByText(/^Published: /);
    await expect(toast).toBeVisible();
    const url = (await toast.textContent())!.replace('Published: ', '').trim();
    expect(url).toContain('/p/pub_');

    // A brand-new context has no storage state, so no session at all — the
    // only way to actually prove the page is public.
    const anon = await browser.newContext();
    const visitor = await anon.newPage();
    await visitor.goto(url);

    await expect(visitor.getByText('Jane')).toBeVisible();
    // The public page is titled by the public name, not by "Version 1".
    await expect(visitor.getByText('Publish Test Version 1')).toBeVisible();
    await expect(visitor.getByRole('button', { name: /play/i })).toBeVisible();
    await expect(visitor.getByRole('button', { name: /share/i })).toBeVisible();

    // View and play only.
    for (const name of [/export/i, /import/i, /print/i]) {
      expect(await visitor.getByRole('button', { name }).count()).toBe(0);
    }

    // And Community lists it, also signed out.
    await visitor.goto(url.replace(/\/p\/.*$/, '/community'));
    await expect(visitor.getByRole('heading', { name: /community/i })).toBeVisible();
    // .first(): the shared test database accumulates published rows, so this
    // deliberately asserts "at least one", not "exactly one".
    await expect(visitor.getByText(/by Jane/).first()).toBeVisible();

    await anon.close();
  });
});

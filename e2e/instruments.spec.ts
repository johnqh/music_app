/**
 * Instrument selection: the picker offers the full General MIDI catalogue, and
 * choosing one is reflected in the piano keyboard's header.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  gotoDashboard,
  waitForNotation,
} from './helpers';

test.describe('instrument selection', () => {
  test('picks an instrument and the keyboard header follows', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Instruments Check');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 4 });
    await waitForNotation(page);

    // The picker is labelled per track; the score has one.
    const picker = page.getByLabel(/^Instrument: /).first();
    await expect(picker).toBeVisible();
    await picker.click();

    // All 128 GM programs, grouped by family.
    await expect(page.getByRole('option')).toHaveCount(128);
    await page.getByRole('option', { name: 'Trumpet', exact: true }).click();

    // The keyboard names the active track's instrument, not "Piano".
    await expect(page.getByRole('img', { name: /Piano keyboard/ })).toBeVisible();
    await expect(page.getByText('Trumpet', { exact: false }).first()).toBeVisible();

    expect(getErrors()).toEqual([]);
  });
});

test.describe('track gutter and editor', () => {
  test('clicking a track in the canvas gutter makes it active', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Gutter Check');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 8 });
    await waitForNotation(page);

    // A second track, so "which track is active" is a real question.
    await page.getByRole('button', { name: 'Add track' }).click();
    const editor = page.getByRole('region', { name: 'Track editor' });
    await expect(editor).toBeVisible();

    // The gutter is drawn in the canvas, so target it by geometry: the second
    // track's stave band, inside the reserved left column.
    const point = await page.evaluate(() => {
      const h = (window as any).__scoresmith;
      const scroll = h.scrollBox;
      const rect = scroll.getBoundingClientRect();
      const plan = h.result.plan;
      const box = plan.trackLayouts[1].measures[0].box;
      return { x: rect.left + 20, y: rect.top + box.y + box.height / 2 - scroll.scrollTop };
    });
    await page.mouse.click(point.x, point.y);

    // The editor follows the active track.
    await expect(editor.getByLabel(/^Track name: /)).toHaveValue('New track');

    expect(getErrors()).toEqual([]);
  });
});

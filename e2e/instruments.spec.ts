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

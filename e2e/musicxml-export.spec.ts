/**
 * Spec §30 scenario 14: export MusicXML and verify the downloaded file is
 * well-formed MusicXML for the current score. Also exercises the
 * MusicXML import dialog on that same exported file (adapter round-trip,
 * spec §17), reusing the MIDI round-trip spec's "export from the app,
 * import the exact file back in" pattern instead of a committed fixture.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { collectPageErrors, createNewProject, generateWholeScore, gotoDashboard, readScoreSummary } from './helpers';

test.describe('MusicXML export', () => {
  test('exports a well-formed MusicXML file for the current score', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'MusicXML Export');
    await generateWholeScore(page, {
      prompt: 'Create a playful waltz in 3/4 time',
      measures: 8,
    });

    const original = await readScoreSummary(page);
    expect(original).not.toBeNull();

    await page.getByRole('button', { name: 'Export menu' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'MusicXML' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.musicxml$/);

    const xmlPath = await download.path();
    expect(xmlPath).toBeTruthy();
    const xml = await readFile(xmlPath!, 'utf-8');
    expect(xml).toContain('<score-partwise');
    expect(xml).toContain('</score-partwise>');
    expect(xml).toContain('<part-list>');

    // Round-trip it back in through the import dialog (spec §17).
    await page.getByRole('button', { name: 'Back to dashboard' }).click();
    await expect(page).toHaveURL(/\/en\/projects$/);

    await page.getByRole('button', { name: 'Import MusicXML' }).click();
    await page.getByLabel('MusicXML file input').setInputFiles(xmlPath!);

    const importButton = page.getByRole('button', { name: 'Import', exact: true });
    await expect(importButton).toBeEnabled();
    await importButton.click();

    await expect(page).toHaveURL(/\/project\//, { timeout: 15_000 });
    const imported = await readScoreSummary(page);
    expect(imported).not.toBeNull();
    expect(imported!.notes.length).toBe(original!.notes.length);

    expect(getErrors()).toEqual([]);
  });
});

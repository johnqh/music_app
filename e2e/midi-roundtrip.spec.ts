/**
 * Spec §30 scenarios 11-12: export MIDI, then import that exact file back
 * in through the import wizard (spec §39 items 20-22: "resulting notes and
 * timing are substantially equivalent"). The fixture is generated at test
 * time by round-tripping through the app itself, rather than committing a
 * binary `.mid` file to the repo.
 */
import { expect, test } from '@playwright/test';
import { collectPageErrors, createNewProject, generateWholeScore, gotoDashboard, readScoreSummary } from './helpers';

test.describe('MIDI export and import round-trip', () => {
  test('exports a MIDI file and re-imports it into a new project with substantially equivalent notes', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'MIDI Round Trip');
    await generateWholeScore(page, {
      prompt: 'Create a jazz-inspired progression with a walking bass',
      measures: 8,
    });

    const original = await readScoreSummary(page);
    expect(original).not.toBeNull();
    expect(original!.notes.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Export menu' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'MIDI' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.mid$/);
    const midiPath = await download.path();
    expect(midiPath).toBeTruthy();

    // Import that exact file back in as a brand-new project, from the dashboard.
    await page.getByRole('button', { name: 'Back to dashboard' }).click();
    await expect(page).toHaveURL(/\/en\/projects$/);

    await page.getByRole('button', { name: 'Import MIDI' }).click();
    await page.getByLabel('MIDI file input').setInputFiles(midiPath!);

    await expect(page.getByRole('table', { name: 'MIDI track summary' })).toBeVisible();
    const importButton = page.getByRole('button', { name: 'Import', exact: true });
    await expect(importButton).toBeEnabled();
    await importButton.click();

    await expect(page).toHaveURL(/\/project\//, { timeout: 15_000 });

    const imported = await readScoreSummary(page);
    expect(imported).not.toBeNull();

    // "Substantially equivalent" (spec §39 item 22): same note count, and
    // the same sequence of pitches in the same order. MIDI import can
    // slightly perturb tick-level timing (quantization/rounding), which is
    // exactly why this doesn't assert exact tick equality.
    expect(imported!.notes.length).toBe(original!.notes.length);
    expect(imported!.notes.map((n) => `${n.pitch.step}${n.pitch.accidental}${n.pitch.octave}`)).toEqual(
      original!.notes.map((n) => `${n.pitch.step}${n.pitch.accidental}${n.pitch.octave}`),
    );

    expect(getErrors()).toEqual([]);
  });
});

/**
 * Spec §30 scenarios 4-6: select a note, change its pitch, then undo/redo
 * the change.
 */
import { expect, test } from '@playwright/test';
import {
  clickNoteGroup,
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  getNoteGroups,
  gotoDashboard,
  readScoreSummary,
} from './helpers';

test.describe('note selection, editing, and undo/redo', () => {
  test('selects a note, changes its pitch, and undoes/redoes the change', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    /** How the browser encoded each save it actually made. */
    const saveEncodings: (string | undefined)[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes('/api/v1/projects/')) {
        saveEncodings.push(request.headers()['content-encoding']);
      }
    });

    await gotoDashboard(page);
    await createNewProject(page);
    await generateWholeScore(page, {
      prompt: 'Create a simple beginner melody using quarter and half notes',
      measures: 4,
    });

    // Select a note (spec §39 item 14's setup / scenario 4).
    const groups = await getNoteGroups(page);
    expect(groups.length).toBeGreaterThan(0);
    await clickNoteGroup(page, groups[0]);

    await expect(page.getByText('1 note selected')).toBeVisible();

    const before = await readScoreSummary(page);
    expect(before).not.toBeNull();
    const beforePitch = before!.notes[0].pitch;

    // Change pitch via the inspector (scenario 5). Library sweep 1: the
    // native <select> becomes @sudobility/components' Radix-backed
    // Select -- its trigger is a <button role="combobox">, not a real
    // <select>, so `selectOption`/`toHaveValue` no longer apply. Open it
    // and click the resulting role="option" instead, and assert the
    // closed trigger's own rendered text (`toHaveText`, an exact match --
    // it only ever shows the selected item, unlike a native select's
    // textContent, which concatenates every option).
    const pitchStepSelect = page.getByRole('combobox', { name: 'Pitch step' });
    await expect(pitchStepSelect).toBeVisible();
    const nextStep = beforePitch.step === 'C' ? 'D' : 'C';
    await pitchStepSelect.click();
    await page.getByRole('option', { name: nextStep }).click();

    await expect(pitchStepSelect).toHaveText(nextStep);

    const afterChange = await readScoreSummary(page);
    expect(afterChange!.notes[0].pitch.step).toBe(nextStep);
    expect(afterChange!.notes[0].pitch.step).not.toBe(beforePitch.step);

    // Undo reverts the pitch change (scenario 6 / spec §39 item 15).
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(pitchStepSelect).toHaveText(beforePitch.step);
    const afterUndo = await readScoreSummary(page);
    expect(afterUndo!.notes[0].pitch.step).toBe(beforePitch.step);

    // Redo re-applies it (spec §39 item 15).
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(pitchStepSelect).toHaveText(nextStep);
    const afterRedo = await readScoreSummary(page);
    expect(afterRedo!.notes[0].pitch.step).toBe(nextStep);

    // The autosave that follows an edit carries the whole score, and carries
    // it gzipped. Only a real browser against the real server shows both
    // halves at once: a unit test proves the client compresses and the API's
    // own tests prove it decompresses, but neither sees Chromium's
    // willingness to send `Content-Encoding` or the preflight it provokes.
    // The save reaching "Saved" is the proof the server understood it.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[aria-label="Save state: Saved"]')).toBeVisible({ timeout: 10_000 });
    expect(saveEncodings.length).toBeGreaterThan(0);
    expect(saveEncodings).toContain('gzip');

    expect(getErrors()).toEqual([]);
  });
});

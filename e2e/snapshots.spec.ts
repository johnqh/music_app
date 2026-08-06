import { expect, test } from '@playwright/test';
import {
  clickNoteGroup,
  createNewProject,
  generateWholeScore,
  getNoteGroups,
  gotoDashboard,
  readScoreSummary,
  waitForNotation,
} from './helpers';

test.describe('snapshots', () => {
  test('a snapshot survives later edits, and opening it restores them', async ({ page }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Snapshot Test');
    await generateWholeScore(page, { prompt: 'Create a calm study', measures: 4 });
    await waitForNotation(page);

    const before = await readScoreSummary(page);
    expect(before!.notes.length).toBeGreaterThan(0);

    await page.getByLabel('Project menu').click();
    await page.getByRole('menuitem', { name: 'Create snapshot…' }).click();
    await expect(page.getByLabel('Snapshot name')).toHaveValue('Version 1');
    await page.getByRole('button', { name: 'Create snapshot' }).click();
    // Wait for the dialog to actually go: its overlay intercepts clicks on the
    // canvas underneath, which made the note click below silently miss.
    await expect(page.getByLabel('Snapshot name')).toBeHidden();

    // Change the music, so restoring it is observable. Pitch via the
    // inspector, as select-edit-undo.spec.ts does — it is the reliable edit
    // path in this suite, and it proves the snapshot restores *content*
    // rather than merely a note count.
    const groups = await getNoteGroups(page);
    await clickNoteGroup(page, groups[0]);
    await expect(page.getByText('1 note(s) selected')).toBeVisible();

    // Track the edited note by **id**, not by position: opening a snapshot
    // replaces the whole score, and nothing guarantees the summary lists notes
    // in the same order afterwards.
    const editedId = before!.notes[0].id;
    const stepOf = async (id: string) =>
      (await readScoreSummary(page))?.notes.find((n) => n.id === id)?.pitch.step ?? null;

    const beforeStep = before!.notes[0].pitch.step;
    const nextStep = beforeStep === 'C' ? 'D' : 'C';
    await page.getByRole('combobox', { name: 'Pitch step' }).click();
    await page.getByRole('option', { name: nextStep, exact: true }).click();

    await expect.poll(async () => stepOf(editedId)).toBe(nextStep);

    await page.getByLabel('Project menu').click();
    await page.getByRole('menuitem', { name: 'Open snapshot…' }).click();
    await expect(page.getByText(/current work will be replaced/i)).toBeVisible();
    await page.getByRole('button', { name: 'Version 1' }).click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();

    // The snapshot never changed, so the original pitch is back — and the note
    // keeps its id through the round trip, because a snapshot is a full copy.
    await expect.poll(async () => stepOf(editedId)).toBe(beforeStep);
  });
});

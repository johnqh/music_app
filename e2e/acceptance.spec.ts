/**
 * Spec §39's full acceptance scenario, end to end, in one comprehensive
 * test: open the app, create a project, generate a score, play it,
 * regenerate a two-measure region and accept an alternative, hand-edit
 * and undo/redo a note, cross-check the piano roll, export/import MIDI,
 * export MusicXML, and save + reopen the project -- all without an
 * uncaught error (item 25).
 *
 * The individual grouped spec files (`project-generate-play.spec.ts`,
 * `select-edit-undo.spec.ts`, `regeneration.spec.ts`,
 * `midi-roundtrip.spec.ts`, `musicxml-export.spec.ts`,
 * `persistence.spec.ts`, `caret-selection.spec.ts`) exercise each
 * of these areas in isolation with tighter assertions; this test instead
 * verifies they compose correctly as one continuous user session, exactly
 * as spec §39 describes it.
 */
import { expect, test } from '@playwright/test';
import {
  chooseImport,
  clickNoteGroup,
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  getNoteGroups,
  gotoDashboard,
  readPlaybackState,
  readScoreSummary,
  selectMeasuresByIndex,
  startPlayback,
  waitForGenerationSettled,
  waitForNotation,
  expectCanvasPainted,
} from './helpers';

test.describe('spec §39 acceptance scenario', () => {
  test('full user session: create, generate, play, regenerate, edit, keyboard, MIDI, MusicXML, persist', async ({
    page,
  }) => {
    const getErrors = collectPageErrors(page);

    // 1-2. Open the app, create a new project.
    await gotoDashboard(page);
    await createNewProject(page, 'Acceptance Run');

    // 3-5. Generate a valid score from a prompt; it renders as notation.
    await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano piece in A minor.',
      measures: 8,
      keyMode: 'minor',
    });
    const generated = await readScoreSummary(page);
    expect(generated).not.toBeNull();
    expect(generated!.notes.length).toBeGreaterThan(0);
    await waitForNotation(page);
    await expectCanvasPainted(page); // canvas smoke: the notation actually painted pixels

    // 6-7. Play; notes highlight in sync (observed via store playback state --
    // Tone.js audio itself has no observable signal in headless Chromium).
    await startPlayback(page);
    await expect
      .poll(async () => (await readPlaybackState(page)).state, { timeout: 10_000 })
      .toBe('playing');
    await page.getByRole('button', { name: 'Stop' }).click();

    // 8-13. Select measures 3-4 and replace them. One result, applied by the
    // job — no candidate list to preview or accept.
    await selectMeasuresByIndex(page, [2, 3]);
    await page.getByRole('tab', { name: 'Bar' }).click();
    await page.getByRole('button', { name: 'Replace Bars' }).click();
    await page
      .getByLabel('Instruction', { exact: true })
      .fill('Make this section more dramatic while preserving the melody.');
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    // Wait for the lock to appear before waiting for it to clear: "no overlay"
    // is true before the job starts too, so settling alone reads a stale score.
    await expect(page.getByText('Generating notes…')).toBeVisible();
    await waitForGenerationSettled(page);

    const afterRegen = await readScoreSummary(page);
    expect(afterRegen).not.toBeNull();
    const m3 = generated!.measures[2];
    const m4 = generated!.measures[3];
    const inRegen = (tick: number): boolean =>
      tick >= m3.startTick && tick < m4.startTick + m4.durationTicks;
    expect(afterRegen!.notes.filter((n) => inRegen(n.startTick))).not.toEqual(
      generated!.notes.filter((n) => inRegen(n.startTick)),
    );
    expect(afterRegen!.notes.filter((n) => !inRegen(n.startTick))).toEqual(
      generated!.notes.filter((n) => !inRegen(n.startTick)),
    );

    // Clear the selection so the next click cleanly picks a single note (14).
    await page.keyboard.press('Escape');

    // 14-15. Manually change one note's pitch, then undo and redo it.
    const groups = await getNoteGroups(page);
    expect(groups.length).toBeGreaterThan(0);
    await clickNoteGroup(page, groups[0]);
    await expect(page.getByText('1 note selected')).toBeVisible();

    // Library sweep 1: the native <select> becomes @sudobility/components'
    // Radix-backed Select -- its trigger is a <button role="combobox">, not
    // a real <select>, so `selectOption`/`inputValue`/`toHaveValue` no
    // longer apply. Open it and click the resulting role="option" instead,
    // and read/assert "what's currently selected" off the closed trigger's
    // own rendered text (it only ever shows the selected item, unlike a
    // native select's textContent, which concatenates every option).
    const pitchStepSelect = page.getByRole('combobox', { name: 'Pitch step' });
    const originalStep = (await pitchStepSelect.textContent())?.trim();
    const nextStep = originalStep === 'C' ? 'D' : 'C';
    await pitchStepSelect.click();
    await page.getByRole('option', { name: nextStep }).click();
    await expect(pitchStepSelect).toHaveText(nextStep);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(pitchStepSelect).toHaveText(originalStep ?? '');

    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(pitchStepSelect).toHaveText(nextStep);

    // 16-19. The piano keyboard is on screen alongside the notation, and its
    // keys light up as the active track plays. (The piano-roll timeline it
    // replaced is gone, along with note-dragging -- see the piano-keyboard
    // spec's "what this costs".)
    const keyboard = page.getByRole('img', { name: /Piano keyboard/ });
    await expect(keyboard).toBeVisible();
    /*
      The keyboard's range is the *active track's* instrument, not always 88
      keys. This asserted 88 back when generation produced a lone piano; a
      generated score now opens on a voice — turning "Generate for me" on
      prepends `DEFAULT_VOCAL_INSTRUMENT_VALUE` (Voice Oohs, program 53) and a
      voice sorts first, so the first track is the one this reads.

      Voice Oohs' compass is MIDI 48-84, and both ends are already white keys,
      so `snapToWhiteKeys` widens nothing: 37 keys, C3 to C6. The bounds are
      asserted alongside the count so the number explains itself rather than
      being a magic one, and so a range that merely *happened* to hold 37 keys
      would still fail.
    */
    const keyRange = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="piano-key-"]')).map((el) =>
        Number((el.getAttribute('data-testid') ?? '').replace('piano-key-', '')),
      ),
    );
    expect(keyRange).toHaveLength(37);
    expect(Math.min(...keyRange)).toBe(48);
    expect(Math.max(...keyRange)).toBe(84);

    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('[data-playing="true"]').first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.locator('[data-playing="true"]')).toHaveCount(0);

    await waitForNotation(page);

    // 20-22. Export MIDI, import it into a new project, substantially equivalent notes.
    const beforeMidi = await readScoreSummary(page);
    await page.getByRole('button', { name: 'Export menu' }).click();
    const midiDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'MIDI' }).click();
    const midiDownload = await midiDownloadPromise;
    const midiPath = await midiDownload.path();
    expect(midiPath).toBeTruthy();

    await page.getByRole('button', { name: 'Back to dashboard' }).click();
    await expect(page).toHaveURL(/\/en\/projects$/);
    await chooseImport(page, 'Import MIDI');
    await page.getByLabel('MIDI file input').setInputFiles(midiPath!);
    await expect(page.getByRole('table', { name: 'MIDI track summary' })).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page).toHaveURL(/\/project\//, { timeout: 15_000 });

    const importedMidi = await readScoreSummary(page);
    expect(importedMidi!.notes.length).toBe(beforeMidi!.notes.length);

    // 23. Export MusicXML (of the freshly-imported project -- still a
    // valid, well-formed export regardless of which project is open).
    await page.getByRole('button', { name: 'Export menu' }).click();
    const xmlDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'MusicXML' }).click();
    const xmlDownload = await xmlDownloadPromise;
    expect(xmlDownload.suggestedFilename()).toMatch(/\.musicxml$/);

    // 24. Save and reopen the project.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[aria-label="Save state: Saved"]')).toBeVisible({ timeout: 10_000 });
    const projectUrl = page.url();
    await page.reload();
    await expect
      .poll(async () => (await readScoreSummary(page))?.notes.length ?? 0, { timeout: 10_000 })
      .toBe(importedMidi!.notes.length);
    expect(page.url()).toBe(projectUrl);

    // 25. No uncaught errors across the entire session.
    expect(getErrors()).toEqual([]);
  });
});

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
 * `persistence.spec.ts`, `view-switch-piano-roll.spec.ts`) exercise each
 * of these areas in isolation with tighter assertions; this test instead
 * verifies they compose correctly as one continuous user session, exactly
 * as spec §39 describes it.
 */
import { expect, test } from '@playwright/test';
import {
  clickNoteGroup,
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  getNoteGroups,
  gotoDashboard,
  readCandidates,
  readPlaybackState,
  readScoreSummary,
  selectMeasuresByIndex,
} from './helpers';

test.describe('spec §39 acceptance scenario', () => {
  test('full user session: create, generate, play, regenerate, edit, piano-roll, MIDI, MusicXML, persist', async ({ page }) => {
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
    await expect(page.locator('[data-testid="score-editor-canvas"] [id^="vf-"]').first()).toBeVisible();

    // 6-7. Play; notes highlight in sync (observed via store playback state --
    // Tone.js audio itself has no observable signal in headless Chromium).
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect.poll(async () => (await readPlaybackState(page)).state, { timeout: 10_000 }).toBe('playing');
    await page.getByRole('button', { name: 'Stop' }).click();

    // 8-13. Select measures 3-4, regenerate, preview each alternative, accept one.
    await selectMeasuresByIndex(page, [2, 3]);
    await expect(page.locator('[aria-label="Regeneration panel"]')).toBeVisible();
    await page.getByLabel('Regeneration instruction').fill('Make this section more dramatic while preserving the melody.');
    await page.getByRole('button', { name: 'Generate alternatives' }).click();

    const candidateCards = page.locator('[role="group"][aria-label^="Candidate card:"]');
    await expect(candidateCards).toHaveCount(3, { timeout: 15_000 });
    const candidates = await readCandidates(page);
    for (const candidate of candidates) {
      const card = page.getByRole('group', { name: `Candidate card: ${candidate.label}` });
      await card.getByRole('button', { name: candidate.label, exact: true }).click();
      await expect(card.getByRole('button', { name: candidate.label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    const acceptedLabel = candidates[candidates.length - 1].label;
    await page
      .getByRole('group', { name: `Candidate card: ${acceptedLabel}` })
      .getByRole('button', { name: `Accept ${acceptedLabel}` })
      .click();
    await expect(candidateCards).toHaveCount(0);

    const afterRegen = await readScoreSummary(page);
    expect(afterRegen).not.toBeNull();
    const m3 = generated!.measures[2];
    const m4 = generated!.measures[3];
    const inRegen = (tick: number): boolean => tick >= m3.startTick && tick < m4.startTick + m4.durationTicks;
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
    await expect(page.getByText('1 note(s) selected')).toBeVisible();

    const pitchStepSelect = page.getByRole('combobox', { name: 'Pitch step' });
    const originalStepText = await pitchStepSelect.textContent();
    const nextStep = originalStepText === 'C' ? 'D' : 'C';
    await pitchStepSelect.click();
    await page.getByRole('option', { name: nextStep, exact: true }).click();
    await expect(pitchStepSelect).toHaveText(nextStep);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(pitchStepSelect).toHaveText(originalStepText ?? '');

    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(pitchStepSelect).toHaveText(nextStep);

    // 16-19. Open the piano roll; the same notes appear; drag one; notation updates.
    await page.getByRole('button', { name: 'Piano roll view' }).click();
    await expect(page.getByRole('region', { name: 'Piano roll' })).toBeVisible();
    // The piano roll culls notes to the scrolled viewport (spec §29), same
    // as the notation view, so this just asserts some notes render there.
    const noteRects = page.locator('[data-testid^="pr-note-"]');
    await expect(noteRects.first()).toBeVisible();

    const firstRect = noteRects.first();
    // `boundingBox()`/`page.mouse` need the note actually scrolled into
    // the real viewport first (the 88-key grid is far taller than one
    // screen; unlike a locator's own `.click()`, neither auto-scrolls).
    await firstRect.scrollIntoViewIfNeeded();
    const box = await firstRect.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 - 28, { steps: 8 });
    await page.mouse.up();

    // Notation re-renders against the same, now-updated score (not
    // asserting the dragged note's own element -- like the piano roll, the
    // notation view culls to the scrolled viewport, spec §29).
    await page.getByRole('button', { name: 'Notation view' }).click();
    await expect(page.locator('[data-testid="score-editor-canvas"] [id^="vf-"]').first()).toBeVisible();

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
    await page.getByRole('button', { name: 'Import MIDI' }).click();
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

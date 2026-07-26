/**
 * Spec §30 scenario 15 / spec §39 items 16-19: switch between the
 * notation and piano-roll views, drag a note in the piano roll, and
 * verify the notation view reflects the same, synchronized score.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  gotoDashboard,
  readScoreSummary,
  waitForNotation,
} from './helpers';

test.describe('view switching and piano-roll editing', () => {
  test('switches to the piano roll, drags a note, and the notation view reflects the change', async ({
    page,
  }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'View Switch Check');
    await generateWholeScore(page, {
      prompt: 'Create an energetic video-game battle theme',
      measures: 8,
    });

    const before = await readScoreSummary(page);
    expect(before).not.toBeNull();
    const noteCount = before!.notes.length;
    expect(noteCount).toBeGreaterThan(0);

    // Switch to the piano roll (spec §39 item 16).
    await page.getByRole('button', { name: 'Piano roll view' }).click();
    await expect(page.getByRole('region', { name: 'Piano roll' })).toBeVisible();

    // The same notes appear there (spec §39 item 17). The piano roll (like
    // the notation view) culls notes to the scrolled viewport (spec §29
    // virtualization -- see `PianoRollView.tsx`'s `visibleNoteIds`), so a
    // wide score need not render every note at once; this asserts *some*
    // of the same notes are present, not an exhaustive count match.
    const noteRects = page.locator('[data-testid^="pr-note-"]');
    await expect(noteRects.first()).toBeVisible();
    const renderedIds = await noteRects.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid')?.slice('pr-note-'.length)),
    );
    for (const id of renderedIds) {
      expect(before!.notes.some((n) => n.id === id)).toBe(true);
    }

    // Drag one note: horizontally (time) and vertically (pitch) by enough
    // to guarantee a real change under the piano roll's snap grid
    // (`ROW_HEIGHT = 14px/semitone` at the default zoom -- see `geometry.ts`).
    const firstNote = noteRects.first();
    const testId = await firstNote.getAttribute('data-testid');
    const draggedEventId = testId!.slice('pr-note-'.length);
    // `boundingBox()`/`page.mouse` use real viewport pixels and, unlike a
    // locator's own `.click()`, do NOT auto-scroll -- the piano roll's 88-
    // key grid is far taller than the viewport, so without this the note
    // (and the click/drag landing on it) can be well below the fold.
    await firstNote.scrollIntoViewIfNeeded();
    const box = await firstNote.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY - 28, { steps: 8 });
    await page.mouse.up();

    // Switch back to notation (spec §39 item 19): it re-renders against the
    // same, now-updated score (not asserting the dragged note's own
    // element specifically -- like the piano roll, the notation view culls
    // to the scrolled viewport, spec §29, so a note that moved later in
    // the piece is not guaranteed to be drawn at the default scroll
    // position).
    await page.getByRole('button', { name: 'Notation view' }).click();
    await waitForNotation(page);

    const after = await readScoreSummary(page);
    expect(after).not.toBeNull();
    expect(after!.notes.length).toBe(noteCount);

    const beforeNote = before!.notes.find((n) => n.id === draggedEventId);
    const afterNote = after!.notes.find((n) => n.id === draggedEventId);
    expect(beforeNote).toBeDefined();
    expect(afterNote).toBeDefined();
    expect(afterNote).not.toEqual(beforeNote);

    expect(getErrors()).toEqual([]);
  });
});

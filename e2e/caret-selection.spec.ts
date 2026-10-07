/**
 * The caret-anchored interaction model: a click places the red caret and
 * selects nothing; a note click selects that note and moves the caret to it;
 * cmd-click selects everything between the caret and the click; pressing play
 * deselects and plays from the caret.
 */
import { expect, test } from '@playwright/test';
import {
  clickNoteGroup,
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  getNoteGroups,
  gotoDashboard,
  waitForNotation,
} from './helpers';

test.describe('caret-anchored selection', () => {
  test('click sets the caret, cmd-click selects a range, and play deselects', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Caret Selection Check');
    await generateWholeScore(page, {
      prompt: 'Create a calm piano study',
      measures: 8,
    });
    await waitForNotation(page);

    const status = page.getByRole('status', { name: 'Status bar' });
    const groups = await getNoteGroups(page);
    expect(groups.length).toBeGreaterThan(3);

    // A note click selects exactly that note and shows the caret.
    await clickNoteGroup(page, groups[0]);
    await expect(status).toContainText('1 note selected');
    await expect(page.getByTestId('playback-caret')).toBeVisible();

    // Cmd-click extends from the caret to the clicked note.
    await clickNoteGroup(page, groups[3], { meta: true });
    await expect(status).not.toContainText('1 note selected');
    await expect(status).toContainText('notes selected');

    // Play deselects and runs from the caret.
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(status).toContainText('No selection');

    await page.getByRole('button', { name: 'Pause' }).click();
    expect(getErrors()).toEqual([]);
  });

  test('notation and the piano keyboard are both on screen, and the keyboard collapses', async ({
    page,
  }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Split View Check');
    await generateWholeScore(page, { prompt: 'Create a short waltz', measures: 4 });
    await waitForNotation(page);

    const keyboard = page.getByRole('img', { name: /Piano keyboard/ });
    await expect(page.getByTestId('score-editor-canvas')).toBeVisible();
    await expect(keyboard).toBeVisible();
    // No mode switch exists any more.
    await expect(page.getByRole('group', { name: 'Editor view' })).toHaveCount(0);

    /*
      The toggle is the transport bar's rightmost button now, not a header of
      the keyboard's own — that row cost a whole strip to hold one control, and
      it put the thing that *reveals* the keyboard inside the thing it reveals.
      So it is named for what it does to the keyboard rather than for the panel:
      "Hide keyboard" while it is showing, "Show keyboard" once it is not.
    */
    await page.getByRole('button', { name: 'Hide keyboard' }).click();
    await expect(keyboard).toHaveCount(0);
    // Collapsing the keyboard must not disturb the notation.
    await expect(page.getByTestId('score-editor-canvas')).toBeVisible();

    await page.getByRole('button', { name: 'Show keyboard' }).click();
    await expect(keyboard).toBeVisible();

    expect(getErrors()).toEqual([]);
  });
});

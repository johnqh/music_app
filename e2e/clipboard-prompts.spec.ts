/**
 * Cut and paste, and the questions they ask.
 *
 * The rule under test is when the editor *stays quiet*: a prompt whose answers
 * would produce the same score is a click the user cannot get wrong, so it
 * must not appear.
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

/** Selects notes directly through the store — clicking noteheads is not the subject here. */
async function selectNotes(page: import('@playwright/test').Page, ids: string[]) {
  await page.evaluate((eventIds) => {
    const store = (
      window as unknown as {
        __SCORESMITH_STORE__: { getState: () => { setSelection: (s: unknown) => void } };
      }
    ).__SCORESMITH_STORE__;
    store.getState().setSelection({ eventIds, measureIds: [], trackIds: [] });
  }, ids);
}

/**
 * Scoped locators.
 *
 * Playwright matches accessible names as substrings, so a bare `name: 'Insert'`
 * also hits "Insert mode" and "Insert a note at the caret". Scoping each click
 * to the region it belongs to is more precise than fighting that with `exact`,
 * and it keeps reading like the thing being described.
 */
/**
 * Cut, copy, paste, clear and delete are the score's context menu now, not
 * toolbar buttons — so reaching one means right-clicking the score first.
 *
 * The selection is set through the store above rather than by clicking, and a
 * right-click inside an existing selection deliberately keeps it, so opening
 * the menu anywhere over the sheet acts on what was selected.
 */
async function chooseScoreAction(page: import('@playwright/test').Page, name: string) {
  await page.getByTestId('score-editor-canvas').click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Score actions' })
    .getByRole('menuitem', { name, exact: true })
    .click();
}

const dialogButton = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('dialog').getByRole('button', { name, exact: true });

async function openScore(page: import('@playwright/test').Page, name: string) {
  await gotoDashboard(page);
  await createNewProject(page, name);
  await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 4 });
  await waitForNotation(page);
}

test.describe('cut and paste prompts', () => {
  test('cutting mid-track asks, and closing the gap moves later notes earlier', async ({
    page,
  }) => {
    const getErrors = collectPageErrors(page);
    await openScore(page, 'Cut Prompt');

    const before = await readScoreSummary(page);
    const track = before!.notes[0].trackId;
    const onTrack = before!.notes
      .filter((n) => n.trackId === track)
      .sort((a, b) => a.startTick - b.startTick);
    expect(onTrack.length).toBeGreaterThan(2);

    const cut = onTrack[0];
    const following = onTrack[onTrack.length - 1];
    await selectNotes(page, [cut.id]);
    await chooseScoreAction(page, 'Cut');

    await expect(page.getByText('Cut these notes')).toBeVisible();
    await dialogButton(page, 'Close the gap').click();

    const after = await readScoreSummary(page);
    const moved = after!.notes.find((n) => n.id === following.id);
    expect(moved, 'the following note survived').toBeTruthy();
    expect(moved!.startTick).toBeLessThan(following.startTick);
    expect(getErrors()).toEqual([]);
  });

  test('leaving silence keeps the following notes where they were', async ({ page }) => {
    const getErrors = collectPageErrors(page);
    await openScore(page, 'Cut Silence');

    const before = await readScoreSummary(page);
    const track = before!.notes[0].trackId;
    const onTrack = before!.notes
      .filter((n) => n.trackId === track)
      .sort((a, b) => a.startTick - b.startTick);

    const following = onTrack[onTrack.length - 1];
    await selectNotes(page, [onTrack[0].id]);
    await chooseScoreAction(page, 'Cut');
    await dialogButton(page, 'Leave silence').click();

    const after = await readScoreSummary(page);
    expect(after!.notes.find((n) => n.id === following.id)!.startTick).toBe(following.startTick);
    expect(getErrors()).toEqual([]);
  });

  test('cutting the last notes does not ask, because both answers agree', async ({ page }) => {
    const getErrors = collectPageErrors(page);
    await openScore(page, 'Cut Quiet');

    const before = await readScoreSummary(page);
    const track = before!.notes[0].trackId;
    const onTrack = before!.notes
      .filter((n) => n.trackId === track)
      .sort((a, b) => a.startTick - b.startTick);

    // Everything on the track: nothing follows it, so closing the gap would
    // move nothing.
    await selectNotes(
      page,
      onTrack.map((n) => n.id),
    );
    await chooseScoreAction(page, 'Cut');

    await expect(page.getByText('Cut these notes')).toBeHidden();
    expect(getErrors()).toEqual([]);
  });

  test('pasting onto occupied time asks, and insert keeps what was there', async ({ page }) => {
    const getErrors = collectPageErrors(page);
    await openScore(page, 'Paste Prompt');

    const before = await readScoreSummary(page);
    const track = before!.notes[0].trackId;
    const onTrack = before!.notes
      .filter((n) => n.trackId === track)
      .sort((a, b) => a.startTick - b.startTick);

    await selectNotes(page, [onTrack[0].id]);
    await chooseScoreAction(page, 'Copy');
    await chooseScoreAction(page, 'Paste');

    await expect(page.getByText('Paste over this music')).toBeVisible();
    await dialogButton(page, 'Insert').click();

    const after = await readScoreSummary(page);
    // Insert displaces rather than overwriting, so nothing is lost.
    for (const note of onTrack) {
      expect(
        after!.notes.some((n) => n.id === note.id),
        `note ${note.id} survived`,
      ).toBe(true);
    }
    expect(getErrors()).toEqual([]);
  });
});

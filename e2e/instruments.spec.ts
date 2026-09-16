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

    // Track editing lives in the inspector's Track tab. There used to be a
    // second editor in a panel beside the keyboard, labelled per track
    // ("Instrument: <track>") inside a "Track editor" region; both are gone,
    // and this spec targeted them long after they were deleted.
    await page.getByRole('tab', { name: 'Track' }).click();
    const picker = page.getByLabel('Instrument', { exact: true });
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

test.describe('track gutter and editor', () => {
  test('clicking a track in the canvas gutter makes it active', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Gutter Check');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 8 });
    await waitForNotation(page);

    // A second track, so "which track is active" is a real question.
    // "+" opens a menu now (Blank Track / Generate Track), rather than adding
    // a track outright.
    await page.getByRole('combobox', { name: 'Add Track' }).click();
    await page.getByRole('option', { name: 'Blank Track' }).click();
    // Same move as above: the one track editor is the inspector's Track tab.
    await page.getByRole('tab', { name: 'Track' }).click();
    const editor = page.getByRole('tabpanel');
    await expect(editor).toBeVisible();

    /*
      The gutter is drawn in the canvas, so target it by geometry: the blank
      track's stave band, inside the reserved left column.

      The *last* layout, not index 1. A generated score used to be one track,
      so the track just added was the second; "Generate for me" now prepends a
      voice to the roster, so index 1 is the generated piano and the click
      landed on a track that was never added here.
    */
    const point = await page.evaluate(() => {
      // Minimal local shape rather than `any`: only the fields this reads.
      type Box = { y: number; height: number };
      type Handle = {
        result: {
          plan: { trackLayouts: Array<{ measures: Array<{ box: Box }> }> };
        } | null;
        scrollBox: HTMLElement | null;
      };
      const h = (window as unknown as { __scoresmith: Handle }).__scoresmith;
      const scroll = h.scrollBox!;
      const rect = scroll.getBoundingClientRect();
      const plan = h.result!.plan;
      const box = plan.trackLayouts[plan.trackLayouts.length - 1].measures[0].box;
      return { x: rect.left + 20, y: rect.top + box.y + box.height / 2 - scroll.scrollTop };
    });
    await page.mouse.click(point.x, point.y);

    // The editor follows the active track.
    // Labelled "Track name", not "Track name: <name>" — the per-track suffix
    // belonged to the deleted panel, where several tracks were on screen at
    // once and each field needed its own name. One track is shown here.
    await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('New track');

    expect(getErrors()).toEqual([]);
  });
});

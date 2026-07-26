/**
 * Spec §30 scenarios 1-3: create a new project, generate a whole-score
 * composition from the mock provider, and play it back.
 */
import { expect, test } from '@playwright/test';
import {
  collectPageErrors,
  createNewProject,
  generateWholeScore,
  gotoDashboard,
  readPlaybackState,
} from './helpers';

test.describe('project creation, generation, and playback', () => {
  test('creates a new project, generates a composition, and plays it', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);
    await createNewProject(page, 'Gentle Piano Piece');

    // Editable title reflects the project's name.
    await expect(page.getByRole('button', { name: 'Edit project title' })).toHaveText(
      'Gentle Piano Piece',
    );

    // Generate (spec §39 items 3-5): a valid score appears as readable notation.
    await generateWholeScore(page, {
      prompt: 'Create a gentle eight-measure piano piece in A minor.',
      measures: 8,
      keyFifths: 'C',
      keyMode: 'minor',
    });

    const noteGroups = page.locator('[data-testid="score-editor-canvas"] [id^="vf-"]');
    await expect(noteGroups.first()).toBeVisible();

    // Play (spec §39 items 6-7): transport toggles and the store's
    // playback state actually advances (Tone.js audio itself can't be
    // observed in headless Chromium -- see helpers.ts's module doc).
    const playButton = page.getByRole('button', { name: 'Play' });
    await expect(playButton).toBeEnabled();
    await playButton.click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

    await expect
      .poll(async () => (await readPlaybackState(page)).state, { timeout: 10_000 })
      .toBe('playing');

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

    await page.getByRole('button', { name: 'Stop' }).click();

    expect(getErrors()).toEqual([]);
  });
});

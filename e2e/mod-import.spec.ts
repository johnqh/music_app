/**
 * Importing an Amiga tracker module.
 *
 * The module is built with `music_codecs`' own `buildMod` — the same builder
 * its reader is tested against — rather than a copy here, so this cannot pass
 * against bytes the real reader would reject. It comes from the `/fixtures`
 * entry, which exists for exactly this: a test-facing export that keeps the
 * builders out of the surface an app imports.
 */
import { expect, test } from '@playwright/test';
import { buildMod } from '@sudobility/music_codecs/fixtures';
import {
  chooseImport,
  collectPageErrors,
  gotoDashboard,
  readScoreSummary,
  waitForNotation,
} from './helpers';

/** C-3, D-3, E-3 and G-3 as ProTracker periods, one per row on channel 0. */
const PERIODS = [428, 381, 339, 285];

function moduleBytes(): Buffer {
  const rows = PERIODS.map((period) => [{ sample: 1, period }]);
  return Buffer.from(
    new Uint8Array(
      buildMod({
        title: 'E2E Module',
        sampleNames: ['lead', 'bass'],
        order: [0],
        patterns: [rows],
      }),
    ),
  );
}

test.describe('module import', () => {
  test('imports a .MOD as a project with notes', async ({ page }) => {
    const getErrors = collectPageErrors(page);

    await gotoDashboard(page);

    // Import lives on the dashboard, not in the editor: every import makes a
    // project, so a menu on the editor's own title bar could only throw you
    // out of the project you had open. It is one menu now, and `chooseImport`
    // matches the option name exactly — every one of them begins "Import".
    await chooseImport(page, 'Import Tracker Module');
    await page.getByLabel('module file input').setInputFiles({
      name: 'e2e.mod',
      mimeType: 'application/octet-stream',
      buffer: moduleBytes(),
    });

    // Import creates its own project, named from the module's title.
    await expect(page.getByLabel('Edit project title')).toHaveText('E2E Module', {
      timeout: 15_000,
    });
    await waitForNotation(page);

    const summary = await readScoreSummary(page);
    expect(summary).not.toBeNull();
    expect(summary!.notes.length).toBeGreaterThan(0);
    // Grouped by sample, not by channel — one sample was used, so one track.
    expect(summary!.trackCount).toBe(1);

    expect(getErrors()).toEqual([]);
  });

  test('a file that is not a module is refused, not imported as nonsense', async ({ page }) => {
    // A garbage score is worse than a clear failure: it looks like the file
    // imported and quietly is not the music.
    await gotoDashboard(page);

    await chooseImport(page, 'Import Tracker Module');
    const dialog = page.getByRole('dialog', { name: 'Import Tracker Module' });
    await dialog.getByLabel('module file input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not a tracker module'),
    });

    // The dialog stays open and says so, rather than navigating to a project
    // full of nonsense. A garbage score is worse than a clear failure: it
    // looks like the file imported and quietly is not the music.
    await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toBeVisible();
  });
});

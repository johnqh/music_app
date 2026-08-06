import { expect, test } from '@playwright/test';
import {
  createNewProject,
  generateWholeScore,
  gotoDashboard,
  readScoreSummary,
  waitForNotation,
} from './helpers';

const SR = 44100;

/** A mono 16-bit WAV of `hz` for `seconds`, built the same way music_io writes one. */
function wavOfTones(tones: Array<{ hz: number; seconds: number }>): Buffer {
  const samples: number[] = [];
  for (const { hz, seconds } of tones) {
    const n = Math.floor(SR * seconds);
    for (let i = 0; i < n; i += 1) samples.push(Math.sin((2 * Math.PI * hz * i) / SR));
  }
  const body = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => body.writeInt16LE(Math.max(-1, Math.min(1, s)) * 0x7fff, i * 2));

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + body.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

test.describe('audio', () => {
  test('imports a recording as a new track, and exports the score as WAV', async ({ page }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Audio Test');
    await generateWholeScore(page, { prompt: 'Create a calm study', measures: 4 });
    await waitForNotation(page);

    const before = await readScoreSummary(page);

    // --- import ---------------------------------------------------------
    await page.getByLabel('Import menu').click();
    await page.getByRole('menuitem', { name: 'Audio…' }).click();

    await page.getByLabel('Audio file').setInputFiles({
      name: 'hum.wav',
      mimeType: 'audio/wav',
      buffer: wavOfTones([
        { hz: 440, seconds: 0.6 },
        { hz: 523.25, seconds: 0.6 },
      ]),
    });

    // Analysis is async; the tempo field only appears once it is done.
    // Scoped to the dialog: "Tempo" also labels the transport's field, and
    // "Import" is the name of a menu, so page-wide locators are ambiguous.
    const dialog = page.getByRole('dialog', { name: 'Import audio' });
    await expect(dialog.getByLabel('Tempo')).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByLabel('Audio file')).toBeHidden();

    // A new track, and the existing music untouched.
    await expect
      .poll(async () => (await readScoreSummary(page))?.trackCount)
      .toBe((before?.trackCount ?? 0) + 1);

    // --- export ---------------------------------------------------------
    const download = page.waitForEvent('download');
    await page.getByLabel('Export menu').click();
    await page.getByRole('menuitem', { name: 'Audio (WAV)…' }).click();
    const file = await download;

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);

    // A real WAV, rendered through the same instruments playback uses. This is
    // the only verification `renderOffline` can have — it needs a genuine
    // OfflineAudioContext, which vitest does not provide.
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
    expect(bytes.length).toBeGreaterThan(44);
  });
});

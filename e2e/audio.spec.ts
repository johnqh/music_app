import { expect, test } from '@playwright/test';
import { createNewProject, generateWholeScore, gotoDashboard, waitForNotation } from './helpers';

/**
 * Export only, deliberately.
 *
 * There used to be an import test here that drove an editor Import menu, waited
 * for an analysis, picked a tempo and confirmed. All four are gone: audio
 * import moved to the dashboard and became a *server* job, with no tempo field
 * and no confirm step, because the score does not exist yet when the dialog
 * closes.
 *
 * It is not covered here because it cannot be covered stably. Transcription
 * needs the separate `midi_transcriber_api` daemon, and whether it appears
 * available depends on `music_api`'s local `.env` — so the same test passes,
 * fails, or asserts the opposite depending on the machine. What *is* covered:
 * `AudioImportDialog.test.tsx` for the dialog (file choice, the large-file
 * warning, the unavailable message, the error path), and the transcriber's own
 * suite for the transcription.
 *
 * Export earns its place here because nothing else can test it: `renderOffline`
 * needs a genuine `OfflineAudioContext`, which vitest does not provide.
 */
test.describe('audio', () => {
  test('exports the score as WAV and MP3', async ({ page }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Audio Test');
    await generateWholeScore(page, { prompt: 'Create a calm study', measures: 4 });
    await waitForNotation(page);

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

    // --- and as MP3 ------------------------------------------------------
    // The least-verified path otherwise: `encodeMp3` is only unit-tested to
    // "produces bytes", because checking an mp3 decodes needs a decoder in the
    // test environment. Here at least the frame header is real.
    const mp3Download = page.waitForEvent('download');
    await page.getByLabel('Export menu').click();
    await page.getByRole('menuitem', { name: 'Audio (MP3)…' }).click();
    const mp3File = await mp3Download;

    const mp3Chunks: Buffer[] = [];
    for await (const chunk of await mp3File.createReadStream()) mp3Chunks.push(chunk as Buffer);
    const mp3 = Buffer.concat(mp3Chunks);

    expect(mp3.length).toBeGreaterThan(0);
    expect(mp3File.suggestedFilename()).toMatch(/\.mp3$/);
    // An MPEG audio frame starts with eleven set bits: 0xFF then 0xE0-0xFF.
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xe0).toBe(0xe0);
  });
});

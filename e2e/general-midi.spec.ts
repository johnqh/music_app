/**
 * Every General MIDI instrument, against the soundfont that actually plays it.
 *
 * This exists because two instrument faults shipped without being noticed: a
 * second drum track played its congas on a piano, and the kit a file asked for
 * was ignored. Both were invisible to every other test — the transport ran, the
 * notes were dispatched, and the wrong instrument came out. The only way to
 * catch that class of bug is to ask the synth what it is actually going to
 * play, so that is what this does.
 *
 * Runs against the real 23MB font in a real browser, so it is slower than a
 * unit test and belongs here rather than in music_io's suite.
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const JS_SYNTH = readFileSync(
  '/Users/johnhuang/projects/music_io/node_modules/js-synthesizer/dist/js-synthesizer.js',
  'utf8',
);

/** The kit addresses General MIDI defines in the drum bank. */
const GM_KITS = [0, 8, 16, 24, 25, 32, 40, 48];

async function withSynth<T>(page: import('@playwright/test').Page, body: string): Promise<T> {
  await page.goto('/');
  await page.addScriptTag({ url: '/audio/libfluidsynth-2.4.6-with-libsndfile.js' });
  await page.addScriptTag({ content: JS_SYNTH });
  await page.waitForFunction(() => (window as never as { JSSynth?: unknown }).JSSynth !== undefined, {
    timeout: 60_000,
  });
  return (await page.evaluate(body)) as T;
}

test.describe('General MIDI', () => {
  test('every melodic program resolves to its own preset and makes a sound', async ({ page }) => {
    test.setTimeout(300_000);
    const rows = await withSynth<Array<{ program: number; preset: string | null; peak: number }>>(
      page,
      `(async () => {
        const J = window.JSSynth;
        await J.waitForReady();
        const font = await (await fetch('/audio/FluidR3Mono_GM.sf3')).arrayBuffer();
        const synth = new J.Synthesizer();
        synth.init(44100);
        const sf = await synth.loadSFont(font);
        const sfont = synth.getSFontObject(sf);
        const left = new Float32Array(22050), right = new Float32Array(22050);
        const rows = [];
        for (let program = 0; program < 128; program += 1) {
          const preset = sfont.getPreset(0, program);
          synth.midiProgramSelect(0, sf, 0, program);
          synth.midiNoteOn(0, 60, 100);
          synth.render([left, right]);
          let peak = 0;
          for (let i = 0; i < left.length; i += 1) {
            const l = Math.abs(left[i]), r = Math.abs(right[i]);
            if (l > peak) peak = l;
            if (r > peak) peak = r;
          }
          synth.midiAllSoundsOff();
          rows.push({ program, preset: preset ? preset.name : null, peak });
        }
        synth.close();
        return rows;
      })()`,
    );

    expect(rows).toHaveLength(128);
    // A missing preset is a silent instrument; the bank must be complete.
    expect(rows.filter((r) => r.preset === null).map((r) => r.program)).toEqual([]);
    expect(rows.filter((r) => r.peak === 0).map((r) => r.program)).toEqual([]);
    // 128 distinct presets: a routing fault that pins every program to one
    // instrument would still be audible, and would still pass the checks above.
    expect(new Set(rows.map((r) => r.preset)).size).toBe(128);
  });

  test('every drum kit is present and distinct, through the engine routing', async ({ page }) => {
    test.setTimeout(300_000);
    const rows = await withSynth<Array<{ kit: number; peak: number; rms: number }>>(
      page,
      `(async () => {
        const J = window.JSSynth;
        await J.waitForReady();
        const font = await (await fetch('/audio/FluidR3Mono_GM.sf3')).arrayBuffer();
        const kits = ${JSON.stringify(GM_KITS)};
        const rows = [];
        for (const kit of kits) {
          // A fresh synth per kit, so no preset or reverb tail carries over.
          const synth = new J.Synthesizer();
          synth.init(44100);
          const sf = await synth.loadSFont(font);
          // Exactly what SynthHost does: the guaranteed kit, then the asked-for one.
          synth.midiProgramSelect(9, sf, 128, 0);
          if (kit !== 0) synth.midiProgramSelect(9, sf, 128, kit);
          synth.midiNoteOn(9, 38, 110); // Acoustic Snare
          const left = new Float32Array(22050), right = new Float32Array(22050);
          synth.render([left, right]);
          let peak = 0, energy = 0;
          for (let i = 0; i < left.length; i += 1) {
            const l = Math.abs(left[i]), r = Math.abs(right[i]);
            if (l > peak) peak = l;
            if (r > peak) peak = r;
            energy += left[i] * left[i];
          }
          synth.close();
          rows.push({ kit, peak, rms: Math.sqrt(energy / left.length) });
        }
        return rows;
      })()`,
    );

    expect(rows.map((r) => r.kit)).toEqual(GM_KITS);
    for (const row of rows) expect(row.peak, `kit ${row.kit} is silent`).toBeGreaterThan(0);
    // Distinct kits, so "always Standard" cannot come back unnoticed. Rounded,
    // because these are measurements and not exact arithmetic.
    const signatures = rows.map((r) => `${r.peak.toFixed(3)}/${r.rms.toFixed(4)}`);
    expect(new Set(signatures).size).toBe(GM_KITS.length);
  });
});

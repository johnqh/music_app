# Instrument Transposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print a part in the pitch its player reads, not the pitch it sounds.

**Architecture:** A curated per-program table in `music_lib` gives the written interval; a key-signature shift moves the key with it. Both are consumed by a new `extractPart(score, trackId)` that returns a **print-only derived score** — features 3 to 5 extend the same function. The print view uses it for a single track and nothing else does.

**Tech Stack:** TypeScript (strict), Vitest, React 19, Playwright, Bun.

## Global Constraints

- **Feature 2 of seven.** Multi-measure rests, rehearsal marks, cues, page turns and written-pitch editing are features 3 to 7; nothing here implements them.
- **Transposition must not reach playback, the editor, or the whole-score print.** The engine plays sounding pitch; the editor edits concert pitch; conductors read concert pitch.
- **The key is transposed first, then pitches are respelled in the _new_ key.** Respelling against the original key spells G♭ where F♯ belongs.
- **`extractPart` output is never written back or saved.** It exists for the duration of a render.
- **Default transposition is 0**, including for an out-of-range program: an unknown instrument is written where it sounds rather than moved by a guess.
- **Do not commit or push.** `scripts/push_all.sh` does that. Leave every change in the working tree.
- After changing `music_lib`: `bun run build` there, copy `dist` into `music_app/node_modules/@sudobility/music_lib/`, then `rm -rf node_modules/.vite` in `music_app`.

---

## File Structure

| File                                                   | Responsibility                                             |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `music_lib/src/domain/instruments/gm-transposition.ts` | **New.** The written-interval table.                       |
| `music_lib/src/domain/pitch/transpose.ts`              | `transposeKeySignature` — the fifths shift.                |
| `music_lib/src/domain/score/extract-part.ts`           | **New.** The print-only derived part score.                |
| `music_lib/src/index.ts`                               | Export both new modules.                                   |
| `music_app/src/features/print/PrintView.tsx`           | Use `extractPart` for a single track; shorten the caveat.  |
| `music_app/e2e/print.spec.ts`                          | A transposing part prints transposed; the editor does not. |

---

### Task 1: The written-interval table

**Files:**

- Create: `~/projects/music_lib/src/domain/instruments/gm-transposition.ts`
- Create: `~/projects/music_lib/src/domain/instruments/gm-transposition.test.ts`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**

- Consumes: `gmInstrument` from `./gm.js`.
- Produces: `gmWrittenTransposition(program: number): number` — semitones to **add to sounding pitch** to get written pitch.

- [ ] **Step 1: Write the failing test**

Create `~/projects/music_lib/src/domain/instruments/gm-transposition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gmWrittenTransposition } from './gm-transposition.js';
import { GM_INSTRUMENTS } from './gm.js';

describe('gmWrittenTransposition', () => {
  it('writes B-flat instruments a tone above what they sound', () => {
    expect(gmWrittenTransposition(56)).toBe(2); // Trumpet
    expect(gmWrittenTransposition(71)).toBe(2); // Clarinet
    expect(gmWrittenTransposition(64)).toBe(2); // Soprano Sax
  });

  it('writes F instruments a fifth above', () => {
    expect(gmWrittenTransposition(60)).toBe(7); // French Horn
    expect(gmWrittenTransposition(69)).toBe(7); // English Horn
  });

  it('writes the E-flat and lower B-flat saxes at their own intervals', () => {
    expect(gmWrittenTransposition(65)).toBe(9); // Alto Sax
    expect(gmWrittenTransposition(66)).toBe(14); // Tenor Sax — a ninth, not a tone
    expect(gmWrittenTransposition(67)).toBe(21); // Baritone Sax
  });

  it('writes the octave-transposing instruments an octave off', () => {
    // Guitar music is written an octave above where it sounds; piccolo an
    // octave below. Both are as real as the B-flat cases.
    expect(gmWrittenTransposition(24)).toBe(12); // Acoustic Guitar (nylon)
    expect(gmWrittenTransposition(32)).toBe(12); // Acoustic Bass
    expect(gmWrittenTransposition(43)).toBe(12); // Contrabass
    expect(gmWrittenTransposition(72)).toBe(-12); // Piccolo
    expect(gmWrittenTransposition(8)).toBe(-12); // Celesta
    expect(gmWrittenTransposition(13)).toBe(-12); // Xylophone
    expect(gmWrittenTransposition(9)).toBe(-24); // Glockenspiel
  });

  it('leaves a non-transposing instrument where it sounds', () => {
    expect(gmWrittenTransposition(0)).toBe(0); // Acoustic Grand Piano
    expect(gmWrittenTransposition(40)).toBe(0); // Violin
    expect(gmWrittenTransposition(73)).toBe(0); // Flute
  });

  it('gives an unknown program the benefit of the doubt', () => {
    // Moving a note by a guess is worse than leaving it alone.
    expect(gmWrittenTransposition(-1)).toBe(0);
    expect(gmWrittenTransposition(128)).toBe(0);
    expect(gmWrittenTransposition(3.5)).toBe(0);
  });

  it('returns a whole number of semitones for every program', () => {
    for (const instrument of GM_INSTRUMENTS) {
      const value = gmWrittenTransposition(instrument.program);
      expect(Number.isInteger(value), instrument.name).toBe(true);
      expect(Math.abs(value), instrument.name).toBeLessThanOrEqual(24);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test gm-transposition`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the table**

Create `~/projects/music_lib/src/domain/instruments/gm-transposition.ts`:

```ts
/**
 * How far a General MIDI program's written pitch sits from its sounding pitch.
 *
 * A transposing instrument is written in a key other than the one it sounds:
 * a B♭ trumpet reads a tone above what comes out, so concert C is written D.
 * This is a property of the instrument, not a preference — hand a clarinettist
 * a part at concert pitch and every note is wrong.
 *
 * Curated like `gm-range.ts` and `gm-polyphony.ts`: a default with overrides
 * for the programs that actually transpose. Most do not, so the table is only
 * the exceptions.
 */
import { gmInstrument } from './gm.js';

/** Semitones to ADD to sounding pitch to get written pitch. */
const PROGRAM_TRANSPOSITION: Record<number, number> = {
  // Octave-transposing tuned percussion: written an octave (or two) below
  // where they sound, so the reader is not chasing ledger lines.
  8: -12, // Celesta
  9: -24, // Glockenspiel
  13: -12, // Xylophone

  // Guitars and basses are written an octave above where they sound.
  24: 12, // Acoustic Guitar (nylon)
  25: 12, // Acoustic Guitar (steel)
  26: 12, // Electric Guitar (jazz)
  27: 12, // Electric Guitar (clean)
  28: 12, // Electric Guitar (muted)
  29: 12, // Overdriven Guitar
  30: 12, // Distortion Guitar
  31: 12, // Guitar Harmonics
  32: 12, // Acoustic Bass
  33: 12, // Electric Bass (finger)
  34: 12, // Electric Bass (pick)
  35: 12, // Fretless Bass
  36: 12, // Slap Bass 1
  37: 12, // Slap Bass 2
  38: 12, // Synth Bass 1
  39: 12, // Synth Bass 2
  43: 12, // Contrabass

  // Brass.
  56: 2, // Trumpet — B♭
  60: 7, // French Horn — F

  // Reeds. The saxophone family transposes by four different intervals.
  64: 2, // Soprano Sax — B♭
  65: 9, // Alto Sax — E♭
  66: 14, // Tenor Sax — B♭, a ninth below
  67: 21, // Baritone Sax — E♭, an octave and a sixth below
  69: 7, // English Horn — F
  71: 2, // Clarinet — B♭

  // Pipes.
  72: -12, // Piccolo — sounds an octave above where it is written
};

/**
 * Semitones to add to `program`'s sounding pitch to get its written pitch.
 *
 * `0` for anything that is written where it sounds, and for any program
 * outside 0-127: an unknown instrument is left alone rather than moved by a
 * guess, which would be a silently wrong part.
 */
export function gmWrittenTransposition(program: number): number {
  if (!gmInstrument(program)) return 0;
  return PROGRAM_TRANSPOSITION[program] ?? 0;
}

/** Whether `program` is written anywhere other than where it sounds. */
export function gmIsTransposing(program: number): boolean {
  return gmWrittenTransposition(program) !== 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test gm-transposition`
Expected: PASS.

- [ ] **Step 5: Export it**

Add to `~/projects/music_lib/src/index.ts`, beside the other instrument exports (find them with `grep -n "domain/instruments" src/index.ts`):

```ts
export * from './domain/instruments/gm-transposition.js';
```

---

### Task 2: The key-signature shift

**Files:**

- Modify: `~/projects/music_lib/src/domain/pitch/transpose.ts`
- Test: `~/projects/music_lib/src/domain/pitch/transpose.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `transposeKeySignature(key: KeySignature, semitones: number): KeySignature`.

- [ ] **Step 1: Write the failing test**

Add to `~/projects/music_lib/src/domain/pitch/transpose.test.ts` (match the file's existing import style):

```ts
describe('transposeKeySignature', () => {
  const major = (fifths: number) => ({ fifths, mode: 'major' as const });

  it('moves C major to D major for a B-flat instrument', () => {
    // Two sharps: the classic case, and the one most likely to be noticed.
    expect(transposeKeySignature(major(0), 2)).toEqual(major(2));
  });

  it('moves C major to G major for an F instrument', () => {
    expect(transposeKeySignature(major(0), 7)).toEqual(major(1));
  });

  it('moves C major to A major for an E-flat instrument', () => {
    expect(transposeKeySignature(major(0), 9)).toEqual(major(3));
  });

  it('moves C major to E-flat major for a minor third', () => {
    // Folds to the flat side rather than reporting nine sharps.
    expect(transposeKeySignature(major(0), 3)).toEqual(major(-3));
  });

  it('leaves the key alone for an octave', () => {
    // Guitar and piccolo transpose by octaves and keep their key signature.
    expect(transposeKeySignature(major(0), 12)).toEqual(major(0));
    expect(transposeKeySignature(major(3), -12)).toEqual(major(3));
    expect(transposeKeySignature(major(0), -24)).toEqual(major(0));
  });

  it('gives the tenor sax the same key as the other B-flat instruments', () => {
    // +14 is +2 an octave down; the key must not differ from the trumpet's.
    expect(transposeKeySignature(major(0), 14)).toEqual(transposeKeySignature(major(0), 2));
  });

  it('keeps the mode', () => {
    expect(transposeKeySignature({ fifths: 0, mode: 'minor' }, 2).mode).toBe('minor');
  });

  it('never returns a key needing more than six accidentals', () => {
    // Seven sharps is spellable but eight is not; folding is what keeps every
    // result printable.
    for (let semitones = -24; semitones <= 24; semitones++) {
      for (const start of [-5, -3, 0, 3, 5]) {
        const result = transposeKeySignature(major(start), semitones);
        expect(Math.abs(result.fifths), `${start} by ${semitones}`).toBeLessThanOrEqual(7);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test transpose`
Expected: FAIL — `transposeKeySignature` is not exported.

- [ ] **Step 3: Implement it**

Add to `~/projects/music_lib/src/domain/pitch/transpose.ts`:

```ts
/**
 * The key `key` becomes when the music is transposed by `semitones`.
 *
 * Moving up a fifth adds one sharp, so a shift of `s` semitones moves the key
 * by `s × 7` fifths — the circle of fifths is a cycle of 7 semitones. The
 * result is folded into -6..6 so a minor third up reads as three flats rather
 * than nine sharps: both name the same key, but only one is printable.
 *
 * An octave leaves the key untouched, which falls out of the arithmetic rather
 * than needing a special case.
 */
export function transposeKeySignature(key: KeySignature, semitones: number): KeySignature {
  const raw = (((semitones * 7) % 12) + 12) % 12;
  const delta = raw > 6 ? raw - 12 : raw;

  let fifths = key.fifths + delta;
  // The result can still land outside the printable range when the starting
  // key is already remote; fold it back the same way.
  while (fifths > 7) fifths -= 12;
  while (fifths < -7) fifths += 12;

  return { fifths, mode: key.mode };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test transpose`
Expected: PASS.

---

### Task 3: `extractPart`

**Files:**

- Create: `~/projects/music_lib/src/domain/score/extract-part.ts`
- Create: `~/projects/music_lib/src/domain/score/extract-part.test.ts`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**

- Consumes: `gmWrittenTransposition` (Task 1), `transposeKeySignature` (Task 2), `transposePitch` (existing).
- Produces: `extractPart(score: Score, trackId: string): Score | null` — a print-only derived score containing only that track, transposed for its instrument. `null` when the track does not exist.

- [ ] **Step 1: Write the failing test**

Create `~/projects/music_lib/src/domain/score/extract-part.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyScore } from './factory.js';
import { allNotes } from './queries.js';
import { addNoteCommand } from '../commands/note-commands.js';
import { extractPart } from './extract-part.js';
import type { Pitch, Score } from '@sudobility/music_types';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

/** A two-track score: track 0's program is settable, track 1 is a piano. */
function scoreWith(program: number): Score {
  const base = createEmptyScore({
    title: 'Part',
    measures: 2,
    tracks: [
      { name: 'Solo', instrumentName: 'Solo', clef: 'treble' as const },
      { name: 'Piano', instrumentName: 'Piano', clef: 'bass' as const },
    ],
  });
  const withProgram: Score = {
    ...base,
    tracks: base.tracks.map((t, i) => (i === 0 ? { ...t, midiProgram: program } : t)),
  };
  const track = withProgram.tracks[0];
  return ['C', 'D', 'E'].reduce(
    (acc, step, i) =>
      addNoteCommand({
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch(step),
        startTick: i * withProgram.ppq,
        durationTicks: withProgram.ppq,
      }).execute(acc),
    withProgram,
  );
}

const steps = (score: Score) =>
  allNotes(score)
    .sort((a, b) => a.startTick - b.startTick)
    .map(
      (n) =>
        `${n.pitch.step}${n.pitch.accidental === 1 ? '#' : n.pitch.accidental === -1 ? 'b' : ''}`,
    );

describe('extractPart', () => {
  it('keeps only the requested track', () => {
    const score = scoreWith(0);
    const part = extractPart(score, score.tracks[0].id)!;
    expect(part.tracks).toHaveLength(1);
    expect(part.tracks[0].id).toBe(score.tracks[0].id);
  });

  it('is null for a track that does not exist', () => {
    expect(extractPart(scoreWith(0), 'nope')).toBeNull();
  });

  it('leaves a non-transposing instrument exactly as it sounds', () => {
    const score = scoreWith(0); // Acoustic Grand Piano
    const part = extractPart(score, score.tracks[0].id)!;
    expect(steps(part)).toEqual(['C', 'D', 'E']);
    expect(part.tracks[0].measures[0].keySignature.fifths).toBe(
      score.tracks[0].measures[0].keySignature.fifths,
    );
  });

  it('writes a B-flat instrument a tone up', () => {
    const score = scoreWith(71); // Clarinet
    const part = extractPart(score, score.tracks[0].id)!;
    expect(steps(part)).toEqual(['D', 'E', 'F#']);
  });

  it('moves the key signature with the pitches', () => {
    // Without this the part is full of accidentals where a key belongs.
    const score = scoreWith(71);
    const part = extractPart(score, score.tracks[0].id)!;
    for (const measure of part.tracks[0].measures) {
      expect(measure.keySignature.fifths).toBe(2); // concert C -> D major
    }
  });

  it('spells in the new key, not the old one', () => {
    // The whole reason the key is transposed first: concert E in a B-flat part
    // is F#, not Gb. Both are the same sound; only one is correct notation.
    const score = scoreWith(71);
    const part = extractPart(score, score.tracks[0].id)!;
    const third = allNotes(part).sort((a, b) => a.startTick - b.startTick)[2];
    expect(third.pitch.step).toBe('F');
    expect(third.pitch.accidental).toBe(1);
  });

  it('moves an octave-transposing instrument without touching its key', () => {
    const score = scoreWith(24); // Acoustic Guitar
    const part = extractPart(score, score.tracks[0].id)!;
    expect(steps(part)).toEqual(['C', 'D', 'E']);
    const written = allNotes(part).sort((a, b) => a.startTick - b.startTick);
    const sounding = allNotes(score)
      .filter((n) => n.trackId === score.tracks[0].id)
      .sort((a, b) => a.startTick - b.startTick);
    expect(written[0].pitch.octave).toBe(sounding[0].pitch.octave + 1);
    expect(part.tracks[0].measures[0].keySignature.fifths).toBe(0);
  });

  it('does not modify the score it was given', () => {
    // The derived part is print-only; the real score must be untouched.
    const score = scoreWith(71);
    const before = steps(score);
    extractPart(score, score.tracks[0].id);
    expect(steps(score)).toEqual(before);
  });

  it('keeps rests, ties and articulations', () => {
    // Only pitch and key change; everything else is the same music.
    const score = scoreWith(71);
    const part = extractPart(score, score.tracks[0].id)!;
    const sourceEvents = score.tracks[0].measures.flatMap((m) =>
      m.voices.flatMap((v) => v.events.length),
    );
    const partEvents = part.tracks[0].measures.flatMap((m) =>
      m.voices.flatMap((v) => v.events.length),
    );
    expect(partEvents).toEqual(sourceEvents);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test extract-part`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement it**

Create `~/projects/music_lib/src/domain/score/extract-part.ts`:

```ts
/**
 * A single track, written the way its player reads it.
 *
 * **Print-only.** The returned score is never saved, never played and never
 * edited — it is a notation of the music, not the music. Playback uses
 * sounding pitch, and routing this into it would make a trumpet sound a tone
 * sharp.
 *
 * Features 3 to 5 extend this same function with multi-measure rests,
 * rehearsal marks and cue notes, which is why part extraction is one place
 * rather than four.
 */
import { gmWrittenTransposition } from '../instruments/gm-transposition.js';
import { transposeKeySignature, transposePitch } from '../pitch/transpose.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { Measure, Score } from '@sudobility/music_types';

/** `measure` with its key and every pitch moved by `semitones`. */
function transposeMeasure(measure: Measure, semitones: number): Measure {
  // The key first: every pitch is then respelled *in the new key*, which is
  // what makes a B♭ part in concert C spell F♯ rather than G♭.
  const keySignature = transposeKeySignature(measure.keySignature, semitones);

  return {
    ...measure,
    keySignature,
    voices: measure.voices.map((voice) => ({
      ...voice,
      events: voice.events.map((event) =>
        isNoteEvent(event)
          ? { ...event, pitch: transposePitch(event.pitch, semitones, keySignature) }
          : event,
      ),
    })),
  };
}

/**
 * The part for `trackId`: that track alone, transposed for its instrument.
 *
 * Returns `null` when the track is not in the score, rather than an empty
 * score — an empty part and a missing one are different problems, and only one
 * of them is a bug.
 */
export function extractPart(score: Score, trackId: string): Score | null {
  const track = score.tracks.find((t) => t.id === trackId);
  if (!track) return null;

  const semitones = gmWrittenTransposition(track.midiProgram);
  if (semitones === 0) return { ...score, tracks: [track] };

  return {
    ...score,
    tracks: [
      {
        ...track,
        measures: track.measures.map((measure) => transposeMeasure(measure, semitones)),
      },
    ],
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test extract-part`
Expected: PASS. If the spelling test fails with G♭, the key is being transposed after the pitches rather than before — check the order in `transposeMeasure`.

- [ ] **Step 5: Export it**

Add to `~/projects/music_lib/src/index.ts`, beside the other score exports:

```ts
export * from './domain/score/extract-part.js';
```

- [ ] **Step 6: Verify and stage**

```bash
cd ~/projects/music_lib && bun run verify
bun run build
cp -r dist ~/projects/music_app/node_modules/@sudobility/music_lib/
rm -rf ~/projects/music_app/node_modules/.vite
```

Expected: PASS.

---

### Task 4: The print view uses it

**Files:**

- Modify: `~/projects/music_app/src/features/print/PrintView.tsx`
- Test: `~/projects/music_app/src/features/print/PrintView.test.tsx`

**Interfaces:**

- Consumes: `extractPart` (Task 3).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to `~/projects/music_app/src/features/print/PrintView.test.tsx`:

```tsx
describe('a part is written for its instrument', () => {
  /** A two-track score whose first track is a B-flat clarinet. */
  function clarinetStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    const score = twoTrackScore();
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t, i) =>
        i === 0 ? { ...t, midiProgram: 71, instrumentName: 'Clarinet' } : t,
      ),
    });
    return store;
  }

  it('no longer warns about concert pitch', () => {
    // The half of the caveat this feature makes untrue.
    const store = clarinetStore();
    render(<PrintView store={store} onBack={() => {}} />);
    expect(screen.queryByText(/concert pitch/i)).toBeNull();
  });

  it('leaves the score in the store at concert pitch', async () => {
    // The guard that matters: printing a transposed part must not transpose
    // the music. This failure would be silent.
    const user = userEvent.setup();
    const store = clarinetStore();
    const before = store
      .getState()
      .score!.tracks[0].measures[0].voices[0].events.filter((e) => 'pitch' in e)
      .map((e) => JSON.stringify((e as { pitch: unknown }).pitch));

    render(<PrintView store={store} onBack={() => {}} />);
    await user.click(screen.getByLabelText('What to print'));
    await user.click(screen.getByRole('option', { name: 'Clarinet' }));

    const after = store
      .getState()
      .score!.tracks[0].measures[0].voices[0].events.filter((e) => 'pitch' in e)
      .map((e) => JSON.stringify((e as { pitch: unknown }).pitch));
    expect(after).toEqual(before);
  });
});
```

Add `twoTrackScore` to the file's `@sudobility/music_lib` import if it is not already there.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: FAIL on the caveat test — it still says "concert pitch". The store test should already pass; it is a guard, and a guard that starts green is doing its job.

- [ ] **Step 3: Use `extractPart` and shorten the caveat**

In `~/projects/music_app/src/features/print/PrintView.tsx`, replace the `pages` memo and the score it renders. Change:

```tsx
const pages = useMemo(() => {
  if (!score) return [];
  return printSystems(computeLayout(score, printRenderOptions(trackIds)));
}, [score, trackIds]);
```

to:

```tsx
/**
 * The score actually printed.
 *
 * A single track goes through `extractPart`, which writes it for its
 * instrument — a clarinet part reads a tone above what it sounds. The whole
 * score does not: conductors read concert pitch, and it is the one place
 * every part must be comparable.
 */
const printedScore = useMemo(() => {
  if (!score) return null;
  return isSingleTrack ? extractPart(score, scope) : score;
}, [score, isSingleTrack, scope]);

const pages = useMemo(() => {
  if (!printedScore) return [];
  return printSystems(computeLayout(printedScore, printRenderOptions(trackIds)));
}, [printedScore, trackIds]);
```

Change the render to use `printedScore`:

```tsx
      {printedScore && pages.length > 0 ? (
        <div className="print-pages mx-auto max-w-[1000px] px-4 py-6">
          {pages.map((page) => (
            <PrintSystem
              key={page.systemIndex}
              score={printedScore}
              page={page}
              trackIds={trackIds}
            />
          ))}
        </div>
      ) : (
```

And shorten the caveat, which now only covers rests:

```tsx
<p className="w-full text-sm text-neutral-600">
  Single tracks print with every bar of rest written out. Fine for a lead sheet or a piano part; not
  yet an orchestral part.
</p>
```

Add the import:

```tsx
import { computeLayout, extractPart, selectVisibleTrackIds } from '@sudobility/music_lib';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: PASS.

- [ ] **Step 5: Full unit suite**

Run: `cd ~/projects/music_app && bun run verify`
Expected: PASS.

---

### Task 5: End to end

**Files:**

- Modify: `~/projects/music_app/e2e/print.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the spec**

Add to `~/projects/music_app/e2e/print.spec.ts`:

```ts
test('a transposing part prints written, and the editor stays at concert pitch', async ({
  page,
}) => {
  await openPrintView(page, 'Transposed Part', 8);

  // Make the first track a B-flat clarinet through the store: the point here
  // is the printed pitch, not how the instrument got set.
  await page.evaluate(() => {
    const store = (
      window as unknown as {
        __SCORESMITH_STORE__: {
          getState: () => {
            score: { tracks: Array<{ id: string }> } | null;
            setScore: (s: unknown) => void;
          };
        };
      }
    ).__SCORESMITH_STORE__;
    const score = store.getState().score as unknown as {
      tracks: Array<Record<string, unknown>>;
    };
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t, i) =>
        i === 0 ? { ...t, midiProgram: 71, instrumentName: 'Clarinet' } : t,
      ),
    });
  });

  const concertBefore = await page.evaluate(() => {
    const store = (
      window as unknown as { __SCORESMITH_STORE__: { getState: () => { score: unknown } } }
    ).__SCORESMITH_STORE__;
    return JSON.stringify(store.getState().score);
  });

  await page.getByLabel('What to print').click();
  await page.getByRole('option', { name: 'Clarinet' }).click();
  await expect(page.locator('[data-testid^="print-system-"]').first()).toBeVisible();

  // The caveat lost its concert-pitch half.
  await expect(page.getByText(/concert pitch/i)).toHaveCount(0);

  // And the score itself never moved.
  const concertAfter = await page.evaluate(() => {
    const store = (
      window as unknown as { __SCORESMITH_STORE__: { getState: () => { score: unknown } } }
    ).__SCORESMITH_STORE__;
    return JSON.stringify(store.getState().score);
  });
  expect(concertAfter).toBe(concertBefore);
});
```

- [ ] **Step 2: Run it**

```bash
cd ~/projects/music_app
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e print
```

Expected: PASS. Needs a local Postgres `music_test` DB and `../music_api`'s dependencies installed.

- [ ] **Step 3: Full suites**

```bash
cd ~/projects/music_lib && bun run verify
cd ~/projects/music_app && bun run verify
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
bun run test:e2e
```

Expected: all pass.

- [ ] **Step 4: Look at a transposed part**

Set a track to Clarinet, print it, and check by eye: the key signature has two more sharps than the score's, and the notes sit a tone higher. Then check the editor still shows the original pitches.

This is worth doing by hand because the failure it catches — a part transposed the wrong direction — passes every test that only checks _that_ it moved.

---

## Self-Review

**Spec coverage.** The table with its named instruments and the 0 default → Task 1. The fifths shift and the standard cases → Task 2. `extractPart`, key-before-pitches, spelling in the new key → Task 3. Print view using it for a single track only, and the shortened caveat → Task 4. Not reaching playback, the editor or the whole score → Tasks 3, 4 and 5, each asserted. Human check → Task 5 Step 4.

**Deliberate gaps, stated rather than hidden:**

- **Nothing asserts transposition stays out of playback**, because nothing routes `extractPart` anywhere near it — the guard is that only `PrintView` calls it. If a later feature passes a part to the engine, that is the moment to add the test.
- **The table's octave cases are conventions, not laws.** Guitar-an-octave-up is standard; some editions differ. They are in because a guitarist reading concert pitch is reading the wrong octave.
- **Features 3 to 7 untouched**, as the spec states. The caveat still mentions rests, and feature 3 deletes that half too.

**Type consistency.** `gmWrittenTransposition(program: number): number` is the same name in Tasks 1, 3 and its export. `transposeKeySignature(key, semitones): KeySignature` matches between Task 2 and its use in Task 3. `extractPart(score, trackId): Score | null` returns nullable in Task 3 and is handled as nullable in Task 4's `printedScore`.

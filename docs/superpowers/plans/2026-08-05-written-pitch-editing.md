# Written-Pitch Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let a clarinet part be written and edited as the clarinet reads it, without changing what the score stores or what it sounds like.

**Architecture:** A display transformation (`writtenScore`) and an input transformation (`soundingPitch`) in `music_lib`, both built on the transposition `extractPart` already uses. The notation view and the inspector read the transformed score; only absolute pitch entry converts back. Stored data is never round-tripped.

**Tech Stack:** TypeScript (strict), VexFlow 4.2.5, Vitest, React 19, Zustand, Playwright, Bun.

## Global Constraints

- **Feature 7 of seven, and the last.**
- **The store keeps sounding pitch, always.** The toggle is a lens on notation.
- **Display transforms one way; input transforms the other way once, at entry; stored data is never round-tripped.** Measured: over 1323 combinations of pitch, key and transposition, the round trip changes the sounding pitch **0** times and the spelling **567** times. Round-tripping stored notes would churn accidental spellings.
- **`writtenScore` returns its input object unchanged when no track transposes.** `computeLayout` is cached by score identity; a fresh object per render re-formats every VexFlow object every frame.
- **The derived score must be memoized** on `(score, pitchDisplay)`.
- **Position-based edits convert nothing, but must read their base pitch from the stored score.** Pitch-drag captures `hitEvent.pitch` today, which in written mode is a _written_ pitch — storing it would be a real bug. The step count needs no conversion; the base pitch does.
- **Out of scope, per the spec:** the piano keyboard (a concert-pitch instrument), playback, MIDI export, and both print modes.
- **Do not commit or push.** `scripts/push_all.sh` does that.
- After changing `music_lib`: `bun run build`, copy `dist` into `music_app/node_modules/@sudobility/music_lib/`, then `rm -rf node_modules/.vite` in `music_app`.

---

## File Structure

| File                                                      | Responsibility                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `music_lib/src/domain/score/written-pitch.ts`             | **New.** The shared transposition, `writtenScore`, `soundingPitch`. |
| `music_lib/src/domain/score/extract-part.ts`              | Imports the shared transposition instead of owning one.             |
| `music_lib/src/store/slices/ui-slice.ts`                  | `pitchDisplay` + `setPitchDisplay`.                                 |
| `music_lib/src/services/prefs.ts`                         | `pitchDisplay` on `DevicePrefs`.                                    |
| `music_app/src/app/App.tsx`                               | Load and persist it.                                                |
| `music_app/src/features/score-editor/ScoreEditorView.tsx` | Draw the displayed score; drag from the stored pitch.               |
| `music_app/src/features/score-editor/EditorToolbar.tsx`   | The toggle.                                                         |
| `music_app/src/components/inspector/InspectorPanel.tsx`   | Show written, store sounding.                                       |

---

### Task 1: One transposition, two directions

**Files:**

- Create: `~/projects/music_lib/src/domain/score/written-pitch.ts`
- Create: `~/projects/music_lib/src/domain/score/written-pitch.test.ts`
- Modify: `~/projects/music_lib/src/domain/score/extract-part.ts`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**

- Consumes: `gmWrittenTransposition`, `transposeKeySignature`, `transposePitch`.
- Produces:

```ts
export function transposeMeasure(measure: Measure, semitones: number): Measure;
export function writtenScore(score: Score): Score;
export function soundingPitch(
  written: Pitch,
  midiProgram: number,
  soundingKey: KeySignature,
): Pitch;
```

- [x] **Step 1: Write the failing test**

Create `~/projects/music_lib/src/domain/score/written-pitch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyScore } from './factory.js';
import { addNoteCommand } from '../commands/note-commands.js';
import { allNotes } from './queries.js';
import { soundingPitch, writtenScore } from './written-pitch.js';
import { transposeKeySignature, transposePitch } from '../pitch/transpose.js';
import { pitchToMidi } from '../pitch/pitch.js';
import type { KeySignature, Pitch, Score } from '@sudobility/music_types';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

/** A score whose tracks carry the given GM programs, each with a C4 in bar 1. */
function scoreWithPrograms(programs: number[]): Score {
  const base = createEmptyScore({
    title: 'Written',
    measures: 2,
    tracks: programs.map((_, i) => ({
      name: `T${i}`,
      instrumentName: `T${i}`,
      clef: 'treble' as const,
    })),
  });
  const withPrograms: Score = {
    ...base,
    tracks: base.tracks.map((t, i) => ({ ...t, midiProgram: programs[i] })),
  };
  return withPrograms.tracks.reduce(
    (acc, track) =>
      addNoteCommand({
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch('C'),
        startTick: 0,
        durationTicks: base.ppq,
      }).execute(acc),
    withPrograms,
  );
}

describe('writtenScore', () => {
  it('moves each track by its own interval', () => {
    // Clarinet (71) reads a tone up, alto sax (65) a major sixth up, piano (0)
    // not at all. One score, three answers.
    const score = scoreWithPrograms([71, 65, 0]);
    const written = writtenScore(score);
    const noteOf = (s: Score, track: number) =>
      allNotes(s).find((n) => n.trackId === s.tracks[track].id)!;

    expect(pitchToMidi(noteOf(written, 0).pitch) - pitchToMidi(noteOf(score, 0).pitch)).toBe(2);
    expect(pitchToMidi(noteOf(written, 1).pitch) - pitchToMidi(noteOf(score, 1).pitch)).toBe(9);
    expect(pitchToMidi(noteOf(written, 2).pitch)).toBe(pitchToMidi(noteOf(score, 2).pitch));
  });

  it('moves the key signature with the pitches, per track', () => {
    const written = writtenScore(scoreWithPrograms([71, 0]));
    expect(written.tracks[0].measures[0].keySignature.fifths).toBe(2); // concert C -> D
    expect(written.tracks[1].measures[0].keySignature.fifths).toBe(0);
  });

  it('returns the identical object when nothing transposes', () => {
    // Not a copy: `computeLayout` is cached by score identity, so a fresh
    // object per render would re-format every VexFlow object every frame.
    const score = scoreWithPrograms([0, 1, 2]);
    expect(writtenScore(score)).toBe(score);
  });

  it('does not modify the score it was given', () => {
    const score = scoreWithPrograms([71]);
    const before = JSON.stringify(score);
    writtenScore(score);
    expect(JSON.stringify(score)).toBe(before);
  });

  it('keeps every event and measure id, so selection survives the toggle', () => {
    const score = scoreWithPrograms([71]);
    const written = writtenScore(score);
    expect(allNotes(written).map((n) => n.id)).toEqual(allNotes(score).map((n) => n.id));
    expect(written.tracks[0].measures.map((m) => m.id)).toEqual(
      score.tracks[0].measures.map((m) => m.id),
    );
  });
});

describe('soundingPitch', () => {
  it('undoes the written transposition', () => {
    // A clarinettist reading D sounds C.
    const written = pitch('D');
    const sounding = soundingPitch(written, 71, { fifths: 0, mode: 'major' });
    expect(sounding.step).toBe('C');
    expect(sounding.accidental).toBe(0);
  });

  it('leaves a non-transposing instrument alone, object and all', () => {
    const p = pitch('D');
    expect(soundingPitch(p, 0, { fifths: 0, mode: 'major' })).toBe(p);
  });
});

describe('round-trip fidelity', () => {
  /**
   * The measurement the whole architecture rests on: sounding -> written ->
   * sounding is exact in *pitch* and lossy in *spelling*. Pinned as a
   * regression test so a future change to `transposePitch` cannot quietly make
   * the pitch half wrong, which would corrupt scores rather than merely
   * respell them.
   */
  it('never changes the sounding pitch, and changes only spellings', () => {
    let pitchWrong = 0;
    let spellingOnly = 0;
    let total = 0;

    for (const semitones of [2, 7, 9, 14, 21, -12, 12]) {
      for (const fifths of [-7, -5, -3, -1, 0, 1, 3, 5, 7]) {
        const key: KeySignature = { fifths, mode: 'major' };
        const writtenKey = transposeKeySignature(key, semitones);
        for (const step of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const) {
          for (const accidental of [-1, 0, 1]) {
            total += 1;
            const p = { step, accidental, octave: 4 } as unknown as Pitch;
            const w = transposePitch(p, semitones, writtenKey);
            const back = transposePitch(w, -semitones, key);
            if (pitchToMidi(back) !== pitchToMidi(p)) pitchWrong += 1;
            else if (back.step !== p.step || back.accidental !== p.accidental) spellingOnly += 1;
          }
        }
      }
    }

    expect({ total, pitchWrong }).toEqual({ total: 1323, pitchWrong: 0 });
    // Recorded, not aspired to: this is why stored notes are never
    // round-tripped through the display.
    expect(spellingOnly).toBe(567);
  });

  it('is exact in both pitch and spelling for naturals', () => {
    // What a user actually enters most of the time.
    for (const semitones of [2, 7, 9, 14, 21, -12, 12]) {
      for (const fifths of [-5, -3, -1, 0, 1, 3, 5]) {
        const key: KeySignature = { fifths, mode: 'major' };
        const writtenKey = transposeKeySignature(key, semitones);
        for (const step of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const) {
          const p = { step, accidental: 0, octave: 4 } as unknown as Pitch;
          const back = transposePitch(transposePitch(p, semitones, writtenKey), -semitones, key);
          expect(pitchToMidi(back)).toBe(pitchToMidi(p));
        }
      }
    }
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test written-pitch`
Expected: FAIL — the module does not exist.

- [x] **Step 3: Move the transposition into its own module**

Create `~/projects/music_lib/src/domain/score/written-pitch.ts`, moving
`transposeEvents` and `transposeMeasure` **verbatim** out of `extract-part.ts`
(they are unchanged; only their home moves, so there is one transposition in
the codebase rather than two that can drift):

```ts
/**
 * Written pitch: what each player reads, as against what the score sounds.
 *
 * The model stores **sounding** pitch, and playback, MIDI export and any
 * comparison between tracks depend on that. This module is the lens: one way
 * for display, the other way for a pitch the user has just entered.
 *
 * **Stored notes are never round-tripped through it.** Measured over 1323
 * combinations of pitch, key and transposition, sounding -> written ->
 * sounding changes the pitch 0 times and the spelling 567 — so a deliberately
 * spelled C# would become Db the first time somebody toggled the view twice.
 */
import { gmWrittenTransposition } from '../instruments/gm-transposition.js';
import { transposeKeySignature, transposePitch } from '../pitch/transpose.js';
import { isNoteEvent } from '@sudobility/music_types';
import type { KeySignature, Measure, MusicalEvent, Pitch, Score } from '@sudobility/music_types';

/** `events` with every pitch moved by `semitones`, respelled in `keySignature`. */
export function transposeEvents(
  events: readonly MusicalEvent[],
  semitones: number,
  keySignature: KeySignature,
): MusicalEvent[] {
  return events.map((event) =>
    isNoteEvent(event)
      ? { ...event, pitch: transposePitch(event.pitch, semitones, keySignature) }
      : event,
  );
}

/** `measure` with its key, every pitch, and any cue moved by `semitones`. */
export function transposeMeasure(measure: Measure, semitones: number): Measure {
  // The key first: every pitch is then respelled *in the new key*, which is
  // what makes a B♭ part in concert C spell F♯ rather than G♭. Both are the
  // same sound; only one is correct notation.
  const keySignature = transposeKeySignature(measure.keySignature, semitones);

  const transposed: Measure = {
    ...measure,
    keySignature,
    voices: measure.voices.map((voice) => ({
      ...voice,
      events: transposeEvents(voice.events, semitones, keySignature),
    })),
  };

  // The cue transposes too, or a flute cue inside a clarinet part reads a tone
  // wrong against everything around it. Rebuilt rather than spread so a
  // measure with no cue does not gain an explicit `cue: undefined`.
  return measure.cue === undefined
    ? transposed
    : {
        ...transposed,
        cue: {
          ...measure.cue,
          events: transposeEvents(measure.cue.events, semitones, keySignature),
        },
      };
}

/**
 * `score` with every track written as its own player reads it.
 *
 * The whole-score sibling of `extractPart`'s per-track transposition: each
 * track moves by its own interval, with its own key signature, so a mixed
 * ensemble shows every staff as its player reads it.
 *
 * Returns the **identical object** when nothing transposes. `computeLayout` is
 * cached by score identity, so a fresh object per render would re-format every
 * VexFlow object on every frame — the exact cost the playback work avoids.
 */
export function writtenScore(score: Score): Score {
  if (!score.tracks.some((track) => gmWrittenTransposition(track.midiProgram) !== 0)) {
    return score;
  }

  return {
    ...score,
    tracks: score.tracks.map((track) => {
      const semitones = gmWrittenTransposition(track.midiProgram);
      return semitones === 0
        ? track
        : { ...track, measures: track.measures.map((m) => transposeMeasure(m, semitones)) };
    }),
  };
}

/**
 * The sounding pitch a player on `midiProgram` produces when reading `written`.
 *
 * The input half of the lens, applied **once**, at the moment a pitch is
 * entered. `soundingKey` is the stored measure's key, so the result is
 * respelled into the score's own key rather than the reader's.
 */
export function soundingPitch(
  written: Pitch,
  midiProgram: number,
  soundingKey: KeySignature,
): Pitch {
  const semitones = gmWrittenTransposition(midiProgram);
  return semitones === 0 ? written : transposePitch(written, -semitones, soundingKey);
}
```

- [x] **Step 4: Point `extract-part.ts` at it**

In `~/projects/music_lib/src/domain/score/extract-part.ts`, delete the local
`transposeEvents` and `transposeMeasure` and import them instead:

```ts
import { transposeMeasure } from './written-pitch.js';
```

Remove the now-unused imports: `transposeKeySignature`, `transposePitch`,
`isNoteEvent`, and the `KeySignature` / `MusicalEvent` type imports. The type
import line becomes:

```ts
import type { Measure, Score } from '@sudobility/music_types';
```

`Measure` is still used by the function signature; if `bun run lint` reports it
unused after the move, drop it too.

- [x] **Step 5: Export it**

Add to `~/projects/music_lib/src/index.ts`, beside the other score modules:

```ts
export * from './domain/score/written-pitch.js';
```

- [x] **Step 6: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test written-pitch extract-part`
Expected: PASS — including every feature 2-5 test, which is the point of moving
the function rather than copying it.

---

### Task 2: The toggle's state

**Files:**

- Modify: `~/projects/music_lib/src/store/slices/ui-slice.ts`
- Modify: `~/projects/music_lib/src/services/prefs.ts`
- Test: `~/projects/music_lib/src/store/slices/ui-slice.test.ts`

**Interfaces:**

- Produces: `PitchDisplay = 'concert' | 'written'`, `UiSlice.pitchDisplay`, `setPitchDisplay`, `DevicePrefs.pitchDisplay`.

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_lib/src/store/slices/ui-slice.test.ts`:

```ts
it('starts in concert pitch and toggles to written', () => {
  // Concert by default: nothing changes for anyone who does not ask.
  const store = createAppStore({ context: testStoreContext() });
  expect(store.getState().pitchDisplay).toBe('concert');
  store.getState().setPitchDisplay('written');
  expect(store.getState().pitchDisplay).toBe('written');
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test ui-slice`
Expected: FAIL — `pitchDisplay` is undefined and `setPitchDisplay` is not a function.

- [x] **Step 3: Add the state**

In `~/projects/music_lib/src/store/slices/ui-slice.ts`, add the type near the
other UI unions:

```ts
/** Whether notation shows what the score sounds, or what each player reads. */
export type PitchDisplay = 'concert' | 'written';
```

In `UiSlice`'s state, after `snapGrid`:

```ts
/**
 * Whether notation shows sounding pitch or each player's written pitch.
 *
 * A lens on notation only: the store always holds sounding pitch, and
 * playback, MIDI export and printing ignore this entirely.
 *
 * Persisted, unlike `editMode`: it is how this person likes to work, and it
 * means the same thing in every project.
 */
pitchDisplay: PitchDisplay;
```

In the setters block, after `setSnapGrid`:

```ts
  setPitchDisplay: (display: PitchDisplay) => void;
```

In the initial state, after `snapGrid: 'quarter',`:

```ts
  pitchDisplay: 'concert',
```

And the implementation, beside `setSnapGrid`'s:

```ts
  setPitchDisplay: (display) => {
    set((state) => {
      state.pitchDisplay = display;
    });
  },
```

In `~/projects/music_lib/src/services/prefs.ts`, add to `DevicePrefs`:

```ts
  pitchDisplay?: 'concert' | 'written';
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_lib && bun run test ui-slice`
Expected: PASS.

- [x] **Step 5: Verify, build and stage**

```bash
cd ~/projects/music_lib && bun run verify
bun run build
cp -r dist ~/projects/music_app/node_modules/@sudobility/music_lib/
rm -rf ~/projects/music_app/node_modules/.vite
```

Expected: PASS.

---

### Task 3: The notation view

**Files:**

- Modify: `~/projects/music_app/src/features/score-editor/ScoreEditorView.tsx`
- Test: `~/projects/music_app/src/features/score-editor/ScoreEditorView.test.tsx`

**Interfaces:**

- Consumes: `writtenScore` (Task 1), `pitchDisplay` (Task 2).

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_app/src/features/score-editor/ScoreEditorView.test.tsx`:

```tsx
describe('written-pitch display', () => {
  /** A one-track clarinet score with a C4 in bar 1. */
  function clarinetStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    const base = twinkleScore();
    store.getState().setScore({
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    });
    return store;
  }

  it('draws the same notation in concert pitch as an untransposed score', () => {
    // The default must not change anything.
    const store = clarinetStore();
    expect(store.getState().pitchDisplay).toBe('concert');
    render(<ScoreEditorView store={store} />);
    expect(store.getState().score!.tracks[0].measures[0].keySignature.fifths).toBe(0);
  });

  it('never writes the transposed score back to the store', () => {
    // The guard that matters: the lens must not become the model.
    const store = clarinetStore();
    const before = JSON.stringify(store.getState().score);
    store.getState().setPitchDisplay('written');
    render(<ScoreEditorView store={store} />);
    expect(JSON.stringify(store.getState().score)).toBe(before);
  });

  it('keeps the selection across a toggle', () => {
    // Ids survive the transformation, so nothing has to be remapped.
    const store = clarinetStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
    render(<ScoreEditorView store={store} />);

    store.getState().setPitchDisplay('written');
    expect(selectedNoteIds(store.getState().score!, store.getState().selection)).toEqual([noteId]);
  });
});
```

Add `allNotes`, `selectedNoteIds`, `twinkleScore` and `createAppStore` to the
file's `@sudobility/music_lib` import if they are not already there.
`ScoreSelection` is `{ eventIds, measureIds, trackIds }` — all three are
required, hence the empty arrays.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test ScoreEditorView`
Expected: the first and third PASS (they hold today), the second PASS as well —
all three pin behaviour that must survive Step 3 rather than drive it. This is
deliberate: the observable change is _what is drawn_, which is canvas ink, and
Step 4 asserts that separately.

- [x] **Step 3: Draw the displayed score**

In `~/projects/music_app/src/features/score-editor/ScoreEditorView.tsx`, beside
the other store reads (around line 352):

```tsx
const pitchDisplay = store((s) => s.pitchDisplay);
```

Then immediately after, derive the score everything below draws from:

```tsx
/**
 * The score as drawn — sounding pitch, or each player's written pitch.
 *
 * Memoized on the stored score and the mode, and `writtenScore` returns its
 * input unchanged in concert mode, so `computeLayout`'s identity cache is
 * untouched unless the lens is actually on.
 */
const displayScore = useMemo(
  () => (score && pitchDisplay === 'written' ? writtenScore(score) : score),
  [score, pitchDisplay],
);
```

Replace every use of `score` **in rendering and layout** with `displayScore` —
the `computeLayout` call, the renderer's `render(...)` argument, and the note
colour map. Leave every use that reads or writes model state (`store.getState().score`,
command dispatch, `resolveInsertTarget`) exactly as it is: those are the model,
not the lens.

Add to the `@sudobility/music_lib` import:

```tsx
  writtenScore,
```

- [x] **Step 4: Fix pitch-drag's base pitch**

This is a real bug the toggle would otherwise introduce. At the drag start
(around line 955), `hitEvent.pitch` comes from the drawn score, which in written
mode is a written pitch — dispatching `shiftDiatonic` of it would store the
written pitch as sounding.

Replace:

```tsx
pitchDragRef.current = { eventId: onlySelected, pitch: hitEvent.pitch, startY: point.y };
```

with:

```tsx
// The *stored* pitch, not the drawn one: in written mode they differ
// by the instrument's transposition, and the command writes sounding
// pitch. The step count below needs no such care — diatonic
// transposition preserves staff position, so "up two positions"
// means the same thing in either representation.
const stored = findEvent(store.getState().score!, onlySelected);
pitchDragRef.current = {
  eventId: onlySelected,
  pitch: stored && isNoteEvent(stored) ? stored.pitch : hitEvent.pitch,
  startY: point.y,
};
```

Add `findEvent` and `isNoteEvent` to the imports if they are not already there.

The live preview keeps using the drawn pitch — `scoreWithPitch` is applied to
`displayScore`, so the note the user sees follows the pointer in whatever
representation they are reading.

- [x] **Step 5: Write the test that proves it**

Add to the same describe:

```tsx
it('drags a note by staff position, storing the sounding pitch', async () => {
  // The bug the toggle would otherwise introduce: dragging in written mode
  // must not store the written pitch.
  const store = clarinetStore();
  const note = allNotes(store.getState().score!)[0];
  const before = pitchToMidi(note.pitch);

  store.getState().setPitchDisplay('written');
  render(<ScoreEditorView store={store} />);

  store.getState().dispatchCommand(changePitchCommand([note.id], shiftDiatonic(note.pitch, 1)));

  const after = pitchToMidi(allNotes(store.getState().score!)[0].pitch);
  // One diatonic step from the stored pitch: 1 or 2 semitones, never the
  // instrument's whole transposition on top.
  expect(after - before).toBeGreaterThan(0);
  expect(after - before).toBeLessThanOrEqual(2);
});
```

Add `changePitchCommand`, `shiftDiatonic` and `pitchToMidi` to the imports.

- [x] **Step 6: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test ScoreEditorView`
Expected: PASS.

- [x] **Step 7: Prove the drawn notation actually changes**

Add to the same describe — the assertion that the feature does anything:

```tsx
it('draws a different key signature in written mode', () => {
  // Canvas ink, so assert through the layout the renderer is given: a
  // clarinet in concert C reads D major, and the stave draws two sharps.
  const store = clarinetStore();
  const concert = computeLayout(store.getState().score!, layoutOptions());
  const written = computeLayout(writtenScore(store.getState().score!), layoutOptions());

  expect(store.getState().score!.tracks[0].measures[0].keySignature.fifths).toBe(0);
  expect(writtenScore(store.getState().score!).tracks[0].measures[0].keySignature.fifths).toBe(2);
  expect(written.systems.length).toBeGreaterThan(0);
  expect(concert.systems.length).toBeGreaterThan(0);
});
```

with, at the top of the describe:

```tsx
const layoutOptions = () => ({
  zoom: 1,
  layoutMode: 'page' as const,
  width: 1200,
  theme: LIGHT_RENDER_THEME,
});
```

Add `computeLayout` to the imports; `LIGHT_RENDER_THEME` comes from
`@/features/score-editor/render-theme`.

- [x] **Step 8: Run them again**

Run: `cd ~/projects/music_app && bun run test ScoreEditorView`
Expected: PASS.

---

### Task 4: The inspector

**Files:**

- Modify: `~/projects/music_app/src/components/inspector/InspectorPanel.tsx`
- Test: `~/projects/music_app/src/components/inspector/InspectorPanel.test.tsx`

**Interfaces:**

- Consumes: `soundingPitch` (Task 1), `gmWrittenTransposition`, `pitchDisplay`.

This is the one place a user types an **absolute** pitch, so it is the one place
the input half of the lens is needed.

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_app/src/components/inspector/InspectorPanel.test.tsx`:

```tsx
describe('written-pitch display', () => {
  function clarinetStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    const base = twinkleScore();
    store.getState().setScore({
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    });
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    return store;
  }

  it('reads out the written pitch in written mode', () => {
    // A clarinet sounding C reads D.
    const store = clarinetStore();
    store.getState().setPitchDisplay('written');
    render(<InspectorPanel store={store} />);
    expect(screen.getByLabelText('Pitch step')).toHaveValue('D');
  });

  it('reads out the sounding pitch in concert mode', () => {
    const store = clarinetStore();
    render(<InspectorPanel store={store} />);
    expect(screen.getByLabelText('Pitch step')).toHaveValue('C');
  });

  it('stores the sounding pitch when a written one is entered', () => {
    // The input half of the lens: type E in written mode, store D.
    const user = userEvent.setup();
    const store = clarinetStore();
    store.getState().setPitchDisplay('written');
    render(<InspectorPanel store={store} />);

    await user.selectOptions(screen.getByLabelText('Pitch step'), 'E');

    expect(allNotes(store.getState().score!)[0].pitch.step).toBe('D');
  });
});
```

Mark that third test `async`. The control is a `MixedSelect` with
`ariaLabel="Pitch step"`, which renders a `<select>`.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test InspectorPanel`
Expected: FAIL on the first and third — the panel shows and stores sounding
pitch unconditionally.

- [x] **Step 3: Put the lens on the readout and the input**

In `~/projects/music_app/src/components/inspector/InspectorPanel.tsx`, inside
`NoteTab`, after the existing store reads:

```tsx
const pitchDisplay = store((s) => s.pitchDisplay);
```

After `notes` is computed, derive what to show:

```tsx
/**
 * How many semitones the readout is shifted by, and the key it is spelled
 * in. Zero in concert mode, and zero for a non-transposing instrument, so
 * the common path is unchanged.
 */
const shift = (note: NoteEvent): number =>
  pitchDisplay === 'written'
    ? gmWrittenTransposition(findTrack(score, note.trackId)?.midiProgram ?? 0)
    : 0;

const shown = (note: NoteEvent): Pitch => {
  const semitones = shift(note);
  if (semitones === 0) return note.pitch;
  const key = measureOfNote(score, note)?.keySignature ?? { fifths: 0, mode: 'major' };
  return transposePitch(note.pitch, semitones, transposeKeySignature(key, semitones));
};
```

Replace the three pitch readouts to use it:

```tsx
const step = commonValue(notes.map((n) => shown(n).step));
const accidentalStr = commonValue(notes.map((n) => String(shown(n).accidental)));
const octave = commonValue(notes.map((n) => shown(n).octave));
```

And convert on the way in:

```tsx
const applyPitchPatch = (
  patch: Partial<{ step: PitchStep; accidental: Accidental; octave: number }>,
): void => {
  for (const note of notes) {
    // The patch is against what the user is *reading*, so apply it there and
    // convert once. Never a round trip: the stored pitch is replaced, not
    // fed back through the lens.
    const edited = { ...shown(note), ...patch };
    const program = findTrack(score, note.trackId)?.midiProgram ?? 0;
    const key = measureOfNote(score, note)?.keySignature ?? { fifths: 0, mode: 'major' };
    const next = pitchDisplay === 'written' ? soundingPitch(edited, program, key) : edited;
    store.getState().dispatchCommand(changePitchCommand([note.id], next));
  }
};
```

`music_lib` has `findMeasure(score, measureId)`, but a `NoteEvent` carries no
measure id — only `trackId` and `startTick`. Add a local helper that uses those,
which searches one track's measures rather than every event in the score:

```tsx
/** The measure holding `note`, found by its track and tick, for the key signature. */
function measureOfNote(score: Score, note: NoteEvent): Measure | null {
  const track = findTrack(score, note.trackId);
  return (
    track?.measures.find(
      (m) => note.startTick >= m.startTick && note.startTick < m.startTick + m.durationTicks,
    ) ?? null
  );
}
```

Add `gmWrittenTransposition`, `soundingPitch`, `transposePitch` and
`transposeKeySignature` to the `@sudobility/music_lib` import, and `Measure`,
`Pitch`, `Score` to the type import.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test InspectorPanel`
Expected: PASS.

---

### Task 5: The toggle

**Files:**

- Modify: `~/projects/music_app/src/features/score-editor/EditorToolbar.tsx`
- Modify: `~/projects/music_app/src/app/App.tsx`
- Test: `~/projects/music_app/src/features/score-editor/EditorToolbar.test.tsx`

**Interfaces:**

- Consumes: `pitchDisplay`, `setPitchDisplay` (Task 2).

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_app/src/features/score-editor/EditorToolbar.test.tsx`:

```tsx
it('toggles between concert and written pitch', async () => {
  const user = userEvent.setup();
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  render(<EditorToolbar store={store} />);

  await user.click(screen.getByRole('button', { name: /written pitch/i }));
  expect(store.getState().pitchDisplay).toBe('written');

  await user.click(screen.getByRole('button', { name: /concert pitch/i }));
  expect(store.getState().pitchDisplay).toBe('concert');
});
```

If `EditorToolbar` takes props beyond `store` in this file's existing tests,
match whatever they pass.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test EditorToolbar`
Expected: FAIL — no such button.

- [x] **Step 3: Add the control**

In `~/projects/music_app/src/features/score-editor/EditorToolbar.tsx`, read the
state beside the other toolbar reads:

```tsx
const pitchDisplay = store((s) => s.pitchDisplay);
```

and add a button in the same group as the other view controls. Its accessible
name states what clicking it _does_, so the two assertions above address two
different states of one control:

```tsx
<Button
  type="button"
  variant={pitchDisplay === 'written' ? 'primary' : 'ghost'}
  aria-pressed={pitchDisplay === 'written'}
  aria-label={pitchDisplay === 'written' ? 'Show concert pitch' : 'Show written pitch'}
  title="Show each player's written pitch, or what the score sounds"
  onClick={() =>
    store.getState().setPitchDisplay(pitchDisplay === 'written' ? 'concert' : 'written')
  }
>
  {pitchDisplay === 'written' ? 'Written' : 'Concert'}
</Button>
```

- [x] **Step 4: Persist it**

In `~/projects/music_app/src/app/App.tsx`, read it beside the other persisted
prefs and extend both effects:

```tsx
const pitchDisplay = store((s) => s.pitchDisplay);
```

In the bootstrap effect, after the `developerMode` line:

```tsx
if (prefs.pitchDisplay) store.getState().setPitchDisplay(prefs.pitchDisplay);
```

In the persist effect:

```tsx
    void savePrefs(prefsStorage, { themeMode, developerMode, pitchDisplay });
  }, [themeMode, developerMode, pitchDisplay]);
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test EditorToolbar App`
Expected: PASS.

- [x] **Step 6: Check the label sweep still passes**

Run: `cd ~/projects/music_app && bun run test duplicate`
Expected: PASS. A duplicate accessible label broke 18 e2e tests once before;
this adds two new ones ("Show written pitch" / "Show concert pitch").

---

### Task 6: End to end, and the whole suite

**Files:**

- Create: `~/projects/music_app/e2e/written-pitch.spec.ts`

- [x] **Step 1: Write the e2e**

```ts
test('written pitch changes the notation but not the score', async ({ page }) => {
  await gotoDashboard(page);
  await createNewProject(page, 'Written Pitch');
  await generateWholeScore(page, { prompt: 'Create a calm clarinet study', measures: 8 });
  await waitForNotation(page);

  // Make track 0 a clarinet, which reads a tone above concert pitch.
  await page.evaluate(() => {
    type Store = {
      getState: () => {
        score: { tracks: Array<Record<string, unknown>> };
        setScore: (s: unknown) => void;
      };
    };
    const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
    const score = store.getState().score;
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t, i) => (i === 0 ? { ...t, midiProgram: 71 } : t)),
    });
  });

  const soundingBefore = await page.evaluate(() => {
    const store = (
      window as unknown as {
        __SCORESMITH_STORE__: {
          getState: () => {
            score: {
              tracks: Array<{
                measures: Array<{ voices: Array<{ events: Array<Record<string, unknown>> }> }>;
              }>;
            };
          };
        };
      }
    ).__SCORESMITH_STORE__;
    const events = store
      .getState()
      .score.tracks[0].measures.flatMap((m) => m.voices.flatMap((v) => v.events));
    return JSON.stringify(events.map((e) => e.pitch ?? null));
  });

  await page.getByRole('button', { name: 'Show written pitch' }).click();
  await expect(page.getByRole('button', { name: 'Show concert pitch' })).toBeVisible();

  const soundingAfter = await page.evaluate(() => {
    const store = (
      window as unknown as {
        __SCORESMITH_STORE__: {
          getState: () => {
            score: {
              tracks: Array<{
                measures: Array<{ voices: Array<{ events: Array<Record<string, unknown>> }> }>;
              }>;
            };
          };
        };
      }
    ).__SCORESMITH_STORE__;
    const events = store
      .getState()
      .score.tracks[0].measures.flatMap((m) => m.voices.flatMap((v) => v.events));
    return JSON.stringify(events.map((e) => e.pitch ?? null));
  });

  // The lens must not become the model.
  expect(soundingAfter).toBe(soundingBefore);
});
```

The file needs `import { expect, test } from '@playwright/test';` and
`import { createNewProject, generateWholeScore, gotoDashboard, waitForNotation } from './helpers';`.

- [x] **Step 2: Run everything**

```bash
cd ~/projects/music_lib && bun run verify
cd ~/projects/music_app && bun run verify
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e
```

Expected: all pass.

- [x] **Step 3: Look at it**

Open a score with a clarinet or trumpet track and toggle. Check by eye: the
notation moves up a tone and gains two sharps, playback sounds identical either
way, the caret and any selection stay where they were, and printing a part is
unchanged by the toggle. Then toggle twice and confirm no note's spelling
changed — that is the round-trip rule holding in practice.

---

## Self-Review

**Spec coverage.** Display transform → Task 1 (`writtenScore`) and Task 3. Input transform → Task 1 (`soundingPitch`) and Task 4. Never round-trip stored data → Task 1's regression test, plus Tasks 3 and 4 asserting the store is untouched. Identical object when nothing transposes → Task 1. Memoization → Task 3. Position-based edits need no conversion but must read the stored base pitch → Task 3 Steps 4-5. Ids survive → Task 1 and Task 3. Toggle state, persisted, default concert → Tasks 2 and 5. Keyboard/playback/MIDI/print untouched → no task changes them; Task 6 checks print and playback by eye. e2e → Task 6.

**Deliberate gaps, stated rather than hidden:**

- **Task 3 Step 2 expects its tests to pass immediately.** They pin behaviour that must survive the change rather than drive it, because the observable effect is canvas ink. Step 7 is the test that would fail without the feature, and it is written against `computeLayout` rather than the canvas for the same reason feature 4's mark test ended up asserting `fillText`.
- **The inspector's `measureOfNote` scans one track's measures** per selected note per render. Bounded by bar count, not note count, and the panel only renders when something is selected. `findMeasure` in `music_lib` could not be reused: a `NoteEvent` carries no measure id.
- **`shown()` recomputes per readout** (three times per note). Trivial, and clearer than memoizing three values that must agree.
- **Two accessible labels for one button.** "Show written pitch" and "Show concert pitch" name the _action_, not the state, which is what a button should do — but it means an e2e cannot locate the control without knowing the current mode. Task 6 relies on that deliberately, as the assertion that the click worked.

**Type consistency.** `PitchDisplay` is defined in Task 2 and used in Tasks 3, 4 and 5. `writtenScore(score): Score` is produced in Task 1 and consumed in Task 3. `soundingPitch(written, midiProgram, soundingKey): Pitch` is produced in Task 1 and consumed in Task 4. `transposeMeasure` moves in Task 1 Step 3 and is imported by `extract-part.ts` in Step 4 — the same signature it had, so features 2-5 are unaffected. `DevicePrefs.pitchDisplay` is added in Task 2 and read/written in Task 5.

---

## Execution Notes (2026-08-05)

All six tasks complete. No `music_types` change — this is a lens, not a model
change. Suites green: music_lib 1035, music_app 540, e2e 32.

Verified by eye on a clarinet track: concert mode draws no accidentals, written
mode draws two sharps with every note a staff position higher, and toggling
twice leaves every stored spelling byte-identical — the round-trip rule holding
in practice, not just in the unit test.

**Two corrections to the plan, both found by reading the code rather than
trusting the plan's description of it:**

1. **The pitch-drag bug I predicted does not exist.** I claimed the drag
   captures `hitEvent.pitch` from the drawn score; it already reads
   `findEvent(state.score, …)` — the stored one. No fix was needed.

2. **There is a different, real ordering bug, and the plan would have shipped
   it.** A `displayScore` memo already existed for the generation and drag
   previews, and the drag preview splices in a **sounding** pitch. Applying the
   written lens _before_ it would draw the dragged note an instrument's
   transposition below its own staff. `writtenScore` therefore runs **last**,
   over everything else. The test for it discriminates: with the order
   reversed, the dragged note's delta against its neighbours would be 0 instead
   of 2.

**Two test-shape corrections:**

- `ScoreSelection` is `{ eventIds, measureIds, trackIds }`, not
  `{ kind, noteIds }` — the plan's shape was invented.
- The inspector's pitch control is a Radix `MixedSelect` (a `<button
role="combobox">`), so `toHaveValue` and `selectOptions` cannot work. The
  tests drive it by clicking trigger then option, which is where an earlier
  select bug hid.

`transposeMeasure` moved out of `extract-part.ts` into `written-pitch.ts` and
is imported back, so there is one transposition in the codebase rather than
two. All 27 feature 2-5 tests pass against the moved function unchanged.

Not committed — `scripts/push_all.sh` owns commits.

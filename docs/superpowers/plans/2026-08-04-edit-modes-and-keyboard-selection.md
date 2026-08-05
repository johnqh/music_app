# Edit Modes and Keyboard Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give note entry an explicit mode — insert, replace, or stack — and make the piano keyboard the way to add and remove notes from a selected chord.

**Architecture:** A single `editMode` in `music_lib`'s ui-slice governs every path that writes a note. Ripple insert is a new domain command in `music_lib`, built on the existing `moveNotesCommand`. In `music_app`, the keyboard gains a second job: with a single chord selected it toggles pitches instead of entering them, and a click on a chord now selects the whole chord.

**Tech Stack:** TypeScript (strict), Zustand + immer, React 19, VexFlow (canvas), Vitest + Testing Library, Playwright, Bun.

## Global Constraints

- **`editMode` replaces `chordMode` outright.** `ui-slice.chordMode: boolean` and `setChordMode` do not survive this plan; nothing should read them afterwards.
- **Default is `'replace'`** — today's behaviour, so no existing muscle memory breaks.
- **Mode governs everything that writes notes**: piano keys, Insert Note, Insert Rest, paste.
- **Mode does not govern simultaneity.** Keys held down together are one chord in every mode; that grouping already exists in `PianoKeyboardView` and must keep working unchanged.
- **`insert` shifts the active track only**, and grows _every_ track when content passes the last barline. Content is never dropped.
- **Keyboard pitch-editing engages only when the selection is a single chord** — every selected note sharing one start tick.
- **`stack` is unavailable on monophonic instruments** (`gmMaxPolyphony(program) === 1`), disabled in the UI with the instrument named; the per-edit block in `insertChordAtCaret` stays as the backstop.
- **Do not commit or push.** `scripts/push_all.sh` does that. Leave every change in the working tree.
- `music_app` currently builds against a locally-staged `music_lib` build; after changing `music_lib`, run `bun run build` there and copy `dist` into `music_app/node_modules/@sudobility/music_lib/`, then `rm -rf node_modules/.vite` in `music_app` or the browser will serve a stale module.

---

## File Structure

| File                                                          | Responsibility                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `music_lib/src/store/slices/ui-slice.ts`                      | `editMode` state + `setEditMode`; `chordMode` removed.                                    |
| `music_lib/src/domain/commands/ripple-commands.ts`            | **New.** `insertWithRippleCommand` — shift the active track, grow all tracks on overflow. |
| `music_lib/src/index.ts`                                      | Export the new command module.                                                            |
| `music_app/src/features/score-editor/editing.ts`              | Mode dispatch: `insertChordAtCaret` honours `editMode`.                                   |
| `music_app/src/features/score-editor/hit-test.ts`             | `eventIdsAtPoint` — every id sharing the hit box.                                         |
| `music_app/src/features/score-editor/ScoreEditorView.tsx`     | A chord click selects the whole chord.                                                    |
| `music_app/src/features/score-editor/EditorToolbar.tsx`       | Three-way mode control replacing the chord toggle.                                        |
| `music_app/src/features/piano-keyboard/selection-editing.ts`  | **New.** Pure: is the selection one chord, and what does toggling a pitch mean.           |
| `music_app/src/features/piano-keyboard/PianoKeyboardView.tsx` | Selection-editing behaviour + the second lit state.                                       |
| `music_app/e2e/edit-modes.spec.ts`                            | **New.** One test per mode, plus select-chord-then-toggle.                                |

---

### Task 1: `editMode` replaces `chordMode`

**Files:**

- Modify: `~/projects/music_lib/src/store/slices/ui-slice.ts`
- Test: `~/projects/music_lib/src/store/slices/ui-slice.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export type EditMode = 'insert' | 'replace' | 'stack'`; `UiSlice.editMode: EditMode` (default `'replace'`); `UiSlice.setEditMode: (mode: EditMode) => void`. Both exported from the package root via the existing `export * from './store/slices/ui-slice.js'`.

- [ ] **Step 1: Write the failing test**

Replace the whole `describe('visible tracks', ...)` sibling block named `chord mode` if one exists, and add to `~/projects/music_lib/src/store/slices/ui-slice.test.ts`:

```ts
describe('edit mode', () => {
  it('defaults to replace, which is what the editor already did', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(store.getState().editMode).toBe('replace');
  });

  it('sets each mode', () => {
    const store = createAppStore({ context: testStoreContext() });
    for (const mode of ['insert', 'stack', 'replace'] as const) {
      store.getState().setEditMode(mode);
      expect(store.getState().editMode).toBe(mode);
    }
  });

  it('does not mark the project dirty', () => {
    // A mode is how you are editing, not part of the music. Persisting it
    // would queue a save on every toggle.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setEditMode('insert');
    expect(store.getState().dirty).toBe(false);
  });
});
```

Also update the defaults test at the top of the file: change the line `expect(state.visibleTrackIds).toBeNull();` to be followed by:

```ts
expect(state.editMode).toBe('replace');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test ui-slice`
Expected: FAIL — `editMode` is undefined and `setEditMode` is not a function.

- [ ] **Step 3: Replace the state**

In `~/projects/music_lib/src/store/slices/ui-slice.ts`, add above `export type UiSlice`:

```ts
/**
 * What happens to music already at the caret when a new note is written.
 *
 * `insert` shifts the active track's later notes out of the way, `replace`
 * overwrites them, `stack` joins them as a chord. Deliberately NOT about
 * whether one gesture makes a chord — keys held together are one chord in
 * every mode, because that is what playing them means.
 */
export type EditMode = 'insert' | 'replace' | 'stack';
```

Replace the whole `chordMode` doc comment and field in `UiSlice` with:

```ts
/**
 * What writing a note does to music already at the caret.
 *
 * Lives here rather than in the editor because everything that writes notes
 * — the toolbar, the piano keyboard, paste — sits in different subtrees and
 * must agree.
 *
 * Not persisted: it is how you are editing right now, not a property of the
 * piece, and saving it would queue a write on every toggle.
 */
editMode: EditMode;
```

Replace `setChordMode: (enabled: boolean) => void;` with:

```ts
  setEditMode: (mode: EditMode) => void;
```

Replace the initial value `chordMode: false,` with:

```ts
  editMode: 'replace',
```

Replace the `setChordMode` action with:

```ts
  setEditMode: (mode) => {
    set((state) => {
      state.editMode = mode;
    });
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test ui-slice`
Expected: PASS.

- [ ] **Step 5: Confirm nothing still reads `chordMode`**

Run: `cd ~/projects/music_lib && grep -rn "chordMode" src/ || echo clean`
Expected: `clean`. (`music_app` still references it and is fixed in Task 4.)

---

### Task 2: `insertWithRippleCommand`

**Files:**

- Create: `~/projects/music_lib/src/domain/commands/ripple-commands.ts`
- Create: `~/projects/music_lib/src/domain/commands/ripple-commands.test.ts`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**

- Consumes: `EditMode` from Task 1 (only conceptually — this command is mode-agnostic).
- Produces:

```ts
export type RippleInsertParams = {
  trackId: UUID;
  measureId: UUID;
  voiceIndex: number;
  pitch: Pitch;
  startTick: number;
  durationTicks: number;
  articulation?: Articulation;
};
export function insertWithRippleCommand(params: RippleInsertParams): ScoreCommand;
```

**Why a new command rather than a flag on `addNoteCommand`:** `addNoteCommand` is documented as measure-local by design ("an add always targets one named measure"). A ripple spans measures and can grow the score, so bolting it on would break that contract.

- [ ] **Step 1: Write the failing test**

Create `~/projects/music_lib/src/domain/commands/ripple-commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { allNotes, findTrack } from '../score/queries.js';
import { addNoteCommand } from './note-commands.js';
import { insertWithRippleCommand } from './ripple-commands.js';
import type { Pitch, Score } from '@sudobility/music_types';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

/** Two tracks, four measures, with a quarter note on each beat of track 0. */
function scoreWithMelody(): Score {
  let score = createEmptyScore({
    title: 'Ripple',
    measures: 4,
    tracks: [
      { name: 'Lead', instrumentName: 'Piano', clef: 'treble' as const },
      { name: 'Bass', instrumentName: 'Piano', clef: 'bass' as const },
    ],
  });
  const track = score.tracks[0];
  const ppq = score.ppq;
  ['C', 'D', 'E', 'F'].forEach((step, i) => {
    score = addNoteCommand({
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: pitch(step),
      startTick: i * ppq,
      durationTicks: ppq,
    }).apply(score);
  });
  return score;
}

const onTrack = (score: Score, index: number) =>
  allNotes(score)
    .filter((n) => n.trackId === score.tracks[index].id)
    .sort((a, b) => a.startTick - b.startTick);

describe('insertWithRippleCommand', () => {
  it('pushes later notes in the track out of the way', () => {
    const score = scoreWithMelody();
    const track = score.tracks[0];
    const ppq = score.ppq;

    const next = insertWithRippleCommand({
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: pitch('G'),
      startTick: ppq, // where D currently sits
      durationTicks: ppq,
    }).apply(score);

    const steps = onTrack(next, 0).map((n) => n.pitch.step);
    expect(steps.slice(0, 5)).toEqual(['C', 'G', 'D', 'E', 'F']);
  });

  it('keeps every displaced note, rather than dropping the tail', () => {
    const score = scoreWithMelody();
    const before = onTrack(score, 0).length;
    const track = score.tracks[0];

    const next = insertWithRippleCommand({
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: pitch('G'),
      startTick: 0,
      durationTicks: score.ppq,
    }).apply(score);

    expect(onTrack(next, 0).length).toBe(before + 1);
  });

  it('leaves other tracks where they were', () => {
    // The whole point of 'active track only': the edited part moves against
    // its accompaniment.
    const score = scoreWithMelody();
    const track = score.tracks[0];
    const bassBefore = onTrack(score, 1).map((n) => n.startTick);

    const next = insertWithRippleCommand({
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: pitch('G'),
      startTick: 0,
      durationTicks: score.ppq,
    }).apply(score);

    expect(onTrack(next, 1).map((n) => n.startTick)).toEqual(bassBefore);
  });

  it('grows every track when content passes the last barline', () => {
    // Measures are per-track but the layout assumes a shared grid, so growing
    // only the edited track would misalign every barline beneath it.
    let score = createEmptyScore({
      title: 'Full',
      measures: 1,
      tracks: [
        { name: 'Lead', instrumentName: 'Piano', clef: 'treble' as const },
        { name: 'Bass', instrumentName: 'Piano', clef: 'bass' as const },
      ],
    });
    const track = score.tracks[0];
    const ppq = score.ppq;
    // Fill the only measure completely.
    ['C', 'D', 'E', 'F'].forEach((step, i) => {
      score = addNoteCommand({
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch(step),
        startTick: i * ppq,
        durationTicks: ppq,
      }).apply(score);
    });

    const next = insertWithRippleCommand({
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: pitch('G'),
      startTick: 0,
      durationTicks: ppq,
    }).apply(score);

    expect(findTrack(next, next.tracks[0].id)!.measures.length).toBeGreaterThan(1);
    // Both tracks, or the barlines stop lining up.
    expect(next.tracks[0].measures.length).toBe(next.tracks[1].measures.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test ripple-commands`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the command**

Create `~/projects/music_lib/src/domain/commands/ripple-commands.ts`:

```ts
/**
 * Insert that pushes existing music out of the way, rather than overwriting it.
 *
 * Separate from `addNoteCommand`, which is measure-local by design: a ripple
 * spans measures and can lengthen the score, so folding it into that command
 * would break the contract its callers rely on.
 */
import { appendMeasure } from '../score/factory.js';
import { allNotes, scoreEndTick } from '../score/queries.js';
import { addNoteCommand, moveNotesCommand } from './note-commands.js';
import { transformCommand } from './snapshot.js';
import type { ScoreCommand } from './types.js';
import type { Articulation, Pitch, Score, UUID } from '@sudobility/music_types';

export type RippleInsertParams = {
  trackId: UUID;
  measureId: UUID;
  voiceIndex: number;
  pitch: Pitch;
  startTick: number;
  durationTicks: number;
  articulation?: Articulation;
};

/**
 * Room for `durationTicks` more music on `trackId`, adding measures to EVERY
 * track when the shifted tail would pass the final barline.
 *
 * All tracks, not just the edited one: measures are per-track, but the layout
 * takes each measure's width as the maximum density across tracks at that
 * index, so a track with more measures than its neighbours would misalign
 * every barline beneath it.
 */
function growToFit(score: Score, trackId: UUID, neededTicks: number): Score {
  const track = score.tracks.find((t) => t.id === trackId);
  if (!track) return score;

  const lastNoteEnd = allNotes(score)
    .filter((n) => n.trackId === trackId)
    .reduce((end, n) => Math.max(end, n.startTick + n.durationTicks), 0);

  let next = score;
  while (lastNoteEnd + neededTicks > scoreEndTick(next)) {
    next = appendMeasure(next);
  }
  return next;
}

export function insertWithRippleCommand(params: RippleInsertParams): ScoreCommand {
  return transformCommand('Insert note', (score) => {
    const grown = growToFit(score, params.trackId, params.durationTicks);

    // Everything at or after the caret on this track moves later. Gathered by
    // id rather than by span, because `moveNotesCommand` is the primitive that
    // already knows how to re-place notes and reflow their measures.
    const displaced = allNotes(grown)
      .filter((n) => n.trackId === params.trackId && n.startTick >= params.startTick)
      .map((n) => n.id);

    const shifted = displaced.length
      ? moveNotesCommand(displaced, {
          deltaTicks: params.durationTicks,
          deltaSemitones: 0,
        }).apply(grown)
      : grown;

    return addNoteCommand({
      trackId: params.trackId,
      measureId: params.measureId,
      voiceIndex: params.voiceIndex,
      pitch: params.pitch,
      startTick: params.startTick,
      durationTicks: params.durationTicks,
      ...(params.articulation ? { articulation: params.articulation } : {}),
    }).apply(shifted);
  });
}
```

If `ScoreCommand` is not exported from `./types.js`, find its real module with `grep -rn "export type ScoreCommand" ~/projects/music_lib/src` and import from there. If `ScoreCommand` has no `.apply(score)` method, read `snapshot.ts` and use whatever the existing commands use to run one against a score — `note-commands.test.ts` shows the established idiom.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test ripple-commands`
Expected: PASS. If the "grows every track" test still fails, check whether `moveNotesCommand` clamps notes to the measure rather than carrying them across the barline — if it does, the fix is to grow _before_ moving, which `growToFit` already does; widen the growth loop rather than dropping the assertion.

- [ ] **Step 5: Export it**

Add to `~/projects/music_lib/src/index.ts`, beside the other command exports (find them with `grep -n "domain/commands" src/index.ts`):

```ts
export * from './domain/commands/ripple-commands.js';
```

- [ ] **Step 6: Verify the package**

Run: `cd ~/projects/music_lib && bun run verify`
Expected: PASS.

- [ ] **Step 7: Stage the build for `music_app`**

```bash
cd ~/projects/music_lib && bun run build
cp -r dist ~/projects/music_app/node_modules/@sudobility/music_lib/
rm -rf ~/projects/music_app/node_modules/.vite
```

---

### Task 3: Mode dispatch in the editor

**Files:**

- Modify: `~/projects/music_app/src/features/score-editor/editing.ts`
- Test: `~/projects/music_app/src/features/score-editor/chord-entry.test.ts`

**Interfaces:**

- Consumes: `editMode` (Task 1), `insertWithRippleCommand` (Task 2), and the existing `insertChordAtCaret(store, pitches, { duration?, advanceCaret? })`.
- Produces: `insertChordAtCaret` unchanged in signature, now honouring `editMode`.

- [ ] **Step 1: Write the failing tests**

Add to `~/projects/music_app/src/features/score-editor/chord-entry.test.ts`, inside the existing `describe('insertChordAtCaret', ...)`:

```ts
describe('edit modes', () => {
  /** Writes a C quarter at tick 0 so there is something to displace. */
  function withExistingNote(store: EditorStoreApi): void {
    store.getState().setSnapGrid('quarter');
    insertChordAtCaret(store, [pitch('C')]);
  }

  it('replace mode overwrites what was there', () => {
    const store = makeStore(0);
    store.getState().setEditMode('replace');
    withExistingNote(store);

    insertChordAtCaret(store, [pitch('E')]);

    expect(notesAt(store, 0).map((n) => n.pitch.step)).toEqual(['E']);
  });

  it('stack mode joins what was there', () => {
    const store = makeStore(0);
    store.getState().setEditMode('stack');
    withExistingNote(store);

    insertChordAtCaret(store, [pitch('E')]);

    expect(
      notesAt(store, 0)
        .map((n) => n.pitch.step)
        .sort(),
    ).toEqual(['C', 'E']);
  });

  it('insert mode pushes what was there later', () => {
    const store = makeStore(0);
    store.getState().setEditMode('insert');
    withExistingNote(store);

    insertChordAtCaret(store, [pitch('E')]);

    const ppq = store.getState().score!.ppq;
    expect(notesAt(store, 0).map((n) => n.pitch.step)).toEqual(['E']);
    expect(notesAt(store, ppq).map((n) => n.pitch.step)).toEqual(['C']);
  });

  it('stack mode still refuses a chord the instrument cannot play', () => {
    const store = makeStore(56); // Trumpet
    store.getState().setEditMode('stack');
    withExistingNote(store);

    expect(insertChordAtCaret(store, [pitch('E')])).toBe(false);
    expect(notesAt(store, 0).map((n) => n.pitch.step)).toEqual(['C']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ~/projects/music_app && bun run test chord-entry`
Expected: FAIL — `setEditMode` is not a function, and insert/stack behave identically to replace.

- [ ] **Step 3: Dispatch on the mode**

In `~/projects/music_app/src/features/score-editor/editing.ts`, inside `insertChordAtCaret`, replace the loop that dispatches `addNoteCommand` per pitch:

```ts
for (const pitch of pitches) {
  dispatchTracked(
    store,
    addNoteCommand({
      trackId: target.trackId,
      measureId: target.measureId,
      voiceIndex: target.voiceIndex,
      pitch,
      startTick: target.startTick,
      durationTicks,
    }),
  );
}
```

with:

```ts
const mode = state.editMode;
for (const pitch of pitches) {
  dispatchTracked(
    store,
    mode === 'insert'
      ? insertWithRippleCommand({
          trackId: target.trackId,
          measureId: target.measureId,
          voiceIndex: target.voiceIndex,
          pitch,
          startTick: target.startTick,
          durationTicks,
        })
      : addNoteCommand({
          trackId: target.trackId,
          measureId: target.measureId,
          voiceIndex: target.voiceIndex,
          pitch,
          startTick: target.startTick,
          durationTicks,
        }),
  );
}
```

`replace` and `stack` both go through `addNoteCommand`, because reflow already distinguishes them: same start _and_ same duration clusters into a chord (stack), and a differing duration lets the later note win the span (replace). Only the first pitch of a chord ripples — the rest join it at the tick the ripple opened up, which is why the mode is read once before the loop rather than inside it.

Add the import beside the other command imports:

```ts
import { insertWithRippleCommand } from '@sudobility/music_lib';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test chord-entry`
Expected: PASS. If `stack` fails because the second note replaced the first, check that `withExistingNote` and the second insert used the same `snapGrid` — differing durations do not cluster, by design.

- [ ] **Step 5: Fix the ripple-per-pitch case**

The loop above would ripple once per pitch of a chord, opening three gaps for a triad. Guard it so only the first pitch ripples:

```ts
const mode = state.editMode;
pitches.forEach((pitch, index) => {
  // Only the first note of a chord opens a gap; its siblings land in the gap
  // it made. Rippling per pitch would push the tail three beats for a triad.
  const useRipple = mode === 'insert' && index === 0;
  dispatchTracked(
    store,
    useRipple
      ? insertWithRippleCommand({
          trackId: target.trackId,
          measureId: target.measureId,
          voiceIndex: target.voiceIndex,
          pitch,
          startTick: target.startTick,
          durationTicks,
        })
      : addNoteCommand({
          trackId: target.trackId,
          measureId: target.measureId,
          voiceIndex: target.voiceIndex,
          pitch,
          startTick: target.startTick,
          durationTicks,
        }),
  );
});
```

- [ ] **Step 6: Test that guard**

Add to the `edit modes` describe block:

```ts
it('a chord in insert mode opens one gap, not one per note', () => {
  const store = makeStore(0);
  store.getState().setEditMode('insert');
  withExistingNote(store);

  insertChordAtCaret(store, [pitch('E'), pitch('G')]);

  const ppq = store.getState().score!.ppq;
  // The displaced C moved by one note's worth, not two.
  expect(notesAt(store, ppq).map((n) => n.pitch.step)).toEqual(['C']);
});
```

Run: `cd ~/projects/music_app && bun run test chord-entry`
Expected: PASS.

---

### Task 4: The three-way mode control

**Files:**

- Modify: `~/projects/music_app/src/features/score-editor/EditorToolbar.tsx`
- Modify: `~/projects/music_app/src/components/icons/notation-icons.tsx`
- Test: `~/projects/music_app/src/features/score-editor/EditorToolbar.test.tsx`

**Interfaces:**

- Consumes: `editMode`/`setEditMode` (Task 1), `gmMaxPolyphony` (already published).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe('chord mode toggle', ...)` block at the end of `~/projects/music_app/src/features/score-editor/EditorToolbar.test.tsx` with:

```ts
describe('edit mode control', () => {
  it('shows replace as the active mode by default', () => {
    const store = makeStore();
    renderToolbar(store);
    expect(screen.getByLabelText('Replace mode')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Insert mode')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches mode', async () => {
    const store = makeStore();
    renderToolbar(store);

    await userEvent.click(screen.getByLabelText('Insert mode'));
    expect(store.getState().editMode).toBe('insert');
    expect(screen.getByLabelText('Insert mode')).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables stack on a monophonic instrument', () => {
    // Offering a mode that would refuse every edit is worse than not offering
    // it: the refusal only shows up after you have tried to play something.
    const store = makeStore();
    const score = store.getState().score!;
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t) => ({ ...t, midiProgram: 56, instrumentName: 'Trumpet' })),
    });
    renderToolbar(store);

    expect(screen.getByLabelText('Stack mode')).toBeDisabled();
    expect(screen.getByLabelText('Replace mode')).toBeEnabled();
  });

  it('leaves stack available on a polyphonic instrument', () => {
    const store = makeStore();
    const score = store.getState().score!;
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t) => ({ ...t, midiProgram: 0, instrumentName: 'Piano' })),
    });
    renderToolbar(store);

    expect(screen.getByLabelText('Stack mode')).toBeEnabled();
  });

  it('falls back off stack when the active track cannot play chords', () => {
    // The mode is set before the track changes; leaving it on stack would mean
    // every subsequent edit silently refuses.
    const store = makeStore();
    store.getState().setEditMode('stack');
    const score = store.getState().score!;
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t) => ({ ...t, midiProgram: 56, instrumentName: 'Trumpet' })),
    });
    renderToolbar(store);

    expect(store.getState().editMode).toBe('replace');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ~/projects/music_app && bun run test EditorToolbar`
Expected: FAIL — the labels do not exist, and `setEditMode` is not a function.

- [ ] **Step 3: Add the two missing icons**

In `~/projects/music_app/src/components/icons/notation-icons.tsx`, beside the existing `ChordIcon`, add:

```tsx
/** Insert mode: a note arriving between two others, which is what it does. */
export function InsertModeIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={4.5} cy={HEAD_Y} rx={2.6} ry={1.9} />
      <ellipse cx={19.5} cy={HEAD_Y} rx={2.6} ry={1.9} />
      <path
        d="M12 6.5 L12 19.5 M8.5 10 L12 6.5 L15.5 10"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

/** Replace mode: a note landing on top of one that was already there. */
export function ReplaceModeIcon(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx={12} cy={HEAD_Y} rx={3.4} ry={2.4} />
      <path
        d="M12 5 L12 12.5 M8.5 9 L12 5 L15.5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}
```

Check the existing `Glyph` and `GlyphProps` in that file and match how other icons declare fill vs stroke — several use filled shapes with no explicit `stroke`, so these two set it explicitly only on the path.

- [ ] **Step 4: Replace the toggle with a three-way group**

In `~/projects/music_app/src/features/score-editor/EditorToolbar.tsx`, replace `const chordMode = store((s) => s.chordMode);` with:

```tsx
const editMode = store((s) => s.editMode);
const activeTrackId = store(selectActiveTrackId);
const activeTrack = score?.tracks.find((t) => t.id === activeTrackId) ?? null;
const canStack = gmMaxPolyphony(activeTrack?.midiProgram ?? 0) > 1;

// A mode set before the track changed would otherwise refuse every edit,
// and the refusal only surfaces after you try to play something.
useEffect(() => {
  if (editMode === 'stack' && !canStack) store.getState().setEditMode('replace');
}, [editMode, canStack, store]);

const EDIT_MODES: Array<{ value: EditMode; Icon: NotationIcon; label: string; hint: string }> = [
  {
    value: 'insert',
    Icon: InsertModeIcon,
    label: 'Insert mode',
    hint: 'Insert: notes you add push this track’s later notes out of the way',
  },
  {
    value: 'replace',
    Icon: ReplaceModeIcon,
    label: 'Replace mode',
    hint: 'Replace: notes you add overwrite what was already there',
  },
  {
    value: 'stack',
    Icon: ChordIcon,
    label: 'Stack mode',
    hint: canStack
      ? 'Stack: notes you add join what is already there, building a chord'
      : `Stack needs an instrument that can play more than one note at a time — ${activeTrack?.instrumentName ?? 'this one'} cannot`,
  },
];
```

Then replace the whole chord-mode `<Tooltip>…</Tooltip>` block with:

```tsx
<div role="group" aria-label="Edit mode" className="flex items-center gap-0.5">
  {EDIT_MODES.map((option) => (
    <Tooltip placement="bottom" key={option.value} content={option.hint}>
      <Button
        type="button"
        variant="ghost"
        aria-label={option.label}
        aria-pressed={editMode === option.value}
        disabled={!hasScore || (option.value === 'stack' && !canStack)}
        onClick={() => store.getState().setEditMode(option.value)}
        className={TOGGLE_BUTTON_CLASS}
      >
        <option.Icon className={ICON_GLYPH_CLASS} />
      </Button>
    </Tooltip>
  ))}
</div>
```

Add the imports: `InsertModeIcon` and `ReplaceModeIcon` beside `ChordIcon` in the icons import; `selectActiveTrackId` and `gmMaxPolyphony` from `@sudobility/music_lib`; and `EditMode` as a type import from `@sudobility/music_lib`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test EditorToolbar`
Expected: PASS.

- [ ] **Step 6: Confirm nothing still reads `chordMode`**

Run: `cd ~/projects/music_app && grep -rn "chordMode" src/ e2e/ || echo clean`
Expected: `clean` — `PianoKeyboardView.tsx` is fixed in Task 6, so if it still appears, do that task next before running the full suite.

---

### Task 5: Selecting a whole chord

**Files:**

- Modify: `~/projects/music_app/src/features/score-editor/hit-test.ts`
- Modify: `~/projects/music_app/src/features/score-editor/ScoreEditorView.tsx:865-885`
- Test: `~/projects/music_app/src/features/score-editor/hit-test.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export function eventIdsAtPoint(idToBBox: ReadonlyMap<string, BBox>, point: Point): string[]`.

- [ ] **Step 1: Write the failing test**

Add to `~/projects/music_app/src/features/score-editor/hit-test.test.ts` (match the file's existing import style):

```ts
describe('eventIdsAtPoint', () => {
  const box = { x: 10, y: 10, width: 20, height: 20 };

  it('returns every id sharing a box, which is what a chord is', () => {
    // Every note of a chord is drawn as one VexFlow StaveNote, so the renderer
    // maps them all to the same box. Returning one of them is what made a
    // chord impossible to select.
    const map = new Map([
      ['c', box],
      ['e', box],
      ['g', box],
    ]);
    expect(eventIdsAtPoint(map, { x: 15, y: 15 }).sort()).toEqual(['c', 'e', 'g']);
  });

  it('returns only the ids under the point', () => {
    const map = new Map([
      ['hit', box],
      ['elsewhere', { x: 100, y: 100, width: 5, height: 5 }],
    ]);
    expect(eventIdsAtPoint(map, { x: 15, y: 15 })).toEqual(['hit']);
  });

  it('returns an empty list when nothing is under the point', () => {
    expect(eventIdsAtPoint(new Map([['a', box]]), { x: 0, y: 0 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test hit-test`
Expected: FAIL — `eventIdsAtPoint` is not exported.

- [ ] **Step 3: Implement it**

Add to `~/projects/music_app/src/features/score-editor/hit-test.ts`, directly below `eventIdAtPoint`:

```ts
/**
 * Every event id whose bbox contains `point`.
 *
 * A chord's notes are drawn as one VexFlow `StaveNote`, so the renderer maps
 * all of their ids to the same box — `eventIdAtPoint` therefore returns an
 * arbitrary member and no click can reach the others. Selecting the whole
 * chord is the honest answer to a click on overlapping noteheads; picking
 * individual notes out of it is the piano keyboard's job.
 */
export function eventIdsAtPoint(idToBBox: ReadonlyMap<string, BBox>, point: Point): string[] {
  const ids: string[] = [];
  for (const [id, box] of idToBBox) {
    if (pointInBBox(box, point)) ids.push(id);
  }
  return ids;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd ~/projects/music_app && bun run test hit-test`
Expected: PASS.

- [ ] **Step 5: Select the whole chord on click**

In `~/projects/music_app/src/features/score-editor/ScoreEditorView.tsx`, in the `// ---- click on a note.` block, replace:

```tsx
state.setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
```

with:

```tsx
// The whole chord, not one arbitrary member of it: every note in a
// chord shares one bounding box, so "the note you clicked" is not a
// question the geometry can answer.
const chordIds = result ? eventIdsAtPoint(result.idToBBox, point) : [noteId];
state.setSelection({
  eventIds: chordIds.length > 0 ? chordIds : [noteId],
  measureIds: [],
  trackIds: [],
});
```

Add `eventIdsAtPoint` to the existing `hit-test` import.

- [ ] **Step 6: Run the editor tests**

Run: `cd ~/projects/music_app && bun run test ScoreEditorView`
Expected: PASS. Existing single-note tests still pass because a lone note's box holds only its own id.

---

### Task 6: The keyboard edits the selection

**Files:**

- Create: `~/projects/music_app/src/features/piano-keyboard/selection-editing.ts`
- Create: `~/projects/music_app/src/features/piano-keyboard/selection-editing.test.ts`
- Modify: `~/projects/music_app/src/features/piano-keyboard/PianoKeyboardView.tsx`
- Test: `~/projects/music_app/src/features/piano-keyboard/PianoKeyboardView.test.tsx`

**Interfaces:**

- Consumes: `selectSelectedNotes` (already exported), `insertChordAtCaret` (Task 3), `gmMaxPolyphony`.
- Produces:

```ts
export type ChordSelection = {
  startTick: number;
  durationTicks: number;
  trackId: string;
  notes: NoteEvent[];
};
/** The selection as one editable chord, or null when it is not exactly one. */
export function chordSelection(notes: readonly NoteEvent[]): ChordSelection | null;
```

- [ ] **Step 1: Write the failing pure tests**

Create `~/projects/music_app/src/features/piano-keyboard/selection-editing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chordSelection } from '@/features/piano-keyboard/selection-editing';
import type { NoteEvent } from '@sudobility/music_types';

const note = (id: string, startTick: number, durationTicks = 480, trackId = 't1'): NoteEvent =>
  ({
    id,
    startTick,
    durationTicks,
    trackId,
    voiceId: 'v1',
    pitch: { step: 'C', accidental: 0, octave: 4 },
    velocity: 80,
  }) as unknown as NoteEvent;

describe('chordSelection', () => {
  it('is null for an empty selection', () => {
    expect(chordSelection([])).toBeNull();
  });

  it('treats a single note as a chord of one', () => {
    const result = chordSelection([note('a', 0)]);
    expect(result?.notes).toHaveLength(1);
    expect(result?.startTick).toBe(0);
  });

  it('accepts notes that share a start tick', () => {
    const result = chordSelection([note('a', 0), note('b', 0), note('c', 0)]);
    expect(result?.notes).toHaveLength(3);
  });

  it('is null when the selection spans several ticks', () => {
    // Two chords have no single chord to edit, and guessing which one the
    // player meant would be worse than doing nothing.
    expect(chordSelection([note('a', 0), note('b', 480)])).toBeNull();
  });

  it('is null when the selection spans several tracks', () => {
    expect(chordSelection([note('a', 0, 480, 't1'), note('b', 0, 480, 't2')])).toBeNull();
  });

  it('takes the duration from the notes', () => {
    expect(chordSelection([note('a', 0, 960)])?.durationTicks).toBe(960);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test selection-editing`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the rule**

Create `~/projects/music_app/src/features/piano-keyboard/selection-editing.ts`:

```ts
/**
 * When the piano keyboard edits the selection instead of entering notes.
 *
 * Pure over a note list — no store, no DOM — so the rule that decides between
 * the keyboard's two jobs is testable on its own, in the same shape as
 * `tap-to-note.ts` and `pitch-drag.ts`.
 */
import type { NoteEvent } from '@sudobility/music_types';

export type ChordSelection = {
  startTick: number;
  durationTicks: number;
  trackId: string;
  notes: NoteEvent[];
};

/**
 * The selection as one editable chord, or `null` when it is not exactly one.
 *
 * A chord is notes sharing a start tick on one track. A selection spanning
 * several ticks contains more than one chord, and there is no defensible way
 * to guess which the player meant — so the keyboard stays in entry mode rather
 * than editing something arbitrary.
 */
export function chordSelection(notes: readonly NoteEvent[]): ChordSelection | null {
  if (notes.length === 0) return null;

  const [first] = notes;
  const sameChord = notes.every(
    (n) => n.startTick === first.startTick && n.trackId === first.trackId,
  );
  if (!sameChord) return null;

  return {
    startTick: first.startTick,
    durationTicks: first.durationTicks,
    trackId: first.trackId,
    notes: [...notes],
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd ~/projects/music_app && bun run test selection-editing`
Expected: PASS.

- [ ] **Step 5: Write the failing keyboard tests**

Add to `~/projects/music_app/src/features/piano-keyboard/PianoKeyboardView.test.tsx`:

```tsx
describe('the keyboard edits a selected chord', () => {
  function storeWithChord(): { store: EditorStoreApi; ids: string[] } {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(createEmptyScore({ title: 'Sel', measures: 2 }));
    const track = store.getState().score!.tracks[0];
    for (const step of ['C', 'E', 'G']) {
      store.getState().dispatchCommand(
        addNoteCommand({
          trackId: track.id,
          measureId: track.measures[0].id,
          voiceIndex: 0,
          pitch: { step, accidental: 0, octave: 4 } as never,
          startTick: 0,
          durationTicks: store.getState().score!.ppq,
        }),
      );
    }
    const ids = allNotes(store.getState().score!)
      .filter((n) => n.startTick === 0)
      .map((n) => n.id);
    store.getState().setSelection({ eventIds: ids, measureIds: [], trackIds: [] });
    return { store, ids };
  }

  it('lights the selected pitches', () => {
    const { store } = storeWithChord();
    const { container } = render(<PianoKeyboardView store={store} />);
    expect(key(container, 60)).toHaveAttribute('data-selected', 'true'); // C4
    expect(key(container, 64)).toHaveAttribute('data-selected', 'true'); // E4
    expect(key(container, 62)).toHaveAttribute('data-selected', 'false'); // D4
  });

  it('removes a note when its lit key is pressed', () => {
    const { store } = storeWithChord();
    const { container } = render(<PianoKeyboardView store={store} />);

    fireEvent.pointerDown(key(container, 64), { pointerId: 1 });
    fireEvent.pointerUp(key(container, 64), { pointerId: 1 });

    expect(
      allNotes(store.getState().score!)
        .map((n) => n.pitch.step)
        .sort(),
    ).toEqual(['C', 'G']);
  });

  it('adds a note when an unlit key is pressed', () => {
    const { store } = storeWithChord();
    const { container } = render(<PianoKeyboardView store={store} />);

    fireEvent.pointerDown(key(container, 62), { pointerId: 1 }); // D4
    fireEvent.pointerUp(key(container, 62), { pointerId: 1 });

    const atZero = allNotes(store.getState().score!).filter((n) => n.startTick === 0);
    expect(atZero.map((n) => n.pitch.step).sort()).toEqual(['C', 'D', 'E', 'G']);
  });

  it('does not write at the caret while editing a selection', () => {
    // The two jobs must not both happen: that would add a note AND move on.
    const { store } = storeWithChord();
    const { container } = render(<PianoKeyboardView store={store} />);
    const seek = vi.mocked(playbackController.seek);
    seek.mockClear();

    fireEvent.pointerDown(key(container, 62), { pointerId: 1 });
    fireEvent.pointerUp(key(container, 62), { pointerId: 1 });

    expect(seek).not.toHaveBeenCalled();
  });

  it('stays in entry mode when the selection spans several ticks', () => {
    const { store } = storeWithChord();
    const track = store.getState().score!.tracks[0];
    store.getState().dispatchCommand(
      addNoteCommand({
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: { step: 'A', accidental: 0, octave: 4 } as never,
        startTick: store.getState().score!.ppq,
        durationTicks: store.getState().score!.ppq,
      }),
    );
    const all = allNotes(store.getState().score!).map((n) => n.id);
    store.getState().setSelection({ eventIds: all, measureIds: [], trackIds: [] });

    const { container } = render(<PianoKeyboardView store={store} />);
    const seek = vi.mocked(playbackController.seek);
    seek.mockClear();

    fireEvent.pointerDown(key(container, 62), { pointerId: 1 });
    fireEvent.pointerUp(key(container, 62), { pointerId: 1 });

    // Entry mode advances the caret; edit mode never does.
    expect(seek).toHaveBeenCalled();
  });
});
```

Add `addNoteCommand` to the file's `@sudobility/music_lib` import.

- [ ] **Step 6: Run them to verify they fail**

Run: `cd ~/projects/music_app && bun run test PianoKeyboardView`
Expected: FAIL — no `data-selected` attribute, and keys always enter notes.

- [ ] **Step 7: Implement the behaviour**

In `~/projects/music_app/src/features/piano-keyboard/PianoKeyboardView.tsx`:

Add the store reads near the existing ones:

```tsx
const selectedNotes = store(selectSelectedNotes);
const editableChord = useMemo(() => chordSelection(selectedNotes), [selectedNotes]);
const selectedMidis = useMemo(
  () => new Set((editableChord?.notes ?? []).map((n) => pitchToMidi(n.pitch))),
  [editableChord],
);
```

Replace the body of `releaseKey`'s note-writing section — everything from `const group = chordRef.current;` to the end of the callback — with:

```tsx
      const group = chordRef.current;
      chordRef.current = null;
      if (!group || group.midis.length === 0) return;

      const score = store.getState().score;
      if (!score) return;

      // With one chord selected the keyboard edits it instead of entering
      // notes: a lit key removes its note, an unlit one joins the chord. The
      // two jobs are exclusive — doing both would add a note and move on.
      if (editableChord) {
        for (const midi of group.midis) {
          const existing = editableChord.notes.find((n) => pitchToMidi(n.pitch) === midi);
          if (existing) {
            deleteEvents(store, [existing.id]);
          } else {
            insertChordAtCaret(store, [midiToPitch(midi)], {
              duration: undefined,
              advanceCaret: false,
            });
          }
        }
        return;
      }

      const bpm = score.tempoMap[0]?.bpm ?? 120;
      // Wrapped, not point-free: `map` would pass the index into
      // `midiToPitch`'s key-signature parameter.
      const pitches = group.midis.map((midi) => midiToPitch(midi));
      insertChordAtCaret(store, pitches, {
        duration: durationForTap(performance.now() - group.firstPressAt, bpm),
        advanceCaret: true,
      });
    },
    [store, editableChord],
  );
```

Adding to a selected chord must land at the chord's tick, not the caret. If the caret is elsewhere, `insertChordAtCaret` writes in the wrong place — so before the loop, seek the caret to the chord: `playbackController.seek(editableChord.startTick);`. Verify with the "adds a note" test, which asserts the new note is at tick 0.

Pass the selected state into each key:

```tsx
              isSelected={selectedMidis.has(key.midi)}
              selectedColor={theme.noteSelected}
```

and in the key component, add the props and render them:

```tsx
      data-selected={isSelected ? 'true' : 'false'}
```

with the background falling back through the two states — a sounding key wins over a selected one, since it is the more transient signal:

```tsx
        backgroundColor: isLit
          ? litColor
          : isSelected
            ? selectedColor
            : isBlack
              ? '#1f1f23'
              : '#fbfbfd',
```

Add imports: `chordSelection` from `./selection-editing`, `selectSelectedNotes` and `pitchToMidi` from `@sudobility/music_lib`, and `deleteEvents` from `@/features/score-editor/editing` (check its exported name with `grep -n "export function delete" src/features/score-editor/editing.ts` — it may be `deleteSelected`, in which case add a `deleteEvents(store, ids)` export beside it that dispatches `deleteEventsCommand(ids)` through `dispatchTracked`).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test PianoKeyboardView selection-editing`
Expected: PASS, including the pre-existing chord and melody tests.

- [ ] **Step 9: Full unit suite**

Run: `cd ~/projects/music_app && bun run verify`
Expected: PASS.

---

### Task 7: End-to-end

**Files:**

- Create: `~/projects/music_app/e2e/edit-modes.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

**Why:** with `playbackController` mocked, unit tests cannot tell a chord from an arpeggio because the caret never moves — proven in the previous round. Only e2e exercises the real caret.

- [ ] **Step 1: Write the spec**

Create `~/projects/music_app/e2e/edit-modes.spec.ts`, reusing the `playChord` helper pattern from `e2e/chord-entry.spec.ts` (copy it — the two specs are read independently):

```ts
/**
 * The three edit modes, and editing a selected chord from the keyboard.
 *
 * e2e rather than unit, because unit tests mock `playbackController` and so
 * cannot observe where the caret actually goes — which is the whole
 * difference between insert, replace and a chord.
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

async function tapKey(page: import('@playwright/test').Page, midi: number, heldMs = 250) {
  await page.evaluate(
    async ({ midi, heldMs }) => {
      const el = document.querySelector(`[data-testid="piano-key-${midi}"]`);
      if (!el) throw new Error(`no key on screen for midi ${midi}`);
      const box = el.getBoundingClientRect();
      const fire = (type: 'pointerdown' | 'pointerup') =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: midi,
            pointerType: 'touch',
            isPrimary: true,
            clientX: box.x + box.width / 2,
            clientY: box.y + box.height - 6,
          }),
        );
      fire('pointerdown');
      await new Promise((r) => setTimeout(r, heldMs));
      fire('pointerup');
    },
    { midi, heldMs },
  );
}

test.describe('edit modes', () => {
  test('insert mode pushes later notes out of the way', async ({ page }) => {
    const getErrors = collectPageErrors(page);
    await gotoDashboard(page);
    await createNewProject(page, 'Insert Mode');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 4 });
    await waitForNotation(page);

    await page.getByLabel('Insert mode').click();
    const before = await readScoreSummary(page);
    const firstTrack = before!.notes[0].trackId;
    const laterBefore = before!.notes
      .filter((n) => n.trackId === firstTrack)
      .sort((a, b) => a.startTick - b.startTick);

    await tapKey(page, 60);

    const after = await readScoreSummary(page);
    // Every note that was on this track is still there — insert displaces,
    // it never discards.
    for (const note of laterBefore) {
      expect(after!.notes.some((n) => n.id === note.id)).toBe(true);
    }
    expect(after!.notes.length).toBeGreaterThan(before!.notes.length);
    expect(getErrors()).toEqual([]);
  });

  test('replace mode overwrites instead of displacing', async ({ page }) => {
    const getErrors = collectPageErrors(page);
    await gotoDashboard(page);
    await createNewProject(page, 'Replace Mode');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 4 });
    await waitForNotation(page);

    await page.getByLabel('Replace mode').click();
    const before = await readScoreSummary(page);

    await tapKey(page, 60);

    const after = await readScoreSummary(page);
    // Replace does not lengthen the piece the way insert does.
    expect(after!.notes.length).toBeLessThanOrEqual(before!.notes.length + 1);
    expect(getErrors()).toEqual([]);
  });

  test('a selected chord is edited by the keyboard, not added to the caret', async ({ page }) => {
    const getErrors = collectPageErrors(page);
    await gotoDashboard(page);
    await createNewProject(page, 'Chord Edit');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 4 });
    await waitForNotation(page);

    // Build a chord to select: stack mode, three keys at the caret.
    await page.getByLabel('Stack mode').click();
    for (const midi of [60, 64, 67]) await tapKey(page, midi);

    const withChord = await readScoreSummary(page);
    const chord = withChord!.notes.filter((n) => n.startTick === 0);
    expect(chord.length).toBeGreaterThanOrEqual(3);

    // Select it through the store, then remove one note by pressing its key.
    await page.evaluate(
      (ids) => {
        const store = (
          window as unknown as {
            __SCORESMITH_STORE__: { getState: () => { setSelection: (s: unknown) => void } };
          }
        ).__SCORESMITH_STORE__;
        store.getState().setSelection({ eventIds: ids, measureIds: [], trackIds: [] });
      },
      chord.map((n) => n.id),
    );

    await tapKey(page, 64); // E4, already in the chord

    const after = await readScoreSummary(page);
    expect(after!.notes.filter((n) => n.startTick === 0).length).toBe(chord.length - 1);
    expect(getErrors()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd ~/projects/music_app
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e edit-modes
```

Expected: PASS. Needs a local Postgres `music_test` DB and `../music_api`'s dependencies installed. If the browser reports a missing export from `@sudobility/music_lib`, the staged build is stale — redo Task 2's Step 7.

- [ ] **Step 3: Full e2e suite**

```bash
cd ~/projects/music_app
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
bun run test:e2e
```

Expected: all specs pass, including the existing `chord-entry.spec.ts`.

- [ ] **Step 4: Update the shortcut help**

The editor's discoverability list should mention the new behaviour. In `~/projects/music_app/src/components/dialogs/ShortcutHelpDialog.tsx`, add to `SHORTCUTS`:

```ts
  { keys: 'Click a chord', action: 'Select every note in it' },
  { keys: 'Piano key (with a chord selected)', action: 'Add or remove that note' },
```

Run: `cd ~/projects/music_app && bun run verify`
Expected: PASS.

---

## Self-Review

**Spec coverage.** Edit mode state and default → Task 1. Ripple insert, active-track-only, growth of all tracks, nothing dropped → Task 2. Mode governing everything that writes → Task 3. Three-way control, `stack` disabled on monophonic instruments, fallback when the track changes → Task 4. Chord click selects the chord → Task 5. Keyboard as selection editor, the single-chord rule, second lit state → Task 6. Testing including one e2e per mode → Task 7.

**Deliberate gaps, stated rather than hidden:**

- **Paste is listed in the spec as mode-governed but has no task.** Paste goes through `pasteEventsCommand` in `music_lib`, not `insertChordAtCaret`, so honouring the mode there is a separate change. It is called out here so the omission is visible rather than discovered later; if paste must ripple too, that is a follow-up task against the same command.
- **`music_io` is not in `music_app/scripts/push_all.sh`.** Unrelated to this plan, but it means the publish chain does not cover it.
- **Dotted notes, tuplets, measure UI and second voices** remain out of scope, as the spec states.

**Type consistency.** `EditMode` is `'insert' | 'replace' | 'stack'` in Tasks 1, 3 and 4. `insertWithRippleCommand(params: RippleInsertParams)` takes the same field names as `addNoteCommand`'s params in Tasks 2 and 3. `chordSelection(notes)` returns `ChordSelection | null` in Task 6, and its `notes`/`startTick`/`durationTicks`/`trackId` fields are the ones the keyboard reads. `eventIdsAtPoint(map, point): string[]` is used in Task 5 with the same signature it is defined with.

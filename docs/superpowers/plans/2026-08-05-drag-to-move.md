# Drag To Move Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** drag selected notes to another time, another track, or both — a cut and paste you can do with the mouse.

**Architecture:** One domain command in `music_lib` relocates notes to a target track and tick, taking the collision rule as a parameter so the whole gesture is a single undo step. `music_app` adds the Option+drag gesture, a content-coordinate track hit test, and a drop indicator.

**Tech Stack:** TypeScript (strict), VexFlow 4.2.5, Vitest, React 19, Zustand, Playwright, Bun.

## Global Constraints

- **Option/Alt + drag moves; plain drag still pitch-drags; plain drag on empty staff still box-selects.** The last two are the regressions this feature could cause.
- **Pitch never changes.** Vertical movement means _which track_, never _what pitch_.
- **Every dragged note lands on the track under the pointer**, even if the selection spanned several.
- **The anchor is the note under the pointer at press**; the others keep their tick offset from it.
- **One undo step for the whole gesture.** The collision rule is a parameter of the domain command, not something the app composes from several dispatches.
- **The drop indicator never mutates the score** — a live note preview would force a relayout every frame.
- **Do not commit or push.** `scripts/push_all.sh` does that.
- After changing `music_lib`: `bun run build`, copy `dist` into `music_app/node_modules/@sudobility/music_lib/`, then `rm -rf node_modules/.vite` in `music_app`.

---

## File Structure

| File                                                      | Responsibility                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `music_lib/src/domain/commands/relocate-commands.ts`      | **New.** `relocateNotesCommand` — move to a track and tick, with a collision rule. |
| `music_lib/src/index.ts`                                  | Export it.                                                                         |
| `music_app/src/features/score-editor/hit-test.ts`         | `trackIdAtContentPoint`.                                                           |
| `music_app/src/features/score-editor/note-drag.ts`        | **New.** Pure: what a drag resolves to.                                            |
| `music_app/src/features/score-editor/ScoreEditorView.tsx` | The gesture and the indicator.                                                     |
| `music_app/e2e/note-drag.spec.ts`                         | **New.** Drag a note to another track.                                             |

---

### Task 1: The relocate command

**Files:**

- Create: `~/projects/music_lib/src/domain/commands/relocate-commands.ts`
- Create: `~/projects/music_lib/src/domain/commands/relocate-commands.test.ts`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**

- Consumes: `clearDanglingTies`, `removeNotesFromTrack`, `insertNoteIntoTrack`, `withTracks` from `./reflow.js`; `makeRoom` from `./ripple-commands.js`; `deleteEventsCommand` from `./note-commands.js`.
- Produces:

```ts
export type CollisionMode = 'stack' | 'replace' | 'ripple';
export type RelocateNotesParams = {
  targetTrackId: UUID;
  deltaTicks: number;
  collision: CollisionMode;
};
export function relocateNotesCommand(eventIds: UUID[], params: RelocateNotesParams): ScoreCommand;
```

- [x] **Step 1: Write the failing test**

Create `~/projects/music_lib/src/domain/commands/relocate-commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/factory.js';
import { addNoteCommand } from './note-commands.js';
import { relocateNotesCommand } from './relocate-commands.js';
import { allNotes } from '../score/queries.js';
import { pitchToMidi } from '../pitch/pitch.js';
import type { Pitch, Score } from '@sudobility/music_types';

const pitch = (step: string, octave = 4): Pitch =>
  ({ step, accidental: 0, octave }) as unknown as Pitch;

/** Two tracks of `bars` bars. Track 0 gets a note per entry in `steps`, one per beat. */
function scoreWith(steps: string[], bars = 4): Score {
  const base = createEmptyScore({
    title: 'Drag',
    measures: bars,
    tracks: [
      { name: 'A', instrumentName: 'A', clef: 'treble' as const },
      { name: 'B', instrumentName: 'B', clef: 'bass' as const },
    ],
  });
  const track = base.tracks[0];
  return steps.reduce(
    (acc, step, i) =>
      addNoteCommand({
        trackId: track.id,
        measureId: track.measures[0].id,
        voiceIndex: 0,
        pitch: pitch(step),
        startTick: i * base.ppq,
        durationTicks: base.ppq,
      }).execute(acc),
    base,
  );
}

const onTrack = (score: Score, index: number) =>
  allNotes(score)
    .filter((n) => n.trackId === score.tracks[index].id)
    .sort((a, b) => a.startTick - b.startTick);

describe('relocateNotesCommand', () => {
  it('moves a note to another track, keeping its sounding pitch', () => {
    // The central claim: you are reassigning who plays it, not rewriting it.
    const score = scoreWith(['C']);
    const note = onTrack(score, 0)[0];
    const out = relocateNotesCommand([note.id], {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 0,
      collision: 'stack',
    }).execute(score);

    expect(onTrack(out, 0)).toHaveLength(0);
    expect(onTrack(out, 1)).toHaveLength(1);
    expect(pitchToMidi(onTrack(out, 1)[0].pitch)).toBe(pitchToMidi(note.pitch));
    expect(onTrack(out, 1)[0].startTick).toBe(note.startTick);
  });

  it('moves within the same track by shifting the tick', () => {
    const score = scoreWith(['C']);
    const note = onTrack(score, 0)[0];
    const out = relocateNotesCommand([note.id], {
      targetTrackId: score.tracks[0].id,
      deltaTicks: score.ppq * 2,
      collision: 'stack',
    }).execute(score);

    expect(onTrack(out, 0)).toHaveLength(1);
    expect(onTrack(out, 0)[0].startTick).toBe(note.startTick + score.ppq * 2);
  });

  it('keeps the internal offsets of a multi-note selection', () => {
    // A phrase keeps its shape.
    const score = scoreWith(['C', 'D', 'E']);
    const notes = onTrack(score, 0);
    const offsets = notes.map((n) => n.startTick - notes[0].startTick);

    const out = relocateNotesCommand(
      notes.map((n) => n.id),
      { targetTrackId: score.tracks[1].id, deltaTicks: score.ppq, collision: 'stack' },
    ).execute(score);

    const moved = onTrack(out, 1);
    expect(moved).toHaveLength(3);
    expect(moved.map((n) => n.startTick - moved[0].startTick)).toEqual(offsets);
    expect(moved[0].startTick).toBe(notes[0].startTick + score.ppq);
  });

  it('lands notes from several tracks all on the target', () => {
    const score = scoreWith(['C', 'D']);
    const first = onTrack(score, 0)[0];
    const onB = relocateNotesCommand([first.id], {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 0,
      collision: 'stack',
    }).execute(score);

    // Now one note on each track; drag both onto track 1.
    const ids = allNotes(onB).map((n) => n.id);
    const out = relocateNotesCommand(ids, {
      targetTrackId: onB.tracks[1].id,
      deltaTicks: 0,
      collision: 'stack',
    }).execute(onB);

    expect(onTrack(out, 0)).toHaveLength(0);
    expect(onTrack(out, 1)).toHaveLength(2);
  });

  describe('collision', () => {
    /** Track 0 has C on beat 0; track 1 has G on beat 0. */
    function twoOccupied(): Score {
      const score = scoreWith(['C']);
      return addNoteCommand({
        trackId: score.tracks[1].id,
        measureId: score.tracks[1].measures[0].id,
        voiceIndex: 0,
        pitch: pitch('G', 3),
        startTick: 0,
        durationTicks: score.ppq,
      }).execute(score);
    }

    it('stack joins what is already there', () => {
      const score = twoOccupied();
      const note = onTrack(score, 0)[0];
      const out = relocateNotesCommand([note.id], {
        targetTrackId: score.tracks[1].id,
        deltaTicks: 0,
        collision: 'stack',
      }).execute(score);
      expect(onTrack(out, 1)).toHaveLength(2);
    });

    it('replace clears the span it lands on', () => {
      const score = twoOccupied();
      const note = onTrack(score, 0)[0];
      const out = relocateNotesCommand([note.id], {
        targetTrackId: score.tracks[1].id,
        deltaTicks: 0,
        collision: 'replace',
      }).execute(score);
      const landed = onTrack(out, 1);
      expect(landed).toHaveLength(1);
      expect(pitchToMidi(landed[0].pitch)).toBe(pitchToMidi(note.pitch));
    });

    it('ripple pushes what was there later', () => {
      const score = twoOccupied();
      const note = onTrack(score, 0)[0];
      const before = onTrack(score, 1)[0];
      const out = relocateNotesCommand([note.id], {
        targetTrackId: score.tracks[1].id,
        deltaTicks: 0,
        collision: 'ripple',
      }).execute(score);

      const landed = onTrack(out, 1);
      expect(landed).toHaveLength(2);
      // The dropped note takes the beat; the occupant moved later.
      const displaced = landed.find((n) => pitchToMidi(n.pitch) === pitchToMidi(before.pitch))!;
      expect(displaced.startTick).toBeGreaterThan(before.startTick);
    });
  });

  it('clamps a drop past the end of the track rather than losing the note', () => {
    const score = scoreWith(['C'], 2);
    const note = onTrack(score, 0)[0];
    const out = relocateNotesCommand([note.id], {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 1_000_000,
      collision: 'stack',
    }).execute(score);

    expect(onTrack(out, 1)).toHaveLength(1);
  });

  it('is a no-op for ids that are not in the score', () => {
    const score = scoreWith(['C']);
    const out = relocateNotesCommand(['nope'], {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 0,
      collision: 'stack',
    }).execute(score);
    expect(JSON.stringify(out)).toBe(JSON.stringify(score));
  });

  it('is a no-op for a target track that does not exist', () => {
    const score = scoreWith(['C']);
    const note = onTrack(score, 0)[0];
    const out = relocateNotesCommand([note.id], {
      targetTrackId: 'nope',
      deltaTicks: 0,
      collision: 'stack',
    }).execute(score);
    expect(JSON.stringify(out)).toBe(JSON.stringify(score));
  });

  it('undoes to exactly the score it started from', () => {
    // One command, one undo step — both the source and the destination.
    const score = scoreWith(['C', 'D']);
    const ids = onTrack(score, 0).map((n) => n.id);
    const cmd = relocateNotesCommand(ids, {
      targetTrackId: score.tracks[1].id,
      deltaTicks: 240,
      collision: 'replace',
    });
    const moved = cmd.execute(score);
    expect(JSON.stringify(cmd.undo(moved))).toBe(JSON.stringify(score));
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test relocate-commands`
Expected: FAIL — the module does not exist.

- [x] **Step 3: Implement it**

Create `~/projects/music_lib/src/domain/commands/relocate-commands.ts`:

```ts
/**
 * Moving notes to another track, another tick, or both.
 *
 * `moveNotesCommand` already relocates notes *within* a track. This is the
 * cross-track case, and it takes the collision rule as a parameter so that a
 * drag is **one** undo step: composing "clear the span" and "put them there"
 * from two dispatches would make undo step back through the middle of a
 * gesture the user experienced as one.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent, Score, Track, UUID } from '@sudobility/music_types';
import { transformCommand } from './types.js';
import type { ScoreCommand } from './types.js';
import {
  clearDanglingTies,
  insertNoteIntoTrack,
  removeNotesFromTrack,
  withTracks,
} from './reflow.js';
import { makeRoom } from './ripple-commands.js';

/** What happens to music already at the destination. Mirrors the editor's edit mode. */
export type CollisionMode = 'stack' | 'replace' | 'ripple';

export type RelocateNotesParams = {
  targetTrackId: UUID;
  deltaTicks: number;
  collision: CollisionMode;
};

type Moving = { note: NoteEvent; voiceIndex: number };

/** Every note in `score` carrying one of `ids`, with the voice it sat in. */
function collect(score: Score, ids: ReadonlySet<UUID>): Moving[] {
  const found: Moving[] = [];
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      measure.voices.forEach((voice, voiceIndex) => {
        for (const event of voice.events) {
          if (isNoteEvent(event) && ids.has(event.id)) found.push({ note: event, voiceIndex });
        }
      });
    }
  }
  return found;
}

/** The last tick a note of `durationTicks` can start at and still fit in `track`. */
function lastStart(track: Track, durationTicks: number): number {
  const last = track.measures[track.measures.length - 1];
  const end = last ? last.startTick + last.durationTicks : 0;
  return Math.max(0, end - durationTicks);
}

/** Ids of notes on `track` sounding inside `[from, to)` in any of `voices`. */
function occupantsOf(track: Track, from: number, to: number, voices: ReadonlySet<number>): UUID[] {
  const ids: UUID[] = [];
  for (const measure of track.measures) {
    measure.voices.forEach((voice, voiceIndex) => {
      // Voice-scoped: clearing the span across *every* voice would delete the
      // other line, which is a bug this codebase has already had once.
      if (!voices.has(voiceIndex)) return;
      for (const event of voice.events) {
        if (!isNoteEvent(event)) continue;
        if (event.startTick < to && event.startTick + event.durationTicks > from)
          ids.push(event.id);
      }
    });
  }
  return ids;
}

function relocateNotes(
  score: Score,
  eventIds: readonly UUID[],
  params: RelocateNotesParams,
): Score {
  const ids = new Set(eventIds);
  const moving = collect(score, ids);
  if (moving.length === 0) return score;
  if (!score.tracks.some((t) => t.id === params.targetTrackId)) return score;

  // Partners left behind must not keep a tie to a note that has gone.
  const detied = clearDanglingTies(score, ids);
  let working = withTracks(
    detied,
    detied.tracks.map((track) => removeNotesFromTrack(track, ids)),
  );

  const target = working.tracks.find((t) => t.id === params.targetTrackId)!;
  const placed = moving.map(({ note, voiceIndex }) => ({
    note,
    voiceIndex,
    startTick: Math.max(
      0,
      Math.min(note.startTick + params.deltaTicks, lastStart(target, note.durationTicks)),
    ),
  }));

  const from = Math.min(...placed.map((p) => p.startTick));
  const to = Math.max(...placed.map((p) => p.startTick + p.note.durationTicks));

  if (params.collision === 'replace') {
    const voices = new Set(placed.map((p) => p.voiceIndex));
    const doomed = new Set(occupantsOf(target, from, to, voices));
    if (doomed.size > 0) {
      working = withTracks(
        working,
        working.tracks.map((t) =>
          t.id === params.targetTrackId ? removeNotesFromTrack(t, doomed) : t,
        ),
      );
    }
  } else if (params.collision === 'ripple') {
    working = makeRoom(working, params.targetTrackId, from, to - from);
  }

  for (const { note, voiceIndex, startTick } of placed) {
    working = withTracks(
      working,
      working.tracks.map((t) =>
        t.id === params.targetTrackId
          ? insertNoteIntoTrack(
              t,
              {
                ...note,
                trackId: params.targetTrackId,
                startTick,
                // The note's former neighbours are not necessarily adjacent
                // any more, so its tie flags cannot survive the move.
                tieStart: undefined,
                tieStop: undefined,
              },
              voiceIndex,
            )
          : t,
      ),
    );
  }

  return working;
}

/**
 * Moves `eventIds` onto `params.targetTrackId`, shifted by `params.deltaTicks`.
 *
 * Pitch is untouched: a note dragged from flute to cello sounds identical, and
 * only its player changes. Notes are clamped into the target track rather than
 * dropped when the shift runs past its end.
 */
export function relocateNotesCommand(eventIds: UUID[], params: RelocateNotesParams): ScoreCommand {
  return transformCommand('Move notes', (score) => relocateNotes(score, eventIds, params));
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test relocate-commands`
Expected: PASS.

- [x] **Step 5: Verify the tests are not vacuous**

Make `relocateNotes` ignore `params.collision` entirely (always behave as
`stack`) and confirm the `replace` and `ripple` tests fail. Make it ignore
`deltaTicks` and confirm the offset tests fail. Restore.

- [x] **Step 6: Export it**

Add to `~/projects/music_lib/src/index.ts`, beside the other command modules:

```ts
export * from './domain/commands/relocate-commands.js';
```

- [x] **Step 7: Verify, build and stage**

```bash
cd ~/projects/music_lib && bun run verify
bun run build
cp -r dist ~/projects/music_app/node_modules/@sudobility/music_lib/
rm -rf ~/projects/music_app/node_modules/.vite
```

---

### Task 2: Which track is under the pointer

**Files:**

- Modify: `~/projects/music_app/src/features/score-editor/hit-test.ts`
- Test: `~/projects/music_app/src/features/score-editor/hit-test.test.ts`

**Interfaces:**

- Produces: `trackIdAtContentPoint(plan: LayoutPlan, point: Point): string | null`.

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_app/src/features/score-editor/hit-test.test.ts`:

```ts
describe('trackIdAtContentPoint', () => {
  it('finds the track whose stave band contains the point', () => {
    const plan = computeLayout(twoTrackScore(), {
      zoom: 1,
      layoutMode: 'page',
      width: 1200,
      theme: testRenderTheme(),
    });
    const [a, b] = plan.trackLayouts;
    const boxA = a.measures[0].box;
    const boxB = b.measures[0].box;

    expect(trackIdAtContentPoint(plan, { x: boxA.x + 10, y: boxA.y + boxA.height / 2 })).toBe(
      a.track.id,
    );
    expect(trackIdAtContentPoint(plan, { x: boxB.x + 10, y: boxB.y + boxB.height / 2 })).toBe(
      b.track.id,
    );
  });

  it('is null above the first stave', () => {
    const plan = computeLayout(twoTrackScore(), {
      zoom: 1,
      layoutMode: 'page',
      width: 1200,
      theme: testRenderTheme(),
    });
    expect(trackIdAtContentPoint(plan, { x: 100, y: -500 })).toBeNull();
  });

  it('works anywhere across the width, unlike the gutter hit test', () => {
    // `trackIdAtGutterPoint` is x-constrained to the gutter and reads viewport
    // coordinates, because the gutter is pinned to the viewport. A drop can
    // land anywhere on the staff, in content coordinates.
    const plan = computeLayout(twoTrackScore(), {
      zoom: 1,
      layoutMode: 'page',
      width: 1200,
      theme: testRenderTheme(),
    });
    const box = plan.trackLayouts[1].measures[0].box;
    expect(trackIdAtContentPoint(plan, { x: box.x + box.width - 5, y: box.y + 5 })).toBe(
      plan.trackLayouts[1].track.id,
    );
  });
});
```

Add `trackIdAtContentPoint` to the file's `@/features/score-editor/hit-test`
import, and `computeLayout`, `twoTrackScore`, `testRenderTheme` from
`@sudobility/music_lib`.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test hit-test`
Expected: FAIL — not exported.

- [x] **Step 3: Implement it**

Add to `~/projects/music_app/src/features/score-editor/hit-test.ts`:

```ts
/**
 * The track whose stave band contains `point`, in **content** coordinates.
 *
 * The sibling of `trackIdAtGutterPoint`, which does the same y-band search but
 * is x-constrained to the gutter and reads *viewport* coordinates — the one
 * place in the editor where the two spaces differ, because the gutter is
 * painted pinned to the viewport's left edge. A drop can land anywhere on the
 * staff, so it needs the ordinary content-space search.
 */
export function trackIdAtContentPoint(plan: LayoutPlan, point: Point): string | null {
  for (const system of plan.systems) {
    const measureIndex = system.measureIndices[0];
    if (measureIndex === undefined) continue;
    for (const trackLayout of plan.trackLayouts) {
      const box = trackLayout.measures.find((m) => m.measureIndex === measureIndex)?.box;
      if (!box) continue;
      if (point.y >= box.y && point.y < box.y + box.height) return trackLayout.track.id;
    }
  }
  return null;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test hit-test`
Expected: PASS.

---

### Task 3: What a drag resolves to

**Files:**

- Create: `~/projects/music_app/src/features/score-editor/note-drag.ts`
- Create: `~/projects/music_app/src/features/score-editor/note-drag.test.ts`

**Interfaces:**

- Consumes: `trackIdAtContentPoint` (Task 2), `tickForPoint`, `CollisionMode` (Task 1).
- Produces:

```ts
export type NoteDrag = { anchorId: string; anchorTick: number };
export type DropTarget = { trackId: string; deltaTicks: number };
export function collisionForEditMode(mode: EditMode): CollisionMode;
export function resolveDrop(
  plan: LayoutPlan,
  score: Score,
  drag: NoteDrag,
  point: Point,
  snapTicks: number,
): DropTarget | null;
```

- [x] **Step 1: Write the failing test**

Create `~/projects/music_app/src/features/score-editor/note-drag.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeLayout, testRenderTheme, twoTrackScore } from '@sudobility/music_lib';
import { collisionForEditMode, resolveDrop } from '@/features/score-editor/note-drag';

const score = twoTrackScore();
const plan = () =>
  computeLayout(score, {
    zoom: 1,
    layoutMode: 'page',
    width: 1200,
    theme: testRenderTheme(),
  });

describe('collisionForEditMode', () => {
  it('maps the editor modes onto the command s collision rules', () => {
    // A drop is a write, so it obeys the same mode as every other write.
    expect(collisionForEditMode('replace')).toBe('replace');
    expect(collisionForEditMode('stack')).toBe('stack');
    expect(collisionForEditMode('insert')).toBe('ripple');
  });
});

describe('resolveDrop', () => {
  it('reports the track under the pointer and the snapped tick delta', () => {
    const p = plan();
    const box = p.trackLayouts[1].measures[0].box;
    const drop = resolveDrop(
      p,
      score,
      { anchorId: 'n1', anchorTick: 0 },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      480,
    );

    expect(drop?.trackId).toBe(p.trackLayouts[1].track.id);
    expect(drop!.deltaTicks % 480).toBe(0);
  });

  it('snaps the destination to the grid', () => {
    const p = plan();
    const box = p.trackLayouts[0].measures[0].box;
    const drop = resolveDrop(
      p,
      score,
      { anchorId: 'n1', anchorTick: 0 },
      { x: box.x + 7, y: box.y + box.height / 2 },
      480,
    );
    expect(drop!.deltaTicks % 480).toBe(0);
  });

  it('is null when the pointer is not over any stave', () => {
    expect(
      resolveDrop(plan(), score, { anchorId: 'n1', anchorTick: 0 }, { x: 100, y: -500 }, 480),
    ).toBeNull();
  });

  it('reports a delta relative to the anchor, so a phrase keeps its shape', () => {
    const p = plan();
    const box = p.trackLayouts[0].measures[0].box;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const fromZero = resolveDrop(p, score, { anchorId: 'n1', anchorTick: 0 }, point, 480);
    const fromLater = resolveDrop(p, score, { anchorId: 'n1', anchorTick: 960 }, point, 480);

    expect(fromZero!.deltaTicks - fromLater!.deltaTicks).toBe(960);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test note-drag`
Expected: FAIL — the module does not exist.

- [x] **Step 3: Implement it**

Create `~/projects/music_app/src/features/score-editor/note-drag.ts`:

```ts
/**
 * What an Option+drag resolves to: which track, and how far in time.
 *
 * Pure over a layout plan and a point — no store, no React — in the same shape
 * as `pitch-drag.ts` and `playback-scroll.ts`, so the rules are testable
 * without rendering anything.
 */
import { tickForPoint } from '@sudobility/music_lib';
import type { EditMode, LayoutPlan } from '@sudobility/music_lib';
import type { Score } from '@sudobility/music_types';
import type { CollisionMode } from '@sudobility/music_lib';
import { trackIdAtContentPoint } from '@/features/score-editor/hit-test';
import type { Point } from '@/features/score-editor/hit-test';

/** The note the gesture is anchored to: the one under the pointer at press. */
export type NoteDrag = { anchorId: string; anchorTick: number };

/** Where a drop would put the selection. */
export type DropTarget = { trackId: string; deltaTicks: number };

/**
 * The collision rule a drop uses, from the toolbar's edit mode.
 *
 * A drop is a write, so it obeys the mode already set rather than inventing a
 * rule or asking. `insert` ripples, which is what `insert` means everywhere
 * else in the editor.
 */
export function collisionForEditMode(mode: EditMode): CollisionMode {
  if (mode === 'insert') return 'ripple';
  return mode;
}

/** Rounds `tick` to the nearest multiple of `snapTicks`. */
function snap(tick: number, snapTicks: number): number {
  if (snapTicks <= 0) return tick;
  return Math.round(tick / snapTicks) * snapTicks;
}

/**
 * The track and tick delta a drop at `point` would produce, or null when the
 * pointer is not over a stave.
 *
 * The delta is relative to the **anchor**, so every other note in the
 * selection keeps its offset and a phrase keeps its shape.
 */
export function resolveDrop(
  plan: LayoutPlan,
  score: Score,
  drag: NoteDrag,
  point: Point,
  snapTicks: number,
): DropTarget | null {
  const trackId = trackIdAtContentPoint(plan, point);
  if (!trackId) return null;

  // `tickForPoint` needs the score as well as the plan: it reads measure
  // timings, not just geometry. Same call the caret already makes.
  const tick = tickForPoint(plan, score, point.x, point.y);
  if (tick === null) return null;

  return { trackId, deltaTicks: snap(tick, snapTicks) - drag.anchorTick };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test note-drag`
Expected: PASS.

---

### Task 4: The gesture and the indicator

**Files:**

- Modify: `~/projects/music_app/src/features/score-editor/ScoreEditorView.tsx`
- Test: `~/projects/music_app/src/features/score-editor/ScoreEditorView.test.tsx`

**Interfaces:**

- Consumes: `resolveDrop`, `collisionForEditMode` (Task 3), `relocateNotesCommand` (Task 1).

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_app/src/features/score-editor/ScoreEditorView.test.tsx`:

```tsx
describe('drag to move notes', () => {
  it('moves the selected note to the track it is dropped on', () => {
    // Asserted through the command rather than through synthetic pointer
    // events, which the canvas hit test cannot resolve in jsdom: the gesture
    // wiring is covered by e2e, the semantics here.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twoTrackScore());
    const note = allNotes(store.getState().score!)[0];
    const targetTrack = store.getState().score!.tracks[1];

    store.getState().dispatchCommand(
      relocateNotesCommand([note.id], {
        targetTrackId: targetTrack.id,
        deltaTicks: 0,
        collision: 'stack',
      }),
    );

    const moved = allNotes(store.getState().score!).find((n) => n.id !== note.id);
    expect(allNotes(store.getState().score!).some((n) => n.trackId === targetTrack.id)).toBe(true);
    expect(moved).toBeDefined();
  });

  it('leaves a plain drag on a selected note as a pitch drag', () => {
    // The regression this feature could cause. Option is what distinguishes
    // them, so a plain drag must be untouched.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    const { container } = render(<ScoreEditorView store={store} />);

    const before = allNotes(store.getState().score!)[0].trackId;
    // A plain drag must never change which track a note is on.
    expect(container).toBeTruthy();
    expect(allNotes(store.getState().score!)[0].trackId).toBe(before);
  });
});
```

Add `relocateNotesCommand` to the file's `@sudobility/music_lib` import.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test ScoreEditorView`
Expected: FAIL on the first — `relocateNotesCommand` is not exported yet if
Task 1 Step 7 was skipped; otherwise it PASSES, since it exercises the command
directly. That is deliberate: this describe pins semantics, and Step 5's e2e
drives the real gesture.

- [x] **Step 3: Add the drag state**

In `~/projects/music_app/src/features/score-editor/ScoreEditorView.tsx`, beside
`pitchDragRef`:

```tsx
const noteDragRef = useRef<{ anchorId: string; anchorTick: number } | null>(null);
const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
```

- [x] **Step 4: Start the drag on Option+press**

In the pointer-down handler, **before** the pitch-drag branch (so the modifier
wins), add:

```tsx
// Option/Alt starts a move. Checked first, because the same press on the
// same note would otherwise start a pitch drag — the modifier is the
// whole disambiguation.
if (event.altKey && result) {
  const hitId = eventIdAtPoint(result.idToBBox, point);
  const hitEvent = hitId && state.score ? findEvent(state.score, hitId) : null;
  if (hitId && hitEvent && isNoteEvent(hitEvent)) {
    // Option+press works on any note: an explicit modifier leaves no
    // ambiguity with box select, so requiring a prior selection would be
    // friction for nothing.
    if (!state.selection.eventIds.includes(hitId)) {
      store.getState().setSelection({ eventIds: [hitId], measureIds: [], trackIds: [] });
    }
    noteDragRef.current = { anchorId: hitId, anchorTick: hitEvent.startTick };
    containerRef.current?.setPointerCapture?.(event.pointerId);
    return;
  }
}
```

- [x] **Step 5: Track the drop target while moving**

In the pointer-move handler, before the pitch-drag branch:

```tsx
if (noteDragRef.current && layoutPlan) {
  setDropTarget(
    resolveDrop(layoutPlan, score, noteDragRef.current, point, ticksFor(snapGrid, ppq)),
  );
  return;
}
```

`snapGrid` and the score's `ppq` are already read in this component; if `ppq`
is not, read it as `store((s) => s.score?.ppq ?? 480)`.

- [x] **Step 6: Commit on release**

In the pointer-up handler, before the pitch-drag branch:

```tsx
const noteDrag = noteDragRef.current;
if (noteDrag) {
  containerRef.current?.releasePointerCapture?.(event.pointerId);
  noteDragRef.current = null;
  const target = dropTarget;
  setDropTarget(null);
  suppressNextClickRef.current = true;

  const ids = store.getState().selection.eventIds;
  // A drop that changes nothing is not worth an undo entry.
  const moved =
    target && (target.deltaTicks !== 0 || target.trackId !== trackOfAnchor(noteDrag.anchorId));
  if (target && moved && ids.length > 0) {
    // One command for the whole gesture, so undo restores both the
    // source and the destination in a single step.
    store.getState().dispatchCommand(
      relocateNotesCommand([...ids], {
        targetTrackId: target.trackId,
        deltaTicks: target.deltaTicks,
        collision: collisionForEditMode(editMode),
      }),
    );
  }
  return;
}
```

with, near the other helpers in the component:

```tsx
/** The track the anchor note currently sits on, for the "nothing moved" check. */
const trackOfAnchor = (anchorId: string): string | null => {
  const event = store.getState().score ? findEvent(store.getState().score!, anchorId) : null;
  return event && isNoteEvent(event) ? event.trackId : null;
};
```

- [x] **Step 7: Draw the indicator**

Render the drop indicator as an absolutely-positioned overlay inside the scroll
box, beside the playback caret — it never touches the score, so no relayout:

```tsx
{
  dropTarget && layoutPlan && <DropIndicator plan={layoutPlan} target={dropTarget} zoom={zoom} />;
}
```

and add the component at the bottom of the file:

```tsx
/**
 * Where a drop would land: the target stave tinted, and a caret at the snapped
 * tick.
 *
 * Deliberately not a preview of the notes themselves. Splicing notes into
 * another track's measures changes those measures' contents and forces a full
 * relayout — the per-frame cost the playback work exists to avoid. This draws
 * from geometry the plan already has.
 */
function DropIndicator({
  plan,
  target,
  zoom,
}: {
  plan: LayoutPlan;
  target: DropTarget;
  zoom: number;
}) {
  const trackLayout = plan.trackLayouts.find((t) => t.track.id === target.trackId);
  const box = trackLayout?.measures[0]?.box;
  if (!box) return null;

  return (
    <div
      data-testid="drop-indicator"
      aria-hidden
      className="pointer-events-none absolute bg-sky-400/20 ring-1 ring-sky-500"
      style={{
        left: box.x * zoom,
        top: box.y * zoom,
        width: box.width * zoom,
        height: box.height * zoom,
      }}
    />
  );
}
```

Import `DropTarget`, `resolveDrop` and `collisionForEditMode` from
`@/features/score-editor/note-drag`, and `relocateNotesCommand` from
`@sudobility/music_lib`.

- [x] **Step 8: Run the tests**

Run: `cd ~/projects/music_app && bun run test ScoreEditorView`
Expected: PASS, including every existing pitch-drag and box-select test — those
are the regressions this task could cause.

---

### Task 5: End to end

**Files:**

- Create: `~/projects/music_app/e2e/note-drag.spec.ts`

- [x] **Step 1: Write the e2e**

```ts
import { expect, test } from '@playwright/test';
import {
  createNewProject,
  generateWholeScore,
  gotoDashboard,
  readScoreSummary,
  viewportPointForId,
  waitForNotation,
} from './helpers';

test.describe('drag to move notes', () => {
  test('Option+drag moves a note to another track, keeping its pitch', async ({ page }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Note Drag');
    await generateWholeScore(page, { prompt: 'Create a calm duet', measures: 4 });
    await waitForNotation(page);

    // Drag a note on track 0 onto a note that is already on track 1 — that
    // point is guaranteed to be inside track 1's stave band, so the test needs
    // no new introspection API.
    const summary = await readScoreSummary(page);
    const tracks = [...new Set((summary?.notes ?? []).map((n) => n.trackId))];
    expect(tracks.length).toBeGreaterThan(1);

    const source = summary!.notes.find((n) => n.trackId === tracks[0])!;
    const anchorOnTarget = summary!.notes.find((n) => n.trackId === tracks[1])!;

    const from = await viewportPointForId(page, 'idToBBox', source.id);
    const to = await viewportPointForId(page, 'idToBBox', anchorOnTarget.id);
    if (!from || !to) throw new Error('note not in the drawn window');

    await page.keyboard.down('Alt');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await expect(page.getByTestId('drop-indicator')).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up('Alt');

    const after = await page.evaluate(() => {
      const store = (
        window as unknown as {
          __SCORESMITH_STORE__: {
            getState: () => {
              score: {
                tracks: Array<{
                  id: string;
                  measures: Array<{ voices: Array<{ events: Array<Record<string, unknown>> }> }>;
                }>;
              };
            };
          };
        }
      ).__SCORESMITH_STORE__;
      const score = store.getState().score;
      return score.tracks.map(
        (t) =>
          t.measures.flatMap((m) => m.voices.flatMap((v) => v.events)).filter((e) => 'pitch' in e)
            .length,
      );
    });

    // Track 1 gained a note; track 0 lost one.
    expect(after[1]).toBeGreaterThan(0);
  });
});
```

`viewportPointForId` is module-private in `e2e/helpers.ts` today; add `export`
to it. That is the whole helper change — the `__scoresmith` handle needs
nothing new, because dropping onto a note already on the target track puts the
pointer inside that track's stave band by construction.

- [x] **Step 2: Run everything**

```bash
cd ~/projects/music_lib && bun run verify
cd ~/projects/music_app && bun run verify
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e
```

Expected: all pass.

- [x] **Step 3: Try it by hand**

Option+drag a note within its own track and across to another. Check by eye:
the target stave tints while dragging, the note lands on the beat you aimed at,
it sounds the same on the new track, and one undo puts it back exactly. Then
plain-drag a selected note and confirm it still changes pitch, and plain-drag on
empty staff and confirm it still box-selects.

---

## Self-Review

**Spec coverage.** Option+drag, working on any note → Task 4 Step 4. Anchor and offsets → Task 3 (`resolveDrop` returns a delta) and Task 1 (offsets preserved). Snapped tick → Task 3. Track under pointer → Tasks 2 and 3. Pitch unchanged → Task 1's central test. Voice kept → Task 1 (`insertNoteIntoTrack` with the note's own voice index). Collision from edit mode, one undo step → Tasks 1 and 3. Drop indicator, no relayout → Task 4 Step 7. Reuse of existing machinery → Task 1 imports `reflow.js` and `ripple-commands.js`. Regressions pinned → Task 4 Step 8 and Task 5 Step 3. e2e → Task 5.

**Deliberate gaps, stated rather than hidden:**

- **Task 4's unit tests exercise the command, not synthetic pointer events.** The canvas hit test cannot resolve a jsdom pointer event to a note — that is why `e2e/helpers.ts` exists at all. The gesture wiring is covered by Task 5; the semantics by Task 1.
- **The drop indicator tints the whole stave band of the target track**, not just the destination measure. Cheaper and, at a glance, clearer about the thing most likely to be wrong: which track.
- **`resolveDrop` snaps to the grid and then subtracts the anchor tick**, so the _delta_ is snapped rather than each note's final position. A selection whose notes sit off the grid keeps its internal offsets exactly, which is the property the spec asks for; the alternative would quantise the phrase.
- **`relocateNotesCommand` does not split a note that crosses a measure boundary** the way `moveNotesCommand` does. A cross-track drop lands the note whole in its destination measure via `insertNoteIntoTrack`, which clips at the measure end. Worth revisiting if long notes are commonly dragged; not worth pre-solving.

**Type consistency.** `CollisionMode` is defined in Task 1 and consumed by `collisionForEditMode` in Task 3. `RelocateNotesParams` is produced in Task 1 and constructed in Task 4 Step 6. `DropTarget` is produced in Task 3 and consumed in Task 4 Steps 5-7. `trackIdAtContentPoint(plan, point)` is produced in Task 2 and consumed in Task 3. `NoteDrag` carries `anchorTick`, which Task 4 Step 4 fills from the hit note's `startTick` and Task 3 subtracts.

---

## Execution Notes (2026-08-05)

All five tasks complete. music_lib 1046 tests, music_app 548, e2e 33 — all
green. No `music_types` change.

**The e2e earned its keep: it caught a real defect in the app, not just in the
test.** The three pointer handlers are `useCallback`s with deliberately narrow
dependency arrays, and I added branches reading `layoutPlan`, `snapGrid`,
`editMode` and `dropTarget` without touching them — so every one of those
closed over a stale value. `layoutPlan` was null when captured, so
`resolveDrop` was never reached and no drop indicator ever appeared. This would
have failed identically for a real user; the unit tests could not see it,
because they exercise the pure functions rather than the memoized handlers.

Fixed with the split the file already uses for pitch-drag: `dropTargetRef` for
the handlers to read, `dropTarget` state for rendering the indicator, and the
genuinely-needed values added to the deps.

**Three test-fixture mistakes, each caught rather than shipped:**

1. The first run **skipped silently** — generation produced a one-track score
   and `test.skip` fired, which reads as a pass. Replaced with a fixture that
   builds the second track and asserts it exists.
2. That fabricated track was a shallow copy, so every note still carried the
   original `trackId` and only one distinct track appeared. Events, voices and
   measures now get their own ids.
3. The final assertion counted notes per track and expected track 1 to gain
   one. It does not: the default edit mode is `replace`, so the dropped note
   displaces an occupant and the count is unchanged (16 → 16, while track 0
   went 16 → 15). The code was right and the assertion was wrong. It now
   asserts **where the dragged note's id lives**, which is the actual claim and
   is independent of edit mode.

Verified non-vacuous by disabling the `event.altKey` branch, which fails the
e2e on the drop indicator.

Not committed — `scripts/push_all.sh` owns commits.

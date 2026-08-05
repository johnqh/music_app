# Rehearsal Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print lettered marks a conductor can call out — "from B" — so every player finds the same bar.

**Architecture:** A pure derivation reads the **whole score** once and returns marks keyed by measure index. Both print paths apply them: `extractPart` for a single track, and a sibling `withRehearsalMarks` for the whole-score print. Marks are applied before rests collapse, and a marked bar ends a rest run.

**Tech Stack:** TypeScript (strict), VexFlow 4.2.5, Vitest, React 19, Playwright, Bun.

## Global Constraints

- **Feature 4 of seven.** Cue notes, page turns and written-pitch editing are features 5 to 7.
- **Marks are derived from the whole score, once, then applied to every part.** Deriving per-part gives each player different letters and destroys the feature. This is the constraint everything else follows from.
- **Marks appear in the score AND every part** — unlike transposition and multi-measure rests, which are parts-only.
- **Marks never appear in the editor.** A derived mark that cannot be moved would be a control that looks editable and is not.
- **No two marks closer than 4 bars.** On collision the earlier wins.
- **Bar 1 never gets a mark.** "From the top" needs no letter.
- **Lettering is A…Z then AA, BB, CC** — never AB, which sounds like two marks when spoken.
- **A marked bar breaks a multi-measure rest**, so marks must be applied _before_ `collapseRests`.
- **Do not commit or push.** `scripts/push_all.sh` does that.
- After changing `music_lib`: `bun run build`, copy `dist` into `music_app/node_modules/@sudobility/music_lib/`, then `rm -rf node_modules/.vite` in `music_app`.

---

## File Structure

| File                                                | Responsibility                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `music_types/src/index.ts`                          | `Measure.rehearsalMark?: string`.                                   |
| `music_lib/src/domain/score/rehearsal-marks.ts`     | **New.** Pure: where marks go, what they are called, applying them. |
| `music_lib/src/domain/score/collapse-rests.ts`      | A marked bar ends a run.                                            |
| `music_lib/src/domain/score/extract-part.ts`        | Apply marks before collapsing.                                      |
| `music_lib/src/adapters/vexflow/measure-content.ts` | Draw the section above the stave.                                   |
| `music_app/src/features/print/PrintView.tsx`        | Whole-score print gets marks too.                                   |
| `music_app/e2e/print.spec.ts`                       | Same letters at the same bars in score and part.                    |

---

### Task 1: The model field

**Files:**

- Modify: `~/projects/music_types/src/index.ts` (the `Measure` type and `measureSchema`)
- Test: `~/projects/music_types/src/api.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `Measure.rehearsalMark?: string`, accepted by `measureSchema`.

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_types/src/api.test.ts`, beside the `multiMeasureRestCount` tests:

```ts
it('accepts a measure carrying a rehearsal mark', () => {
  const withMark = {
    ...score,
    tracks: score.tracks.map((t) => ({
      ...t,
      measures: t.measures.map((m) => ({ ...m, rehearsalMark: 'B' })),
    })),
  };
  const parsed = projectCreateRequestSchema.parse({ name: 'P', score: withMark });
  expect(parsed.score.tracks[0].measures[0].rehearsalMark).toBe('B');
});

it('rejects an empty rehearsal mark', () => {
  // A mark nobody can call out is not a mark.
  const withEmpty = {
    ...score,
    tracks: score.tracks.map((t) => ({
      ...t,
      measures: t.measures.map((m) => ({ ...m, rehearsalMark: '' })),
    })),
  };
  expect(() => projectCreateRequestSchema.parse({ name: 'P', score: withEmpty })).toThrow();
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_types && bun run test`
Expected: FAIL — the schema strips the unknown key and the empty string is accepted.

- [x] **Step 3: Add the field and schema entry**

In `~/projects/music_types/src/index.ts`, inside `Measure` after `multiMeasureRestCount`:

```ts
  /**
   * Rehearsal mark shown above this measure, e.g. "B".
   *
   * Print-only and derived (see `rehearsalMarks` in music_lib): a stored score
   * carries none, and the editor never shows them, because a mark you cannot
   * move would be a control that looks editable and is not.
   */
  rehearsalMark?: string;
```

and in `measureSchema` after `multiMeasureRestCount`:

```ts
  rehearsalMark: z.string().min(1).optional(),
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_types && bun run verify`
Expected: PASS.

- [x] **Step 5: Publish and consume**

Edit `version` in `package.json` by hand (bump the minor), then:

```bash
cd ~/projects/music_types && npm publish
sleep 12 && npm view @sudobility/music_types version
cd ~/projects/music_lib && bun add @sudobility/music_types@latest && bun run typecheck
```

Do not use `npm version`: it commits, and commits belong to `scripts/push_all.sh`.

---

### Task 2: Where the marks go

**Files:**

- Create: `~/projects/music_lib/src/domain/score/rehearsal-marks.ts`
- Create: `~/projects/music_lib/src/domain/score/rehearsal-marks.test.ts`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**

- Consumes: `Measure.rehearsalMark` (Task 1), `isSilentMeasure` from `./collapse-rests.js`.
- Produces:

```ts
export function markLabel(ordinal: number): string;
export function rehearsalMarks(score: Score): Map<number, string>;
export function applyRehearsalMarks(
  measures: readonly Measure[],
  marks: ReadonlyMap<number, string>,
): Measure[];
export function withRehearsalMarks(score: Score): Score;
```

- [x] **Step 1: Write the failing test**

Create `~/projects/music_lib/src/domain/score/rehearsal-marks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyScore } from './factory.js';
import { addNoteCommand } from '../commands/note-commands.js';
import {
  applyRehearsalMarks,
  markLabel,
  rehearsalMarks,
  withRehearsalMarks,
} from './rehearsal-marks.js';
import type { KeySignature, Pitch, Score, TimeSignature } from '@sudobility/music_types';

const pitch = (step: string): Pitch => ({ step, accidental: 0, octave: 4 }) as unknown as Pitch;

/** A one-track score of `measures` bars, every bar sounding. */
function fullScore(measures: number): Score {
  const base = createEmptyScore({
    title: 'Marks',
    measures,
    tracks: [{ name: 'A', instrumentName: 'Piano', clef: 'treble' as const }],
  });
  const track = base.tracks[0];
  return track.measures.reduce(
    (acc, m) =>
      addNoteCommand({
        trackId: track.id,
        measureId: m.id,
        voiceIndex: 0,
        pitch: pitch('C'),
        startTick: m.startTick,
        durationTicks: base.ppq,
      }).execute(acc),
    base,
  );
}

/** `score` with `patch` applied to the measures at `indices` on every track. */
function patchMeasures(
  score: Score,
  indices: number[],
  patch: Partial<Score['tracks'][0]['measures'][0]>,
): Score {
  return {
    ...score,
    tracks: score.tracks.map((t) => ({
      ...t,
      measures: t.measures.map((m, i) => (indices.includes(i) ? { ...m, ...patch } : m)),
    })),
  };
}

describe('markLabel', () => {
  it('runs A to Z', () => {
    expect(markLabel(0)).toBe('A');
    expect(markLabel(25)).toBe('Z');
  });

  it('doubles the letter after Z, rather than pairing two', () => {
    // "AB" spoken over a bad line sounds like two separate marks.
    expect(markLabel(26)).toBe('AA');
    expect(markLabel(27)).toBe('BB');
    expect(markLabel(51)).toBe('ZZ');
  });

  it('triples after that', () => {
    expect(markLabel(52)).toBe('AAA');
  });
});

describe('rehearsalMarks', () => {
  it('never marks the first bar', () => {
    // "From the top" already exists and needs no letter.
    expect(rehearsalMarks(fullScore(40)).has(0)).toBe(false);
  });

  it('marks every 16 bars through an unbroken stretch', () => {
    const marks = rehearsalMarks(fullScore(40));
    expect([...marks.keys()].sort((a, b) => a - b)).toEqual([16, 32]);
  });

  it('marks a time-signature change', () => {
    const threeFour: TimeSignature = { numerator: 3, denominator: 4 };
    const score = patchMeasures(fullScore(12), [5], { timeSignature: threeFour });
    expect(rehearsalMarks(score).has(5)).toBe(true);
  });

  it('marks a key change', () => {
    const dMajor: KeySignature = { fifths: 2, mode: 'major' };
    const score = patchMeasures(fullScore(12), [7], { keySignature: dMajor });
    expect(rehearsalMarks(score).has(7)).toBe(true);
  });

  it('marks the bar after a long silence, where somebody re-enters', () => {
    // The moment a conductor restarts from, and the moment a lost player most
    // needs a landmark.
    const score = patchMeasures(fullScore(12), [4, 5, 6], { voices: [] });
    expect(rehearsalMarks(score).has(7)).toBe(true);
  });

  it('does not mark after a single silent bar', () => {
    const score = patchMeasures(fullScore(12), [4], { voices: [] });
    expect(rehearsalMarks(score).has(5)).toBe(false);
  });

  it('keeps marks at least four bars apart, earlier winning', () => {
    // Two metre changes three bars apart must not produce two marks: three
    // marks in a row help nobody.
    const threeFour: TimeSignature = { numerator: 3, denominator: 4 };
    const twoFour: TimeSignature = { numerator: 2, denominator: 4 };
    const score = patchMeasures(
      patchMeasures(fullScore(20), [5], { timeSignature: threeFour }),
      [7],
      { timeSignature: twoFour },
    );
    const marks = rehearsalMarks(score);
    expect(marks.has(5)).toBe(true);
    expect(marks.has(7)).toBe(false);
  });

  it('letters them in bar order', () => {
    const threeFour: TimeSignature = { numerator: 3, denominator: 4 };
    const score = patchMeasures(fullScore(40), [5], { timeSignature: threeFour });
    const marks = rehearsalMarks(score);
    const inOrder = [...marks.entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
    expect(inOrder).toEqual(inOrder.map((_, i) => markLabel(i)));
  });

  it('sees silence in any track, not just the first', () => {
    // A mark is a landmark for everybody; the second oboe re-entering is as
    // structural as the first violin doing so.
    const base = fullScore(12);
    const twoTrack: Score = {
      ...base,
      tracks: [base.tracks[0], { ...base.tracks[0], id: 't2', name: 'B' }],
    };
    const silenced: Score = {
      ...twoTrack,
      tracks: twoTrack.tracks.map((t, i) =>
        i === 1
          ? {
              ...t,
              measures: t.measures.map((m, j) => (j >= 4 && j <= 6 ? { ...m, voices: [] } : m)),
            }
          : t,
      ),
    };
    expect(rehearsalMarks(silenced).has(7)).toBe(true);
  });
});

describe('applyRehearsalMarks', () => {
  it('writes the mark onto the measure at that index', () => {
    const score = fullScore(4);
    const marked = applyRehearsalMarks(score.tracks[0].measures, new Map([[2, 'B']]));
    expect(marked[2].rehearsalMark).toBe('B');
    expect(marked[0].rehearsalMark).toBeUndefined();
  });

  it('keys by measure index, not array position', () => {
    // A part's measures are already renumbered by collapsing in feature 3, so
    // position is not a reliable key.
    const score = fullScore(4);
    const shifted = score.tracks[0].measures.slice(2); // starts at index 2
    const marked = applyRehearsalMarks(shifted, new Map([[2, 'B']]));
    expect(marked[0].rehearsalMark).toBe('B');
  });

  it('does not modify the measures it was given', () => {
    const score = fullScore(4);
    const before = JSON.stringify(score.tracks[0].measures);
    applyRehearsalMarks(score.tracks[0].measures, new Map([[2, 'B']]));
    expect(JSON.stringify(score.tracks[0].measures)).toBe(before);
  });
});

describe('withRehearsalMarks', () => {
  it('marks every track identically', () => {
    // The whole point: "from B" must mean one bar for everyone.
    const base = fullScore(40);
    const twoTrack: Score = {
      ...base,
      tracks: [base.tracks[0], { ...base.tracks[0], id: 't2', name: 'B' }],
    };
    const marked = withRehearsalMarks(twoTrack);
    const labels = (trackIndex: number) =>
      marked.tracks[trackIndex].measures
        .map((m, i) => [i, m.rehearsalMark] as const)
        .filter(([, label]) => label !== undefined);
    expect(labels(0)).toEqual(labels(1));
    expect(labels(0).length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test rehearsal-marks`
Expected: FAIL — the module does not exist.

- [x] **Step 3: Implement it**

Create `~/projects/music_lib/src/domain/score/rehearsal-marks.ts`:

```ts
/**
 * Where rehearsal marks go, and what they are called.
 *
 * **Derived from the whole score, once.** A mark is only useful if it means
 * the same bar in every part — the conductor says "from B" and everyone finds
 * the same place. Deriving per-part would give each player different letters,
 * which is worse than no marks at all.
 *
 * Print-only: a stored score carries none, and the editor never shows them.
 */
import { isSilentMeasure } from './collapse-rests.js';
import type { Measure, Score } from '@sudobility/music_types';

/** A mark every this many bars through a stretch with no other structure. */
const REGULAR_INTERVAL = 16;

/**
 * Closest two marks may be.
 *
 * Without a floor, a passage that changes metre twice in three bars gets three
 * marks and none of them helps.
 */
const MIN_SPACING = 4;

/** A silence at least this long counts as structural — the same threshold that collapses a rest. */
const LONG_SILENCE = 2;

/**
 * The label for the `ordinal`-th mark: A…Z, then AA, BB, CC.
 *
 * Doubled rather than paired: "AB" spoken over a bad line sounds like two
 * separate marks, while "double A" cannot be mistaken for anything else.
 */
export function markLabel(ordinal: number): string {
  const letter = String.fromCharCode(65 + (ordinal % 26));
  const repeats = Math.floor(ordinal / 26) + 1;
  return letter.repeat(repeats);
}

/** Whether `index` starts a stretch of silence at least `LONG_SILENCE` bars long, in `track`. */
function silenceRunLength(measures: readonly Measure[], index: number): number {
  let length = 0;
  while (index + length < measures.length && isSilentMeasure(measures[index + length])) {
    length += 1;
  }
  return length;
}

/**
 * Measure indices that deserve a mark, before spacing is applied.
 *
 * Structural signals first — a change of key or metre, and the bar where
 * somebody re-enters after a long rest — then a regular interval so a long
 * unbroken stretch is not left without a landmark.
 */
function candidates(score: Score): number[] {
  const reference = score.tracks[0]?.measures ?? [];
  const found = new Set<number>();

  for (let index = 1; index < reference.length; index += 1) {
    const previous = reference[index - 1];
    const measure = reference[index];

    const metreChanged =
      previous.timeSignature.numerator !== measure.timeSignature.numerator ||
      previous.timeSignature.denominator !== measure.timeSignature.denominator;
    const keyChanged =
      previous.keySignature.fifths !== measure.keySignature.fifths ||
      previous.keySignature.mode !== measure.keySignature.mode;

    if (metreChanged || keyChanged) found.add(index);
    if (index % REGULAR_INTERVAL === 0) found.add(index);
  }

  // An entrance after a long rest, in ANY track: a mark is a landmark for
  // everybody, and the second oboe re-entering is as structural as the first
  // violin doing so.
  for (const track of score.tracks) {
    for (let index = 0; index < track.measures.length; index += 1) {
      const run = silenceRunLength(track.measures, index);
      if (run >= LONG_SILENCE) {
        const entrance = index + run;
        if (entrance > 0 && entrance < track.measures.length) found.add(entrance);
        index += run - 1;
      }
    }
  }

  // Bar 1 never gets one: "from the top" already exists.
  found.delete(0);
  return [...found].sort((a, b) => a - b);
}

/**
 * Marks for `score`, keyed by measure index.
 *
 * Candidates closer together than `MIN_SPACING` are thinned, earlier winning:
 * a mark just after a change is more useful than one just before the next.
 */
export function rehearsalMarks(score: Score): Map<number, string> {
  const kept: number[] = [];
  for (const index of candidates(score)) {
    const previous = kept[kept.length - 1];
    if (previous === undefined || index - previous >= MIN_SPACING) kept.push(index);
  }

  return new Map(kept.map((index, ordinal) => [index, markLabel(ordinal)]));
}

/**
 * `measures` with each mark written onto the measure carrying that **index**.
 *
 * Keyed by `measure.index`, not array position: a part's measures have already
 * been thinned by rest-collapsing, so position means nothing.
 */
export function applyRehearsalMarks(
  measures: readonly Measure[],
  marks: ReadonlyMap<number, string>,
): Measure[] {
  return measures.map((measure) => {
    const mark = marks.get(measure.index);
    return mark === undefined ? measure : { ...measure, rehearsalMark: mark };
  });
}

/**
 * `score` with rehearsal marks on every track.
 *
 * For the whole-score print. Every track gets the same letters at the same
 * bars, which is the only way "from B" can mean anything.
 */
export function withRehearsalMarks(score: Score): Score {
  const marks = rehearsalMarks(score);
  return {
    ...score,
    tracks: score.tracks.map((track) => ({
      ...track,
      measures: applyRehearsalMarks(track.measures, marks),
    })),
  };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test rehearsal-marks`
Expected: PASS. If "marks every 16 bars" reports extra indices, check whether the silence scan is adding entrances in a score where every bar sounds — it should find none.

- [x] **Step 5: Export it**

Add to `~/projects/music_lib/src/index.ts`, beside the other score exports:

```ts
export * from './domain/score/rehearsal-marks.js';
```

---

### Task 3: A mark ends a rest run

**Files:**

- Modify: `~/projects/music_lib/src/domain/score/collapse-rests.ts`
- Test: `~/projects/music_lib/src/domain/score/collapse-rests.test.ts`

**Interfaces:**

- Consumes: `Measure.rehearsalMark` (Task 1).
- Produces: `collapseRests` unchanged in signature.

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_lib/src/domain/score/collapse-rests.test.ts`, inside the `collapseRests` describe:

```ts
it('breaks a run at a marked bar', () => {
  // A mark inside a multi-measure rest would be invisible, and the
  // conductor's "from B" would point at nothing.
  const result = collapseRests([
    measure(0),
    measure(1),
    measure(2, false, { rehearsalMark: 'B' }),
    measure(3),
  ]);
  expect(counts(result)).toEqual([2, 2]);
  expect(result[1].rehearsalMark).toBe('B');
});

it('keeps a mark on a bar that starts a run', () => {
  const result = collapseRests([
    measure(0, true),
    measure(1, false, { rehearsalMark: 'B' }),
    measure(2),
    measure(3),
  ]);
  expect(result[1].rehearsalMark).toBe('B');
  expect(result[1].multiMeasureRestCount).toBe(3);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test collapse-rests`
Expected: FAIL on the first — the run spans the marked bar and swallows the mark.

- [x] **Step 3: Break the run**

In `~/projects/music_lib/src/domain/score/collapse-rests.ts`, replace the body of `runContinues`:

```ts
return (
  previous.timeSignature.numerator === next.timeSignature.numerator &&
  previous.timeSignature.denominator === next.timeSignature.denominator &&
  previous.keySignature.fifths === next.keySignature.fifths &&
  previous.keySignature.mode === next.keySignature.mode
);
```

with:

```ts
// A mark inside a rest would be invisible, and "from B" would point at
// nothing. The bar carrying it has to start its own rest.
if (next.rehearsalMark !== undefined) return false;

return (
  previous.timeSignature.numerator === next.timeSignature.numerator &&
  previous.timeSignature.denominator === next.timeSignature.denominator &&
  previous.keySignature.fifths === next.keySignature.fifths &&
  previous.keySignature.mode === next.keySignature.mode
);
```

and update the comment above it, which currently says feature 4 will add this, to say it has:

```ts
/** Whether a run may continue from `previous` into `next`. */
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test collapse-rests`
Expected: PASS.

---

### Task 4: Parts get marks

**Files:**

- Modify: `~/projects/music_lib/src/domain/score/extract-part.ts`
- Test: `~/projects/music_lib/src/domain/score/extract-part.test.ts`

**Interfaces:**

- Consumes: `rehearsalMarks`, `applyRehearsalMarks` (Task 2).
- Produces: `extractPart` unchanged in signature.

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_lib/src/domain/score/extract-part.test.ts`:

```ts
describe('extractPart carries the score-wide marks', () => {
  /** Two tracks, 40 bars, everything sounding. */
  function twoTrackFull(): Score {
    const base = createEmptyScore({
      title: 'Marks',
      measures: 40,
      tracks: [
        { name: 'One', instrumentName: 'Piano', clef: 'treble' as const },
        { name: 'Two', instrumentName: 'Piano', clef: 'bass' as const },
      ],
    });
    return base.tracks.reduce(
      (acc, track) =>
        track.measures.reduce(
          (inner, m) =>
            addNoteCommand({
              trackId: track.id,
              measureId: m.id,
              voiceIndex: 0,
              pitch: pitch('C'),
              startTick: m.startTick,
              durationTicks: base.ppq,
            }).execute(inner),
          acc,
        ),
      base,
    );
  }

  it('gives both parts the same letters at the same bars', () => {
    // The single most important property: "from B" means one bar for everyone.
    const score = twoTrackFull();
    const labelsOf = (trackId: string) =>
      extractPart(score, trackId)!
        .tracks[0].measures.filter((m) => m.rehearsalMark !== undefined)
        .map((m) => [m.index, m.rehearsalMark] as const);

    expect(labelsOf(score.tracks[0].id)).toEqual(labelsOf(score.tracks[1].id));
    expect(labelsOf(score.tracks[0].id).length).toBeGreaterThan(0);
  });

  it('marks the part from the whole score, not from that track alone', () => {
    // Silencing track two must still mark track one's part at the entrance,
    // because a landmark belongs to everybody.
    const base = twoTrackFull();
    const score: Score = {
      ...base,
      tracks: base.tracks.map((t, i) =>
        i === 1
          ? {
              ...t,
              measures: t.measures.map((m, j) => (j >= 4 && j <= 8 ? { ...m, voices: [] } : m)),
            }
          : t,
      ),
    };
    const first = extractPart(score, score.tracks[0].id)!;
    expect(first.tracks[0].measures.some((m) => m.index === 9 && m.rehearsalMark)).toBe(true);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test extract-part`
Expected: FAIL — no measure carries a mark.

- [x] **Step 3: Apply marks before collapsing**

In `~/projects/music_lib/src/domain/score/extract-part.ts`, replace:

```ts
// Collapse last, so it sees the written music. Order does not change the
// result today — transposition can neither silence a bar nor fill one — but
// reading it in the order a player would is what keeps this followable as
// features 4 and 5 add to it.
return { ...score, tracks: [{ ...track, measures: collapseRests(written) }] };
```

with:

```ts
// Marks come from the WHOLE score, not this track: "from B" has to mean the
// same bar in every part, and a per-track derivation would give each player
// different letters.
const marked = applyRehearsalMarks(written, rehearsalMarks(score));

// Collapse last. Marks must already be on, because a marked bar ends a rest
// run — a mark hidden inside a multi-measure rest would point at nothing.
return { ...score, tracks: [{ ...track, measures: collapseRests(marked) }] };
```

Add the import:

```ts
import { applyRehearsalMarks, rehearsalMarks } from './rehearsal-marks.js';
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test extract-part`
Expected: PASS, including the earlier transposition and collapsing tests.

---

### Task 5: Drawing the mark

**Files:**

- Modify: `~/projects/music_lib/src/adapters/vexflow/measure-content.ts`
- Test: `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.test.ts`

**Interfaces:**

- Consumes: `Measure.rehearsalMark` (Task 1).
- Produces: nothing new; the stave carries the section.

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.test.ts`:

```ts
describe('rehearsal marks', () => {
  /** Path operations recorded while drawing `score`. */
  function drawOps(score: Score): number {
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
    });
    return ctx.ops.filter((op) => op.method === 'bezierCurveTo' || op.method === 'lineTo').length;
  }

  it('draws more when a mark is present', () => {
    // VexFlow renders the letter as glyph outlines and a box, so there is no
    // string to match — but a marked score must draw strictly more than the
    // same score unmarked.
    const score = twinkleScore();
    const marked: Score = {
      ...score,
      tracks: score.tracks.map((t) => ({
        ...t,
        measures: t.measures.map((m, i) => (i === 1 ? { ...m, rehearsalMark: 'B' } : m)),
      })),
    };
    expect(drawOps(marked)).toBeGreaterThan(drawOps(score));
  });

  it('draws more for a longer mark', () => {
    // Confirms the label itself is drawn, not just a box: "AA" is wider than
    // "A".
    const score = twinkleScore();
    const withLabel = (label: string): Score => ({
      ...score,
      tracks: score.tracks.map((t) => ({
        ...t,
        measures: t.measures.map((m, i) => (i === 1 ? { ...m, rehearsalMark: label } : m)),
      })),
    });
    expect(drawOps(withLabel('AA'))).toBeGreaterThan(drawOps(withLabel('A')));
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test canvas-renderer`
Expected: FAIL — a marked score draws exactly as much as an unmarked one.

- [x] **Step 3: Put the section on the stave**

In `~/projects/music_lib/src/adapters/vexflow/measure-content.ts`, after the clef/key/time block and **before** the multi-measure-rest early return (so a marked rest still shows its letter):

```ts
// Boxed, because a bare letter beside a dynamic or a tempo marking is easy
// to miss — and a rehearsal mark that is missed has failed at its one job.
if (measure.rehearsalMark !== undefined) {
  stave.setSection(measure.rehearsalMark, 0, 0, 12, true);
}
```

`setSection(section, y, xOffset, fontSize, drawRect)` — `y: 0` places it above the stave, and `drawRect: true` is the box.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test canvas-renderer`
Expected: PASS. If the second test fails because "AA" and "A" draw the same, VexFlow may be centring a fixed-width box — check by drawing "A" against "AAAA"; if those differ, adjust the test to that pair rather than weakening it.

- [x] **Step 5: Verify and stage**

```bash
cd ~/projects/music_lib && bun run verify
bun run build
cp -r dist ~/projects/music_app/node_modules/@sudobility/music_lib/
rm -rf ~/projects/music_app/node_modules/.vite
```

Expected: PASS.

---

### Task 6: The score print gets them too

**Files:**

- Modify: `~/projects/music_app/src/features/print/PrintView.tsx`
- Test: `~/projects/music_app/src/features/print/PrintView.test.tsx`
- Modify: `~/projects/music_app/e2e/print.spec.ts`

**Interfaces:**

- Consumes: `withRehearsalMarks` (Task 2), `extractPart` (Task 4).
- Produces: nothing.

- [x] **Step 1: Write the failing test**

A rehearsal mark is drawn into a canvas, so no DOM assertion can see it. The
equality claim — same letters, same bars, every part — is asserted in
`music_lib`'s own suite (Task 4), where the derived measures are real objects.
What `music_app` can assert is that the view is wired to the right function and
that nothing leaks into the store. Add to
`~/projects/music_app/src/features/print/PrintView.test.tsx`:

```tsx
describe('rehearsal marks', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  /** A 40-bar two-track score, long enough to earn regular marks. */
  function longStore(): EditorStoreApi {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(2, 40));
    return store;
  }

  it('renders the whole score through the marking path', () => {
    // `withRehearsalMarks` returns a new score object; if the view were still
    // passing the raw one, the count of drawn systems would be unchanged but
    // the marks would be missing from what it lays out. Comparing the view's
    // system count against a layout of the *marked* score is what catches the
    // wrong function being wired in: marks break rest runs, so a marked score
    // can lay out differently.
    const store = longStore();
    const { container } = render(<PrintView store={store} onBack={() => {}} />);

    const expected = computeLayout(
      withRehearsalMarks(store.getState().score!),
      printRenderOptions(selectVisibleTrackIds(store.getState())),
    ).systems.length;

    expect(container.querySelectorAll('[data-testid^="print-system-"]')).toHaveLength(expected);
  });

  it('leaves the score in the store unmarked', () => {
    // Marks are print-only. One that cannot be moved would be a control that
    // looks editable and is not.
    const store = longStore();
    render(<PrintView store={store} onBack={() => {}} />);
    const marked = store
      .getState()
      .score!.tracks.flatMap((t) => t.measures)
      .some((m) => m.rehearsalMark !== undefined);
    expect(marked).toBe(false);
  });
});
```

Add `stressScore`, `computeLayout`, `withRehearsalMarks` and `selectVisibleTrackIds` to the
file's `@sudobility/music_lib` import, and `printRenderOptions` from
`@/features/print/print-layout`.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: FAIL on the first — the view lays out the unmarked score, and the
expected count comes from the marked one. If both counts happen to match for
this fixture, increase the track count or bar count until they differ; a test
that cannot fail is not worth keeping.

- [x] **Step 3: Apply marks to the whole-score path**

In `~/projects/music_app/src/features/print/PrintView.tsx`, replace:

```tsx
const printedScore = useMemo(() => {
  if (!score) return null;
  return isSingleTrack ? extractPart(score, scope) : score;
}, [score, isSingleTrack, scope]);
```

with:

```tsx
const printedScore = useMemo(() => {
  if (!score) return null;
  // Marks go on both: a conductor reading the score needs the same letters
  // the players have, which is the one thing a rehearsal mark is for.
  // `extractPart` applies them itself, from the whole score.
  return isSingleTrack ? extractPart(score, scope) : withRehearsalMarks(score);
}, [score, isSingleTrack, scope]);
```

and extend the import:

```tsx
import {
  computeLayout,
  extractPart,
  selectVisibleTrackIds,
  withRehearsalMarks,
} from '@sudobility/music_lib';
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: PASS.

- [x] **Step 5: Extend the print e2e**

The existing print specs must keep passing with marks present — marks break
rest runs, so the "part with a long silence prints fewer systems" test is the
one most likely to shift. Add to `~/projects/music_app/e2e/print.spec.ts`:

```ts
test('marks do not stop a part printing', async ({ page }) => {
  // Not an equality check — a mark is drawn into a canvas and the DOM cannot
  // see it, so equality is asserted in music_lib. This catches the coarser
  // failure: marks breaking rest runs badly enough that a part stops
  // rendering at all.
  await openPrintView(page, 'Marked Part', 40);

  const scoreSystems = await page.locator('[data-testid^="print-system-"]').count();
  expect(scoreSystems).toBeGreaterThan(0);

  const trackName = await page.evaluate(() => {
    const store = (
      window as unknown as {
        __SCORESMITH_STORE__: { getState: () => { score: { tracks: Array<{ name: string }> } } };
      }
    ).__SCORESMITH_STORE__;
    return store.getState().score.tracks[0].name;
  });

  await page.getByLabel('What to print').click();
  await page.getByRole('option', { name: trackName, exact: true }).click();
  await expect(page.locator('[data-testid^="print-system-"]').first()).toBeVisible();
});
```

- [x] **Step 6: Run everything**

```bash
cd ~/projects/music_lib && bun run verify
cd ~/projects/music_app && bun run verify
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e
```

Expected: all pass.

- [x] **Step 7: Look at a marked score and part**

Print the whole score and one part of the same piece. Check by eye: boxed letters above the stave, **the same letters at the same bar numbers in both**, none on bar 1, and none crowded closer than four bars.

The cross-check between score and part is the one worth doing by hand — a per-part derivation would produce marks that look perfectly reasonable in isolation and disagree between players.

---

## Self-Review

**Spec coverage.** Derived from the whole score → Tasks 2 and 4. Score and every part → Tasks 4 and 6. Never in the editor → Task 6 Step 3, asserted. Placement at key/metre changes, entrances, and every 16 bars → Task 2. The 4-bar floor with the earlier winning → Task 2. Bar 1 never marked → Task 2. Lettering A…Z, AA → Task 2. Breaks a rest run → Task 3. Rendering boxed above the stave → Task 5. Model field → Task 1. Human cross-check → Task 6 Step 7.

**Deliberate gaps, stated rather than hidden:**

- **Task 6's e2e is weak and I have said so in the step.** The DOM cannot show a rehearsal mark — it is drawn into a canvas — so the equality claim is asserted in `music_lib`, where the derived measures are real objects. The e2e only catches the view being wired to the wrong function. It should not be dressed up as more.
- **Candidates are read off track 0 for key and metre changes.** Every track shares the measure grid and its signatures, so this is equivalent to scanning all of them, and cheaper. If tracks ever carry independent signatures, this is the line that breaks.
- **`markLabel` past ZZ gives AAA.** Unlikely at 52 marks, and better than throwing.

**Type consistency.** `rehearsalMark?: string` is the same name in Tasks 1, 2, 3, 4, 5 and 6. `rehearsalMarks(score): Map<number, string>` and `applyRehearsalMarks(measures, marks): Measure[]` match between Task 2 and their use in Task 4. `withRehearsalMarks(score): Score` is produced in Task 2 and consumed in Task 6.

---

## Execution Notes (2026-08-05)

All six tasks complete. `music_types` 0.6.0 published and consumed. Full suites
green: music_types 51, music_lib 981, music_app 524, e2e 29.

Three places where the plan was wrong and the code is right:

1. **Task 5's tests measured the wrong thing.** The plan assumed VexFlow draws
   the label as glyph outlines, as it does the multi-measure-rest numeral, and
   counted path operations. It does not — `setSection` goes through `fillText`,
   with a `rect` for the box. That is _better_ than the plan assumed: the
   letter itself is assertable, so the count-the-ink proxy was replaced with
   four tests that check the drawn string, the box, and that a marked
   multi-measure rest still shows its letter. All four were confirmed to fail
   with `setSection` commented out.

2. **Task 6's first test was vacuous as written.** It compared the view's
   system count against a layout of the marked score, on the theory that marks
   break rest runs and change the layout. They do not for a whole score —
   collapsing happens only in `extractPart` — so the test passed before the
   feature existed. Replaced with one that reads `fillText` off the printed
   canvases (music_app's jsdom setup gives every canvas a persistent recording
   mock) and asserts every label from `rehearsalMarks` reaches the page.

3. **Two feature-3 tests changed, and the change is the feature working.** A
   24-bar silence used to collapse to one rest; it now prints as `15` + `[A]
9`, because a regular mark at bar 16 falls inside it and a multirest may not
   span a mark. The tests now assert the split, the counts summing to 24, and
   the mark on the second rest. Verified by eye: a part silent from bar 2 to 38
   prints `1 | 15 | [A] 17 x16 | [B] 33 x6 | [C] 39`.

Not committed — `scripts/push_all.sh` owns commits.

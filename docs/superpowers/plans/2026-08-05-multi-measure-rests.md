# Multi-Measure Rests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print a part where a long silence is one bar carrying its count, not twenty-four empty bars.

**Architecture:** A pure collapse pass inside `extractPart` replaces runs of silent measures with a single measure carrying `multiMeasureRestCount`, keeping each survivor's original `index` so bar numbers stay true. `buildMeasureContent` returns a voice-less stave for such a measure and the renderer draws a VexFlow `MultiMeasureRest` onto it.

**Tech Stack:** TypeScript (strict), VexFlow 4.2.5, Vitest, React 19, Playwright, Bun.

## Global Constraints

- **Feature 3 of seven.** Rehearsal marks, cues, page turns and written-pitch editing are features 4 to 7.
- **A run is two or more measures.** A single empty bar stays an ordinary whole-bar rest; `1` over a bar is noise.
- **"Silent" means every voice holds only rests.** One note in any voice disqualifies the measure.
- **Runs break at a change of key or time signature.** A multi-measure rest asserts the bars inside it are alike.
- **Parts only.** The whole-score print never collapses — one part's silence is another's entrance.
- **Each survivor keeps its original `index`.** The renderer draws measure numbers from `measure.index`, so this is what makes bar 25 follow a 24-bar rest.
- **`extractPart`'s output stays print-only** — never saved, played, edited or validated. Collapsing breaks `startTick` contiguity, and that is only safe because of this.
- **Do not commit or push.** `scripts/push_all.sh` does that.
- After changing `music_lib`: `bun run build`, copy `dist` into `music_app/node_modules/@sudobility/music_lib/`, then `rm -rf node_modules/.vite` in `music_app`.

---

## File Structure

| File                                                | Responsibility                                              |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `music_types/src/index.ts`                          | `Measure.multiMeasureRestCount?: number`.                   |
| `music_lib/src/domain/score/collapse-rests.ts`      | **New.** Pure: the collapse pass and what counts as silent. |
| `music_lib/src/domain/score/extract-part.ts`        | Run the collapse after transposition.                       |
| `music_lib/src/adapters/vexflow/layout.ts`          | A wider slot for a collapsed measure.                       |
| `music_lib/src/adapters/vexflow/measure-content.ts` | Voice-less stave plus the rest object.                      |
| `music_lib/src/adapters/vexflow/canvas-renderer.ts` | Draw it.                                                    |
| `music_app/src/features/print/PrintView.tsx`        | Delete the caveat.                                          |
| `music_app/e2e/print.spec.ts`                       | A long silence prints shorter, and the caveat is gone.      |

---

### Task 1: The model field

**Files:**

- Modify: `~/projects/music_types/src/index.ts:94-102`
- Test: `~/projects/music_types/src/api.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `Measure.multiMeasureRestCount?: number`, accepted by `scoreSchema`.

- [ ] **Step 1: Write the failing test**

Add to `~/projects/music_types/src/api.test.ts`, inside the `project schemas` describe:

```ts
it('accepts a measure carrying a multi-measure rest count', () => {
  const score = createEmptyScore({ title: 'P', measures: 1, tracks: [{ name: 'Piano' }] });
  const withCount = {
    ...score,
    tracks: score.tracks.map((t) => ({
      ...t,
      measures: t.measures.map((m) => ({ ...m, multiMeasureRestCount: 24 })),
    })),
  };
  const parsed = projectCreateRequestSchema.parse({ name: 'P', score: withCount });
  expect(parsed.score.tracks[0].measures[0].multiMeasureRestCount).toBe(24);
});

it('accepts a measure without one, which is every ordinary measure', () => {
  const score = createEmptyScore({ title: 'P', measures: 1, tracks: [{ name: 'Piano' }] });
  const parsed = projectCreateRequestSchema.parse({ name: 'P', score });
  expect(parsed.score.tracks[0].measures[0].multiMeasureRestCount).toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_types && bun run test`
Expected: FAIL — the schema strips the unknown key, so it reads back `undefined`.

- [ ] **Step 3: Add the field to the type**

In `~/projects/music_types/src/index.ts`, inside `Measure`, after `keySignature`:

```ts
  /**
   * How many measures of silence this one stands for, when it is a
   * multi-measure rest. Absent for an ordinary measure.
   *
   * Only ever set on a derived, print-only part (see `extractPart` in
   * music_lib). A stored score always writes its rests out in full, because
   * collapsing loses which bar is which.
   */
  multiMeasureRestCount?: number;
```

- [ ] **Step 4: Add it to the schema**

Find the measure schema with `grep -n "measureSchema" src/index.ts` and add, beside `keySignature`:

```ts
  multiMeasureRestCount: z.number().int().min(2).optional(),
```

Minimum 2, not 1: a count of one is not a multi-measure rest, and rejecting it here stops a meaningless value reaching the renderer.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_types && bun run verify`
Expected: PASS.

- [ ] **Step 6: Publish and consume**

```bash
cd ~/projects/music_types && npm version minor && npm publish
cd ~/projects/music_lib && bun add @sudobility/music_types@latest && bun run verify
```

If `npm version` refuses because the tree is dirty, commit is not an option here — instead edit `version` in `package.json` by hand, since `scripts/push_all.sh` owns commits. Verify the version actually published with `npm view @sudobility/music_types version` before moving on; the registry can lag a few seconds.

---

### Task 2: The collapse pass

**Files:**

- Create: `~/projects/music_lib/src/domain/score/collapse-rests.ts`
- Create: `~/projects/music_lib/src/domain/score/collapse-rests.test.ts`

**Interfaces:**

- Consumes: `Measure` with `multiMeasureRestCount` (Task 1).
- Produces:

```ts
export function isSilentMeasure(measure: Measure): boolean;
export function collapseRests(measures: readonly Measure[]): Measure[];
```

- [ ] **Step 1: Write the failing test**

Create `~/projects/music_lib/src/domain/score/collapse-rests.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collapseRests, isSilentMeasure } from './collapse-rests.js';
import type { KeySignature, Measure, TimeSignature } from '@sudobility/music_types';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
const C_MAJOR: KeySignature = { fifths: 0, mode: 'major' };

let nextId = 0;
/** A measure holding one whole-bar rest, or one note when `withNote`. */
function measure(index: number, withNote = false, overrides: Partial<Measure> = {}): Measure {
  nextId += 1;
  const voiceId = `v${nextId}`;
  return {
    id: `m${nextId}`,
    index,
    startTick: index * 1920,
    durationTicks: 1920,
    timeSignature: FOUR_FOUR,
    keySignature: C_MAJOR,
    voices: [
      {
        id: voiceId,
        name: 'Voice 1',
        events: withNote
          ? [
              {
                id: `n${nextId}`,
                pitch: { step: 'C', accidental: 0, octave: 4 },
                startTick: index * 1920,
                durationTicks: 1920,
                velocity: 80,
                voiceId,
                trackId: 't1',
              },
            ]
          : [
              {
                id: `r${nextId}`,
                startTick: index * 1920,
                durationTicks: 1920,
                voiceId,
                trackId: 't1',
              },
            ],
      },
    ],
    ...overrides,
  } as Measure;
}

const counts = (ms: Measure[]) => ms.map((m) => m.multiMeasureRestCount ?? 1);
const indices = (ms: Measure[]) => ms.map((m) => m.index);

describe('isSilentMeasure', () => {
  it('is true for a measure of rests', () => {
    expect(isSilentMeasure(measure(0))).toBe(true);
  });

  it('is false when any voice holds a note', () => {
    expect(isSilentMeasure(measure(0, true))).toBe(false);
  });

  it('is false when a second voice holds a note', () => {
    // One note anywhere disqualifies the bar; a player still has to play it.
    const m = measure(0);
    const withSecond = { ...m, voices: [...m.voices, measure(0, true).voices[0]] };
    expect(isSilentMeasure(withSecond)).toBe(false);
  });

  it('is true for a measure with no voices at all', () => {
    expect(isSilentMeasure({ ...measure(0), voices: [] })).toBe(true);
  });
});

describe('collapseRests', () => {
  it('collapses a run of silent measures into one carrying the count', () => {
    const result = collapseRests([measure(0), measure(1), measure(2), measure(3, true)]);
    expect(result).toHaveLength(2);
    expect(counts(result)).toEqual([3, 1]);
  });

  it('leaves a single silent measure alone', () => {
    // "1" over a bar is noise; every engraver writes it out.
    const result = collapseRests([measure(0, true), measure(1), measure(2, true)]);
    expect(result).toHaveLength(3);
    expect(result[1].multiMeasureRestCount).toBeUndefined();
  });

  it('keeps the original index of the measure it starts at', () => {
    // This is what makes bar 25 follow a 24-bar rest. The renderer draws
    // numbers from measure.index, so preserving it is the whole feature.
    const measures = [
      measure(0, true),
      ...Array.from({ length: 24 }, (_, i) => measure(i + 1)),
      measure(25, true),
    ];
    const result = collapseRests(measures);
    expect(indices(result)).toEqual([0, 1, 25]);
    expect(result[1].multiMeasureRestCount).toBe(24);
  });

  it('collapses a run at the very start', () => {
    const result = collapseRests([measure(0), measure(1), measure(2, true)]);
    expect(counts(result)).toEqual([2, 1]);
    expect(indices(result)).toEqual([0, 2]);
  });

  it('collapses a run at the very end', () => {
    const result = collapseRests([measure(0, true), measure(1), measure(2)]);
    expect(counts(result)).toEqual([1, 2]);
  });

  it('collapses a piece that is entirely silent', () => {
    expect(counts(collapseRests([measure(0), measure(1), measure(2)]))).toEqual([3]);
  });

  it('breaks a run at a time-signature change', () => {
    // The rest asserts the bars inside it are alike; spanning 4/4 to 3/4 would
    // hide where the change happened.
    const threeFour: TimeSignature = { numerator: 3, denominator: 4 };
    const result = collapseRests([
      measure(0),
      measure(1),
      measure(2, false, { timeSignature: threeFour }),
      measure(3, false, { timeSignature: threeFour }),
    ]);
    expect(counts(result)).toEqual([2, 2]);
  });

  it('breaks a run at a key change', () => {
    const dMajor: KeySignature = { fifths: 2, mode: 'major' };
    const result = collapseRests([
      measure(0),
      measure(1),
      measure(2, false, { keySignature: dMajor }),
      measure(3, false, { keySignature: dMajor }),
    ]);
    expect(counts(result)).toEqual([2, 2]);
  });

  it('leaves a score with no silence untouched', () => {
    const measures = [measure(0, true), measure(1, true)];
    expect(collapseRests(measures)).toEqual(measures);
  });

  it('does not mutate the measures it was given', () => {
    const measures = [measure(0), measure(1), measure(2, true)];
    const before = JSON.stringify(measures);
    collapseRests(measures);
    expect(JSON.stringify(measures)).toBe(before);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test collapse-rests`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement it**

Create `~/projects/music_lib/src/domain/score/collapse-rests.ts`:

```ts
/**
 * Collapsing runs of silence into multi-measure rests.
 *
 * Pure over a measure list — no score, no renderer — so the rules about what
 * counts as silent and where a run may not span are testable on their own.
 *
 * For **printed parts only**. A stored score always writes its rests out:
 * collapsing loses which bar is which, and the editor needs every bar.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type { Measure } from '@sudobility/music_types';

/** Below this, a run is written out — "1" over a bar is noise, not notation. */
const MIN_RUN = 2;

/**
 * Whether nothing sounds in `measure`.
 *
 * One note in any voice disqualifies it: the player still has to play that
 * bar, so it cannot disappear into a count.
 */
export function isSilentMeasure(measure: Measure): boolean {
  return measure.voices.every((voice) => !voice.events.some(isNoteEvent));
}

/** Whether a run may continue from `previous` into `next`. */
function runContinues(previous: Measure, next: Measure): boolean {
  // A multi-measure rest asserts the bars inside it are alike. Spanning a
  // change would hide from the player exactly where it happened.
  return (
    previous.timeSignature.numerator === next.timeSignature.numerator &&
    previous.timeSignature.denominator === next.timeSignature.denominator &&
    previous.keySignature.fifths === next.keySignature.fifths &&
    previous.keySignature.mode === next.keySignature.mode
  );
}

/**
 * `measures` with every run of two or more silent measures replaced by a
 * single measure carrying the count.
 *
 * The survivor is the run's **first** measure, keeping its own `index`,
 * `startTick` and signatures. That is what makes the numbering work: the
 * renderer draws measure numbers from `measure.index`, so the bar after a
 * 24-bar rest still reports 25.
 *
 * The returned list is therefore shorter than the input, and its measures are
 * no longer contiguous in `startTick`. Only a print-only derived score may
 * carry that.
 */
export function collapseRests(measures: readonly Measure[]): Measure[] {
  const out: Measure[] = [];
  let index = 0;

  while (index < measures.length) {
    const start = measures[index];

    if (!isSilentMeasure(start)) {
      out.push(start);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (
      end < measures.length &&
      isSilentMeasure(measures[end]) &&
      runContinues(measures[end - 1], measures[end])
    ) {
      end += 1;
    }

    const runLength = end - index;
    out.push(runLength >= MIN_RUN ? { ...start, multiMeasureRestCount: runLength } : start);
    index = end;
  }

  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test collapse-rests`
Expected: PASS.

---

### Task 3: `extractPart` collapses

**Files:**

- Modify: `~/projects/music_lib/src/domain/score/extract-part.ts`
- Test: `~/projects/music_lib/src/domain/score/extract-part.test.ts`

**Interfaces:**

- Consumes: `collapseRests` (Task 2).
- Produces: `extractPart` unchanged in signature; its measures are now collapsed.

- [ ] **Step 1: Write the failing test**

Add to `~/projects/music_lib/src/domain/score/extract-part.test.ts`:

```ts
describe('extractPart collapses silence', () => {
  /** One track: a note in bar 0, then `silentBars` empty bars, then a note. */
  function scoreWithSilence(silentBars: number): Score {
    const base = createEmptyScore({
      title: 'Rest',
      measures: silentBars + 2,
      tracks: [{ name: 'Solo', instrumentName: 'Solo', clef: 'treble' as const }],
    });
    const track = base.tracks[0];
    const withFirst = addNoteCommand({
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: pitch('C'),
      startTick: 0,
      durationTicks: base.ppq,
    }).execute(base);
    const last = withFirst.tracks[0].measures[silentBars + 1];
    return addNoteCommand({
      trackId: track.id,
      measureId: last.id,
      voiceIndex: 0,
      pitch: pitch('C'),
      startTick: last.startTick,
      durationTicks: base.ppq,
    }).execute(withFirst);
  }

  it('replaces a long silence with one measure carrying the count', () => {
    const score = scoreWithSilence(24);
    const part = extractPart(score, score.tracks[0].id)!;
    expect(part.tracks[0].measures).toHaveLength(3);
    expect(part.tracks[0].measures[1].multiMeasureRestCount).toBe(24);
  });

  it('keeps the numbering true across the rest', () => {
    // A player counting 24 bars must land on the bar the score calls 26.
    const score = scoreWithSilence(24);
    const part = extractPart(score, score.tracks[0].id)!;
    expect(part.tracks[0].measures.map((m) => m.index)).toEqual([0, 1, 25]);
  });

  it('leaves the score it was given uncollapsed', () => {
    const score = scoreWithSilence(24);
    const before = score.tracks[0].measures.length;
    extractPart(score, score.tracks[0].id);
    expect(score.tracks[0].measures).toHaveLength(before);
  });

  it('collapses after transposing, so both apply to one part', () => {
    const score = scoreWithSilence(4);
    const clarinet: Score = {
      ...score,
      tracks: score.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    };
    const part = extractPart(clarinet, clarinet.tracks[0].id)!;
    expect(part.tracks[0].measures[1].multiMeasureRestCount).toBe(4);
    expect(part.tracks[0].measures[0].keySignature.fifths).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test extract-part`
Expected: FAIL — every measure is still present and no count is set.

- [ ] **Step 3: Collapse in `extractPart`**

In `~/projects/music_lib/src/domain/score/extract-part.ts`, replace the whole return block:

```ts
const semitones = gmWrittenTransposition(track.midiProgram);
// Returned by reference when nothing moves: a non-transposing part is the
// same music, and copying it would only invalidate the layout cache.
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
```

with:

```ts
const semitones = gmWrittenTransposition(track.midiProgram);
const written =
  semitones === 0
    ? track.measures
    : track.measures.map((measure) => transposeMeasure(measure, semitones));

// Collapse last, so it sees the written music. Order does not change the
// result today — transposition cannot make a bar silent or sounding — but
// reading it in the order a player would is what keeps the pipeline
// followable as features 4 and 5 add to it.
return { ...score, tracks: [{ ...track, measures: collapseRests(written) }] };
```

Add the import:

```ts
import { collapseRests } from './collapse-rests.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test extract-part`
Expected: PASS, including the pre-existing transposition tests. If the "keeps rests and every other event in place" test now fails, that is correct — it counted events per measure and there are fewer measures. Update it to compare only the measures that survived, rather than deleting it.

---

### Task 4: Rendering the rest

**Files:**

- Modify: `~/projects/music_lib/src/adapters/vexflow/layout.ts:183-192`
- Modify: `~/projects/music_lib/src/adapters/vexflow/measure-content.ts`
- Modify: `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.ts`
- Test: `~/projects/music_lib/src/adapters/vexflow/layout.test.ts`, `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.test.ts`

**Interfaces:**

- Consumes: `Measure.multiMeasureRestCount` (Task 1).
- Produces: `buildMeasureContent` returns `{ stave, voices, beams, multiMeasureRest }` where `multiMeasureRest` is a VexFlow `MultiMeasureRest | null`.

- [ ] **Step 1: Write the failing layout test**

Add to `~/projects/music_lib/src/adapters/vexflow/layout.test.ts`:

```ts
describe('multi-measure rest width', () => {
  it('gives a collapsed measure more room than an ordinary one', () => {
    // The horizontal bar and its numeral need space; squeezed into one
    // measure's width a 24-bar rest reads as a mistake.
    const score = twinkleScore();
    const collapsed: typeof score = {
      ...score,
      tracks: score.tracks.map((t) => ({
        ...t,
        measures: t.measures.map((m, i) => (i === 1 ? { ...m, multiMeasureRestCount: 24 } : m)),
      })),
    };
    const plan = computeLayout(collapsed, options());
    const rest = plan.trackLayouts[0].measures.find((m) => m.measureIndex === 1)!;
    const ordinary = plan.trackLayouts[0].measures.find((m) => m.measureIndex === 0)!;
    expect(rest.box.width).toBeGreaterThan(ordinary.box.width);
  });

  it('does not scale the width with the count', () => {
    // A 60-bar rest must not be thirty times wider than a 2-bar one.
    const score = twinkleScore();
    const withCount = (count: number) =>
      computeLayout(
        {
          ...score,
          tracks: score.tracks.map((t) => ({
            ...t,
            measures: t.measures.map((m, i) =>
              i === 1 ? { ...m, multiMeasureRestCount: count } : m,
            ),
          })),
        },
        options(),
      ).trackLayouts[0].measures.find((m) => m.measureIndex === 1)!.box.width;

    expect(withCount(60)).toBe(withCount(2));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test layout`
Expected: FAIL on the first — the collapsed measure has the same width as any other.

- [ ] **Step 3: Widen the slot**

In `~/projects/music_lib/src/adapters/vexflow/layout.ts`, add beside the other width constants (near `BASE_MEASURE_WIDTH`):

```ts
/**
 * Width of a measure standing in for a run of silent ones.
 *
 * Fixed rather than proportional to the count: a 60-bar rest should not be
 * thirty times wider than a 2-bar one. It only has to fit the horizontal bar
 * and a numeral.
 */
const MULTI_REST_MEASURE_WIDTH = 320;
```

and inside the `contentWidths` builder, replace:

```ts
return Math.max(BASE_MEASURE_WIDTH, maxEvents * NOTE_SLOT_WIDTH + DENSE_MEASURE_PADDING);
```

with:

```ts
// A collapsed measure's width comes from what it draws — one bar and a
// number — not from the events it replaced, of which there are none.
const collapsed = tracks.some(
  (track) => track.measures[measureIndex]?.multiMeasureRestCount !== undefined,
);
if (collapsed) return MULTI_REST_MEASURE_WIDTH;

return Math.max(BASE_MEASURE_WIDTH, maxEvents * NOTE_SLOT_WIDTH + DENSE_MEASURE_PADDING);
```

- [ ] **Step 4: Run the layout tests**

Run: `cd ~/projects/music_lib && bun run test layout`
Expected: PASS.

- [ ] **Step 5: Write the failing renderer test**

Add to `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.test.ts`:

```ts
describe('multi-measure rests', () => {
  /** twinkleScore with measure 1 standing in for a 24-bar rest. */
  function collapsedScore(): Score {
    const score = twinkleScore();
    return {
      ...score,
      tracks: score.tracks.map((t) => ({
        ...t,
        measures: t.measures.map((m, i) =>
          i === 1 ? { ...m, multiMeasureRestCount: 24, voices: [] } : m,
        ),
      })),
    };
  }

  it('draws the count', () => {
    // The numeral is the whole point: it is what the player counts.
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(collapsedScore(), ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
    });
    const text = ctx.ops.filter((op) => op.method === 'fillText').map((op) => String(op.args[0]));
    expect(text).toContain('24');
  });

  it('records no note bboxes for the collapsed measure', () => {
    // Nothing sounds there, so there is nothing to click or colour.
    const ctx = createMock2DContext();
    const score = collapsedScore();
    const result = new CanvasScoreRenderer().render(score, ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
    });
    const collapsedMeasure = score.tracks[0].measures[1];
    expect(result.measureIdToBBox.has(collapsedMeasure.id)).toBe(true);
  });

  it('still draws the ordinary measures around it', () => {
    const ctx = createMock2DContext();
    const result = new CanvasScoreRenderer().render(collapsedScore(), ctx, {
      ...OPTS,
      viewport: { top: 0, bottom: 5000 },
    });
    expect(result.idToBBox.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test canvas-renderer`
Expected: FAIL — no `24` is drawn.

- [ ] **Step 7: Build the rest object**

In `~/projects/music_lib/src/adapters/vexflow/measure-content.ts`, change the return type and add the branch. After the stave's clef/key/time block and before the `const voices: Voice[] = []` line:

```ts
// A collapsed measure draws one wide rest and a numeral instead of notes.
// Returned rather than drawn here so the renderer keeps sole responsibility
// for putting ink on the context.
if (measure.multiMeasureRestCount !== undefined) {
  return {
    stave,
    voices: [],
    beams: [],
    multiMeasureRest: new MultiMeasureRest(measure.multiMeasureRestCount, {}),
  };
}
```

Change the signature's return type to:

```ts
): { stave: Stave; voices: Voice[]; beams: Beam[]; multiMeasureRest?: MultiMeasureRest } {
```

and add `MultiMeasureRest` to the `vexflow` import at the top of the file.

- [ ] **Step 8: Draw it**

In `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.ts`, in the measure loop, destructure it:

```ts
        const { stave, voices, beams, multiMeasureRest } = buildMeasureContent(
```

and after `stave.format();` and the `staves.push(...)` line, add:

```ts
if (multiMeasureRest) {
  multiMeasureRest.setStave(stave);
  restsToDraw.push(multiMeasureRest);
}
```

Declare `restsToDraw` beside the existing `beamsToDraw` (find it with `grep -n "beamsToDraw" src/adapters/vexflow/canvas-renderer.ts`):

```ts
const restsToDraw: MultiMeasureRest[] = [];
```

and draw them where beams are drawn, after the formatter has run:

```ts
for (const rest of restsToDraw) rest.setContext(vexCtx).draw();
```

Add `MultiMeasureRest` to that file's `vexflow` import too.

- [ ] **Step 9: Run the renderer tests**

Run: `cd ~/projects/music_lib && bun run test canvas-renderer`
Expected: PASS. If `24` is missing, check whether VexFlow draws the numeral via `fillText` at all — inspect with a temporary `console.log(ctx.ops.map((o) => o.method))` and assert against whatever it actually uses, rather than weakening the test to "did not throw".

- [ ] **Step 10: Verify and stage**

```bash
cd ~/projects/music_lib && bun run verify
bun run build
cp -r dist ~/projects/music_app/node_modules/@sudobility/music_lib/
rm -rf ~/projects/music_app/node_modules/.vite
```

Expected: PASS.

---

### Task 5: The caveat goes

**Files:**

- Modify: `~/projects/music_app/src/features/print/PrintView.tsx`
- Test: `~/projects/music_app/src/features/print/PrintView.test.tsx`
- Modify: `~/projects/music_app/e2e/print.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

In `~/projects/music_app/src/features/print/PrintView.test.tsx`, replace the existing `warns about a single track, and only about a single track` test with:

```tsx
it('no longer warns about a single track at all', async () => {
  // Transposition and multi-measure rests were the two things that made a
  // filtered track less than a part. Both have landed, so the caveat has
  // nothing left to say.
  const user = userEvent.setup();
  const store = makeStore();
  render(<PrintView store={store} onBack={() => {}} />);

  await user.click(screen.getByLabelText('What to print'));
  await user.click(screen.getByRole('option', { name: store.getState().score!.tracks[0].name }));

  expect(screen.queryByText(/not yet an orchestral part/i)).toBeNull();
  expect(screen.queryByText(/concert pitch/i)).toBeNull();
  expect(screen.queryByText(/bar of rest/i)).toBeNull();
});
```

and update the `no longer warns about concert pitch` test in the transposition describe the same way — it currently asserts the caveat is still present, which stops being true here:

```tsx
expect(screen.queryByText(/not yet an orchestral part/i)).toBeNull();
expect(screen.queryByText(/concert pitch/i)).toBeNull();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: FAIL — the caveat is still rendered.

- [ ] **Step 3: Delete the caveat**

In `~/projects/music_app/src/features/print/PrintView.tsx`, remove the whole block:

```tsx
{
  isSingleTrack ? (
    <p className="w-full text-sm text-neutral-600">
      Single tracks print with every bar of rest written out. Fine for a lead sheet or a piano part;
      not yet an orchestral part.
    </p>
  ) : null;
}
```

`isSingleTrack` is still used by `printedScore`, so leave it in place.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: PASS.

- [ ] **Step 5: Update the e2e**

In `~/projects/music_app/e2e/print.spec.ts`, the transposition test asserts the caveat is visible. Change:

```ts
await expect(page.getByText(/not yet an orchestral part/i)).toBeVisible();
await expect(page.getByText(/concert pitch/i)).toHaveCount(0);
```

to:

```ts
// Both halves of the caveat are gone: the part is transposed and its rests
// are collapsed.
await expect(page.getByText(/not yet an orchestral part/i)).toHaveCount(0);
await expect(page.getByText(/concert pitch/i)).toHaveCount(0);
```

The `a single track needs no more systems than the whole score` test also asserts the caveat; remove that line from it.

- [ ] **Step 6: Add an e2e for the collapse**

Add to `~/projects/music_app/e2e/print.spec.ts`:

```ts
test('a part with a long silence prints fewer systems than the score', async ({ page }) => {
  await openPrintView(page, 'Long Rest', 24);

  // Empty the first track's later measures so the part has a real silence to
  // collapse, then compare the printed length of score and part.
  await page.evaluate(() => {
    type Store = {
      getState: () => {
        score: { tracks: Array<{ id: string; measures: Array<{ voices: unknown[] }> }> };
        setScore: (s: unknown) => void;
      };
    };
    const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
    const score = store.getState().score as unknown as {
      tracks: Array<Record<string, unknown>>;
    };
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((track, trackIndex) =>
        trackIndex !== 0
          ? track
          : {
              ...track,
              measures: (track.measures as Array<Record<string, unknown>>).map((m, i) =>
                i < 4 ? m : { ...m, voices: [] },
              ),
            },
      ),
    });
  });

  const scoreSystems = await page.locator('[data-testid^="print-system-"]').count();

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

  const partSystems = await page.locator('[data-testid^="print-system-"]').count();
  expect(partSystems).toBeLessThan(scoreSystems);
});
```

- [ ] **Step 7: Run everything**

```bash
cd ~/projects/music_lib && bun run verify
cd ~/projects/music_app && bun run verify
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e
```

Expected: all pass.

- [ ] **Step 8: Look at a part with a long rest**

Print a track whose middle is empty. Check by eye: one wide bar with a numeral where the silence was, the numeral matching the number of bars removed, and the **next bar's number continuing from the score** rather than restarting.

The numbering is the part worth checking by hand — a count that is right but a bar number that is wrong leaves the player in exactly the place this feature exists to prevent.

---

## Self-Review

**Spec coverage.** Runs of 2+, single bars left alone, silence defined by voices → Task 2. Breaks at key and time changes → Task 2. Parts only → Task 3 (only `extractPart` calls it). Original `index` preserved → Tasks 2 and 3, asserted. The model field → Task 1. Wider fixed slot → Task 4. VexFlow rendering → Task 4. Caveat deleted → Task 5. Human check → Task 5 Step 8.

**Deliberate gaps, stated rather than hidden:**

- **Task 1 publishes `music_types` mid-plan.** Unavoidable: `music_lib` consumes it from npm, and the field must exist there before Task 2 compiles. The plan says to hand-edit `version` rather than `npm version`, since commits belong to `push_all.sh`.
- **An existing `extract-part` test will break** — it counts events per measure, and there are now fewer measures. Task 3 Step 4 says to narrow it rather than delete it.
- **The renderer test asserts `fillText` contains the count.** If VexFlow draws the numeral by another path, Task 4 Step 9 says to find out which and assert on that — not to weaken the test.
- **Feature 4's rehearsal marks must also break runs.** `runContinues` is where that goes; it is noted in the spec and not built here.

**Type consistency.** `multiMeasureRestCount?: number` is the same name in Tasks 1, 2, 3 and 4. `collapseRests(measures: readonly Measure[]): Measure[]` and `isSilentMeasure(measure: Measure): boolean` match between Task 2 and their use in Task 3. `buildMeasureContent`'s new `multiMeasureRest?: MultiMeasureRest` is produced in Task 4 Step 7 and consumed in Step 8.

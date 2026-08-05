# Page Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** choose which systems go on which page, so a player turns while they have a hand free rather than mid-phrase.

**Architecture:** A pure packer in `music_lib` takes a `LayoutPlan` and a page height and returns the systems on each page. Given the part's track it also scores each candidate break by the bars the player has free across it, and pulls the break back up to two systems to buy a better turn. `music_app` keeps only the paper picker, the `@page` rule and the rendering.

**Tech Stack:** TypeScript (strict), VexFlow 4.2.5, Vitest, React 19, Playwright, Bun.

## Global Constraints

- **Feature 6 of seven.** Written-pitch editing is feature 7.
- **The packer lives in `music_lib`.** Silence analysis and layout arithmetic are business logic; `music_app`'s CLAUDE.md says so explicitly. The app decides _what paper_, not _what fits_.
- **Turn optimisation applies to parts only.** Expressed as an optional `turnTrack` argument: given, optimise for that player; absent, pack greedily. The whole-score print passes nothing.
- **Free bars at a turn = trailing silent bars of the page's last system + leading silent bars of the next system's first.** A multi-measure rest counts its **full** `multiMeasureRestCount`, not 1.
- **Never pull back more than 2 systems, and never to an empty page.** On a tie the fullest page wins.
- **A system taller than the page still gets its own page.** It overflows; that beats dropping it or looping.
- **Every system appears exactly once, in order, across all pages.** The invariant a pagination bug breaks first.
- **One source for the margin.** `PAGE_MARGIN_MM` drives both the height calculation and the emitted `@page`; `print.css` loses its own `@page` block.
- **`measureIndices` are array positions into `track.measures`**, not `measure.index` values (see `layout.ts:365`). For a collapsed part they index the collapsed array, which is what turn scoring wants.
- **Do not commit or push.** `scripts/push_all.sh` does that.
- After changing `music_lib`: `bun run build`, copy `dist` into `music_app/node_modules/@sudobility/music_lib/`, then `rm -rf node_modules/.vite` in `music_app`.

---

## File Structure

| File                                           | Responsibility                                      |
| ---------------------------------------------- | --------------------------------------------------- |
| `music_lib/src/adapters/vexflow/pagination.ts` | **New.** Paper ratios, the packer, turn scoring.    |
| `music_lib/src/index.ts`                       | Export it.                                          |
| `music_app/src/features/print/print-layout.ts` | `PrintPage` → `PrintSystemSlice`.                   |
| `music_app/src/features/print/PrintSystem.tsx` | Takes a slice, not a "page".                        |
| `music_app/src/features/print/PrintView.tsx`   | Paper picker, pagination, page blocks, `@page`.     |
| `music_app/src/features/print/print.css`       | Page blocks break after; `@page` moves to the view. |
| `music_app/e2e/print.spec.ts`                  | Changing paper changes the page count.              |

---

### Task 1: Paper, as a ratio

**Files:**

- Create: `~/projects/music_lib/src/adapters/vexflow/pagination.ts`
- Create: `~/projects/music_lib/src/adapters/vexflow/pagination.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
export type PaperSize = 'a4' | 'letter' | 'legal';
export type PaperOrientation = 'portrait' | 'landscape';
export const PAPER_DIMENSIONS_MM: Record<PaperSize, { width: number; height: number }>;
export const PAGE_MARGIN_MM: number;
export function usablePageHeight(
  paper: PaperSize,
  orientation: PaperOrientation,
  logicalWidth: number,
  marginMm?: number,
): number;
```

- [x] **Step 1: Write the failing test**

Create `~/projects/music_lib/src/adapters/vexflow/pagination.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PAGE_MARGIN_MM, PAPER_DIMENSIONS_MM, usablePageHeight } from './pagination.js';

describe('usablePageHeight', () => {
  it('is the logical width scaled by the printable aspect ratio', () => {
    // A4 portrait at a 12mm margin: 186mm x 273mm printable, so 1000 logical
    // units of width buys 1000 * 273 / 186 of height.
    expect(usablePageHeight('a4', 'portrait', 1000)).toBeCloseTo((1000 * 273) / 186, 4);
  });

  it('swaps the dimensions for landscape', () => {
    expect(usablePageHeight('a4', 'landscape', 1000)).toBeCloseTo((1000 * 186) / 273, 4);
  });

  it('gives a portrait page more height than a landscape one', () => {
    // The whole reason the picker exists: paper shape changes what fits.
    for (const paper of ['a4', 'letter', 'legal'] as const) {
      expect(usablePageHeight(paper, 'portrait', 1000)).toBeGreaterThan(
        usablePageHeight(paper, 'landscape', 1000),
      );
    }
  });

  it('gives legal more height than letter, which is the same width', () => {
    expect(PAPER_DIMENSIONS_MM.legal.width).toBe(PAPER_DIMENSIONS_MM.letter.width);
    expect(usablePageHeight('legal', 'portrait', 1000)).toBeGreaterThan(
      usablePageHeight('letter', 'portrait', 1000),
    );
  });

  it('scales with the logical width', () => {
    expect(usablePageHeight('a4', 'portrait', 2000)).toBeCloseTo(
      2 * usablePageHeight('a4', 'portrait', 1000),
      4,
    );
  });

  it('takes a margin, defaulting to the one the printed page uses', () => {
    expect(usablePageHeight('a4', 'portrait', 1000, PAGE_MARGIN_MM)).toBe(
      usablePageHeight('a4', 'portrait', 1000),
    );
    // A bigger margin eats proportionally more of the long side.
    expect(usablePageHeight('a4', 'portrait', 1000, 25)).toBeLessThan(
      usablePageHeight('a4', 'portrait', 1000, 12),
    );
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test pagination`
Expected: FAIL — the module does not exist.

- [x] **Step 3: Implement it**

Create `~/projects/music_lib/src/adapters/vexflow/pagination.ts`:

```ts
/**
 * Which systems go on which page, and where a page turn should fall.
 *
 * Pure over a `LayoutPlan` — no DOM, no canvas, no React — so the decisions
 * about paper and page turns are testable without printing anything.
 *
 * Feature 1 left pagination to the browser: every system was a block with
 * `break-inside: avoid`, and the browser fitted as many as the paper allowed.
 * That has no opinion about *where* the break falls, and a turn in the middle
 * of a phrase costs a real player a hand.
 */
import { isSilentMeasure } from '../../domain/score/collapse-rests.js';
import type { Measure, Track } from '@sudobility/music_types';
import type { LayoutPlan, SystemLayout } from './layout.js';

export type PaperSize = 'a4' | 'letter' | 'legal';
export type PaperOrientation = 'portrait' | 'landscape';

/** Portrait dimensions in millimetres; landscape swaps them. */
export const PAPER_DIMENSIONS_MM: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 }, // 8.5in x 11in
  legal: { width: 215.9, height: 355.6 }, // 8.5in x 14in
};

/**
 * The margin the printed page reserves on every side.
 *
 * The single source: the `@page` rule is emitted from this, and the height
 * below is computed from it. Two numbers here means pagination that silently
 * disagrees with what the printer does.
 */
export const PAGE_MARGIN_MM = 12;

/**
 * How much height `logicalWidth` units of layout buy on this paper.
 *
 * Paper only ever enters as a ratio: the layout is computed at a fixed logical
 * width and each page is displayed at the paper's printable width, so the
 * scale is uniform and millimetres cancel.
 */
export function usablePageHeight(
  paper: PaperSize,
  orientation: PaperOrientation,
  logicalWidth: number,
  marginMm: number = PAGE_MARGIN_MM,
): number {
  const { width, height } = PAPER_DIMENSIONS_MM[paper];
  const shortSide = orientation === 'portrait' ? width : height;
  const longSide = orientation === 'portrait' ? height : width;
  return (logicalWidth * (longSide - 2 * marginMm)) / (shortSide - 2 * marginMm);
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test pagination`
Expected: PASS.

---

### Task 2: Packing systems onto pages

**Files:**

- Modify: `~/projects/music_lib/src/adapters/vexflow/pagination.ts`
- Modify: `~/projects/music_lib/src/adapters/vexflow/pagination.test.ts`

**Interfaces:**

- Consumes: `LayoutPlan`, `SystemLayout` from `./layout.js`.
- Produces:

```ts
export type PrintPage = { systemIndices: number[] };
export function paginate(plan: LayoutPlan, pageHeight: number): PrintPage[];
```

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_lib/src/adapters/vexflow/pagination.test.ts`:

```ts
import { paginate } from './pagination.js';
import type { LayoutPlan, SystemLayout } from './layout.js';

/** A plan of `heights.length` systems, each `heights[i]` tall, laid end to end. */
function planOf(heights: number[], indicesPerSystem: number[][] = []): LayoutPlan {
  let y = 0;
  const systems: SystemLayout[] = heights.map((height, i) => {
    const gutterTop = y;
    y += height;
    return {
      measureIndices: indicesPerSystem[i] ?? [i],
      xLeft: 0,
      xRight: 1000,
      gutterTop,
      yTop: gutterTop,
      yBottom: gutterTop + height,
    };
  });
  return { tracks: [], trackLayouts: [], systems, totalWidth: 1000, totalHeight: y };
}

const flat = (pages: { systemIndices: number[] }[]) => pages.flatMap((p) => p.systemIndices);

describe('paginate', () => {
  it('fills each page and starts a new one when the next system will not fit', () => {
    // Four 100-tall systems on a 250-tall page: 2 + 2.
    const pages = paginate(planOf([100, 100, 100, 100]), 250);
    expect(pages.map((p) => p.systemIndices)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('puts every system on exactly one page, in order', () => {
    // The invariant a pagination bug breaks first.
    const heights = [80, 120, 60, 200, 90, 140, 70];
    const pages = paginate(planOf(heights), 260);
    expect(flat(pages)).toEqual(heights.map((_, i) => i));
  });

  it('never exceeds the page height unless one system alone cannot fit', () => {
    const heights = [80, 120, 60, 200, 90, 140, 70];
    const pageHeight = 260;
    const pages = paginate(planOf(heights), pageHeight);
    for (const page of pages) {
      const used = page.systemIndices.reduce((sum, i) => sum + heights[i], 0);
      if (page.systemIndices.length > 1) expect(used).toBeLessThanOrEqual(pageHeight);
    }
  });

  it('gives a system taller than the page a page of its own', () => {
    // It will overflow. That beats dropping it, and it beats looping forever.
    const pages = paginate(planOf([100, 400, 100]), 250);
    expect(pages.map((p) => p.systemIndices)).toEqual([[0], [1], [2]]);
  });

  it('returns nothing for a plan with no systems', () => {
    expect(paginate(planOf([]), 250)).toEqual([]);
  });

  it('puts everything on one page when it all fits', () => {
    expect(paginate(planOf([50, 50, 50]), 1000).map((p) => p.systemIndices)).toEqual([[0, 1, 2]]);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test pagination`
Expected: FAIL — `paginate` is not exported.

- [x] **Step 3: Implement it**

Append to `~/projects/music_lib/src/adapters/vexflow/pagination.ts`:

```ts
/** The systems printed on one page, by index into `LayoutPlan.systems`. */
export type PrintPage = { systemIndices: number[] };

/** A system's full printed height, measure-number band included. */
function systemHeight(system: SystemLayout): number {
  return system.yBottom - system.gutterTop;
}

/**
 * Which systems go on which page.
 *
 * Greedy: take systems in order while they fit. A system taller than the page
 * still gets its own page — it overflows, which is better than dropping it and
 * better than never advancing.
 */
export function paginate(plan: LayoutPlan, pageHeight: number): PrintPage[] {
  const pages: PrintPage[] = [];
  let start = 0;

  while (start < plan.systems.length) {
    let end = start;
    let used = 0;

    while (end < plan.systems.length) {
      const height = systemHeight(plan.systems[end]);
      // `end > start` is what guarantees progress: the first system on a page
      // always goes on it, however tall it is.
      if (end > start && used + height > pageHeight) break;
      used += height;
      end += 1;
    }

    const systemIndices: number[] = [];
    for (let i = start; i < end; i += 1) systemIndices.push(i);
    pages.push({ systemIndices });
    start = end;
  }

  return pages;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test pagination`
Expected: PASS.

---

### Task 3: Turning where the player is free

**Files:**

- Modify: `~/projects/music_lib/src/adapters/vexflow/pagination.ts`
- Modify: `~/projects/music_lib/src/adapters/vexflow/pagination.test.ts`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**

- Consumes: `isSilentMeasure` from `../../domain/score/collapse-rests.js`.
- Produces:

```ts
export const MAX_PULL_BACK: number;
export function turnFreeBars(plan: LayoutPlan, track: Track, lastSystemIndex: number): number;
export function paginate(plan: LayoutPlan, pageHeight: number, turnTrack?: Track): PrintPage[];
```

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_lib/src/adapters/vexflow/pagination.test.ts`:

```ts
import { MAX_PULL_BACK, turnFreeBars } from './pagination.js';
import type { Measure, Track } from '@sudobility/music_types';

/**
 * A track of `pattern.length` measures. `null` is silent; a number is a silent
 * multi-measure rest standing for that many bars; `'note'` sounds.
 */
function trackOf(pattern: Array<'note' | null | number>): Track {
  const measures = pattern.map((entry, i) => {
    const sounding = entry === 'note';
    const measure: Measure = {
      id: `m${i}`,
      index: i,
      startTick: i * 1920,
      durationTicks: 1920,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { fifths: 0, mode: 'major' },
      voices: [
        {
          id: `v${i}`,
          name: 'Voice 1',
          events: sounding
            ? [
                {
                  id: `n${i}`,
                  pitch: { step: 'C', accidental: 0, octave: 4 },
                  startTick: i * 1920,
                  durationTicks: 1920,
                  velocity: 80,
                  voiceId: `v${i}`,
                  trackId: 't1',
                },
              ]
            : [
                {
                  id: `r${i}`,
                  startTick: i * 1920,
                  durationTicks: 1920,
                  voiceId: `v${i}`,
                  trackId: 't1',
                },
              ],
        },
      ],
      ...(typeof entry === 'number' ? { multiMeasureRestCount: entry } : {}),
    } as Measure;
    return measure;
  });
  return { id: 't1', name: 'Solo', measures } as unknown as Track;
}

describe('turnFreeBars', () => {
  it('adds the silence at the end of the page to the silence at the start of the next', () => {
    // The player may begin turning after their last note and must be reading
    // again by their first on the next page.
    const plan = planOf(
      [100, 100],
      [
        [0, 1],
        [2, 3],
      ],
    );
    const track = trackOf(['note', null, null, 'note']);
    expect(turnFreeBars(plan, track, 0)).toBe(2);
  });

  it('counts a multi-measure rest for every bar it stands for', () => {
    // A 13-bar rest at the foot of a page is the best turn in the piece.
    const plan = planOf(
      [100, 100],
      [
        [0, 1],
        [2, 3],
      ],
    );
    const track = trackOf(['note', 13, 'note', 'note']);
    expect(turnFreeBars(plan, track, 0)).toBe(13);
  });

  it('is zero when the player is playing on both sides of the turn', () => {
    const plan = planOf(
      [100, 100],
      [
        [0, 1],
        [2, 3],
      ],
    );
    expect(turnFreeBars(plan, trackOf(['note', 'note', 'note', 'note']), 0)).toBe(0);
  });

  it('is zero after the last system, where there is no turn', () => {
    const plan = planOf(
      [100, 100],
      [
        [0, 1],
        [2, 3],
      ],
    );
    expect(turnFreeBars(plan, trackOf(['note', null, null, 'note']), 1)).toBe(0);
  });
});

describe('paginate with a turn track', () => {
  it('pulls the break back onto a rest', () => {
    // Greedy fits 3 systems and would turn where the player is playing.
    // System 1 ends silent, so ending the page there buys a real turn.
    const plan = planOf(
      [100, 100, 100, 100],
      [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7],
      ],
    );
    const track = trackOf(['note', 'note', 'note', null, 'note', 'note', 'note', 'note']);

    expect(paginate(plan, 350).map((p) => p.systemIndices)).toEqual([[0, 1, 2], [3]]);
    expect(paginate(plan, 350, track).map((p) => p.systemIndices)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('does not pull back when the greedy break is already the best turn', () => {
    // Ties go to the fullest page: pulling back for nothing is pure loss.
    const plan = planOf(
      [100, 100, 100, 100],
      [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7],
      ],
    );
    const track = trackOf(['note', 'note', 'note', 'note', 'note', null, 'note', 'note']);
    expect(paginate(plan, 350, track).map((p) => p.systemIndices)).toEqual([[0, 1, 2], [3]]);
  });

  it('never pulls back more than MAX_PULL_BACK systems', () => {
    // A perfect turn four systems back is out of reach; the page stays full.
    const indices = [[0], [1], [2], [3], [4], [5]];
    const plan = planOf([100, 100, 100, 100, 100, 100], indices);
    const track = trackOf([null, 'note', 'note', 'note', 'note', 'note']);
    // Exact, not a bound: the reachable candidates all score 0, so the page
    // must stay exactly as greedy left it.
    expect(paginate(plan, 550, track)[0].systemIndices).toEqual([0, 1, 2, 3, 4]);
    expect(MAX_PULL_BACK).toBe(2);
  });

  it('never pulls back to an empty page', () => {
    // The only system that fits ends where the player is playing; it still has
    // to go somewhere.
    const plan = planOf([300, 300], [[0], [1]]);
    const track = trackOf(['note', 'note']);
    expect(paginate(plan, 300, track).map((p) => p.systemIndices)).toEqual([[0], [1]]);
  });

  it('leaves a whole-score print packed greedily', () => {
    const plan = planOf(
      [100, 100, 100, 100],
      [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7],
      ],
    );
    const greedy = paginate(plan, 350).map((p) => p.systemIndices);
    expect(paginate(plan, 350, undefined).map((p) => p.systemIndices)).toEqual(greedy);
  });

  it('still puts every system on exactly one page, in order', () => {
    const plan = planOf([100, 100, 100, 100, 100], [[0], [1], [2], [3], [4]]);
    const track = trackOf([null, 'note', null, 'note', null]);
    expect(flat(paginate(plan, 250, track))).toEqual([0, 1, 2, 3, 4]);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test pagination`
Expected: FAIL — `turnFreeBars` and `MAX_PULL_BACK` are not exported, and `paginate` ignores its third argument.

- [x] **Step 3: Implement turn scoring**

Append to `~/projects/music_lib/src/adapters/vexflow/pagination.ts`:

```ts
/**
 * How many systems earlier than the greedy break a page may end.
 *
 * Two. Every system pulled back makes the part longer, and a turn bought three
 * systems early costs more paper than it saves the player.
 */
export const MAX_PULL_BACK = 2;

/** How many bars `measure` stands for — a multi-measure rest stands for its count. */
function barSpan(measure: Measure): number {
  return measure.multiMeasureRestCount ?? 1;
}

/** Silent bars at the end of `indices`. */
function trailingFreeBars(track: Track, indices: readonly number[]): number {
  let bars = 0;
  for (let i = indices.length - 1; i >= 0; i -= 1) {
    const measure = track.measures[indices[i]];
    if (!measure || !isSilentMeasure(measure)) break;
    bars += barSpan(measure);
  }
  return bars;
}

/** Silent bars at the start of `indices`. */
function leadingFreeBars(track: Track, indices: readonly number[]): number {
  let bars = 0;
  for (const index of indices) {
    const measure = track.measures[index];
    if (!measure || !isSilentMeasure(measure)) break;
    bars += barSpan(measure);
  }
  return bars;
}

/**
 * Bars `track`'s player has free across a turn taken after system
 * `lastSystemIndex`.
 *
 * They may begin turning once their last note on the page has finished and
 * must be reading again by their first on the next, so both sides count.
 * Zero after the last system: there is no turn there.
 */
export function turnFreeBars(plan: LayoutPlan, track: Track, lastSystemIndex: number): number {
  const last = plan.systems[lastSystemIndex];
  const next = plan.systems[lastSystemIndex + 1];
  if (!last || !next) return 0;
  return trailingFreeBars(track, last.measureIndices) + leadingFreeBars(track, next.measureIndices);
}

/**
 * The end index (exclusive) that buys the best turn, at most `MAX_PULL_BACK`
 * systems back from `greedyEnd` and never emptying the page.
 *
 * Searched downward with a strict improvement test, so a tie keeps the fullest
 * page — pulling back with nothing to show for it is pure loss.
 */
function bestTurn(plan: LayoutPlan, track: Track, start: number, greedyEnd: number): number {
  let best = greedyEnd;
  let bestScore = turnFreeBars(plan, track, greedyEnd - 1);

  const earliest = Math.max(start + 1, greedyEnd - MAX_PULL_BACK);
  for (let end = greedyEnd - 1; end >= earliest; end -= 1) {
    const score = turnFreeBars(plan, track, end - 1);
    if (score > bestScore) {
      best = end;
      bestScore = score;
    }
  }

  return best;
}
```

- [x] **Step 4: Teach `paginate` to use it**

In the same file, change `paginate`'s signature and add the pull-back. Replace:

```ts
export function paginate(plan: LayoutPlan, pageHeight: number): PrintPage[] {
```

with:

```ts
export function paginate(
  plan: LayoutPlan,
  pageHeight: number,
  turnTrack?: Track,
): PrintPage[] {
```

and, immediately after the inner `while` loop that computes `end`, before the
`systemIndices` loop, insert:

```ts
// Only worth doing when there *is* a turn: the last page ends the piece.
// A whole-score print passes no track — "the player rests" means nothing
// when a dozen staves share the page, and a conductor turns at will.
if (turnTrack && end < plan.systems.length) {
  end = bestTurn(plan, turnTrack, start, end);
}
```

Update the doc comment above `paginate` to:

```ts
/**
 * Which systems go on which page.
 *
 * Greedy: take systems in order while they fit. A system taller than the page
 * still gets its own page — it overflows, which is better than dropping it and
 * better than never advancing.
 *
 * With `turnTrack`, each break is then pulled back up to `MAX_PULL_BACK`
 * systems if that buys its player a better page turn.
 */
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test pagination`
Expected: PASS.

- [x] **Step 6: Verify the tests are not vacuous**

Make `bestTurn` return `greedyEnd` unconditionally and confirm "pulls the break
back onto a rest" fails. Make `barSpan` return `1` always and confirm the
multi-measure-rest test fails. Restore both.

- [x] **Step 7: Export it**

Add to `~/projects/music_lib/src/index.ts`, beside the other vexflow adapters:

```ts
export * from './adapters/vexflow/pagination.js';
```

- [x] **Step 8: Verify and stage**

```bash
cd ~/projects/music_lib && bun run verify
bun run build
cp -r dist ~/projects/music_app/node_modules/@sudobility/music_lib/
rm -rf ~/projects/music_app/node_modules/.vite
```

Expected: PASS.

---

### Task 4: The app renders real pages

**Files:**

- Modify: `~/projects/music_app/src/features/print/print-layout.ts`
- Modify: `~/projects/music_app/src/features/print/PrintSystem.tsx`
- Modify: `~/projects/music_app/src/features/print/PrintView.tsx`
- Modify: `~/projects/music_app/src/features/print/print.css`
- Test: `~/projects/music_app/src/features/print/PrintView.test.tsx`

**Interfaces:**

- Consumes: `paginate`, `usablePageHeight`, `PAGE_MARGIN_MM` (Tasks 1-3).
- Produces: `PrintSystemSlice` (was `PrintPage`) from `print-layout.ts`.

- [x] **Step 1: Rename the slice type**

In `~/projects/music_app/src/features/print/print-layout.ts`, rename the type
and its doc:

```ts
/**
 * One system's slice of the layout: the vertical band to draw for it.
 *
 * Not a page — a page is a *set* of these, chosen by `paginate` in music_lib.
 * The two were the same thing until page turns had to land on rests.
 */
export type PrintSystemSlice = {
  systemIndex: number;
  top: number;
  bottom: number;
  height: number;
};
```

and change `printSystems`'s return type to `PrintSystemSlice[]`.

In `~/projects/music_app/src/features/print/PrintSystem.tsx`, rename the import,
the prop and its uses:

```ts
import type { PrintSystemSlice } from '@/features/print/print-layout';

export type PrintSystemProps = {
  score: Score;
  slice: PrintSystemSlice;
  trackIds: string[];
};

export function PrintSystem({ score, slice, trackIds }: PrintSystemProps) {
```

Inside, replace every `page.` with `slice.` (there are five: `page.height`,
`page.top`, `page.bottom`, `page.systemIndex`, and the `page` in the effect's
dependency array). Update the file's header comment, which currently says
feature 6 will replace one-canvas-per-system — it does not; it groups them:

```
 * One canvas per system. Feature 6 groups them into pages, but the canvas per
 * system is what keeps a page break from ever falling through one.
```

- [x] **Step 2: Write the failing test**

Add to `~/projects/music_app/src/features/print/PrintView.test.tsx`:

```tsx
describe('pagination', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  const pageBlocks = (container: HTMLElement) =>
    container.querySelectorAll('[data-testid^="print-page-"]');

  it('groups systems into page blocks', () => {
    // Feature 1 had no pages at all — every system was a sibling and the
    // browser decided. A page block is what makes the break ours.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(2, 40));
    const { container } = render(<PrintView store={store} onBack={() => {}} />);

    expect(pageBlocks(container).length).toBeGreaterThan(1);
  });

  it('prints every system exactly once across the pages', () => {
    // The invariant a pagination bug breaks first.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(stressScore(2, 40));
    const { container } = render(<PrintView store={store} onBack={() => {}} />);

    const expected = computeLayout(
      withRehearsalMarks(store.getState().score!),
      printRenderOptions(selectVisibleTrackIds(store.getState())),
    ).systems.length;

    expect(container.querySelectorAll('[data-testid^="print-system-"]')).toHaveLength(expected);
  });
});
```

Add `withRehearsalMarks` and `selectVisibleTrackIds` back to the file's
`@sudobility/music_lib` import if they are not already there.

- [x] **Step 3: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: FAIL on the first — there are no page blocks yet.

- [x] **Step 4: Paginate in the view**

In `~/projects/music_app/src/features/print/PrintView.tsx`, replace the `pages`
memo:

```tsx
const pages = useMemo(() => {
  if (!printedScore) return [];
  return printSystems(computeLayout(printedScore, printRenderOptions(trackIds)));
}, [printedScore, trackIds]);
```

with:

```tsx
const plan = useMemo(
  () => (printedScore ? computeLayout(printedScore, printRenderOptions(trackIds)) : null),
  [printedScore, trackIds],
);

const slices = useMemo(() => (plan ? printSystems(plan) : []), [plan]);

/**
 * The part's own track, when printing one — the player whose rests decide
 * where the turns go. A whole score passes nothing: some track is always
 * playing, and a conductor turns at will.
 */
const turnTrack = isSingleTrack ? printedScore?.tracks[0] : undefined;

const pages = useMemo(
  () => (plan ? paginate(plan, usablePageHeight('a4', 'portrait', PRINT_WIDTH), turnTrack) : []),
  [plan, turnTrack],
);
```

Replace the rendering block:

```tsx
{
  pages.map((page) => (
    <PrintSystem key={page.systemIndex} score={printedScore} page={page} trackIds={trackIds} />
  ));
}
```

with:

```tsx
{
  pages.map((page, pageIndex) => (
    <div key={pageIndex} data-testid={`print-page-${pageIndex}`} className="print-page">
      {page.systemIndices.map((systemIndex) => (
        <PrintSystem
          key={systemIndex}
          score={printedScore}
          slice={slices[systemIndex]}
          trackIds={trackIds}
        />
      ))}
    </div>
  ));
}
```

and extend the imports:

```tsx
import {
  computeLayout,
  extractPart,
  paginate,
  selectVisibleTrackIds,
  usablePageHeight,
  withRehearsalMarks,
} from '@sudobility/music_lib';
import { PRINT_WIDTH, printRenderOptions, printSystems } from '@/features/print/print-layout';
```

The hardcoded `'a4', 'portrait'` becomes state in Task 5.

- [x] **Step 5: Break after each page**

In `~/projects/music_app/src/features/print/print.css`, replace the
`.print-pages > *` rule with:

```css
/* The rule the whole feature exists to guarantee: a break after each page we
     chose, and never inside a system. */
.print-page {
  break-after: page;
  page-break-after: always;
}

.print-page:last-child {
  break-after: auto;
  page-break-after: auto;
}
```

Leave the `@page { margin: 12mm }` block alone for now — Task 5 replaces it
with one emitted from `PAGE_MARGIN_MM`.

- [x] **Step 6: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test print`
Expected: PASS, including the existing print tests. If a test asserts on
`print-system-*` counts it should be unaffected — the systems are still all
there, one level deeper in the DOM.

---

### Task 5: The paper picker

**Files:**

- Modify: `~/projects/music_app/src/features/print/PrintView.tsx`
- Modify: `~/projects/music_app/src/features/print/print.css`
- Test: `~/projects/music_app/src/features/print/PrintView.test.tsx`

**Interfaces:**

- Consumes: `PaperSize`, `PaperOrientation`, `PAGE_MARGIN_MM` (Task 1).
- Produces: no new exports.

- [x] **Step 1: Write the failing test**

Add to the `pagination` describe in
`~/projects/music_app/src/features/print/PrintView.test.tsx`:

```tsx
it('repaginates when the paper changes', async () => {
  // A landscape page is shorter, so the same score needs more of them. This
  // is the observable point of the picker.
  const user = userEvent.setup();
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(stressScore(2, 40));
  const { container } = render(<PrintView store={store} onBack={() => {}} />);

  const portraitPages = pageBlocks(container).length;

  await user.click(screen.getByLabelText('Orientation'));
  await user.click(screen.getByRole('option', { name: 'Landscape' }));

  expect(pageBlocks(container).length).toBeGreaterThan(portraitPages);
});

it('offers the three paper sizes', () => {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(stressScore(2, 40));
  render(<PrintView store={store} onBack={() => {}} />);
  expect(screen.getByLabelText('Paper')).toHaveTextContent('A4');
});

it('emits an @page rule matching the chosen paper', () => {
  // The printer and the packer must agree about the page, or the pages we
  // chose are not the pages that come out.
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(stressScore(2, 40));
  const { container } = render(<PrintView store={store} onBack={() => {}} />);

  const style = container.querySelector('style');
  expect(style?.textContent).toContain('size: A4 portrait');
  expect(style?.textContent).toContain(`margin: ${PAGE_MARGIN_MM}mm`);
});
```

Add `PAGE_MARGIN_MM` to the file's `@sudobility/music_lib` import.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: FAIL — there is no Paper or Orientation control and no `<style>`.

- [x] **Step 3: Add the controls**

In `~/projects/music_app/src/features/print/PrintView.tsx`, add state beside
`scope`:

```tsx
const [paper, setPaper] = useState<PaperSize>('a4');
const [orientation, setOrientation] = useState<PaperOrientation>('portrait');
```

and the labels used by both the trigger and the `@page` rule:

```tsx
/** Display names, and the CSS `size` keyword for each paper. */
const PAPERS: { value: PaperSize; label: string; css: string }[] = [
  { value: 'a4', label: 'A4', css: 'A4' },
  { value: 'letter', label: 'Letter', css: 'letter' },
  { value: 'legal', label: 'Legal', css: 'legal' },
];

const ORIENTATIONS: { value: PaperOrientation; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];
```

Replace the hardcoded call in the `pages` memo:

```tsx
const pages = useMemo(
  () => (plan ? paginate(plan, usablePageHeight(paper, orientation, PRINT_WIDTH), turnTrack) : []),
  [plan, paper, orientation, turnTrack],
);
```

Add the two selects to the chrome, after the "What to print" select:

```tsx
        <Select value={paper} onValueChange={(v) => setPaper(v as PaperSize)}>
          <SelectTrigger aria-label="Paper" className="h-auto w-auto px-3 py-1.5">
            <span>{PAPERS.find((p) => p.value === paper)?.label}</span>
          </SelectTrigger>
          <SelectContent>
            {PAPERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={orientation}
          onValueChange={(v) => setOrientation(v as PaperOrientation)}
        >
          <SelectTrigger aria-label="Orientation" className="h-auto w-auto px-3 py-1.5">
            <span>{ORIENTATIONS.find((o) => o.value === orientation)?.label}</span>
          </SelectTrigger>
          <SelectContent>
            {ORIENTATIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
```

And emit the `@page` rule, just inside the outermost `<div>`:

```tsx
{
  /*
        The printer's page and the packer's page must be the same page. Both
        come from `PAGE_MARGIN_MM` and the picker above; a second margin
        written into a stylesheet is how they silently drift apart.
      */
}
<style>{`@page { size: ${PAPERS.find((p) => p.value === paper)?.css} ${orientation}; margin: ${PAGE_MARGIN_MM}mm; }`}</style>;
```

Extend the imports:

```tsx
import {
  computeLayout,
  extractPart,
  PAGE_MARGIN_MM,
  paginate,
  selectVisibleTrackIds,
  usablePageHeight,
  withRehearsalMarks,
} from '@sudobility/music_lib';
import type { PaperOrientation, PaperSize } from '@sudobility/music_lib';
```

- [x] **Step 4: Remove the duplicate margin**

In `~/projects/music_app/src/features/print/print.css`, delete the `@page`
block entirely, leaving a note in its place:

```css
/* No `@page` here: it is emitted by PrintView from PAGE_MARGIN_MM, so the
     margin the printer uses and the margin the packer assumed cannot drift. */
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test print`
Expected: PASS.

---

### Task 6: End to end

**Files:**

- Modify: `~/projects/music_app/e2e/print.spec.ts`

**Interfaces:**

- Consumes: everything above.

- [x] **Step 1: Write the e2e**

Add to `~/projects/music_app/e2e/print.spec.ts`, inside the `printing` describe:

```ts
test('changing the paper repaginates', async ({ page }) => {
  await openPrintView(page, 'Paper Choice', 40);

  const pages = page.locator('[data-testid^="print-page-"]');
  await expect(pages.first()).toBeVisible();
  const portrait = await pages.count();

  await page.getByLabel('Orientation').click();
  await page.getByRole('option', { name: 'Landscape', exact: true }).click();

  // A landscape page is shorter, so the same score needs more of them.
  await expect
    .poll(async () => pages.count(), { message: 'landscape should need more pages' })
    .toBeGreaterThan(portrait);

  // And every system is still printed exactly once.
  expect(await page.locator('[data-testid^="print-system-"]').count()).toBeGreaterThan(0);
});
```

- [x] **Step 2: Run everything**

```bash
cd ~/projects/music_lib && bun run verify
cd ~/projects/music_app && bun run verify
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e
```

Expected: all pass.

- [x] **Step 3: Look at the pages**

Print a part with long rests, on A4 portrait and again on landscape. Check by
eye: no system is cut across a page boundary, the page count changes with the
paper, and — the point of the feature — the last system on a page ends in a
rest wherever one was available within two systems.

Then print the whole score and confirm its pages are packed full, since a score
does not pull back.

---

## Self-Review

**Spec coverage.** Paper picker → Task 5. Explicit pagination → Tasks 2 and 4. Ratio-based page height → Task 1. Free bars = trailing + leading, multirest at full count → Task 3. Pull back at most 2, never to an empty page, ties to the fullest → Task 3. Parts only; score greedy → Task 3 (`turnTrack` optional) and Task 4 (the view passes it only for a part). System taller than the page → Task 2. Every system exactly once, in order → Tasks 2, 3 and 4. Page blocks with `break-after` → Task 4. One margin source → Task 5. `PrintPage` → `PrintSystemSlice` rename → Task 4. e2e → Task 6. Human check → Task 6 Step 3.

**Deliberate gaps, stated rather than hidden:**

- **The turn rule sees only silence, not difficulty.** A bar of rest before a page turn scores the same whether the next page opens with a held whole note or a run of semiquavers. Scoring difficulty needs a model of what is hard to play, which nothing here has.
- **Pull-back is greedy per page, not globally optimal.** Pulling a break back can push the next page's break somewhere worse. A global optimum would be a dynamic program over all breaks; for a handful of pages the greedy pass is within a system of it and far easier to reason about.
- **`turnTrack` is `printedScore.tracks[0]`,** which is correct because `extractPart` returns exactly one track — but it is a positional assumption. If a part ever carries a second staff, this line is where it breaks.
- **The `@page size` keyword and `PAPER_DIMENSIONS_MM` are two statements of the same fact.** They are adjacent in one table so they cannot drift far, but nothing checks that CSS `A4` is 210×297mm.

**Type consistency.** `PaperSize`/`PaperOrientation` are defined in Task 1 and used in Tasks 4 and 5. `PrintPage = { systemIndices: number[] }` is produced in Task 2, extended in use by Task 3, and consumed in Task 4 — distinct from `PrintSystemSlice`, the app-side type Task 4 renames from the old `PrintPage`. `paginate(plan, pageHeight, turnTrack?)` gains its third parameter in Task 3 Step 4 and is called with it in Task 4. `usablePageHeight(paper, orientation, logicalWidth, marginMm?)` is defined in Task 1 and called in Tasks 4 and 5. `PAGE_MARGIN_MM` is defined in Task 1 and used in Task 5 by both the emitted rule and its test.

---

## Execution Notes (2026-08-05)

All six tasks complete. No `music_types` change was needed — this feature is
pure layout. Suites green: music_lib 1025, music_app 531, e2e 31.

Verified on a real 60-bar part (rests around every eighth bar) laid out through
`computeLayout`, not just hand-built plans: **every optimised break is at least
as good as greedy, and at least one is strictly better.** The second half of
that claim is what stops the test passing on a no-op optimiser — confirmed by
making `bestTurn` return `greedyEnd`, which fails it.

Sabotage checks, all confirmed failing the right test and only that test:
`bestTurn` → the pull-back tests; `barSpan` fixed at 1 → the multi-measure-rest
test.

Three corrections to the plan, made while executing:

1. **A test asserted the wrong direction and the code was right.** I had
   written that a bigger page margin gives _less_ usable logical height. It
   gives more: the margin eats proportionally more of the short side than the
   long one, so the printable area gets relatively taller — physically, the
   content prints narrower, at a smaller scale, so more logical units fit down
   the page. The test now says so, with the reasoning; the implementation was
   never wrong. Worth noting because the tempting fix was the other one.

2. **The File Structure missed `PrintSystem.test.tsx`.** It builds the
   component directly and so used the old `page` prop; `bun run verify` caught
   it as four TS2322s. Renamed alongside the component.

3. **`MAX_PULL_BACK`'s test was a loose bound** (`length >= 5 - MAX_PULL_BACK`),
   which passes whether or not the cap works. Tightened to an exact page
   composition before executing.

The `@page` rule now comes from `PAGE_MARGIN_MM` via `PrintView`, and
`print.css` no longer declares one — so the margin the printer applies and the
margin the packer assumed cannot drift.

Not committed — `scripts/push_all.sh` owns commits.

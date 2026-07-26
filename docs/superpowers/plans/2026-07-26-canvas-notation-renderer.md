# Canvas Notation Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the notation view's SVG rendering with a windowed, viewport-sized canvas so arbitrarily large scores render and scroll at O(visible) cost, with identical user-visible behavior.

**Architecture:** music_lib gains a `CanvasScoreRenderer` (VexFlow CanvasContext, draws only visible systems into a caller-managed 2D context), an overlay `paintHighlights` painter, binary-search layout lookups, and the playhead helpers (moved from the app). music_app's ScoreEditorView switches to a sticky canvas pair over a scroll spacer, with all interactions resolved geometrically from the bbox maps. Spec: `docs/superpowers/specs/2026-07-26-canvas-notation-renderer-design.md` (in music_app).

**Tech Stack:** TypeScript strict, VexFlow 4 (`CanvasContext`), React 19, Zustand, vitest + jsdom, Playwright, Bun.

## Global Constraints

- No per-frame or per-interaction work may be O(score): drawing is O(visible systems); lookups are O(log n) binary search. The only O(n) work is `computeLayout`, cached, recomputed only on score/zoom/width/layout-mode change.
- Publish-first npm flow: music_app consumes `@sudobility/music_lib` from the registry. Lib tasks land, `push_all.sh` publishes, then app tasks start (Task 7 is that gate).
- Preserve exactly: all aria roles/labels (`role="application"`, `data-testid="score-editor-scroll"`, `data-testid="score-editor-canvas"` as the interaction surface, `data-testid="playback-caret"`), all keyboard shortcuts, selection semantics (click/shift-toggle/measure/drag-box), click-to-seek, caret behavior, highlight kinds with non-color cues (solid=selected, dashed=playing, dotted=preview — spec §27), light/dark literal `RenderTheme` colors.
- Bboxes in all maps stay in zoom-scaled CSS pixels, document/content coordinates (scrollTop NOT subtracted) — the same convention the SVG maps use today.
- music_lib architectural rules hold: no React/DOM-store coupling in adapters; ticks are integers; renderer objects never live in Zustand.
- Run `bun run verify` in the touched repo before every push; nothing ships red.

## File Map

music_lib:

- Modify `src/adapters/vexflow/layout.ts` — add `systemAtY`, `measureAtXInSystem` (binary search).
- Create `src/adapters/vexflow/playhead.ts` — `caretPositionForTick`, `tickForPoint` (moved from app, re-based on the lookups).
- Modify `src/adapters/vexflow/renderer.ts` — export `buildMeasureContent` (shared with canvas renderer). No behavior change.
- Create `src/adapters/vexflow/canvas-renderer.ts` — `CanvasScoreRenderer`, `CanvasRenderResult`, `CanvasRenderOptions`.
- Create `src/adapters/vexflow/overlay.ts` — `paintHighlights`.
- Create `src/test/canvas-stub.ts` — `createMock2DContext()` (exported from package root for app tests too).
- Modify `src/index.ts` — export all of the above.

music_app:

- Modify `src/features/score-editor/ScoreEditorView.tsx` — canvas pipeline + geometric interactions.
- Delete `src/features/score-editor/playhead.ts` + its test (moved to lib; imports switch to `@sudobility/music_lib`).
- Modify `src/features/score-editor/hit-test.ts` — add `eventIdAtPoint`, `measureIdAtPoint`.
- Modify `src/test/setup.ts` — jsdom `HTMLCanvasElement.getContext('2d')` stub via `createMock2DContext`.
- Modify `src/features/score-editor/ScoreEditorView.test.tsx` — coordinate-based interaction tests.
- Modify `src/app/App.tsx` or `src/config/initialize.ts` — install `window.__scoresmith` e2e handle (gated).
- Modify `e2e/helpers.ts` (+ specs where selectors change) — bbox-coordinate note clicks.
- Modify `CLAUDE.md` in both repos.

---

### Task 1: Binary-search layout lookups (music_lib)

**Files:**

- Modify: `src/adapters/vexflow/layout.ts`
- Test: `src/adapters/vexflow/layout.test.ts` (append)

**Interfaces:**

- Produces: `systemAtY(plan: LayoutPlan, y: number): SystemLayout | null` (logical y; null in gaps/outside), `measureAtXInSystem(plan: LayoutPlan, system: SystemLayout, x: number): MeasureLayout | null` (clamps x into the system's measure span; null only if the system has no measures). Both O(log n).

- [ ] **Step 1: Write the failing tests** (append to `layout.test.ts`)

```ts
import { computeLayout, measureAtXInSystem, systemAtY } from './layout.js';
import { stressScore } from '../../test/fixtures.js';

const THEME = { foreground: '#000', selection: '#00f', playback: '#f00', preview: '#999' };

describe('systemAtY / measureAtXInSystem', () => {
  const score = stressScore(1, 80);
  const plan = computeLayout(score, { zoom: 1, layoutMode: 'page', width: 900, theme: THEME });

  it('finds the system containing a y inside it, for every system', () => {
    for (const system of plan.systems) {
      expect(systemAtY(plan, (system.yTop + system.yBottom) / 2)).toBe(system);
    }
  });

  it('returns null above the first system, below the last, and in inter-system gaps', () => {
    expect(systemAtY(plan, plan.systems[0].yTop - 1)).toBeNull();
    expect(systemAtY(plan, plan.systems.at(-1)!.yBottom + 1)).toBeNull();
    const gapY = (plan.systems[0].yBottom + plan.systems[1].yTop) / 2;
    expect(systemAtY(plan, gapY)).toBeNull();
  });

  it('finds the measure containing an x, clamping outside the span', () => {
    const system = plan.systems[1];
    const layouts = system.measureIndices.map((i) =>
      plan.trackLayouts[0].measures.find((m) => m.measureIndex === i)!,
    );
    const target = layouts[1];
    expect(measureAtXInSystem(plan, system, target.box.x + target.box.width / 2)).toBe(target);
    expect(measureAtXInSystem(plan, system, -9999)!.measureIndex).toBe(layouts[0].measureIndex);
    expect(measureAtXInSystem(plan, system, 99999)!.measureIndex).toBe(
      layouts.at(-1)!.measureIndex,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run src/adapters/vexflow/layout.test.ts`
Expected: FAIL — `systemAtY` is not exported.

- [ ] **Step 3: Implement** (append to `layout.ts`)

```ts
/** Binary search over the y-sorted `plan.systems` for the system containing logical `y`; `null` in inter-system gaps or outside the score. O(log n). */
export function systemAtY(plan: LayoutPlan, y: number): SystemLayout | null {
  const systems = plan.systems;
  let lo = 0;
  let hi = systems.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = systems[mid];
    if (y < s.yTop) hi = mid - 1;
    else if (y > s.yBottom) lo = mid + 1;
    else return s;
  }
  return null;
}

/**
 * Binary search over `system`'s x-sorted measures (first track's layouts)
 * for the measure containing logical `x`, clamping x into the system's
 * measure span (clicks left of the clef resolve to the first measure).
 * `null` only when the system resolves to no measure layouts. O(log n).
 * Relies on `computeLayout` emitting `system.measureIndices` in ascending
 * x order (it lays measures left-to-right), so indices map to sorted boxes.
 */
export function measureAtXInSystem(
  plan: LayoutPlan,
  system: SystemLayout,
  x: number,
): MeasureLayout | null {
  const measures = plan.trackLayouts[0]?.measures;
  if (!measures || system.measureIndices.length === 0) return null;
  const first = measures[system.measureIndices[0]];
  const last = measures[system.measureIndices[system.measureIndices.length - 1]];
  if (!first || !last) return null;
  const clamped = Math.min(Math.max(x, first.box.x), last.box.x + last.box.width - 1e-9);

  let lo = 0;
  let hi = system.measureIndices.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = measures[system.measureIndices[mid]];
    if (clamped < m.box.x) hi = mid - 1;
    else if (clamped >= m.box.x + m.box.width) lo = mid + 1;
    else return m;
  }
  return last;
}
```

Note: `measures[system.measureIndices[k]]` indexing assumes `trackLayouts[0].measures[i].measureIndex === i` (computeLayout builds one layout per measure in order — verify with a quick read; if it holds, replace the existing `find`-based `measureLayoutForIndex` patterns with direct indexing; if it doesn't, keep a Map lookup built once per plan).

- [ ] **Step 4: Run to verify pass** — same command, PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(layout): binary-search system/measure lookups"`

---

### Task 2: Move playhead helpers into music_lib

**Files:**

- Create: `src/adapters/vexflow/playhead.ts`
- Create: `src/adapters/vexflow/playhead.test.ts`
- Modify: `src/index.ts` (export)

**Interfaces:**

- Consumes: Task 1's `systemAtY`, `measureAtXInSystem`.
- Produces: `caretPositionForTick(plan: LayoutPlan, score: Score, tick: number): CaretPosition | null` and `tickForPoint(plan: LayoutPlan, score: Score, x: number, y: number): number | null` with `CaretPosition = { x: number; yTop: number; yBottom: number }` — exact same contracts as music_app's current `src/features/score-editor/playhead.ts` (copy that file as the starting point; its doc comments carry over).

- [ ] **Step 1: Port the app's `playhead.test.ts`** into the lib (imports become relative: `./playhead.js`, `./layout.js`, `../../test/fixtures.js`). Same five test cases (tick-0 caret at first measure left edge; linear interpolation; past-end clamp; round-trip with `tickForPoint`; clef-area clamp; inter-system null).
- [ ] **Step 2: Run to verify failure** — `bunx vitest run src/adapters/vexflow/playhead.test.ts` FAILS (module missing).
- [ ] **Step 3: Port `playhead.ts`** from music_app, replacing the linear scans:
  - `systemForMeasureIndex` → keep for `caretPositionForTick` but implement via `systemAtY`? No — that one maps measure→system; replace `plan.systems.find(...)` with a binary search over systems by first/last measureIndex (they're ascending):

```ts
function systemForMeasureIndex(plan: LayoutPlan, measureIndex: number): SystemLayout | null {
  const systems = plan.systems;
  let lo = 0;
  let hi = systems.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = systems[mid];
    if (measureIndex < s.measureIndices[0]) hi = mid - 1;
    else if (measureIndex > s.measureIndices[s.measureIndices.length - 1]) lo = mid + 1;
    else return s;
  }
  return null;
}
```

- The tick→measure scan in `caretPositionForTick` becomes a binary search over `timings` by `startTick` (ascending); `tickForPoint`'s system/measure resolution uses `systemAtY` + `measureAtXInSystem`.
- [ ] **Step 4: Export** `caretPositionForTick`, `tickForPoint`, `CaretPosition`, `systemAtY`, `measureAtXInSystem` from `src/index.ts`. Run the test — PASS. Run `bun run verify`.
- [ ] **Step 5: Commit** — `git commit -m "feat(playhead): caret/seek geometry helpers (moved from music_app, binary-searched)"`

---

### Task 3: Mock 2D context test double (music_lib)

**Files:**

- Create: `src/test/canvas-stub.ts`
- Modify: `src/index.ts` (export alongside `testStoreContext`)
- Test: `src/test/canvas-stub.test.ts`

**Interfaces:**

- Produces: `createMock2DContext(width = 800, height = 600): Mock2DContext` where `Mock2DContext` is a `CanvasRenderingContext2D`-compatible object with `ops: Array<{ method: string; args: unknown[] }>` recording every call, property setters accepted (`fillStyle`, `strokeStyle`, `font`, `lineWidth`, `lineCap`, `globalAlpha`, ...), and a `canvas: { width; height }` back-reference.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createMock2DContext } from './canvas-stub.js';

describe('createMock2DContext', () => {
  it('records draw calls with arguments', () => {
    const ctx = createMock2DContext();
    ctx.beginPath();
    ctx.moveTo(1, 2);
    ctx.fillRect(0, 0, 10, 10);
    expect(ctx.ops.map((o) => o.method)).toEqual(['beginPath', 'moveTo', 'fillRect']);
    expect(ctx.ops[2].args).toEqual([0, 0, 10, 10]);
  });

  it('accepts style property writes and measureText', () => {
    const ctx = createMock2DContext();
    ctx.fillStyle = '#fff';
    expect(ctx.measureText('abc').width).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** with a Proxy so any method VexFlow's `CanvasContext` calls is recorded without enumerating them all:

```ts
export type MockOp = { method: string; args: unknown[] };
export type Mock2DContext = CanvasRenderingContext2D & { ops: MockOp[] };

/**
 * A recording stand-in for CanvasRenderingContext2D: every method call is
 * appended to `ops`; every property write is accepted; `measureText`
 * returns a deterministic width (8px/char) so VexFlow text layout math
 * stays finite. Proxy-based so new methods VexFlow starts calling never
 * require test-double updates.
 */
export function createMock2DContext(width = 800, height = 600): Mock2DContext {
  const ops: MockOp[] = [];
  const state: Record<string | symbol, unknown> = {
    ops,
    canvas: { width, height },
    measureText: (text: string) => ({
      width: String(text).length * 8,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const fn = (...args: unknown[]) => {
        ops.push({ method: String(prop), args });
        return undefined;
      };
      target[prop] = fn;
      return fn;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as Mock2DContext;
}
```

- [ ] **Step 4: Run to verify pass; export from `src/index.ts`.**
- [ ] **Step 5: Commit** — `git commit -m "test: recording mock 2D context for canvas renderer tests"`

---

### Task 4: CanvasScoreRenderer (music_lib)

**Files:**

- Modify: `src/adapters/vexflow/renderer.ts` — change `function buildMeasureContent(` to `export function buildMeasureContent(` (no other change).
- Create: `src/adapters/vexflow/canvas-renderer.ts`
- Create: `src/adapters/vexflow/canvas-renderer.test.ts`
- Modify: `src/index.ts` (export `CanvasScoreRenderer`, `CanvasRenderOptions`, `CanvasRenderResult`)

**Interfaces:**

- Consumes: `buildMeasureContent`, `buildTies` (renderer.ts), `computeLayout`, `resolveZoom`, `visibleSystemMeasureIndices` (layout.ts), `NoteMeta` (convert.ts), VexFlow `CanvasContext`, `StaveConnector`, `Formatter`, `Voice`.
- Produces:

```ts
export type CanvasViewport = { top: number; bottom: number }; // logical (unscaled) units
export type CanvasRenderOptions = Omit<RenderOptions, 'visibleMeasureIndices'> & {
  viewport: CanvasViewport;
  /** Backing-store scale (window.devicePixelRatio); default 1. */
  devicePixelRatio?: number;
};
export type CanvasRenderResult = {
  idToBBox: Map<string, BBox>; // zoom-scaled CSS px, content coords
  measureIdToBBox: Map<string, BBox>; // same units
  drawnMeasureIndices: Set<number>;
  plan: LayoutPlan;
  theme: RenderTheme;
};
export class CanvasScoreRenderer {
  render(
    score: Score,
    ctx: CanvasRenderingContext2D,
    options: CanvasRenderOptions,
  ): CanvasRenderResult;
  dispose(): void; // clears cached plan
}
```

Behavioral contract:

1. Caches `computeLayout` output; reuses it when `(score, zoom, layoutMode, width, trackIds)` are reference/value-identical to the previous call (viewport changes alone never recompute layout — the O(visible) rule).
2. Clears the full canvas (`ctx.clearRect` under identity transform), sets `ctx.setTransform(z·dpr, 0, 0, z·dpr, 0, −viewport.top·z·dpr)` where `z = resolveZoom(zoom)`, so all drawing happens in logical units.
3. Computes visible measures via `visibleSystemMeasureIndices(plan, viewport, 0)` and builds/draws ONLY those, using the exact same per-measure pipeline as the SVG renderer (`buildMeasureContent` → `stave.setContext(vexCtx).format()` → Formatter per measure → draw staves, voices, beams, ties, brace connectors for multi-track systems), with the whole per-system content wrapped in `try { ... } catch { /* log + skip system, keep drawing the rest */ }`.
4. Sets `vexCtx.setFillStyle(theme.foreground)` / `setStrokeStyle(theme.foreground)` before drawing (canvas has no post-draw recolor pass; VexFlow CanvasContext honors the current styles).
5. Builds `idToBBox` from the VexFlow objects, NOT the DOM: while accumulating channels, keep the `(note, meta)` pairs; after formatting/drawing each measure, `note.getBoundingBox()` gives a logical-unit box → multiply by `z`; first decomposition segment wins per event id (same rule as `id-map.ts`). `measureIdToBBox` comes from each drawn stave: `{ x: stave.getX(), y: stave.getYForLine(0) simplified — use placement.box directly }` — use `placement.box` scaled by `z` (layout truth, no VexFlow call needed).
6. `getBoundingBox()` guarded in try/catch → skip the entry on throw (mirrors `elementBBox`'s ZERO_BBOX rule; a missing bbox only disables clicking that glyph).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { CanvasScoreRenderer } from './canvas-renderer.js';
import { computeLayout } from './layout.js';
import { createMock2DContext } from '../../test/canvas-stub.js';
import { stressScore, twinkleScore } from '../../test/fixtures.js';
import { allNotes } from '../../domain/score/queries.js';

const THEME = { foreground: '#000', selection: '#00f', playback: '#f00', preview: '#999' };
const OPTS = {
  zoom: 1,
  layoutMode: 'page' as const,
  width: 900,
  theme: THEME,
  viewport: { top: 0, bottom: 400 },
};

describe('CanvasScoreRenderer', () => {
  it('draws only the systems intersecting the viewport', () => {
    const score = stressScore(1, 80);
    const plan = computeLayout(score, OPTS);
    const renderer = new CanvasScoreRenderer();
    const result = renderer.render(score, createMock2DContext(), OPTS);
    const expectedVisible = plan.systems
      .filter((s) => s.yBottom >= 0 && s.yTop <= 400)
      .flatMap((s) => s.measureIndices);
    expect([...result.drawnMeasureIndices].sort((a, b) => a - b)).toEqual(expectedVisible);
    expect(result.drawnMeasureIndices.size).toBeLessThan(score.tracks[0].measures.length);
  });

  it('records a bbox for every note event in the drawn window, none outside it', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const result = renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 0, bottom: 10_000 },
    });
    for (const note of allNotes(score)) {
      const box = result.idToBBox.get(note.id);
      expect(box).toBeDefined();
      expect(box!.width).toBeGreaterThan(0);
    }
  });

  it('per-frame draw work is O(visible): equal op counts for 1k vs 8k measures at the same viewport', () => {
    const renderer = new CanvasScoreRenderer();
    const small = createMock2DContext();
    renderer.render(stressScore(1, 1000), small, OPTS);
    const big = createMock2DContext();
    renderer.render(stressScore(1, 8000), big, OPTS);
    expect(big.ops.length).toBe(small.ops.length);
  });

  it('reuses the cached layout when only the viewport changes', () => {
    const score = twinkleScore();
    const renderer = new CanvasScoreRenderer();
    const a = renderer.render(score, createMock2DContext(), OPTS);
    const b = renderer.render(score, createMock2DContext(), {
      ...OPTS,
      viewport: { top: 100, bottom: 500 },
    });
    expect(b.plan).toBe(a.plan);
  });

  it('applies the dpr+zoom+scroll transform before drawing', () => {
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(twinkleScore(), ctx, {
      ...OPTS,
      zoom: 2,
      devicePixelRatio: 2,
      viewport: { top: 50, bottom: 450 },
    });
    const t = ctx.ops.find((o) => o.method === 'setTransform');
    expect(t?.args).toEqual([4, 0, 0, 4, 0, -200]); // z·dpr = 4; offset = −top·z·dpr = −50·4
  });
});
```

(If `stressScore(1, n)`'s signature differs, adapt to the fixture's actual `(tracks, measures)` order — check `src/test/fixtures.ts`.)

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `canvas-renderer.ts`.** Core skeleton (per-measure pipeline copied from `renderer.ts`'s render loop, so read it side-by-side):

```ts
import { CanvasContext, Formatter, StaveConnector } from 'vexflow';
import type { Beam, Stave, StaveTie, Voice } from 'vexflow';
import type { Score } from '@sudobility/music_types';
import { buildMeasureContent, buildTies } from './renderer.js';
import type { Channel } from './renderer.js';
import { computeLayout, resolveZoom, visibleSystemMeasureIndices } from './layout.js';
import type { LayoutPlan } from './layout.js';
import type { BBox, RenderOptions, RenderTheme } from './types.js';
import type { NoteMeta } from './convert.js';

// ...types from the Interfaces block above...

export class CanvasScoreRenderer {
  private cache: { key: string; score: Score; plan: LayoutPlan } | null = null;

  private planFor(score: Score, options: CanvasRenderOptions): LayoutPlan {
    const key = JSON.stringify([
      options.zoom,
      options.layoutMode,
      options.width,
      options.trackIds ?? null,
    ]);
    if (this.cache && this.cache.score === score && this.cache.key === key) return this.cache.plan;
    const plan = computeLayout(score, options as RenderOptions);
    this.cache = { key, score, plan };
    return plan;
  }

  render(
    score: Score,
    ctx: CanvasRenderingContext2D,
    options: CanvasRenderOptions,
  ): CanvasRenderResult {
    const z = resolveZoom(options.zoom);
    const dpr = options.devicePixelRatio ?? 1;
    const plan = this.planFor(score, options);
    const visible = visibleSystemMeasureIndices(plan, options.viewport, 0);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(z * dpr, 0, 0, z * dpr, 0, -options.viewport.top * z * dpr);

    const vexCtx = new CanvasContext(ctx);
    vexCtx.setFillStyle(options.theme.foreground);
    vexCtx.setStrokeStyle(options.theme.foreground);

    const idToBBox = new Map<string, BBox>();
    const measureIdToBBox = new Map<string, BBox>();
    const drawnMeasureIndices = new Set<number>();
    const staveByTrackMeasure = new Map<string, Map<number, Stave>>();
    const drawnPairs: Array<{ note: StaveNoteLike; meta: NoteMeta }> = [];
    // ...per track: channels Map, per visible measure: buildMeasureContent,
    // stave.setContext(vexCtx).format(), voices joinVoices/format/draw,
    // beams/ties draw, record placement.box·z into measureIdToBBox and
    // measureIndex into drawnMeasureIndices — each SYSTEM's loop body inside
    // try/catch (log via console.error, continue). After draw, for each
    // channel entry: try { const bb = note.getBoundingBox(); } catch → skip;
    // first segment per event id wins (copy the eventIds loop from id-map).
    // Brace connectors: same block as renderer.ts lines 235-248, but only
    // for systems whose first measure is in `visible`.
    return { idToBBox, measureIdToBBox, drawnMeasureIndices, plan, theme: options.theme };
  }

  dispose(): void {
    this.cache = null;
  }
}
```

Type note: `StaveNoteLike` = `{ getBoundingBox(): { getX(): number; getY(): number; getW(): number; getH(): number } | undefined }` — VexFlow's `BoundingBox` exposes getters; adapt to what `getBoundingBox()` actually returns in vexflow 4 (check `node_modules/vexflow/entry` typings; it returns a `BoundingBox` with `.getX()` etc. — convert via `{ x: bb.getX() * z, y: bb.getY() * z, width: bb.getW() * z, height: bb.getH() * z }`).

- [ ] **Step 4: Run to verify pass; `bun run verify`.**
- [ ] **Step 5: Commit** — `git commit -m "feat: windowed CanvasScoreRenderer (VexFlow canvas backend, O(visible) drawing)"`

---

### Task 5: Highlight overlay painter (music_lib)

**Files:**

- Create: `src/adapters/vexflow/overlay.ts`
- Create: `src/adapters/vexflow/overlay.test.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: `CanvasRenderResult` (Task 4), `HighlightSets` (renderer.ts — reuse the exported type).
- Produces:

```ts
export type OverlayOptions = {
  viewportTop: number; // CSS px (zoom-scaled content coords, like the bboxes)
  devicePixelRatio?: number; // default 1
};
export function paintHighlights(
  ctx: CanvasRenderingContext2D,
  result: CanvasRenderResult,
  highlights: HighlightSets,
  options: OverlayOptions,
): void;
```

Contract: clears the whole overlay, then for each id present in the bbox maps strokes a 2px rect around the (padded by 1px) bbox in the kind's theme color with the kind's dash pattern — `selected` solid (`setLineDash([])`), `playing` dashed (`[6, 3]`), `preview` dotted (`[2, 3]`) — preserving spec §27's non-color cue exactly as the SVG outline styles did. Precedence when an id is in multiple sets: preview < selected < playing (paint in that order; later overdraws). Transform: `setTransform(dpr, 0, 0, dpr, 0, −viewportTop·dpr)` (bboxes are already zoom-scaled).

- [ ] **Step 1: Failing tests** — using `createMock2DContext` and a hand-built `CanvasRenderResult` (two ids with known bboxes): assert (a) `clearRect` is first, (b) one `strokeRect` per highlighted id at `bbox ± 1px padding`, (c) `setLineDash` `[6,3]` for playing / `[]` for selected / `[2,3]` for preview, (d) an id in both selected+playing gets painted last as playing, (e) ids absent from the maps are skipped without throwing.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** (~40 lines: clear, transform, three passes over `highlights.previewIds/selectedIds/playingIds` with `result.theme.preview/selection/playback`).
- [ ] **Step 4: Run to verify pass; `bun run verify`.**
- [ ] **Step 5: Commit** — `git commit -m "feat: canvas highlight overlay painter with non-color dash cues"`

---

### Task 6: Stress fixture + O(visible) benchmark (music_lib)

**Files:**

- Modify: `src/services/benchmark.ts` (or its module layout — read it first) — add a `benchmarkCanvasRender(measures: number)` entry.
- Test: `src/adapters/vexflow/canvas-renderer.test.ts` (append)

- [ ] **Step 1: Append the scaling regression test**

```ts
it('windowed render time does not scale with score size (10k-measure stress)', () => {
  const renderer = new CanvasScoreRenderer();
  const big = stressScore(2, 10_000);
  const ctx = createMock2DContext();
  renderer.render(big, ctx, OPTS); // warm the layout cache
  const t0 = performance.now();
  for (let i = 0; i < 20; i += 1) {
    renderer.render(big, ctx, { ...OPTS, viewport: { top: i * 100, bottom: i * 100 + 400 } });
  }
  const perFrame = (performance.now() - t0) / 20;
  // Generous CI budget; the point is catching an O(score) regression
  // (which lands in the hundreds of ms), not micro-benchmarking.
  expect(perFrame).toBeLessThan(100);
}, 60_000);
```

- [ ] **Step 2: Run** (fails only if Task 4 has an O(n) leak; if `stressScore(2, 10000)` layout takes > a few seconds, note it in the benchmark doc — layout is the allowed O(n) pass).
- [ ] **Step 3: Add the benchmark entry** following the existing harness's shape (read `src/services/benchmark.ts` and mirror its existing entries; record layout ms + mean frame ms).
- [ ] **Step 4: `bun run verify`; commit** — `git commit -m "perf: canvas renderer stress benchmark + O(visible) regression test"`

---

### Task 7: Publish music_lib (gate for all app tasks)

- [ ] **Step 1:** In music_lib: `bun run verify` (all green).
- [ ] **Step 2:** In music_app: `bash scripts/push_all.sh` (validates, bumps music_lib minor → 0.3.0, pushes; CI publishes).
- [ ] **Step 3:** Poll `npm view @sudobility/music_lib version` until 0.3.0; then in music_app `bun update @sudobility/music_lib` and set the range to `^0.3.0` in package.json.
- [ ] **Step 4:** Commit music_app's dep bump with the Task 8 work (no standalone commit needed).

---

### Task 8: App test scaffolding for canvas (music_app)

**Files:**

- Modify: `src/test/setup.ts`
- Modify: `src/features/score-editor/hit-test.ts`
- Test: `src/features/score-editor/hit-test.test.ts` (append)

**Interfaces:**

- Produces: jsdom `HTMLCanvasElement.prototype.getContext` returns a shared `createMock2DContext()` per canvas; and hit-test helpers used by Task 9/10:

```ts
export function eventIdAtPoint(idToBBox: ReadonlyMap<string, BBox>, point: Point): string | null; // topmost = last inserted wins
export function measureIdAtPoint(
  measureIdToBBox: ReadonlyMap<string, BBox>,
  point: Point,
): string | null;
```

- [ ] **Step 1: Failing tests** for both helpers: point inside one bbox → its id; overlapping bboxes → the later-inserted id; outside all → null.
- [ ] **Step 2: Run to verify failure; implement** (linear scan over the map — the maps only ever hold the drawn window, which is O(visible), so linear is within budget):

```ts
export function eventIdAtPoint(idToBBox: ReadonlyMap<string, BBox>, point: Point): string | null {
  let hit: string | null = null;
  for (const [id, box] of idToBBox) {
    if (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    ) {
      hit = id; // keep scanning: last inserted (drawn on top) wins
    }
  }
  return hit;
}
```

(`measureIdAtPoint` identical over the measure map.)

- [ ] **Step 3: setup.ts canvas stub** (append near the existing `getBBox` stub):

```ts
import { createMock2DContext } from '@sudobility/music_lib';

const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof createMock2DContext>>();
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value(this: HTMLCanvasElement) {
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = createMock2DContext(this.width || 800, this.height || 600);
      contexts.set(this, ctx);
    }
    return ctx;
  },
});
```

- [ ] **Step 4: Run hit-test tests + full suite (still green — nothing consumes the stubs yet); commit** — `git commit -m "test: canvas 2D stub + geometric hit-test helpers"`

---

### Task 9: ScoreEditorView canvas pipeline (music_app)

**Files:**

- Modify: `src/features/score-editor/ScoreEditorView.tsx`
- Modify: `src/features/score-editor/ScoreEditorView.test.tsx`
- Delete: `src/features/score-editor/playhead.ts`, `src/features/score-editor/playhead.test.ts` (import `caretPositionForTick`/`tickForPoint` from `@sudobility/music_lib` instead)

This is the core rewrite. Keep: toolbar, caret div, drag-box div, all aria, `useEditorShortcuts`, preview guard, auto-scroll effect (works off `layoutPlan` + `scrollTo`, unchanged). Remove: `VexFlowScoreRenderer`, `applyHighlights`, `visibleMeasureIndices` state + `measuredForPlanRef` + `measureVisibleIndices` (the culling state machine is superseded by draw-per-scroll-frame).

New pipeline inside the component:

```tsx
const scoreCanvasRef = useRef<HTMLCanvasElement>(null);
const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
const rendererRef = useRef(new CanvasScoreRenderer());
const resultRef = useRef<CanvasRenderResult | null>(null);

/** Sizes both canvas backing stores to the scroll box's client size × dpr; CSS size via style. Returns false when unmeasurable (jsdom default). */
const sizeCanvases = useCallback((): boolean => {
  const box = scrollBoxRef.current;
  const dpr = window.devicePixelRatio || 1;
  if (!box) return false;
  const w = box.clientWidth || DEFAULT_WIDTH;
  const h = box.clientHeight || CONTAINER_MIN_HEIGHT;
  for (const canvas of [scoreCanvasRef.current, overlayCanvasRef.current]) {
    if (!canvas) return false;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  return true;
}, []);

/** Draws the visible window of the score, then repaints the overlay. Called from the draw effect, the scroll rAF, and the ResizeObserver. */
const draw = useCallback(() => {
  const box = scrollBoxRef.current;
  const canvas = scoreCanvasRef.current;
  const ctx = canvas?.getContext('2d');
  if (!box || !canvas || !ctx || !displayScore) return;
  const dpr = window.devicePixelRatio || 1;
  const viewport = {
    top: box.scrollTop / zoom,
    bottom: (box.scrollTop + (box.clientHeight || CONTAINER_MIN_HEIGHT)) / zoom,
  };
  resultRef.current = rendererRef.current.render(displayScore, ctx, {
    zoom,
    layoutMode,
    width: box.clientWidth || DEFAULT_WIDTH,
    theme: renderTheme,
    viewport,
  });
  drawOverlay();
}, [displayScore, zoom, layoutMode, renderTheme /* drawOverlay below */]);

const drawOverlay = useCallback(() => {
  const box = scrollBoxRef.current;
  const ctx = overlayCanvasRef.current?.getContext('2d');
  const result = resultRef.current;
  if (!box || !ctx || !result) return;
  paintHighlights(
    ctx,
    result,
    {
      selectedIds: selection.eventIds,
      playingIds: activeNoteIds,
      previewIds,
    },
    { viewportTop: box.scrollTop, devicePixelRatio: window.devicePixelRatio || 1 },
  );
}, [selection, activeNoteIds, previewIds]);
```

Effects: a draw effect on `[draw]` (which folds in score/zoom/mode/theme) that first calls `sizeCanvases()`; the existing rAF scroll handler now calls `draw()` (drawing IS the culling — no state round-trip); the existing ResizeObserver calls `sizeCanvases() && draw()`; a separate overlay-only effect on `[drawOverlay]` (highlight changes never redraw notation — same property as today, now via layers). `layoutPlan` for the caret/auto-scroll comes from `resultRef.current?.plan ?? layoutPlan` memo — keep the existing `computeLayout` memo as-is (it is the caret's source and identical inputs mean identical geometry).

JSX (replaces the SVG container, spacer math from `layoutPlan`):

```tsx
<div
  ref={scrollBoxRef}
  data-testid="score-editor-scroll"
  onScroll={handleScroll}
  className="relative flex-1 overflow-auto"
  style={{ minHeight: CONTAINER_MIN_HEIGHT }}
>
  <div className="sticky top-0 z-0 h-0 overflow-visible" aria-hidden="true">
    <canvas ref={scoreCanvasRef} data-testid="score-canvas" />
    <canvas ref={overlayCanvasRef} data-testid="overlay-canvas" className="absolute left-0 top-0" />
  </div>
  <div
    ref={containerRef}
    data-testid="score-editor-canvas" /* interaction surface keeps its testid + aria */
    role="application"
    aria-label={`Score notation. ${selectionSummaryLabel(selection)}.`}
    tabIndex={0}
    onClick={handleClick}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
    className="relative w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
    style={{ height: Math.max((layoutPlan?.totalHeight ?? 0) * zoom, CONTAINER_MIN_HEIGHT) }}
  />
  {/* dragBox + caret divs unchanged, absolute-positioned in scrollBox */}
</div>
```

(The interaction div doubles as the spacer — it spans the full content height, sits above the sticky canvases in paint order, is transparent, and receives all pointer events with document-content coordinates exactly like the old SVG container. `pointFromEvent` needs one change: `container.scrollLeft/scrollTop` → `scrollBoxRef.current.scrollLeft/scrollTop`? No — `getBoundingClientRect` on the spacer already moves with scroll, so DELETE the `+ container.scrollLeft/scrollTop` terms only if they were compensating a non-scrolling container; verify with the drag-box test.)

Test updates in `ScoreEditorView.test.tsx`:

- `noteGroup(container, id)` helper is replaced by `clickAt(container, bbox)`: `fireEvent.click(interactionDiv, { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 })` where `box` comes from rendering `computeLayout`-driven expectations — but simplest and honest: read `resultRef` is private, so instead compute the bbox with a directly-instantiated `CanvasScoreRenderer` + `createMock2DContext` in the test against the same score/options, and click its coordinates (jsdom rects are all zeros, so clientX/clientY ARE content coordinates — same trick the caret tests already use).
- The virtualization describe-block ("renders every measure before…", "culls the very first draw…", scroll-flip, ResizeObserver re-measure) is rewritten against the new contract: spy on `CanvasScoreRenderer.prototype.render` and assert the `viewport` argument tracks mocked `clientHeight`/`scrollTop`, and that highlight-only changes do NOT call `render` again (overlay-only), replacing the DOM `.vf-stave`-count assertions.
- Caret tests: unchanged behavior; imports move to lib.

- [ ] Steps: (1) rewrite tests for the new contract and watch them fail, (2) implement the pipeline, (3) `bunx vitest run src/features/score-editor/`, (4) `bunx tsc -b`, (5) commit `feat: notation view renders via windowed canvas`.

---

### Task 10: Geometric interactions (music_app)

**Files:**

- Modify: `src/features/score-editor/ScoreEditorView.tsx` (handleClick / handlePointerUp)
- Test: `src/features/score-editor/ScoreEditorView.test.tsx` (selection/seek describe blocks)

`handleClick` becomes fully geometric (same precedence as today):

```ts
const point = {
  x: event.clientX - rect.left + scrollBox.scrollLeft,
  y: event.clientY - rect.top + scrollBox.scrollTop,
};
// jsdom note: rect is 0 and scroll is 0, so clientX/Y pass through as content coords.
const result = resultRef.current;
const noteId = result ? eventIdAtPoint(result.idToBBox, point) : null;
if (noteId) {
  /* select / shift-toggle — unchanged code */ return;
}
const measureId = result ? measureIdAtPoint(result.measureIdToBBox, point) : null;
if (measureId) selectMeasure(store, measureId);
seekToEventPoint(event); // unchanged; uses tickForPoint(plan, displayScore, x/zoom, y/zoom)
```

Drag-box (`handlePointerUp`) already consumes `idToBBox` — only the map's source object changes. Preview guard stays first.

Tests: port every selection/shift/measure/seek/caret test to coordinate clicks (bbox centers as in Task 9's helper); all store-level assertions stay identical. Verify: `bunx vitest run` full app suite green + `bunx tsc -b`. Commit `feat: geometric note/measure selection and seek on canvas`.

---

### Task 11: e2e handle + helper rewrite (music_app)

**Files:**

- Modify: `src/features/score-editor/ScoreEditorView.tsx` (publish handle)
- Modify: `e2e/helpers.ts`, plus any spec using `[id^="vf-"]` selectors (`grep -rn 'vf-' e2e/`)

Handle (effect in ScoreEditorView, gated so production builds carry nothing):

```ts
useEffect(() => {
  if (!import.meta.env.DEV && import.meta.env.VITE_E2E !== '1') return;
  (window as unknown as Record<string, unknown>).__scoresmith = {
    get result() {
      return resultRef.current;
    },
    get zoom() {
      return zoomRef.current;
    }, // mirror zoom in a ref for the getter
    get scrollBox() {
      return scrollBoxRef.current;
    },
  };
  return () => {
    delete (window as unknown as Record<string, unknown>).__scoresmith;
  };
}, []);
```

Helper replacement in `e2e/helpers.ts`:

```ts
/** Center of a note's bbox in page (viewport) coordinates, from the app's e2e handle. */
export async function noteClickPoint(
  page: Page,
  noteId: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const h = (
      window as never as {
        __scoresmith?: {
          result: {
            idToBBox: Map<string, { x: number; y: number; width: number; height: number }>;
          } | null;
          scrollBox: HTMLElement | null;
        };
      }
    ).__scoresmith;
    const box = h?.result?.idToBBox.get(id);
    const scroll = h?.scrollBox;
    if (!box || !scroll) throw new Error(`no bbox for note ${id}`);
    const rect = scroll.getBoundingClientRect();
    return {
      x: rect.left + box.x + box.width / 2 - scroll.scrollLeft,
      y: rect.top + box.y + box.height / 2 - scroll.scrollTop,
    };
  }, noteId);
}
export async function clickNote(page: Page, noteId: string): Promise<void> {
  const p = await noteClickPoint(page, noteId);
  await page.mouse.click(p.x, p.y);
}
```

- Replace `locator('[data-testid="score-editor-canvas"] [id^="vf-"]').count()` waits with `page.waitForFunction(() => (window as never as { __scoresmith?: { result: { idToBBox: Map<string, unknown> } | null } }).__scoresmith?.result?.idToBBox.size ?? 0 > 0)` style checks (read each call site for its intent: "notation rendered" vs "N notes rendered").
- Add one canvas smoke assertion to `smoke.spec.ts` or `acceptance.spec.ts`: after opening a project, `page.evaluate` reads the score canvas via `getContext('2d').getImageData(...)` over a 50×50 region and asserts any non-transparent pixel (canvas actually painted).
- If a spec clicked notes via `dispatchEvent` on SVG groups, it now uses `clickNote` (note ids come from the same store/evaluate paths helpers already use).
- Run: kill 5173/8023, `bun run test:e2e` — all 10 green. Commit `test(e2e): coordinate-based note interaction via __scoresmith handle`.

---

### Task 12: App cleanup, docs, ship (music_app)

- [ ] Remove all remaining `VexFlowScoreRenderer` / `applyHighlights` / `RenderResult` imports from the app (grep); delete dead helpers (`noteGroup`, SVG-specific test utilities).
- [ ] Update `music_app/CLAUDE.md`: notation view renders via windowed canvas (`CanvasScoreRenderer` + overlay), jsdom canvas stub in setup.ts, e2e `__scoresmith` handle, note-DOM no longer exists.
- [ ] `bun run verify` + full e2e green.
- [ ] `bash scripts/push_all.sh` (bumps + pushes music_app).

### Task 13: Delete the SVG renderer (music_lib, follow-up bump)

- [ ] Once the app no longer imports them (Task 12 shipped): delete `VexFlowScoreRenderer`, `applyHighlights`, `paintDescendants`, `id-map.ts`, and the SVG-only tests; keep `buildMeasureContent`/`buildTies` (move them into `canvas-renderer.ts` or a shared `measure-content.ts` if renderer.ts becomes empty), keep `types.ts`'s `RenderTheme`/`BBox`/`RenderOptions` (still used) and retire `RenderResult`/`ScoreRenderer`/`ScoreChangeSet` if nothing imports them (grep both repos first).
- [ ] Update `music_lib/CLAUDE.md` (adapters section + the `getBBox` setup-stub gotcha, which may become unnecessary — check what still calls it).
- [ ] `bun run verify`; `bash scripts/push_all.sh` (lib patch bump; app picks it up on its next cycle — no app change required since imports were already gone).

## Self-Review Notes

- Spec coverage: windowed canvas (T4/T9), overlay highlights (T5/T9), binary-search lookups + moved playhead (T1/T2), unbounded/stress + O(visible) regression (T6), interactions parity (T10), e2e handle + smoke (T11), per-system error guard (T4 contract #3), DPR/zoom (T4 transform test, T9 sizeCanvases), rollout/publish gates (T7/T12/T13). Deferred-by-spec: incremental reflow (documented, not built).
- Type consistency: `CanvasRenderResult`/`CanvasRenderOptions`/`CanvasViewport` defined in T4 and consumed by T5/T9/T11 with identical field names; `eventIdAtPoint`/`measureIdAtPoint` defined T8, consumed T10.
- Known verify-at-implementation points (flagged inline): `trackLayouts[0].measures[i].measureIndex === i` assumption (T1), `stressScore` signature (T4), VexFlow `BoundingBox` getter names (T4), `pointFromEvent` scroll-term change (T9), benchmark harness shape (T6).

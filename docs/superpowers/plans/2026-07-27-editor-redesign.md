# Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the score editor's highlight-rectangle overlay with per-note coloring, rebuild the click model around a caret anchor, add an active-track concept, and show notation and piano roll simultaneously.

**Architecture:** Note state (normal / selected / regenerated / playing) becomes a color applied directly to VexFlow `StaveNote` objects at draw time, replacing the separate overlay canvas which is deleted. The caret stays `playback-slice.positionTick` — no new state — so "play from caret" needs no plumbing. `activeTrackId` is new UI state in `ui-slice`, resolved through a selector that falls back to the first track. The notation/piano-roll mode switch is removed; the piano roll becomes a full-width collapsible panel above the transport showing only the active track.

**Tech Stack:** TypeScript (strict), VexFlow 4 (canvas), Zustand 5 + Immer, React 19, Tailwind, Vitest + Testing Library + jsdom, Playwright. Bun for scripts.

**Spec:** `docs/superpowers/specs/2026-07-27-editor-redesign-design.md`

## Global Constraints

- Two repos: `/Users/johnhuang/projects/music_lib` and `/Users/johnhuang/projects/music_app`. **`music_lib` tasks (1–7) land and publish before `music_app` tasks (8–17) begin** — `music_app` consumes the new `RenderTheme` and renderer options.
- `music_lib` source uses **relative imports with `.js` specifiers** (no path aliases). `music_app` uses the `@/` alias.
- Domain code (`music_lib/src/domain/**`) must not import React, VexFlow, Tone, or browser APIs. Adapters (`src/adapters/**`) must not import the store or React.
- VexFlow/Tone objects never live in Zustand state.
- Every score mutation goes through a `ScoreCommand` via `dispatchCommand`. Nothing in this plan mutates the score.
- Ticks are integers (480 PPQ default).
- Both repos must pass `bun run verify` (typecheck + lint + test + build) before push.
- Commit messages use conventional-commit prefixes and end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

### Color values (used verbatim in Tasks 1 and 8)

| Role | Light | Dark |
| --- | --- | --- |
| `foreground` | `#3f3f46` | `#d4d4d8` |
| `noteNormal` | `#3f3f46` | `#d4d4d8` |
| `noteSelected` | `#000000` | `#ffffff` |
| `noteRegenerated` | `#8b5a2b` | `#d9a066` |
| `notePlaying` | `#1565c0` | `#64b5f6` |
| `staveActive` | `#000000` | `#ffffff` |
| `staveInactive` | `#71717a` | `#8a8a93` |
| `caret` | `#d32f2f` | `#ef5350` |

### Amendment to the spec

The spec's §2 says the measure-number gutter leaves `totalHeight` unchanged. That is wrong: the first system's `yTop` is only `TOP_MARGIN` (10px) from the top, so an 18px gutter above it would render at a negative y. Task 3 raises the top margin by `MEASURE_HEADER_HEIGHT` instead, which grows `totalHeight` by `2 * MEASURE_HEADER_HEIGHT` (top margin is added twice: once before the first system, once after the last). Gutters for systems 2..n still fit inside the existing 40px `SYSTEM_GAP` with no reflow.

---

# Part A — music_lib

All Part A work happens in `/Users/johnhuang/projects/music_lib`.

---

### Task 1: Color roles and the redefined RenderTheme

**Files:**
- Modify: `src/adapters/vexflow/types.ts`
- Create: `src/adapters/vexflow/note-color.ts`
- Create: `src/adapters/vexflow/note-color.test.ts`
- Delete: `src/adapters/vexflow/overlay.ts`, `src/adapters/vexflow/overlay.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `NoteColorRole`, the redefined `RenderTheme`, `resolveNoteColorRole(eventIds, noteColors)`, `noteColorFor(role, theme)`.

- [ ] **Step 1: Write the failing test**

Create `src/adapters/vexflow/note-color.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { noteColorFor, resolveNoteColorRole } from './note-color.js';
import type { NoteColorRole } from './types.js';
import type { RenderTheme } from './types.js';

const theme: RenderTheme = {
  foreground: '#foreground',
  noteNormal: '#normal',
  noteSelected: '#selected',
  noteRegenerated: '#regenerated',
  notePlaying: '#playing',
  staveActive: '#staveActive',
  staveInactive: '#staveInactive',
  caret: '#caret',
};

describe('resolveNoteColorRole', () => {
  it('returns normal when there is no map', () => {
    expect(resolveNoteColorRole(['a'], undefined)).toBe('normal');
  });

  it('returns normal for an id absent from the map', () => {
    const map = new Map<string, NoteColorRole>([['other', 'selected']]);
    expect(resolveNoteColorRole(['a'], map)).toBe('normal');
  });

  it('returns the role of a single mapped id', () => {
    const map = new Map<string, NoteColorRole>([['a', 'selected']]);
    expect(resolveNoteColorRole(['a'], map)).toBe('selected');
  });

  it('takes the highest-precedence role across a chord', () => {
    const map = new Map<string, NoteColorRole>([
      ['a', 'selected'],
      ['b', 'playing'],
    ]);
    expect(resolveNoteColorRole(['a', 'b'], map)).toBe('playing');
  });

  it('ranks regenerated above selected', () => {
    const map = new Map<string, NoteColorRole>([
      ['a', 'selected'],
      ['b', 'regenerated'],
    ]);
    expect(resolveNoteColorRole(['a', 'b'], map)).toBe('regenerated');
  });

  it('ranks playing above regenerated', () => {
    const map = new Map<string, NoteColorRole>([
      ['a', 'regenerated'],
      ['b', 'playing'],
    ]);
    expect(resolveNoteColorRole(['a', 'b'], map)).toBe('playing');
  });

  it('returns normal for an empty id list', () => {
    const map = new Map<string, NoteColorRole>([['a', 'playing']]);
    expect(resolveNoteColorRole([], map)).toBe('normal');
  });
});

describe('noteColorFor', () => {
  it('maps every role to its theme color', () => {
    expect(noteColorFor('normal', theme)).toBe('#normal');
    expect(noteColorFor('selected', theme)).toBe('#selected');
    expect(noteColorFor('regenerated', theme)).toBe('#regenerated');
    expect(noteColorFor('playing', theme)).toBe('#playing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- note-color`
Expected: FAIL — `Cannot find module './note-color.js'`

- [ ] **Step 3: Redefine RenderTheme**

Replace the `RenderTheme` type in `src/adapters/vexflow/types.ts` (keep the rest of the file, including `RenderOptions` and `BBox`, unchanged for now — Task 2 extends `RenderOptions`):

```ts
/** How a note is colored, by state. See `resolveNoteColorRole` for precedence. */
export type NoteColorRole = 'normal' | 'selected' | 'regenerated' | 'playing';

/**
 * Colors used to draw the notation. Note state is carried by the notehead's
 * own color (there is no highlight overlay any more — see the canvas
 * renderer), so every note state has its own entry here.
 */
export type RenderTheme = {
  /** Non-note glyphs: clefs, key/time signatures, braces, measure numbers. */
  foreground: string;
  noteNormal: string;
  noteSelected: string;
  noteRegenerated: string;
  notePlaying: string;
  /** Stave lines + barlines of the active track. */
  staveActive: string;
  /** Stave lines + barlines of every other track. */
  staveInactive: string;
  /** Playback caret. Drawn as a DOM element by the app, but themed here so all render colors live in one object. */
  caret: string;
};
```

- [ ] **Step 4: Write the color helpers**

Create `src/adapters/vexflow/note-color.ts`:

```ts
/**
 * Note color-role resolution. Pure: no VexFlow, no store, no DOM — so the
 * precedence rule is unit-testable on its own and the canvas renderer only
 * has to call it.
 */
import type { NoteColorRole, RenderTheme } from './types.js';

/**
 * Highest precedence first. `playing` wins so playback stays followable even
 * over a selection; `regenerated` beats `selected` so a just-regenerated
 * passage stays visible while it is still selected.
 *
 * Pressing play clears the selection, so `playing` and `selected` do not
 * normally coexist — this ordering only resolves the case where the user
 * selects notes while playback is running.
 */
const PRECEDENCE: readonly NoteColorRole[] = ['playing', 'regenerated', 'selected', 'normal'];

/**
 * The role to draw a VexFlow note with, given every domain event id it
 * represents (>1 for a chord, or for one segment of a duration-decomposed
 * long note). Ids absent from `noteColors` count as `normal`.
 */
export function resolveNoteColorRole(
  eventIds: readonly string[],
  noteColors: ReadonlyMap<string, NoteColorRole> | undefined,
): NoteColorRole {
  if (!noteColors || noteColors.size === 0) return 'normal';
  let best = PRECEDENCE.length - 1;
  for (const eventId of eventIds) {
    const role = noteColors.get(eventId);
    if (!role) continue;
    const rank = PRECEDENCE.indexOf(role);
    if (rank !== -1 && rank < best) best = rank;
  }
  return PRECEDENCE[best];
}

/** The theme color a role draws in. */
export function noteColorFor(role: NoteColorRole, theme: RenderTheme): string {
  switch (role) {
    case 'playing':
      return theme.notePlaying;
    case 'regenerated':
      return theme.noteRegenerated;
    case 'selected':
      return theme.noteSelected;
    case 'normal':
      return theme.noteNormal;
  }
}
```

- [ ] **Step 5: Delete the overlay**

```bash
rm src/adapters/vexflow/overlay.ts src/adapters/vexflow/overlay.test.ts
```

- [ ] **Step 6: Update the package root exports**

In `src/index.ts`, remove the `paintHighlights` / `HighlightSets` / `OverlayOptions` exports from `./adapters/vexflow/overlay.js` and add:

```ts
export { noteColorFor, resolveNoteColorRole } from './adapters/vexflow/note-color.js';
export type { NoteColorRole } from './adapters/vexflow/types.js';
```

Find the exact existing export lines first:

```bash
grep -n "overlay\|paintHighlights\|vexflow/types" src/index.ts
```

- [ ] **Step 7: Run the new test**

Run: `bun run test -- note-color`
Expected: PASS (9 tests)

- [ ] **Step 8: Typecheck to find every RenderTheme consumer**

Run: `bunx tsc -b --noEmit`
Expected: errors in `canvas-renderer.ts` (`options.theme.foreground` still fine, but `theme` object literals in tests are now missing fields) and in any test fixture building a `RenderTheme`. Fix every fixture by adding the new fields with the placeholder values used in the test above. Do **not** change `canvas-renderer.ts` behavior yet — that is Task 2.

- [ ] **Step 9: Full test run**

Run: `bun run test`
Expected: PASS. Overlay tests are gone; everything else green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(vexflow)!: redefine RenderTheme around note color roles, delete overlay

Note state is now carried by the notehead's own color rather than a
highlight rectangle on a second canvas. Removes paintHighlights and the
selection/playback/preview theme fields it fed.

BREAKING CHANGE: RenderTheme fields changed; paintHighlights removed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Per-note and per-stave coloring in the canvas renderer

**Files:**
- Modify: `src/adapters/vexflow/types.ts` (extend `RenderOptions`)
- Modify: `src/adapters/vexflow/canvas-renderer.ts`
- Modify: `src/adapters/vexflow/canvas-renderer.test.ts`

**Interfaces:**
- Consumes: `NoteColorRole`, `RenderTheme`, `resolveNoteColorRole`, `noteColorFor` (Task 1).
- Produces: `CanvasRenderOptions.noteColors`, `.activeTrackId`, `.selectedMeasureIds` (the last is consumed by Task 3).

- [ ] **Step 1: Write the failing test**

Append to `src/adapters/vexflow/canvas-renderer.test.ts`. Read the top of that file first to reuse its existing score fixture and mock-context setup:

```bash
sed -n '1,60p' src/adapters/vexflow/canvas-renderer.test.ts
```

Then add (adapting `buildScore()` / `renderOptions()` to whatever the file already names them):

```ts
describe('note and stave coloring', () => {
  it('styles a selected note with the selected color', () => {
    const score = buildScore();
    const noteId = score.tracks[0].measures[0].voices[0].events[0].id;
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    const styled: Array<{ fillStyle?: string }> = [];
    const spy = vi
      .spyOn(StaveNote.prototype, 'setStyle')
      .mockImplementation(function (this: StaveNote, style: { fillStyle?: string }) {
        styled.push(style);
        return this;
      });

    renderer.render(score, ctx as unknown as CanvasRenderingContext2D, {
      ...renderOptions(),
      noteColors: new Map([[noteId, 'selected' as const]]),
    });

    spy.mockRestore();
    expect(styled.some((s) => s.fillStyle === renderOptions().theme.noteSelected)).toBe(true);
    expect(styled.some((s) => s.fillStyle === renderOptions().theme.noteNormal)).toBe(true);
  });

  it('styles the active trackstave differently from the others', () => {
    const score = buildTwoTrackScore();
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    const strokes: string[] = [];
    const spy = vi
      .spyOn(Stave.prototype, 'setStyle')
      .mockImplementation(function (this: Stave, style: { strokeStyle?: string }) {
        if (style.strokeStyle) strokes.push(style.strokeStyle);
        return this;
      });

    renderer.render(score, ctx as unknown as CanvasRenderingContext2D, {
      ...renderOptions(),
      activeTrackId: score.tracks[1].id,
    });

    spy.mockRestore();
    expect(strokes).toContain(renderOptions().theme.staveActive);
    expect(strokes).toContain(renderOptions().theme.staveInactive);
  });

  it('colors every note normal when no map is supplied', () => {
    const score = buildScore();
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();

    const styled: Array<{ fillStyle?: string }> = [];
    const spy = vi
      .spyOn(StaveNote.prototype, 'setStyle')
      .mockImplementation(function (this: StaveNote, style: { fillStyle?: string }) {
        styled.push(style);
        return this;
      });

    renderer.render(score, ctx as unknown as CanvasRenderingContext2D, renderOptions());

    spy.mockRestore();
    expect(styled.length).toBeGreaterThan(0);
    expect(styled.every((s) => s.fillStyle === renderOptions().theme.noteNormal)).toBe(true);
  });
});
```

Add `Stave`, `StaveNote` to the file's `vexflow` import and `vi` to its `vitest` import. Add a `buildTwoTrackScore()` helper next to the existing fixture if the file has none — copy the existing single-track builder and push a second track.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- canvas-renderer`
Expected: FAIL — `setStyle` is never called, so all three assertions fail.

- [ ] **Step 3: Extend RenderOptions**

In `src/adapters/vexflow/types.ts`, add to `RenderOptions`:

```ts
  /** eventId -> color role. Absent ids render as `normal`. */
  noteColors?: ReadonlyMap<string, NoteColorRole>;
  /** Track whose staves render in `theme.staveActive`; every other track uses `theme.staveInactive`. */
  activeTrackId?: string | null;
  /** Measure ids whose gutter cell is tinted as selected (see the measure-number gutter in `layout.ts`). */
  selectedMeasureIds?: ReadonlySet<string>;
```

- [ ] **Step 4: Apply the styles in the renderer**

In `src/adapters/vexflow/canvas-renderer.ts`, add the import:

```ts
import { noteColorFor, resolveNoteColorRole } from './note-color.js';
```

In `drawSystem`'s signature add `options: CanvasRenderOptions` as a parameter (pass `options` at the single call site in `render()`), then inside the `plan.trackLayouts.forEach` callback, after `buildMeasureContent(...)` returns and before `staves.push(stave)`:

```ts
        // Stave lines only: `strokeStyle` colors the five lines and the
        // barlines, while `fillStyle` is left alone so the clef / key
        // signature / time signature glyphs keep drawing in
        // `theme.foreground` and an inactive track's clef doesn't wash out.
        stave.setStyle({
          strokeStyle:
            options.activeTrackId != null && track.id === options.activeTrackId
              ? options.theme.staveActive
              : options.theme.staveInactive,
        });
```

Note `track` is available as `plan.trackLayouts[trackIndex].track` — the callback already destructures `{ track }`.

Then, immediately after the `notes.forEach((note, i) => channel.push(...))` bookkeeping inside `buildMeasureContent`'s caller — i.e. still in `drawSystem`, right after the `voices.forEach((v) => v.setStave(stave))` block — add note styling. The cleanest hook is a helper on the class:

```ts
  /**
   * Colors one VexFlow note (and its modifiers) by the highest-precedence
   * role among the domain events it represents. `setStyle` on a `StaveNote`
   * covers the notehead, stem and flag but NOT its modifiers (accidentals,
   * dots, articulations), which carry their own style — hence the second
   * loop.
   */
  private styleNote(
    note: StaveNote,
    meta: NoteMeta,
    options: CanvasRenderOptions,
  ): void {
    const role = resolveNoteColorRole(meta.eventIds, options.noteColors);
    const color = noteColorFor(role, options.theme);
    const style = { fillStyle: color, strokeStyle: color };
    note.setStyle(style);
    for (const modifier of note.getModifiers()) {
      modifier.setStyle(style);
    }
  }
```

Add `import type { StaveNote } from 'vexflow';` to the existing vexflow type import.

Call it from `drawSystem`, **not** from the tie/bbox loop in `render()` — that loop runs after `drawSystem` has already drawn the voices, so styling there would be too late to affect the draw.

Place the call in `drawSystem` immediately before the draw block (`staves.forEach((s) => s.draw())`), walking every channel accumulated so far:

```ts
    for (const channels of channelsByTrack.values()) {
      for (const channel of channels.values()) {
        for (const entry of channel) {
          this.styleNote(entry.note, entry.meta, options);
        }
      }
    }

    // Draw order: staves, then notes/voices, then beams on top.
    staves.forEach((s) => s.draw());
```

This restyles entries carried over from earlier systems in the same frame, which is idempotent and cheap — the accumulated channels only ever hold the drawn window, so this stays O(visible).

- [ ] **Step 5: Run the test**

Run: `bun run test -- canvas-renderer`
Expected: PASS

- [ ] **Step 6: Full test run**

Run: `bun run test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(vexflow): color notes and staves by state in the canvas renderer

Per-note setStyle from a noteColors map, and per-stave stroke color driven
by activeTrackId. Replaces the deleted highlight overlay.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Measure-number gutter

**Files:**
- Modify: `src/adapters/vexflow/layout.ts`
- Modify: `src/adapters/vexflow/layout.test.ts`
- Modify: `src/adapters/vexflow/canvas-renderer.ts`
- Modify: `src/adapters/vexflow/canvas-renderer.test.ts`

**Interfaces:**
- Consumes: `CanvasRenderOptions.selectedMeasureIds` (Task 2).
- Produces: `MEASURE_HEADER_HEIGHT` (exported const), `SystemLayout.gutterTop`.

- [ ] **Step 1: Write the failing layout test**

Append to `src/adapters/vexflow/layout.test.ts`:

```ts
describe('measure-number gutter', () => {
  it('reserves a gutter band above every system', () => {
    const plan = computeLayout(buildScore(8), baseOptions());
    for (const system of plan.systems) {
      expect(system.gutterTop).toBe(system.yTop - MEASURE_HEADER_HEIGHT);
      expect(system.gutterTop).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps later systems gutters inside the existing system gap', () => {
    const plan = computeLayout(buildScore(40), { ...baseOptions(), layoutMode: 'page' });
    expect(plan.systems.length).toBeGreaterThan(1);
    for (let i = 1; i < plan.systems.length; i += 1) {
      const previousBottom = plan.systems[i - 1].yBottom;
      expect(plan.systems[i].gutterTop).toBeGreaterThanOrEqual(previousBottom);
    }
  });
});
```

Import `MEASURE_HEADER_HEIGHT` from `./layout.js`. Reuse the file's existing `buildScore` / `baseOptions` helpers — check their real names first:

```bash
grep -n "function build\|function base\|const base" src/adapters/vexflow/layout.test.ts
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- layout`
Expected: FAIL — `MEASURE_HEADER_HEIGHT` is not exported and `gutterTop` is undefined.

- [ ] **Step 3: Add the gutter to the layout**

In `src/adapters/vexflow/layout.ts`:

```ts
/**
 * Height of the measure-number band above each system's top stave. For
 * systems after the first this is carved out of `SYSTEM_GAP` (40px) so
 * nothing reflows; the first system gets it by raising the top margin,
 * which is why `totalHeight` grows by 2x this value overall.
 */
export const MEASURE_HEADER_HEIGHT = 18;
```

Add `gutterTop` to `SystemLayout`:

```ts
export type SystemLayout = {
  measureIndices: number[];
  xLeft: number;
  xRight: number;
  /** Top of the measure-number band; always `yTop - MEASURE_HEADER_HEIGHT`. */
  gutterTop: number;
  yTop: number;
  yBottom: number;
};
```

Change the top margin so the first system's gutter has room. Find the line reading `const topMargin = TOP_MARGIN;` (or the direct use of `TOP_MARGIN` around line 127) and make it:

```ts
  const topMargin = TOP_MARGIN + MEASURE_HEADER_HEIGHT;
```

Then populate the new field where systems are pushed (around line 197):

```ts
    systems.push({
      measureIndices,
      xLeft: leftMargin,
      xRight: cursorX,
      gutterTop: yTop - MEASURE_HEADER_HEIGHT,
      yTop,
      yBottom,
    });
```

- [ ] **Step 4: Export the new constant**

In `src/index.ts`, add `MEASURE_HEADER_HEIGHT` to the existing `./adapters/vexflow/layout.js` export list — `music_app`'s gutter hit test (Part B Task 11) imports it from the package root.

- [ ] **Step 5: Run the layout test**

Run: `bun run test -- layout`
Expected: PASS. Other layout tests asserting exact `totalHeight` / `yTop` values will now fail — update those expected numbers to the new values (each shifts by `MEASURE_HEADER_HEIGHT`; `totalHeight` by `2 * MEASURE_HEADER_HEIGHT`).

- [ ] **Step 6: Write the failing renderer test**

Append to `src/adapters/vexflow/canvas-renderer.test.ts`:

```ts
describe('measure-number gutter drawing', () => {
  it('draws a number for each measure in the drawn window', () => {
    const score = buildScore();
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();
    const texts: string[] = [];
    ctx.fillText = (text: string) => void texts.push(text);

    renderer.render(score, ctx as unknown as CanvasRenderingContext2D, renderOptions());

    expect(texts).toContain('1');
  });

  it('tints the gutter cell of a selected measure', () => {
    const score = buildScore();
    const measureId = score.tracks[0].measures[0].id;
    const renderer = new CanvasScoreRenderer();
    const ctx = createMock2DContext();
    const fills: Array<{ style: unknown }> = [];
    ctx.fillRect = function (this: typeof ctx) {
      fills.push({ style: this.fillStyle });
    };

    renderer.render(score, ctx as unknown as CanvasRenderingContext2D, {
      ...renderOptions(),
      selectedMeasureIds: new Set([measureId]),
    });

    expect(fills.some((f) => f.style === renderOptions().theme.noteSelected)).toBe(true);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun run test -- canvas-renderer`
Expected: FAIL — no `fillText` and no gutter `fillRect`.

- [ ] **Step 8: Draw the gutter**

In `canvas-renderer.ts`, add a method and call it from `drawSystem` after the staves are drawn:

```ts
  /**
   * Measure numbers in the band above the system's top stave, plus a tint
   * behind any measure in `selectedMeasureIds` (measure selection's only
   * visual feedback, since notes carry their own color now).
   *
   * Drawn straight to the 2D context rather than through VexFlow: there is
   * no VexFlow object for "the space above a stave", and a number plus a
   * rect needs none.
   */
  private drawMeasureGutter(
    system: SystemLayout,
    plan: LayoutPlan,
    ctx: CanvasRenderingContext2D,
    windowIndices: number[],
    options: CanvasRenderOptions,
  ): void {
    const measures = plan.trackLayouts[0]?.measures;
    const track = plan.tracks[0];
    if (!measures || !track) return;

    const previousFill = ctx.fillStyle;
    const previousFont = ctx.font;

    for (const measureIndex of windowIndices) {
      const box = measures[measureIndex]?.box;
      const measure = track.measures[measureIndex];
      if (!box || !measure) continue;

      if (options.selectedMeasureIds?.has(measure.id)) {
        ctx.fillStyle = options.theme.noteSelected;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(box.x, system.gutterTop, box.width, MEASURE_HEADER_HEIGHT);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = options.theme.foreground;
      ctx.font = '11px sans-serif';
      ctx.fillText(String(measure.index + 1), box.x + 3, system.gutterTop + MEASURE_HEADER_HEIGHT - 5);
    }

    ctx.fillStyle = previousFill;
    ctx.font = previousFont;
  }
```

Import `MEASURE_HEADER_HEIGHT` from `./layout.js`.

Thread the raw `CanvasRenderingContext2D` from `render()` into `drawSystem` as its own parameter (`render()` already receives it as `ctx`) rather than reaching through VexFlow's `CanvasContext` wrapper for it — the gutter is a number and a rect, so it needs nothing VexFlow provides, and depending on a wrapper internal would be needless coupling.

Call it at the end of `drawSystem`, after the brace connector:

```ts
    this.drawMeasureGutter(system, plan, ctx, windowIndices, options);
```

- [ ] **Step 9: Run the tests**

Run: `bun run test -- canvas-renderer`
Expected: PASS

- [ ] **Step 10: Full verify**

Run: `bun run verify`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(vexflow): add measure-number gutter with selected-measure tint

Reserves MEASURE_HEADER_HEIGHT above each system for measure numbers and
measure-selection feedback. Later systems reuse the existing SYSTEM_GAP;
the first raises the top margin.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: activeTrackId in ui-slice, remove view mode

**Files:**
- Modify: `src/store/slices/ui-slice.ts`
- Modify: `src/store/slices/ui-slice.test.ts`
- Modify: `src/store/selectors.ts`
- Modify: `src/store/selectors.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `UiSlice.activeTrackId: UUID | null`, `UiSlice.setActiveTrack(trackId: UUID | null): void`, `selectActiveTrackId(state: AppState): string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/slices/ui-slice.test.ts`:

```ts
describe('activeTrackId', () => {
  it('defaults to null', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(store.getState().activeTrackId).toBeNull();
  });

  it('setActiveTrack stores the id', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setActiveTrack('track-1');
    expect(store.getState().activeTrackId).toBe('track-1');
  });

  it('setActiveTrack(null) clears it', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setActiveTrack('track-1');
    store.getState().setActiveTrack(null);
    expect(store.getState().activeTrackId).toBeNull();
  });
});
```

Append to `src/store/selectors.test.ts`:

```ts
describe('selectActiveTrackId', () => {
  it('returns null when there is no score', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(selectActiveTrackId(store.getState())).toBeNull();
  });

  it('falls back to the first track when nothing is set', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = buildScore();
    store.getState().setScore(score);
    expect(selectActiveTrackId(store.getState())).toBe(score.tracks[0].id);
  });

  it('returns the stored id when it resolves', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = buildTwoTrackScore();
    store.getState().setScore(score);
    store.getState().setActiveTrack(score.tracks[1].id);
    expect(selectActiveTrackId(store.getState())).toBe(score.tracks[1].id);
  });

  it('falls back to the first track when the stored id no longer resolves', () => {
    const store = createAppStore({ context: testStoreContext() });
    const score = buildScore();
    store.getState().setScore(score);
    store.getState().setActiveTrack('deleted-track');
    expect(selectActiveTrackId(store.getState())).toBe(score.tracks[0].id);
  });
});
```

Use the fixture builders from `src/test/fixtures.ts` — check the real names:

```bash
grep -n "export function" src/test/fixtures.ts
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- ui-slice selectors`
Expected: FAIL — `setActiveTrack` is not a function; `selectActiveTrackId` is not exported.

- [ ] **Step 3: Add activeTrackId to ui-slice, remove view**

In `src/store/slices/ui-slice.ts`:

- Delete `export type ViewMode = 'notation' | 'piano-roll';`
- Delete `view: ViewMode;` and `setView: (view: ViewMode) => void;` from `UiSlice`
- Delete `view: 'notation',` from the initial state and the whole `setView` implementation
- Add to `UiSlice`:

```ts
  /**
   * The track the caret, the piano roll, and the notation's active-stave
   * coloring follow. `null` means "not explicitly chosen" — read it through
   * `selectActiveTrackId`, which resolves that to the first track.
   *
   * Deliberately NOT persisted: a track id is meaningful only inside one
   * project, so a device-level preference would carry a dead id across
   * projects. It resets to "first track" on load, which is the default anyway.
   */
  activeTrackId: UUID | null;
  setActiveTrack: (trackId: UUID | null) => void;
```

- Add `activeTrackId: null,` to the initial state and:

```ts
  setActiveTrack: (trackId) => {
    set((state) => {
      state.activeTrackId = trackId;
    });
  },
```

- Add `UUID` to the `@sudobility/music_types` type import.
- Update the file's module doc comment: it currently opens "UI slice (spec §6, §33): view mode, theme, zoom/snap..." — replace "view mode" with "active track".

- [ ] **Step 4: Add the selector**

Append to `src/store/selectors.ts`:

```ts
/**
 * The effective active track id: the explicitly-set one when it still
 * resolves against the current score, else the first track, else `null`
 * (no score, or a score with no tracks).
 *
 * Resolving here rather than reconciling `ui-slice.activeTrackId` on every
 * score change means "only one track, so it's active" and "the active track
 * was just deleted" both fall out without a subscription or an effect.
 */
export const selectActiveTrackId = memoize2(
  (state) => state.score,
  (state) => state.activeTrackId,
  (score, activeTrackId): string | null => {
    if (!score || score.tracks.length === 0) return null;
    if (activeTrackId && score.tracks.some((t) => t.id === activeTrackId)) return activeTrackId;
    return score.tracks[0].id;
  },
);
```

- [ ] **Step 5: Export it**

In `src/index.ts`, add `selectActiveTrackId` to the existing `./store/selectors.js` export list, and remove `ViewMode` from the `./store/slices/ui-slice.js` type export list.

- [ ] **Step 6: Run the tests**

Run: `bun run test -- ui-slice selectors`
Expected: PASS

- [ ] **Step 7: Full test run**

Run: `bun run test`
Expected: any test referencing `view`/`setView` fails. Delete those test cases — the feature is gone, not moved.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(store)!: add activeTrackId, remove notation/piano-roll view mode

activeTrackId is resolved through selectActiveTrackId, which falls back to
the first track when unset or stale. ViewMode is gone: notation and piano
roll are shown simultaneously now.

BREAKING CHANGE: UiSlice.view/setView and the ViewMode type are removed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: selectionRegenerated flag

**Files:**
- Modify: `src/store/slices/selection-slice.ts`
- Modify: `src/store/slices/selection-slice.test.ts`
- Modify: `src/store/slices/generation-slice.ts:248-305`
- Modify: `src/store/slices/generation-slice.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SelectionSlice.selectionRegenerated: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/slices/selection-slice.test.ts`:

```ts
describe('selectionRegenerated', () => {
  it('defaults to false', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(store.getState().selectionRegenerated).toBe(false);
  });

  it('is cleared by setSelection', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.setState({ selectionRegenerated: true });
    store.getState().setSelection({ eventIds: [], measureIds: [], trackIds: [] });
    expect(store.getState().selectionRegenerated).toBe(false);
  });

  it('is cleared by clearSelection, which funnels through setSelection', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.setState({ selectionRegenerated: true });
    store.getState().clearSelection();
    expect(store.getState().selectionRegenerated).toBe(false);
  });
});
```

Append to `src/store/slices/generation-slice.test.ts` — model it on the existing `acceptCandidate` test in that file:

```ts
it('selects the accepted candidate new event ids and marks them regenerated', () => {
  // ...build a store with a score and a candidate, exactly as the existing
  // acceptCandidate test does...
  store.getState().acceptCandidate();

  const state = store.getState();
  expect(state.selectionRegenerated).toBe(true);
  expect(state.selection.eventIds.length).toBeGreaterThan(0);
  for (const id of state.selection.eventIds) {
    expect(findEvent(state.score!, id)).not.toBeNull();
  }
});

it('reverts to a normal selection as soon as the selection changes', () => {
  // ...same setup, then...
  store.getState().acceptCandidate();
  store.getState().setSelection({ eventIds: [], measureIds: [], trackIds: [] });
  expect(store.getState().selectionRegenerated).toBe(false);
});
```

Read the existing accept test first so the setup matches:

```bash
grep -n "acceptCandidate" src/store/slices/generation-slice.test.ts
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- selection-slice generation-slice`
Expected: FAIL — `selectionRegenerated` is undefined.

- [ ] **Step 3: Add the flag to selection-slice**

In `src/store/slices/selection-slice.ts`, add to `SelectionSlice`:

```ts
  /**
   * True when the current selection is the direct product of an accepted
   * regeneration — those notes draw in `theme.noteRegenerated` (brown)
   * instead of the normal selected color.
   *
   * Cleared by `setSelection`, and therefore by every selection action
   * (`toggleEvent`/`selectMeasures`/`selectTrack`/`clearSelection` all
   * funnel through it). Set only by `generation-slice.acceptCandidate`.
   */
  selectionRegenerated: boolean;
```

Add `selectionRegenerated: false,` to the initial state, and clear it in `setSelection`:

```ts
  setSelection: (selection) => {
    set((state) => {
      state.selection = selection;
      state.selectionRegenerated = false;
    });
    get().syncModeFromSelection(selection);
  },
```

- [ ] **Step 4: Select the new ids in acceptCandidate**

In `src/store/slices/generation-slice.ts`, add a helper above `createGenerationSlice`:

```ts
/** Every event id the candidate fragment introduces — the ids that exist in the score only after `applyCandidate` splices the fragment in. */
function fragmentEventIds(fragment: ScoreFragment): string[] {
  const ids: string[] = [];
  for (const trackFragment of fragment.tracks) {
    for (const measure of trackFragment.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) ids.push(event.id);
      }
    }
  }
  return ids;
}
```

Then in `acceptCandidate`, replace the `eventIds: []` line (currently `generation-slice.ts:282`) and its comment:

```ts
      // The candidate's own event ids ARE knowable (they were freshly
      // generated when the fragment was built) and now exist in the score,
      // so the accepted notes become the selection — that plus
      // `selectionRegenerated` is what draws them brown. Only the OLD ids
      // can't survive the splice, and those are simply not carried over.
      const remappedSelection: ScoreSelection = {
        ...selection,
        eventIds: fragmentEventIds(candidate.fragment),
        measureIds: selection.measureIds
```

and set the flag in the same `set()`:

```ts
      set((state) => {
        state.candidates = [];
        state.activeCandidateId = null;
        state.previewFragment = null;
        state.selection = normalizedSelection;
        state.selectionRegenerated = normalizedSelection.eventIds.length > 0;
      });
```

`ScoreFragment` is already imported in this file; confirm with `grep -n "ScoreFragment" src/store/slices/generation-slice.ts`.

- [ ] **Step 5: Announce the regenerated state in the selection summary**

Spec §1 trades away the overlay's solid/dashed/dotted redundancy and moves the
non-color channel to the status bar and the SR-only summary. That summary is
`selectionSummaryLabel`, and it has to actually say so.

Add to `src/domain/selection/selection.test.ts`:

```ts
describe('selectionSummaryLabel regenerated variant', () => {
  it('marks a regenerated note selection', () => {
    const sel = { eventIds: ['a', 'b'], measureIds: [], trackIds: [] };
    expect(selectionSummaryLabel(sel, true)).toBe('2 note(s) selected, regenerated');
  });

  it('is unchanged when not regenerated', () => {
    const sel = { eventIds: ['a', 'b'], measureIds: [], trackIds: [] };
    expect(selectionSummaryLabel(sel, false)).toBe('2 note(s) selected');
    expect(selectionSummaryLabel(sel)).toBe('2 note(s) selected');
  });

  it('does not mark an empty selection', () => {
    expect(selectionSummaryLabel({ eventIds: [], measureIds: [], trackIds: [] }, true)).toBe(
      'No selection',
    );
  });
});
```

Run it (`bun run test -- selection`) and confirm it fails, then change the
function in `src/domain/selection/selection.ts`:

```ts
export function selectionSummaryLabel(sel: ScoreSelection, regenerated = false): string {
  const suffix = regenerated ? ', regenerated' : '';
  if (sel.eventIds.length > 0) return `${sel.eventIds.length} note(s) selected${suffix}`;
  if (sel.measureIds.length > 0) return `${sel.measureIds.length} measure(s) selected${suffix}`;
  if (sel.trackIds.length > 0) return `${sel.trackIds.length} track(s) selected${suffix}`;
  return 'No selection';
}
```

Update its doc comment to explain the second parameter: with note state now
carried by color alone on the canvas, this label is the non-color channel that
keeps the regenerated state perceivable.

The three call sites (`AppLayout`'s status bar, `ScoreEditorView`'s and
`PianoRollView`'s SR-only summaries) pass `selectionRegenerated` in Part B —
the default keeps them compiling until then.

- [ ] **Step 6: Run the tests**

Run: `bun run test -- selection-slice generation-slice selection`
Expected: PASS

- [ ] **Step 7: Full test run**

Run: `bun run test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(store): mark an accepted regeneration's selection as regenerated

acceptCandidate now selects the fragment's own new event ids and sets
selectionRegenerated, which renders them brown until the selection changes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Play clears the selection

**Files:**
- Modify: `src/services/playback/controller.ts:206-231`
- Modify: `src/services/playback/controller.test.ts`

**Interfaces:**
- Consumes: `clearSelection` (existing selection-slice action).
- Produces: no new API — a behavior change to `PlaybackController.togglePlay`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/playback/controller.test.ts`, matching the file's existing fake-engine setup:

```ts
describe('togglePlay selection handling', () => {
  it('clears the selection when starting playback', () => {
    const { store, controller } = setup();
    store.getState().setSelection({ eventIds: ['a'], measureIds: [], trackIds: [] });
    controller.togglePlay();
    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('does not clear the selection when pausing', () => {
    const { store, controller, engine } = setup();
    controller.togglePlay();
    engine.emitStateChange('playing');
    store.getState().setSelection({ eventIds: ['a'], measureIds: [], trackIds: [] });
    controller.togglePlay();
    expect(store.getState().selection.eventIds).toEqual(['a']);
  });

  it('does not clear the selection on stop', () => {
    const { store, controller } = setup();
    store.getState().setSelection({ eventIds: ['a'], measureIds: [], trackIds: [] });
    controller.stop();
    expect(store.getState().selection.eventIds).toEqual(['a']);
  });
});
```

Read the file's existing helpers first — it has a fake engine and a store builder:

```bash
grep -n "function setup\|const setup\|class Fake\|makeEngine" src/services/playback/controller.test.ts
```

Adapt the test bodies to whatever those are actually called. The second test needs the store's `state` to read `'playing'`; if the fake engine has no `emitStateChange`, set it directly with `store.getState().setPlaybackState('playing')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- controller`
Expected: FAIL on the first test — the selection survives.

- [ ] **Step 3: Clear the selection on the play transition**

In `src/services/playback/controller.ts`, in `togglePlay()`, in the `else` branch (the one that starts playback):

```ts
    this.pendingResume = null; // an explicit user play/pause action takes over from any queued auto-resume
    if (state === 'playing') {
      this.engine.pause();
    } else {
      // Starting playback deselects (spec: "click play to playback, deselect
      // all, start playing from caret"). Only on the -> playing transition:
      // pause and stop deliberately leave the selection alone. "From the
      // caret" needs no code — the engine resumes from the transport
      // position, which is exactly what a caret seek set.
      this.store.getState().clearSelection();
      this.engine.play().catch((error: unknown) => this.reportError('Playback failed to start', error));
    }
```

Also clear it in the `previewing` early-return branch above, which queues a resume and is also a "start playing" gesture:

```ts
    if (this.previewing) {
      this.store.getState().clearSelection();
      this.pendingResume = { tick: this.store.getState().positionTick };
      this.stopPreview();
      return;
    }
```

- [ ] **Step 4: Run the tests**

Run: `bun run test -- controller`
Expected: PASS

- [ ] **Step 5: Full test run**

Run: `bun run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(playback): clear the selection when starting playback

Only on the stopped/paused -> playing transition. Pause and stop leave the
selection alone, and their caret behavior is unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Verify and publish music_lib

**Files:**
- Modify: `package.json` (version)

- [ ] **Step 1: Full verify**

Run: `bun run verify`
Expected: PASS — typecheck, lint, all tests, build.

- [ ] **Step 2: Bump the minor version**

These are breaking type changes, but the package is pre-1.0 (`0.x`), where a minor bump is the conventional signal for a break. Read the current version and bump the minor:

```bash
grep '"version"' package.json
```

Edit `package.json` to the next minor (e.g. `0.3.4` → `0.4.0`).

- [ ] **Step 3: Commit and push**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore: release 0.4.0 (note coloring, active track, view-mode removal)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

CI publishes to npm on push to main. Wait for the publish to land before starting Part B.

- [ ] **Step 4: Confirm the publish**

```bash
npm view @sudobility/music_lib version
```

Expected: the version you just set.

---

# Part B — music_app

All Part B work happens in `/Users/johnhuang/projects/music_app`. **Start by upgrading the dependency:**

```bash
cd /Users/johnhuang/projects/music_app
bun add @sudobility/music_lib@^0.4.0
```

---

### Task 8: New render theme and renderer wiring; delete the overlay canvas

**Files:**
- Modify: `src/features/score-editor/ScoreEditorView.tsx`
- Create: `src/features/score-editor/note-colors.ts`
- Create: `src/features/score-editor/note-colors.test.ts`
- Modify: `src/features/score-editor/ScoreEditorView.test.tsx`

**Interfaces:**
- Consumes: `NoteColorRole`, `RenderTheme`, `selectActiveTrackId` (Part A).
- Produces: `buildNoteColors(params): Map<string, NoteColorRole>`.

- [ ] **Step 1: Write the failing test**

Create `src/features/score-editor/note-colors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildNoteColors } from '@/features/score-editor/note-colors';

describe('buildNoteColors', () => {
  it('is empty when nothing is selected or playing', () => {
    expect(buildNoteColors({ selectedIds: [], playingIds: [], regenerated: false }).size).toBe(0);
  });

  it('marks selected ids as selected', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: [], regenerated: false });
    expect(map.get('a')).toBe('selected');
  });

  it('marks selected ids as regenerated when the flag is set', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: [], regenerated: true });
    expect(map.get('a')).toBe('regenerated');
  });

  it('marks playing ids as playing', () => {
    const map = buildNoteColors({ selectedIds: [], playingIds: ['a'], regenerated: false });
    expect(map.get('a')).toBe('playing');
  });

  it('lets playing win over selected for the same id', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: ['a'], regenerated: false });
    expect(map.get('a')).toBe('playing');
  });

  it('lets playing win over regenerated for the same id', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: ['a'], regenerated: true });
    expect(map.get('a')).toBe('playing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- note-colors`
Expected: FAIL — module not found.

- [ ] **Step 3: Write buildNoteColors**

Create `src/features/score-editor/note-colors.ts`:

```ts
/**
 * Builds the `eventId -> NoteColorRole` map the canvas renderer colors notes
 * from. Pure and store-free so the precedence is unit-testable without
 * rendering.
 *
 * A map holds one role per id, so precedence is applied by write order:
 * selected/regenerated first, then playing overwrites. (The renderer's own
 * `resolveNoteColorRole` handles the different problem of one VexFlow note
 * standing for several event ids — a chord, or a decomposed long note.)
 */
import type { NoteColorRole } from '@sudobility/music_lib';

export type BuildNoteColorsParams = {
  selectedIds: readonly string[];
  playingIds: readonly string[];
  /** When true, selected notes color as `regenerated` rather than `selected`. */
  regenerated: boolean;
};

export function buildNoteColors({
  selectedIds,
  playingIds,
  regenerated,
}: BuildNoteColorsParams): Map<string, NoteColorRole> {
  const colors = new Map<string, NoteColorRole>();
  const selectedRole: NoteColorRole = regenerated ? 'regenerated' : 'selected';
  for (const id of selectedIds) colors.set(id, selectedRole);
  for (const id of playingIds) colors.set(id, 'playing');
  return colors;
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- note-colors`
Expected: PASS

- [ ] **Step 5: Replace the theme constants**

In `src/features/score-editor/ScoreEditorView.tsx`, replace `LIGHT_RENDER_THEME` and `DARK_RENDER_THEME` with:

```ts
/**
 * VexFlow render colors, one set per resolved light/dark scheme. Literal
 * color strings, not CSS custom properties: VexFlow draws straight to canvas
 * fill/stroke, which never resolves `var(--...)`.
 *
 * Note state is carried by these colors now — there is no highlight overlay.
 * Each value clears 4.5:1 against its mode's stave background.
 */
const LIGHT_RENDER_THEME: RenderTheme = {
  foreground: '#3f3f46',
  noteNormal: '#3f3f46',
  noteSelected: '#000000',
  noteRegenerated: '#8b5a2b',
  notePlaying: '#1565c0',
  staveActive: '#000000',
  staveInactive: '#71717a',
  caret: '#d32f2f',
};
const DARK_RENDER_THEME: RenderTheme = {
  foreground: '#d4d4d8',
  noteNormal: '#d4d4d8',
  noteSelected: '#ffffff',
  noteRegenerated: '#d9a066',
  notePlaying: '#64b5f6',
  staveActive: '#ffffff',
  staveInactive: '#8a8a93',
  caret: '#ef5350',
};
```

- [ ] **Step 6: Delete the overlay canvas**

Still in `ScoreEditorView.tsx`:

- Remove the `paintHighlights` import.
- Remove `overlayCanvasRef` and the entire `drawOverlay` callback.
- Remove the `drawOverlay()` call at the end of `draw`, and remove `drawOverlay` from `draw`'s dependency array.
- Remove the overlay-only repaint effect (`useEffect(() => { drawOverlay(); }, [drawOverlay, selection, activeNoteIds, previewIds])`).
- Remove the `<canvas ref={overlayCanvasRef} data-testid="overlay-canvas" ... />` element.
- In `sizeCanvases`, change the loop `for (const canvas of [scoreCanvasRef.current, overlayCanvasRef.current])` to operate on `scoreCanvasRef.current` alone.
- **Keep** the `previewEventIds` helper and the `previewIds` memo. They fed the deleted overlay, but Step 7 reuses them to color preview notes.

- [ ] **Step 7: Feed the renderer**

Add the store reads near the other ones:

```ts
  const selectionRegenerated = store((s) => s.selectionRegenerated);
  const activeTrackId = store(selectActiveTrackId);
```

Import `selectActiveTrackId` and `buildNoteColors`. Build the map:

```ts
  /**
   * Preview-fragment ids color as `regenerated` too: a candidate on screen
   * is the same "this is generated material" signal as a just-accepted one.
   */
  const noteColors = useMemo(
    () =>
      buildNoteColors({
        selectedIds: [...selection.eventIds, ...previewIds],
        playingIds: activeNoteIds,
        regenerated: selectionRegenerated || previewIds.length > 0,
      }),
    [selection.eventIds, previewIds, activeNoteIds, selectionRegenerated],
  );

  const selectedMeasureIds = useMemo(
    () => new Set(selection.measureIds),
    [selection.measureIds],
  );
```

Pass them in `draw`'s `render(...)` call and add them to `draw`'s dependency array:

```ts
    resultRef.current = rendererRef.current!.render(displayScore, ctx, {
      zoom,
      layoutMode,
      width: viewWidth,
      theme: renderTheme,
      viewport,
      devicePixelRatio: window.devicePixelRatio || 1,
      noteColors,
      activeTrackId,
      selectedMeasureIds,
    });
```

- [ ] **Step 8: Recolor the caret**

Change the caret div's class from `bg-primary` to an inline style so it uses the theme's caret color:

```tsx
        {caret && (
          <div
            data-testid="playback-caret"
            aria-hidden="true"
            style={{
              left: caret.x * zoom,
              top: caret.yTop * zoom,
              height: (caret.yBottom - caret.yTop) * zoom,
              backgroundColor: renderTheme.caret,
            }}
            className="pointer-events-none absolute w-0.5 -translate-x-1/2"
          />
        )}
```

- [ ] **Step 9: Fix the tests**

Run: `bun run test -- ScoreEditorView`

Delete every assertion referencing `overlay-canvas` or `paintHighlights`. Replace them with a check that the renderer receives the right colors — spy on `CanvasScoreRenderer.prototype.render` and assert on the `noteColors` argument:

```ts
it('passes the selected note to the renderer as selected', () => {
  const store = createAppStore({ context: testStoreContext() });
  const score = buildScore();
  store.getState().setScore(score);
  const noteId = score.tracks[0].measures[0].voices[0].events[0].id;
  store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

  const spy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
  render(<ScoreEditorView store={store} />);

  const options = spy.mock.calls.at(-1)![2];
  expect(options.noteColors?.get(noteId)).toBe('selected');
  spy.mockRestore();
});
```

- [ ] **Step 10: Run the tests**

Run: `bun run test -- ScoreEditorView note-colors`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(score-editor): color notes by state, remove the highlight overlay

Drops the second canvas and paintHighlights entirely; note state is now the
notehead's own color, fed to the renderer as a noteColors map. Caret turns
red via the new theme role.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Caret-to-click range selection

**Files:**
- Create: `src/features/score-editor/range-select.ts`
- Create: `src/features/score-editor/range-select.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `noteIdsInTickRange(score, fromTick, toTick, trackIds): UUID[]`.

- [ ] **Step 1: Write the failing test**

Create `src/features/score-editor/range-select.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { noteIdsInTickRange } from '@/features/score-editor/range-select';
import { buildScore } from '@sudobility/music_lib';

/**
 * `buildScore` from music_lib's fixtures produces a deterministic score.
 * Every assertion below derives its expectations from the score itself
 * rather than hardcoding ids, so a fixture change can't silently pass.
 */
function notesOf(score: ReturnType<typeof buildScore>, trackIndex = 0) {
  const out: Array<{ id: string; startTick: number }> = [];
  for (const measure of score.tracks[trackIndex].measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if ('pitch' in event) out.push({ id: event.id, startTick: event.startTick });
      }
    }
  }
  return out.sort((a, b) => a.startTick - b.startTick);
}

describe('noteIdsInTickRange', () => {
  it('selects notes whose startTick is inside the range', () => {
    const score = buildScore();
    const notes = notesOf(score);
    const trackId = score.tracks[0].id;
    const ids = noteIdsInTickRange(score, notes[0].startTick, notes[2].startTick, [trackId]);
    expect(ids).toContain(notes[0].id);
    expect(ids).toContain(notes[1].id);
  });

  it('is half-open: a note starting exactly at the end tick is excluded', () => {
    const score = buildScore();
    const notes = notesOf(score);
    const trackId = score.tracks[0].id;
    const ids = noteIdsInTickRange(score, notes[0].startTick, notes[2].startTick, [trackId]);
    expect(ids).not.toContain(notes[2].id);
  });

  it('accepts a reversed range', () => {
    const score = buildScore();
    const notes = notesOf(score);
    const trackId = score.tracks[0].id;
    const forward = noteIdsInTickRange(score, notes[0].startTick, notes[2].startTick, [trackId]);
    const backward = noteIdsInTickRange(score, notes[2].startTick, notes[0].startTick, [trackId]);
    expect(backward).toEqual(forward);
  });

  it('returns nothing for an empty span', () => {
    const score = buildScore();
    const notes = notesOf(score);
    expect(noteIdsInTickRange(score, notes[0].startTick, notes[0].startTick, [score.tracks[0].id]))
      .toEqual([]);
  });

  it('only returns notes on the named tracks', () => {
    const score = buildScore();
    const trackId = score.tracks[0].id;
    const ids = noteIdsInTickRange(score, 0, Number.MAX_SAFE_INTEGER, [trackId]);
    for (const id of ids) {
      expect(notesOf(score).some((n) => n.id === id)).toBe(true);
    }
  });

  it('returns nothing when no tracks are named', () => {
    const score = buildScore();
    expect(noteIdsInTickRange(score, 0, Number.MAX_SAFE_INTEGER, [])).toEqual([]);
  });

  it('skips rests', () => {
    const score = buildScore();
    const ids = noteIdsInTickRange(score, 0, Number.MAX_SAFE_INTEGER, [score.tracks[0].id]);
    for (const id of ids) {
      const found = notesOf(score).find((n) => n.id === id);
      expect(found).toBeDefined();
    }
  });
});
```

Confirm the fixture export name first:

```bash
grep -n "export function" node_modules/@sudobility/music_lib/dist/test/fixtures.d.ts
```

If `buildScore` is named differently, use the real name throughout.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- range-select`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/score-editor/range-select.ts`:

```ts
/**
 * Caret-to-click range selection (the cmd-click gesture). Pure over
 * `Score` — no store, no DOM — so the tick math is unit-testable without
 * rendering.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type { Score, UUID } from '@sudobility/music_types';

/**
 * Every note whose `startTick` falls in `[min(fromTick,toTick), max(...))`
 * on one of `trackIds`, in ascending tick order.
 *
 * Half-open on purpose: cmd-clicking exactly on a note selects everything
 * up to it but not the note itself, so two adjacent ranges sharing a
 * boundary don't both claim the note sitting on it. Rests are skipped —
 * they aren't selectable material for any downstream action.
 */
export function noteIdsInTickRange(
  score: Score,
  fromTick: number,
  toTick: number,
  trackIds: readonly UUID[],
): UUID[] {
  const start = Math.min(fromTick, toTick);
  const end = Math.max(fromTick, toTick);
  if (start === end || trackIds.length === 0) return [];

  const wanted = new Set(trackIds);
  const hits: Array<{ id: UUID; startTick: number }> = [];

  for (const track of score.tracks) {
    if (!wanted.has(track.id)) continue;
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!isNoteEvent(event)) continue;
          if (event.startTick >= start && event.startTick < end) {
            hits.push({ id: event.id, startTick: event.startTick });
          }
        }
      }
    }
  }

  return hits.sort((a, b) => a.startTick - b.startTick).map((h) => h.id);
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- range-select`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(score-editor): add noteIdsInTickRange for caret-to-click selection

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The new click model

**Files:**
- Modify: `src/features/score-editor/ScoreEditorView.tsx` (`handleClick`)
- Modify: `src/features/score-editor/ScoreEditorView.test.tsx`

**Interfaces:**
- Consumes: `noteIdsInTickRange` (Task 9), `selectActiveTrackId`, `setActiveTrack`.
- Produces: no exported API — behavior only.

**Gesture table this task implements:**

| Gesture | Caret | Selection | Active track |
| --- | --- | --- | --- |
| Click empty stave/barline | → clicked tick | cleared | → clicked track |
| Click a note | → note's `startTick` | that note only | → note's track |
| Cmd-click | unchanged | notes caret→click, active track | unchanged |
| Cmd-shift-click | unchanged | same span, all tracks | unchanged |

- [ ] **Step 1: Write the failing tests**

Append to `src/features/score-editor/ScoreEditorView.test.tsx`. The suite already has a helper that clicks a note by resolving its bbox from the render result — find it:

```bash
grep -n "function clickNote\|idToBBox\|fireEvent.click" src/features/score-editor/ScoreEditorView.test.tsx
```

```ts
describe('caret-anchored click model', () => {
  it('clicking a note selects only it and moves the caret to its start', () => {
    const { store, score, seek } = setupEditor();
    const note = firstNoteOf(score);
    clickNote(note.id);

    expect(store.getState().selection.eventIds).toEqual([note.id]);
    expect(seek).toHaveBeenCalledWith(note.startTick);
  });

  it('clicking a note makes its track active', () => {
    const { store, score } = setupEditor({ tracks: 2 });
    const note = firstNoteOf(score, 1);
    clickNote(note.id);

    expect(store.getState().activeTrackId).toBe(score.tracks[1].id);
  });

  it('clicking empty stave clears the selection and seeks', () => {
    const { store, seek } = setupEditor();
    store.getState().setSelection({ eventIds: ['whatever'], measureIds: [], trackIds: [] });
    clickEmptyStave();

    expect(store.getState().selection.eventIds).toEqual([]);
    expect(seek).toHaveBeenCalled();
  });

  it('cmd-click selects notes between the caret and the click on the active track', () => {
    const { store, score } = setupEditor();
    const notes = notesOf(score);
    store.getState().setPositionTick(notes[0].startTick);
    store.getState().setActiveTrack(score.tracks[0].id);

    clickNote(notes[2].id, { metaKey: true });

    expect(store.getState().selection.eventIds).toContain(notes[0].id);
    expect(store.getState().selection.eventIds).toContain(notes[1].id);
  });

  it('cmd-click does not move the caret', () => {
    const { store, score, seek } = setupEditor();
    const notes = notesOf(score);
    store.getState().setPositionTick(notes[0].startTick);
    seek.mockClear();

    clickNote(notes[2].id, { metaKey: true });

    expect(seek).not.toHaveBeenCalled();
  });

  it('cmd-shift-click widens the range to every track', () => {
    const { store, score } = setupEditor({ tracks: 2 });
    store.getState().setPositionTick(0);
    store.getState().setActiveTrack(score.tracks[0].id);

    clickNote(notesOf(score, 0)[2].id, { metaKey: true, shiftKey: true });

    const selected = store.getState().selection.eventIds;
    const track1Ids = notesOf(score, 1).map((n) => n.id);
    expect(selected.some((id) => track1Ids.includes(id))).toBe(true);
  });

  it('cmd-click sets an explicit range so empty spans still regenerate', () => {
    const { store, score } = setupEditor();
    store.getState().setPositionTick(0);
    clickEmptyStave();
    store.getState().setActiveTrack(score.tracks[0].id);
    cmdClickEmptyStaveFurtherRight();

    expect(store.getState().selection.range).not.toBeUndefined();
  });
});
```

Write the helpers at the top of the describe block. Clicking is geometric —
there is no per-glyph DOM — so coordinates come from the live render result's
bbox maps, captured by spying on `render`:

```tsx
/**
 * The last render result, so a test can turn a note id into a click point.
 * Mirrors what e2e does through `window.__scoresmith`.
 */
let lastResult: CanvasRenderResult | null = null;

function setupEditor({ tracks = 1 }: { tracks?: number } = {}) {
  const context = testStoreContext();
  const store = createAppStore({ context });
  const score = tracks > 1 ? buildTwoTrackScore() : buildScore();
  store.getState().setScore(score);

  const seek = vi.spyOn(playbackController, 'seek').mockImplementation(() => undefined);
  vi.spyOn(CanvasScoreRenderer.prototype, 'render').mockImplementation(function (
    this: CanvasScoreRenderer,
    ...args: Parameters<CanvasScoreRenderer['render']>
  ) {
    const result = CanvasScoreRenderer.prototype.render.wrappedMethod!.apply(this, args);
    lastResult = result;
    return result;
  });

  render(<ScoreEditorView store={store} />);
  return { store, score, seek };
}

function notesOf(score: Score, trackIndex = 0) {
  const out: NoteEvent[] = [];
  for (const measure of score.tracks[trackIndex].measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (isNoteEvent(event)) out.push(event);
      }
    }
  }
  return out.sort((a, b) => a.startTick - b.startTick);
}

function firstNoteOf(score: Score, trackIndex = 0) {
  return notesOf(score, trackIndex)[0];
}

/** Fires a click at the centre of `eventId`'s drawn bbox. */
function clickNote(eventId: string, modifiers: { metaKey?: boolean; shiftKey?: boolean } = {}) {
  const box = lastResult!.idToBBox.get(eventId);
  if (!box) throw new Error(`note ${eventId} was not drawn`);
  fireEvent.click(screen.getByTestId('score-editor-canvas'), {
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
    ...modifiers,
  });
}

/** Fires a click inside a measure's stave but clear of any notehead — its bottom-right corner. */
function clickEmptyStave(
  measureIndex = 0,
  modifiers: { metaKey?: boolean; shiftKey?: boolean } = {},
) {
  const measureId = /* the score's track-0 measure at measureIndex */ '';
  const box = lastResult!.measureIdToBBox.get(measureId)!;
  fireEvent.click(screen.getByTestId('score-editor-canvas'), {
    clientX: box.x + box.width - 4,
    clientY: box.y + box.height - 4,
    ...modifiers,
  });
}

function cmdClickEmptyStaveFurtherRight() {
  clickEmptyStave(1, { metaKey: true });
}
```

Two things to resolve while writing these:

- `clickEmptyStave` needs the measure id — thread the score in, or capture it in
  `setupEditor` and close over it. The `''` above is a placeholder to replace,
  not to ship.
- `CanvasScoreRenderer.prototype.render.wrappedMethod` is not a real Vitest API.
  Capture the original before spying instead:
  `const original = CanvasScoreRenderer.prototype.render;` then call
  `original.apply(this, args)` inside the mock.

`getBoundingClientRect` returns all zeros in jsdom, so the component's
`clientX - rect.left` reduces to `clientX` — bbox coordinates are usable as
client coordinates directly, which is what makes this work at all.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- ScoreEditorView`
Expected: FAIL — old behavior selects measures and doesn't set the active track.

- [ ] **Step 3: Rewrite handleClick**

Replace the body of `handleClick` in `ScoreEditorView.tsx`:

```tsx
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }

      // While a regeneration candidate is being previewed (spec §13),
      // `displayScore` (and so this click's `result`) is the committed score
      // with the candidate spliced in — clicking must not dispatch a
      // selection against ids that may not exist in the committed score, and
      // seeking would fight the preview playback that owns the engine.
      if (previewFragment) return;

      const container = containerRef.current;
      const result = resultRef.current;
      const state = store.getState();
      if (!container || !state.score) return;
      const rect = container.getBoundingClientRect();
      const point: Point = { x: event.clientX - rect.left, y: event.clientY - rect.top };

      // ---- cmd-click: range from the caret to here. Never moves the caret,
      // so the same anchor can be extended repeatedly.
      if (event.metaKey || event.ctrlKey) {
        const clickedTick = tickForPoint(
          layoutPlan!,
          displayScore!,
          point.x / zoom,
          point.y / zoom,
        );
        if (clickedTick === null) return;

        const scopeTrackIds = event.shiftKey
          ? state.score.tracks.map((t) => t.id)
          : activeTrackId
            ? [activeTrackId]
            : [];
        const eventIds = noteIdsInTickRange(
          state.score,
          state.positionTick,
          clickedTick,
          scopeTrackIds,
        );
        // The explicit `range` matters: regenerating a span of empty measures
        // must still work, and `selectionToRange` can't derive a span from an
        // empty eventIds list.
        state.setSelection({
          eventIds,
          measureIds: [],
          trackIds: [],
          range: {
            startTick: Math.min(state.positionTick, clickedTick),
            endTick: Math.max(state.positionTick, clickedTick),
            trackIds: scopeTrackIds,
          },
        });
        return;
      }

      // ---- plain click on a note: caret to its start, select it alone.
      const noteId = result ? eventIdAtPoint(result.idToBBox, point) : null;
      if (noteId) {
        const note = findEvent(state.score, noteId);
        state.setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
        if (note) {
          state.setActiveTrack(note.trackId);
          playbackController.seek(note.startTick);
        }
        return;
      }

      // ---- plain click anywhere else in a system: caret + active track,
      // selection cleared so the caret becomes the next cmd-click's anchor.
      const measureId = result ? measureIdAtPoint(result.measureIdToBBox, point) : null;
      if (measureId) {
        const owner = state.score.tracks.find((t) =>
          t.measures.some((m) => m.id === measureId),
        );
        if (owner) state.setActiveTrack(owner.id);
      }
      state.clearSelection();
      seekToEventPoint(event);
    },
    [store, previewFragment, seekToEventPoint, layoutPlan, displayScore, zoom, activeTrackId],
  );
```

Add imports: `noteIdsInTickRange` from `@/features/score-editor/range-select`, and `findEvent` from `@sudobility/music_lib`. `tickForPoint` and `playbackController` are already imported.

Remove the now-unused `selectMeasure` import if nothing else in the file uses it (Task 11 reintroduces measure selection on the gutter).

- [ ] **Step 4: Run the tests**

Run: `bun run test -- ScoreEditorView`
Expected: PASS. Old tests asserting "clicking a stave selects the measure" now fail — delete them; that gesture moved to the gutter in Task 11.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(score-editor): caret-anchored click model

Click sets the caret and active track and clears the selection; note click
also selects that note; cmd-click selects caret->click on the active track,
cmd-shift-click across all tracks. Stave click no longer selects a measure.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Measure-gutter selection

**Files:**
- Modify: `src/features/score-editor/hit-test.ts`
- Modify: `src/features/score-editor/hit-test.test.ts`
- Modify: `src/features/score-editor/ScoreEditorView.tsx`
- Modify: `src/features/score-editor/ScoreEditorView.test.tsx`

**Interfaces:**
- Consumes: `MEASURE_HEADER_HEIGHT`, `LayoutPlan` (Part A Task 3).
- Produces: `measureIndexAtGutterPoint(plan, point): number | null`.

- [ ] **Step 1: Write the failing test**

Append to `src/features/score-editor/hit-test.test.ts`:

```ts
describe('measureIndexAtGutterPoint', () => {
  const plan = {
    systems: [{ measureIndices: [0, 1], xLeft: 10, xRight: 410, gutterTop: 10, yTop: 28, yBottom: 128 }],
    trackLayouts: [
      {
        measures: [
          { measureIndex: 0, isFirstInSystem: true, box: { x: 10, y: 28, width: 200, height: 100 } },
          { measureIndex: 1, isFirstInSystem: false, box: { x: 210, y: 28, width: 200, height: 100 } },
        ],
      },
    ],
  } as unknown as LayoutPlan;

  it('finds the measure under a point inside the gutter band', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 50, y: 20 })).toBe(0);
    expect(measureIndexAtGutterPoint(plan, { x: 250, y: 20 })).toBe(1);
  });

  it('returns null below the gutter band (that is the stave)', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 50, y: 60 })).toBeNull();
  });

  it('returns null above the gutter band', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 50, y: 2 })).toBeNull();
  });

  it('returns null horizontally past the last measure', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 500, y: 20 })).toBeNull();
  });
});
```

Import `MEASURE_HEADER_HEIGHT` and `LayoutPlan` from `@sudobility/music_lib`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- hit-test`
Expected: FAIL — `measureIndexAtGutterPoint` not exported.

- [ ] **Step 3: Implement the hit test**

Append to `src/features/score-editor/hit-test.ts`:

```ts
/**
 * The measure index under `point` when it falls in a system's measure-number
 * gutter band, or `null` anywhere else. Logical (unzoomed) content
 * coordinates — the caller divides by zoom, same as `tickForPoint`.
 *
 * Measure geometry is read off track 0: every track shares one measure grid
 * (see `rebuildMeasureTicks`), which is why one gutter serves the whole
 * system.
 */
export function measureIndexAtGutterPoint(plan: LayoutPlan, point: Point): number | null {
  const measures = plan.trackLayouts[0]?.measures;
  if (!measures) return null;

  for (const system of plan.systems) {
    if (point.y < system.gutterTop || point.y >= system.yTop) continue;
    for (const measureIndex of system.measureIndices) {
      const box = measures[measureIndex]?.box;
      if (!box) continue;
      if (point.x >= box.x && point.x < box.x + box.width) return measureIndex;
    }
    return null; // in this system's gutter but past its measures
  }
  return null;
}
```

Add `LayoutPlan` to the file's `@sudobility/music_lib` type import.

- [ ] **Step 4: Run the test**

Run: `bun run test -- hit-test`
Expected: PASS

- [ ] **Step 5: Write the failing component test**

Append to `ScoreEditorView.test.tsx`:

```ts
describe('measure gutter selection', () => {
  it('clicking the gutter selects that measure on the active track', () => {
    const { store, score } = setupEditor();
    store.getState().setActiveTrack(score.tracks[0].id);
    clickGutter(0);

    expect(store.getState().selection.measureIds).toEqual([
      score.tracks[0].measures[0].id,
    ]);
  });

  it('cmd-shift-clicking the gutter selects that measure on every track', () => {
    const { store, score } = setupEditor({ tracks: 2 });
    clickGutter(0, { metaKey: true, shiftKey: true });

    expect(store.getState().selection.measureIds).toEqual([
      score.tracks[0].measures[0].id,
      score.tracks[1].measures[0].id,
    ]);
  });

  it('gutter clicks do not move the caret', () => {
    const { seek } = setupEditor();
    seek.mockClear();
    clickGutter(0);
    expect(seek).not.toHaveBeenCalled();
  });
});
```

`clickGutter(index, modifiers)` computes a point inside the gutter band from the layout plan and fires a click on `score-editor-canvas`.

- [ ] **Step 6: Handle gutter clicks**

In `handleClick`, insert this **before** the cmd-click branch (a gutter click must win over both, and must not seek):

```tsx
      // ---- measure gutter: the one gesture that still selects measures
      // (regeneration's "select bars 3-4" workflow). Never moves the caret.
      if (layoutPlan) {
        const gutterIndex = measureIndexAtGutterPoint(layoutPlan, {
          x: point.x / zoom,
          y: point.y / zoom,
        });
        if (gutterIndex !== null) {
          const tracks =
            event.metaKey && event.shiftKey
              ? state.score.tracks
              : state.score.tracks.filter((t) => t.id === activeTrackId);
          const measureIds = tracks
            .map((t) => t.measures[gutterIndex]?.id)
            .filter((id): id is string => id !== undefined);
          if (measureIds.length > 0) state.selectMeasures(measureIds);
          return;
        }
      }
```

Import `measureIndexAtGutterPoint` from `@/features/score-editor/hit-test`.

- [ ] **Step 7: Run the tests**

Run: `bun run test -- ScoreEditorView hit-test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(score-editor): select measures from the measure-number gutter

Preserves the regeneration "select bars 3-4" workflow now that stave clicks
set the caret instead. Cmd-shift widens to every track.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Drag autoscroll

**Files:**
- Create: `src/features/score-editor/autoscroll.ts`
- Create: `src/features/score-editor/autoscroll.test.ts`
- Modify: `src/features/score-editor/ScoreEditorView.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `autoscrollDelta(params): { dx: number; dy: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/features/score-editor/autoscroll.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AUTOSCROLL_EDGE_PX, autoscrollDelta } from '@/features/score-editor/autoscroll';

const box = { width: 800, height: 600 };

describe('autoscrollDelta', () => {
  it('is zero well inside the box', () => {
    expect(autoscrollDelta({ x: 400, y: 300, box, layoutMode: 'page' })).toEqual({ dx: 0, dy: 0 });
    expect(autoscrollDelta({ x: 400, y: 300, box, layoutMode: 'continuous' })).toEqual({ dx: 0, dy: 0 });
  });

  it('scrolls vertically in page mode near the bottom edge', () => {
    const d = autoscrollDelta({ x: 400, y: 595, box, layoutMode: 'page' });
    expect(d.dy).toBeGreaterThan(0);
    expect(d.dx).toBe(0);
  });

  it('scrolls up in page mode near the top edge', () => {
    const d = autoscrollDelta({ x: 400, y: 3, box, layoutMode: 'page' });
    expect(d.dy).toBeLessThan(0);
  });

  it('scrolls horizontally in continuous mode near the right edge', () => {
    const d = autoscrollDelta({ x: 795, y: 300, box, layoutMode: 'continuous' });
    expect(d.dx).toBeGreaterThan(0);
    expect(d.dy).toBe(0);
  });

  it('ignores the off-axis edge', () => {
    expect(autoscrollDelta({ x: 795, y: 300, box, layoutMode: 'page' }).dy).toBe(0);
    expect(autoscrollDelta({ x: 400, y: 595, box, layoutMode: 'continuous' }).dx).toBe(0);
  });

  it('scrolls faster the deeper into the edge band the pointer is', () => {
    const shallow = autoscrollDelta({ x: 400, y: 600 - AUTOSCROLL_EDGE_PX + 2, box, layoutMode: 'page' });
    const deep = autoscrollDelta({ x: 400, y: 600, box, layoutMode: 'page' });
    expect(deep.dy).toBeGreaterThan(shallow.dy);
  });

  it('clamps to the maximum rate past the edge', () => {
    const atEdge = autoscrollDelta({ x: 400, y: 600, box, layoutMode: 'page' });
    const beyond = autoscrollDelta({ x: 400, y: 900, box, layoutMode: 'page' });
    expect(beyond.dy).toBe(atEdge.dy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- autoscroll`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/score-editor/autoscroll.ts`:

```ts
/**
 * Edge autoscroll for drag-box selection. Pure: takes a pointer position
 * relative to the scroll box and returns a per-frame scroll delta, so the
 * rate curve is unit-testable without a real scroll container.
 *
 * The axis follows the layout mode because that's the axis that actually has
 * anywhere to go: continuous mode is one very wide system, page mode wraps
 * into a tall column.
 */
export type AutoscrollParams = {
  /** Pointer x relative to the scroll box's left edge. */
  x: number;
  /** Pointer y relative to the scroll box's top edge. */
  y: number;
  box: { width: number; height: number };
  layoutMode: 'page' | 'continuous';
};

/** How close to an edge (px) the pointer must come before autoscroll engages. */
export const AUTOSCROLL_EDGE_PX = 48;
/** Maximum scroll per animation frame (px), reached at or past the edge itself. */
export const AUTOSCROLL_MAX_PX_PER_FRAME = 18;

/** 0 outside the band, ramping to 1 at (or past) the edge. */
function rate(distanceFromEdge: number): number {
  if (distanceFromEdge >= AUTOSCROLL_EDGE_PX) return 0;
  const clamped = Math.max(0, distanceFromEdge);
  return (AUTOSCROLL_EDGE_PX - clamped) / AUTOSCROLL_EDGE_PX;
}

export function autoscrollDelta({ x, y, box, layoutMode }: AutoscrollParams): {
  dx: number;
  dy: number;
} {
  if (layoutMode === 'continuous') {
    const left = rate(x);
    const right = rate(box.width - x);
    const dx = Math.round((right - left) * AUTOSCROLL_MAX_PX_PER_FRAME);
    return { dx, dy: 0 };
  }
  const top = rate(y);
  const bottom = rate(box.height - y);
  const dy = Math.round((bottom - top) * AUTOSCROLL_MAX_PX_PER_FRAME);
  return { dx: 0, dy };
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- autoscroll`
Expected: PASS (7 tests)

- [ ] **Step 5: Wire it into the drag**

In `ScoreEditorView.tsx` add a ref and two helpers:

```tsx
  /** Live rAF id for drag autoscroll, and the last pointer position in scroll-box coordinates. */
  const autoscrollRafRef = useRef<number | null>(null);
  const autoscrollPointRef = useRef<{ x: number; y: number } | null>(null);

  const stopAutoscroll = useCallback(() => {
    if (autoscrollRafRef.current !== null) {
      cancelAnimationFrame(autoscrollRafRef.current);
      autoscrollRafRef.current = null;
    }
    autoscrollPointRef.current = null;
  }, []);

  /**
   * Runs while a drag-box selection is in flight: each frame, nudges the
   * scroll box if the pointer is inside an edge band. The scroll itself
   * fires `onScroll` -> `draw()`, so the newly-exposed window repaints
   * without any extra wiring here.
   */
  const stepAutoscroll = useCallback(() => {
    const box = scrollBoxRef.current;
    const point = autoscrollPointRef.current;
    if (!box || !point) {
      autoscrollRafRef.current = null;
      return;
    }
    const { dx, dy } = autoscrollDelta({
      x: point.x,
      y: point.y,
      box: {
        width: box.clientWidth || DEFAULT_WIDTH,
        height: box.clientHeight || CONTAINER_MIN_HEIGHT,
      },
      layoutMode,
    });
    if (dx !== 0) box.scrollLeft += dx;
    if (dy !== 0) box.scrollTop += dy;
    autoscrollRafRef.current = requestAnimationFrame(stepAutoscroll);
  }, [layoutMode]);
```

In `handlePointerMove`, after `if (drag.moved) setDragBox(...)`:

```tsx
      if (drag.moved) {
        const box = scrollBoxRef.current;
        if (box) {
          const boxRect = box.getBoundingClientRect();
          autoscrollPointRef.current = {
            x: event.clientX - boxRect.left,
            y: event.clientY - boxRect.top,
          };
          if (autoscrollRafRef.current === null) {
            autoscrollRafRef.current = requestAnimationFrame(stepAutoscroll);
          }
        }
      }
```

Add `stepAutoscroll` to `handlePointerMove`'s dependency array.

In `handlePointerUp`, call `stopAutoscroll();` as the first statement after the `if (!drag) return;` guard. Add a `handlePointerCancel` doing the same plus the drag reset, and wire `onPointerCancel={handlePointerCancel}` on the interaction div.

Extend the existing unmount cleanup effect to also call `stopAutoscroll()`.

Import `autoscrollDelta` from `@/features/score-editor/autoscroll`.

- [ ] **Step 6: Run the tests**

Run: `bun run test -- ScoreEditorView autoscroll`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(score-editor): autoscroll while drag-selecting

Horizontal in continuous mode, vertical in page mode, rate ramping with
depth into a 48px edge band.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Simultaneous layout

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/components/layout/AppLayout.test.tsx`
- Modify: `src/features/score-editor/EditorToolbar.tsx:404-425`
- Modify: `src/features/score-editor/EditorToolbar.test.tsx`
- Modify: `src/features/piano-roll/PianoRollToolbar.tsx:322-343`
- Modify: `src/features/piano-roll/PianoRollToolbar.test.tsx`
- Modify: `src/features/score-editor/ScoreEditorView.tsx` (summary call site only)
- Modify: `src/features/piano-roll/PianoRollView.tsx` (summary call site + collapse props)

**Interfaces:**
- Consumes: `selectionSummaryLabel(sel, regenerated)` (Part A Task 5).
- Produces: `PianoRollViewProps.collapsed`, `PianoRollViewProps.onToggleCollapsed`, and the same two props on `PianoRollToolbarProps`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/layout/AppLayout.test.tsx`:

```ts
describe('simultaneous notation and piano roll', () => {
  it('renders both views at once', () => {
    renderAppLayout();
    expect(screen.getByTestId('score-editor-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('piano-roll-grid')).toBeInTheDocument();
  });

  it('has no view-mode toggle', () => {
    renderAppLayout();
    expect(screen.queryByRole('group', { name: 'Editor view' })).not.toBeInTheDocument();
  });

  it('collapses the piano roll panel', async () => {
    const user = userEvent.setup();
    renderAppLayout();
    await user.click(screen.getByRole('button', { name: 'Collapse piano roll' }));
    expect(screen.queryByTestId('piano-roll-grid')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand piano roll' })).toBeInTheDocument();
  });
});
```

Check the piano roll grid's real testid:

```bash
grep -n "data-testid=\"piano-roll" src/features/piano-roll/PianoRollView.tsx
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- AppLayout`
Expected: FAIL — only one view renders; no collapse button.

- [ ] **Step 3: Remove both view toggles**

In `src/features/score-editor/EditorToolbar.tsx`, delete the whole `<div role="group" aria-label="Editor view">` block and the now-unused `const view = store((s) => s.view);` read.

In `src/features/piano-roll/PianoRollToolbar.tsx`, delete the same block and its `view` read.

- [ ] **Step 4: Add the collapse control to the piano roll toolbar**

In `PianoRollToolbar.tsx`, add two props and a leading button:

```tsx
export type PianoRollToolbarProps = {
  // ...existing props
  collapsed: boolean;
  onToggleCollapsed: () => void;
};
```

```tsx
      <Tooltip content={collapsed ? 'Expand piano roll' : 'Collapse piano roll'}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={collapsed ? 'Expand piano roll' : 'Collapse piano roll'}
          onClick={onToggleCollapsed}
          className="h-auto w-auto p-1.5 text-sm leading-none"
        >
          {collapsed ? '▴' : '▾'}
        </Button>
      </Tooltip>
```

Place it as the toolbar's first child so it stays reachable when collapsed.

- [ ] **Step 5: Make PianoRollView collapsible**

In `PianoRollView.tsx`, add `collapsed`/`onToggleCollapsed` props, pass them to the toolbar, and return early after the toolbar when collapsed:

```tsx
  if (collapsed) {
    return (
      <div className="flex flex-col border-t border-theme-border">
        <PianoRollToolbar
          /* ...existing props... */
          collapsed
          onToggleCollapsed={onToggleCollapsed}
        />
      </div>
    );
  }
```

- [ ] **Step 6: Restructure AppLayout**

In `AppLayout.tsx`:

- Remove `const view = store((s) => s.view);`
- Replace the conditional editor block:

```tsx
          <div className="min-h-0 flex-1">
            <ScoreEditorView store={store} />
          </div>
```

- Add piano-roll state near the other panel state:

```tsx
  const [pianoRollCollapsed, setPianoRollCollapsed] = useState(false);
```

- Insert the panel between the three-pane row's closing tag and `<TransportBar store={store} />`:

```tsx
      {/* Full-width piano roll: a sibling of the transport rather than a
          child of the center column, so it spans the whole window under the
          track and inspector panels. Fixed height, collapsible, own
          horizontal scroll across the full score. */}
      <div
        className="shrink-0 overflow-hidden border-t border-theme-border"
        style={pianoRollCollapsed ? undefined : { height: PIANO_ROLL_PANEL_HEIGHT }}
      >
        <PianoRollView
          store={store}
          collapsed={pianoRollCollapsed}
          onToggleCollapsed={() => setPianoRollCollapsed((v) => !v)}
        />
      </div>
```

- Add the constant next to `SIDE_PANEL_WIDTH`:

```tsx
const PIANO_ROLL_PANEL_HEIGHT = 280;
```

- [ ] **Step 7: Persist the collapsed state**

Find how zoom/theme reach `PrefsStorage`:

```bash
grep -rn "prefsStorage\|PrefsStorage" src/config/initialize.ts src/app/App.tsx
```

Follow that same path for a `pianoRollCollapsed` boolean. If prefs are loaded once at bootstrap into the store, add the field there and read it as the `useState` initial value.

- [ ] **Step 8: Wire the regenerated announcement into all three summaries**

`selectionSummaryLabel` gained a `regenerated` parameter in Part A Task 5 — this
is the non-color channel that replaces the deleted overlay's stroke patterns, so
every call site has to actually pass it. There are exactly three:

```bash
grep -rn "selectionSummaryLabel" src --include=*.tsx | grep -v "\.test\."
```

In each of `AppLayout.tsx` (status bar), `ScoreEditorView.tsx` (the
`role="application"` aria-label) and `PianoRollView.tsx` (its SR-only summary),
read the flag and pass it:

```tsx
  const selectionRegenerated = store((s) => s.selectionRegenerated);
  // ...
  selectionSummaryLabel(selection, selectionRegenerated)
```

`ScoreEditorView` and `PianoRollView` already read `selectionRegenerated` from
Tasks 8 and 14 — reuse it rather than adding a second subscription.

Add to `AppLayout.test.tsx`:

```ts
it('announces a regenerated selection in the status bar', () => {
  const { store, score } = renderAppLayout();
  const noteId = firstNoteOf(score, 0).id;
  act(() => {
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
    store.setState({ selectionRegenerated: true });
  });
  expect(screen.getByRole('status', { name: 'Status bar' })).toHaveTextContent(
    '1 note(s) selected, regenerated',
  );
});
```

- [ ] **Step 9: Run the tests**

Run: `bun run test -- AppLayout EditorToolbar PianoRollToolbar`
Expected: PASS. Delete every test asserting the view toggle or `setView`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(layout): show notation and piano roll simultaneously

The piano roll becomes a full-width collapsible panel above the transport;
the notation/piano-roll mode toggle is removed from both toolbars.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Piano roll shows the active track, colored by state

**Files:**
- Modify: `src/features/piano-roll/PianoRollView.tsx`
- Modify: `src/features/piano-roll/PianoRollView.test.tsx`
- Modify: `src/features/piano-roll/PianoRollToolbar.tsx` (remove Track filter)
- Modify: `src/features/piano-roll/PianoRollToolbar.test.tsx`

**Interfaces:**
- Consumes: `selectActiveTrackId`, `buildNoteColors` (Task 8), `noteColorFor`.
- Produces: no exported API.

- [ ] **Step 1: Write the failing test**

Append to `src/features/piano-roll/PianoRollView.test.tsx`:

```ts
describe('active track only', () => {
  it('renders notes from the active track and no others', () => {
    const { store, score } = setupPianoRoll({ tracks: 2 });
    store.getState().setActiveTrack(score.tracks[1].id);

    const trackOneNote = firstNoteOf(score, 1);
    const trackZeroNote = firstNoteOf(score, 0);
    expect(screen.getByTestId(`pr-note-${trackOneNote.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`pr-note-${trackZeroNote.id}`)).not.toBeInTheDocument();
  });

  it('follows the active track when it changes', () => {
    const { store, score } = setupPianoRoll({ tracks: 2 });
    store.getState().setActiveTrack(score.tracks[0].id);
    expect(screen.getByTestId(`pr-note-${firstNoteOf(score, 0).id}`)).toBeInTheDocument();

    act(() => store.getState().setActiveTrack(score.tracks[1].id));
    expect(screen.queryByTestId(`pr-note-${firstNoteOf(score, 0).id}`)).not.toBeInTheDocument();
  });
});

describe('state colors', () => {
  it('colors a selected note with the selected color', () => {
    const { store, score } = setupPianoRoll();
    const note = firstNoteOf(score, 0);
    act(() =>
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] }),
    );
    expect(screen.getByTestId(`pr-note-${note.id}`)).toHaveStyle({
      backgroundColor: 'rgb(0, 0, 0)',
    });
  });

  it('colors a regenerated selection brown', () => {
    const { store, score } = setupPianoRoll();
    const note = firstNoteOf(score, 0);
    act(() => {
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
      store.setState({ selectionRegenerated: true });
    });
    expect(screen.getByTestId(`pr-note-${note.id}`)).toHaveStyle({
      backgroundColor: 'rgb(139, 90, 43)',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- PianoRollView`
Expected: FAIL — all tracks render; notes use `trackColor`.

- [ ] **Step 3: Derive visibleTrackIds from the active track**

In `PianoRollView.tsx`, replace:

```tsx
  const [visibleTrackIds, setVisibleTrackIds] = useState<Set<UUID> | null>(null);
```

with:

```tsx
  const activeTrackId = store(selectActiveTrackId);
  /**
   * The piano roll is the active track's detail view — one keyboard, one set
   * of rows. That's what makes the four state colors unambiguous here (there
   * are no per-track colors left to collide with) and what makes the
   * playback key highlighting mean anything.
   */
  const visibleTrackIds = useMemo(
    () => (activeTrackId ? new Set<UUID>([activeTrackId]) : null),
    [activeTrackId],
  );
```

Remove every `setVisibleTrackIds` reference and the `visibleTrackIds` prop passed to `PianoRollToolbar`.

Import `selectActiveTrackId`.

- [ ] **Step 4: Color notes by state**

Change `NoteLayerProps` and `NoteLayer`:

```tsx
type NoteLayerProps = {
  noteRects: NoteRect[];
  noteColors: ReadonlyMap<string, NoteColorRole>;
  theme: RenderTheme;
};

const NoteLayer = memo(function NoteLayer({ noteRects, noteColors, theme }: NoteLayerProps) {
  recordNoteLayerRender();
  return (
    <>
      {noteRects.map((r) => {
        const velocityFraction = Math.max(0, Math.min(127, r.velocity)) / 127;
        const role = resolveNoteColorRole([r.id], noteColors);
        return (
          <div
            key={r.id}
            data-testid={`pr-note-${r.id}`}
            style={{
              position: 'absolute',
              left: r.x,
              top: r.y,
              width: r.width,
              height: r.height,
              backgroundColor: noteColorFor(role, theme),
              opacity: 0.45 + 0.55 * velocityFraction,
              border: '1px solid rgba(0,0,0,0.35)',
              boxSizing: 'border-box',
              cursor: 'grab',
            }}
          >
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: `${velocityFraction * 100}%`,
                height: 2,
                backgroundColor: 'rgba(255,255,255,0.85)',
              }}
              className="pointer-events-none"
            />
          </div>
        );
      })}
    </>
  );
});
```

In `PianoRollView`, build the same inputs `ScoreEditorView` does:

```tsx
  const selectionRegenerated = store((s) => s.selectionRegenerated);
  const activeNoteIds = store((s) => s.activeNoteIds);
  const themeMode = store((s) => s.themeMode);
  const theme = useMemo(
    () => (resolveColorScheme(themeMode) === 'dark' ? DARK_RENDER_THEME : LIGHT_RENDER_THEME),
    [themeMode],
  );
  const noteColors = useMemo(
    () =>
      buildNoteColors({
        selectedIds: selection.eventIds,
        playingIds: activeNoteIds,
        regenerated: selectionRegenerated,
      }),
    [selection.eventIds, activeNoteIds, selectionRegenerated],
  );
```

Export `LIGHT_RENDER_THEME`/`DARK_RENDER_THEME` from `ScoreEditorView.tsx` and import them here, so both views draw from one palette. Import `resolveColorScheme` from `@/app/theme`, and `buildNoteColors` from `@/features/score-editor/note-colors`, `noteColorFor`/`resolveNoteColorRole`/`NoteColorRole`/`RenderTheme` from `@sudobility/music_lib`.

Remove the `selectedIds`/`selectionColor` props at the `<NoteLayer />` call site and pass `noteColors={noteColors} theme={theme}`. Keep the separate `selectedIds` set if the drag handlers still use it.

Note this couples note color to `activeNoteIds`, which changes on note boundaries — `NoteLayer` is memoized on props, so it now re-renders per note boundary rather than never. That is the intended trade for playback coloring and is far cheaper than the 30Hz `positionTick`, which stays isolated in `PlaybackCursor`.

- [ ] **Step 5: Remove the Track filter control**

In `PianoRollToolbar.tsx`, delete the whole Track filter menu (around lines 260–320: the trigger button, the popover, the checkbox list) and the `visibleTrackIds`/`onVisibleTrackIdsChange` props. Delete `selectedTrackIds` and any now-unused imports (`Checkbox`, `trackIds`).

- [ ] **Step 6: Run the tests**

Run: `bun run test -- PianoRollView PianoRollToolbar`
Expected: PASS. Delete track-filter tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(piano-roll): show only the active track, color notes by state

visibleTrackIds now derives from selectActiveTrackId, so the manual track
filter is removed. Notes use the shared four-role palette instead of
per-track colors.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Playback key highlighting

**Files:**
- Modify: `src/features/piano-roll/PianoRollView.tsx`
- Modify: `src/features/piano-roll/PianoRollView.test.tsx`
- Create: `src/features/piano-roll/playing-pitches.ts`
- Create: `src/features/piano-roll/playing-pitches.test.ts`

**Interfaces:**
- Consumes: `activeNoteIds`, `selectActiveTrackId`.
- Produces: `playingPitchesForTrack(score, activeNoteIds, trackId): Set<number>`.

- [ ] **Step 1: Write the failing test**

Create `src/features/piano-roll/playing-pitches.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { playingPitchesForTrack } from '@/features/piano-roll/playing-pitches';
import { buildScore, pitchToMidi } from '@sudobility/music_lib';

function firstNote(score: ReturnType<typeof buildScore>, trackIndex: number) {
  for (const measure of score.tracks[trackIndex].measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if ('pitch' in event) return event;
      }
    }
  }
  throw new Error('fixture has no notes');
}

describe('playingPitchesForTrack', () => {
  it('is empty when nothing is playing', () => {
    const score = buildScore();
    expect(playingPitchesForTrack(score, [], score.tracks[0].id).size).toBe(0);
  });

  it('is empty when there is no active track', () => {
    const score = buildScore();
    const note = firstNote(score, 0);
    expect(playingPitchesForTrack(score, [note.id], null).size).toBe(0);
  });

  it('returns the midi of a sounding note on the active track', () => {
    const score = buildScore();
    const note = firstNote(score, 0);
    const pitches = playingPitchesForTrack(score, [note.id], score.tracks[0].id);
    expect(pitches.has(pitchToMidi(note.pitch))).toBe(true);
  });

  it('ignores sounding notes on other tracks', () => {
    const score = buildScore();
    const note = firstNote(score, 0);
    expect(playingPitchesForTrack(score, [note.id], 'some-other-track').size).toBe(0);
  });

  it('ignores ids that no longer resolve', () => {
    const score = buildScore();
    expect(playingPitchesForTrack(score, ['gone'], score.tracks[0].id).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- playing-pitches`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/piano-roll/playing-pitches.ts`:

```ts
/**
 * Which keyboard keys light up during playback: the MIDI pitches currently
 * sounding on the active track.
 *
 * `activeNoteIds` from the playback engine spans every track, so this
 * filters to the one the piano roll is showing — highlighting a key for a
 * note the user can't see would be noise.
 */
import { findEvent, pitchToMidi } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { Score, UUID } from '@sudobility/music_types';

export function playingPitchesForTrack(
  score: Score,
  activeNoteIds: readonly string[],
  trackId: UUID | null,
): Set<number> {
  const pitches = new Set<number>();
  if (!trackId) return pitches;
  for (const id of activeNoteIds) {
    const event = findEvent(score, id);
    if (!event || !isNoteEvent(event) || event.trackId !== trackId) continue;
    pitches.add(pitchToMidi(event.pitch));
  }
  return pitches;
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- playing-pitches`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing component test**

Append to `PianoRollView.test.tsx`:

```ts
describe('playback key highlighting', () => {
  it('highlights the key of a sounding note on the active track', () => {
    const { store, score } = setupPianoRoll();
    const note = firstNoteOf(score, 0);
    act(() => {
      store.getState().setActiveTrack(score.tracks[0].id);
      store.getState().setActiveNoteIds([note.id]);
    });
    const midi = pitchToMidi(note.pitch);
    expect(screen.getByTestId(`pr-key-${midi}`)).toHaveAttribute('data-playing', 'true');
  });

  it('clears the highlight when the note stops', () => {
    const { store, score } = setupPianoRoll();
    const note = firstNoteOf(score, 0);
    act(() => {
      store.getState().setActiveTrack(score.tracks[0].id);
      store.getState().setActiveNoteIds([note.id]);
    });
    act(() => store.getState().setActiveNoteIds([]));
    const midi = pitchToMidi(note.pitch);
    expect(screen.getByTestId(`pr-key-${midi}`)).toHaveAttribute('data-playing', 'false');
  });
});
```

- [ ] **Step 6: Add the isolated keyboard component**

In `PianoRollView.tsx`, extract the keyboard column into its own component so a note boundary repaints only it:

```tsx
type KeyboardColumnProps = {
  store: EditorStoreApi;
  rows: KeyboardRow[];
  height: number;
  theme: RenderTheme;
};

/**
 * The sticky left keyboard. Its own component, and the only place that
 * subscribes to `activeNoteIds`, for the same reason `PlaybackCursor` is
 * isolated from `positionTick`: a playback frame must not re-render the
 * note and grid layers.
 */
function KeyboardColumn({ store, rows, height, theme }: KeyboardColumnProps) {
  const score = store((s) => s.score);
  const activeNoteIds = store((s) => s.activeNoteIds);
  const activeTrackId = store(selectActiveTrackId);
  const playing = useMemo(
    () => (score ? playingPitchesForTrack(score, activeNoteIds, activeTrackId) : new Set<number>()),
    [score, activeNoteIds, activeTrackId],
  );

  return (
    <div
      className="sticky left-0 z-10 shrink-0 border-r border-theme-border bg-theme-bg"
      style={{ width: KEYBOARD_WIDTH, height }}
    >
      {rows.map((row) => {
        const isPlaying = playing.has(row.midi);
        return (
          <div
            key={row.midi}
            data-testid={`pr-key-${row.midi}`}
            data-playing={isPlaying ? 'true' : 'false'}
            style={{
              position: 'absolute',
              top: row.y,
              left: 0,
              width: KEYBOARD_WIDTH,
              height: rowHeight(zoomV),
              backgroundColor: isPlaying
                ? theme.notePlaying
                : row.isBlack
                  ? '#2a2a2a'
                  : '#fafafa',
              color: row.isBlack ? '#fafafa' : '#2a2a2a',
              fontSize: 9,
              boxSizing: 'border-box',
              borderBottom: '1px solid rgba(0,0,0,0.15)',
              paddingLeft: 4,
            }}
          >
            {row.label}
          </div>
        );
      })}
    </div>
  );
}
```

`zoomV` has to reach the component, so add it to `KeyboardColumnProps` alongside the others and pass it down.

Replace the existing inline keyboard block (`PianoRollView.tsx:688-700`) with:

```tsx
<KeyboardColumn store={store} rows={keyboardRows} height={kbHeight} zoomV={zoomV} theme={theme} />
```

Read the existing markup first and carry over its exact row styling — the snippet above reproduces the current look from memory, and any difference in border, background, or label positioning is a regression, not an improvement.

Import `playingPitchesForTrack` and the `KeyboardRow` type.

- [ ] **Step 7: Run the tests**

Run: `bun run test -- PianoRollView playing-pitches`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(piano-roll): highlight sounding keys for the active track

The keyboard column becomes its own component subscribing to activeNoteIds
alone, so a note boundary doesn't re-render the note and grid layers.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Track panel sets the active track

**Files:**
- Modify: `src/components/layout/TrackPanel.tsx`
- Modify: `src/components/layout/TrackPanel.test.tsx`

**Interfaces:**
- Consumes: `selectActiveTrackId`, `setActiveTrack`.
- Produces: no exported API.

- [ ] **Step 1: Write the failing test**

Append to `src/components/layout/TrackPanel.test.tsx`:

```ts
describe('active track', () => {
  it('marks the active track row', () => {
    const { store, score } = setupTrackPanel({ tracks: 2 });
    act(() => store.getState().setActiveTrack(score.tracks[1].id));
    expect(screen.getByTestId(`track-row-${score.tracks[1].id}`)).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByTestId(`track-row-${score.tracks[0].id}`)).not.toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('clicking a row makes that track active', async () => {
    const user = userEvent.setup();
    const { store, score } = setupTrackPanel({ tracks: 2 });
    await user.click(screen.getByTestId(`track-row-${score.tracks[1].id}`));
    expect(store.getState().activeTrackId).toBe(score.tracks[1].id);
  });

  it('defaults to the first track with no explicit choice', () => {
    const { score } = setupTrackPanel({ tracks: 2 });
    expect(screen.getByTestId(`track-row-${score.tracks[0].id}`)).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- TrackPanel`
Expected: FAIL — no `track-row-*` testid, no `aria-current`.

- [ ] **Step 3: Wire the row**

In `TrackPanel.tsx`, read the active track:

```tsx
  const activeTrackId = store(selectActiveTrackId);
```

On each track's root row element add:

```tsx
            data-testid={`track-row-${track.id}`}
            aria-current={track.id === activeTrackId ? 'true' : undefined}
            onClick={() => {
              store.getState().setActiveTrack(track.id);
              store.getState().selectTrack(track.id);
            }}
            className={cn(
              /* existing classes */,
              track.id === activeTrackId && 'bg-theme-hover-bg',
            )}
```

Read the existing row markup first — it already has a click handler calling `selectTrack`; extend rather than duplicate it. Make sure the mute/solo/volume controls inside the row call `event.stopPropagation()` so adjusting them doesn't also switch the active track.

Import `selectActiveTrackId`.

- [ ] **Step 4: Run the tests**

Run: `bun run test -- TrackPanel`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(track-panel): set the active track from a track row

Needed now that the piano roll shows only the active track — otherwise
switching tracks means finding that stave in the notation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: E2E and final verification

**Files:**
- Modify: `e2e/*.spec.ts` (whichever reference the view toggle)
- Modify: `docs/parity-checklist.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find affected e2e specs**

```bash
grep -rn "Notation view\|Piano roll view\|Editor view\|overlay-canvas" e2e/
```

- [ ] **Step 2: Rewrite them for the simultaneous layout**

Any spec that clicked "Piano roll view" to reveal the grid now finds it already present. Delete the toggle click. Any spec asserting the notation view is hidden while in piano-roll mode is obsolete — delete it.

Add one spec covering the new gesture chain:

```ts
test('caret, cmd-click range, and play from caret', async ({ page }) => {
  await openProject(page);

  // Click a note: caret moves there, only that note is selected.
  const first = await noteCoordinates(page, 0);
  await page.mouse.click(first.x, first.y);
  await expect(page.getByTestId('playback-caret')).toBeVisible();

  // Cmd-click further right: range selects the notes in between.
  const later = await noteCoordinates(page, 3);
  await page.keyboard.down('Meta');
  await page.mouse.click(later.x, later.y);
  await page.keyboard.up('Meta');
  await expect(page.getByLabel('Status bar')).toContainText('note(s) selected');

  // Play deselects.
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByLabel('Status bar')).toContainText('No selection');
});
```

Reuse `e2e/helpers.ts`'s existing `window.__scoresmith` bbox resolution for `noteCoordinates`.

- [ ] **Step 3: Run e2e**

Kill anything on 5173/8023 first, then:

```bash
bun run test:e2e
```

Expected: PASS.

- [ ] **Step 4: Update the docs**

- `docs/parity-checklist.md`: update the feature→test rows for the removed view toggle, the new click model, and the gutter.
- `CLAUDE.md`: the Structure and Gotchas sections describe the overlay canvas ("canvas pair (notation + highlight overlay)", `paintHighlights`) and the `view` mode. Rewrite those to describe the single canvas, note coloring, the active track, and the simultaneous layout.

- [ ] **Step 5: Full verify**

```bash
bun run verify
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test(e2e): cover the caret-anchored click model; refresh docs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage check

| Spec section | Task |
| --- | --- |
| §1 Color system, dark palette, precedence | 1, 8 |
| §1 Non-color redundancy in the status bar / SR summary | 5 (`selectionSummaryLabel` gains the flag), 13 (all three call sites pass it) |
| §2 Per-note / per-stave coloring | 2 |
| §2 Measure-number gutter | 3 |
| §2 Deletions (overlay, second canvas) | 1, 8 |
| §3 `activeTrackId` + selector | 4 |
| §3 `selectionRegenerated` | 5 |
| §3 `acceptCandidate` selects new ids | 5 |
| §4 Play clears selection; pause/stop unchanged | 6 |
| §5 Gesture table | 10 |
| §5 Range selection | 9, 10 |
| §5 Measure gutter selection | 11 |
| §6 Drag autoscroll | 12 |
| §7 Full-width collapsible panel; toggles removed | 13 |
| §8 Active-track-only piano roll, state colors | 14 |
| §8 Playback key highlighting | 15 |
| §9 Track panel active track | 16 |
| §10 Testing | every task; e2e in 17 |

### Two decisions the plan makes that the spec left open

- **Preview-candidate notes color as `regenerated`** (Task 8, Step 7). The spec
  deletes the old `preview` theme role and never says what an unaccepted
  candidate looks like, which would leave preview notes indistinguishable from
  normal ones — losing an affordance the old dotted overlay provided. Brown is
  the closest existing role: "this is generated material". Flag it at review if
  you want a fifth color instead.
- **`music_lib` ships as a `0.x` minor bump** (Task 7) rather than a major.
  Pre-1.0, minor is the conventional break signal, and `music_app` is the only
  consumer.

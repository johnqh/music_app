# Print View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print the score, or one track, on whatever paper is in the printer — with page breaks never falling through a system.

**Architecture:** `computeLayout` in page mode returns systems carrying `yTop`/`yBottom`; the renderer already translates by `-viewport.top` and culls to systems intersecting the viewport. So each system is drawn into its own canvas, and CSS `break-inside: avoid` makes the browser paginate between them. A new `showTrackInfo` render option suppresses the track gutter, which otherwise puts mute/solo buttons on paper.

**Tech Stack:** TypeScript (strict), React 19, React Router, VexFlow (canvas), Vitest + Testing Library, Playwright, Bun.

## Global Constraints

- **This is feature 1 of 6.** Transposition, multi-measure rests, rehearsal marks, cue notes and page-turn optimisation are later features; nothing here implements them.
- **Browser pagination is deliberately temporary.** Feature 6 replaces it with explicit pagination and a paper-size picker, because optimising page turns requires knowing the page height. Do not build a paper picker now.
- **Print output carries no editing state**: light theme always, no `noteColors`, no `activeTrackId`, no caret, no selection tint. Measure numbers stay — those are engraving.
- **`showTrackInfo` defaults to `true`**, so every existing caller is unaffected.
- **Do not commit or push.** `scripts/push_all.sh` does that. Leave every change in the working tree.
- After changing `music_lib`: `bun run build` there, copy `dist` into `music_app/node_modules/@sudobility/music_lib/`, then `rm -rf node_modules/.vite` in `music_app` or the browser serves a stale module.

---

## File Structure

| File                                                | Responsibility                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `music_lib/src/adapters/vexflow/types.ts`           | `RenderOptions.showTrackInfo?: boolean`.                                      |
| `music_lib/src/adapters/vexflow/layout.ts`          | Left margin drops `TRACK_INFO_WIDTH` when the gutter is off.                  |
| `music_lib/src/adapters/vexflow/canvas-renderer.ts` | Skip `drawTrackInfoGutter` when the gutter is off.                            |
| `music_app/src/features/print/print-layout.ts`      | **New.** Pure: the render options and per-system viewports a print run needs. |
| `music_app/src/features/print/PrintSystem.tsx`      | **New.** One system, one canvas.                                              |
| `music_app/src/features/print/PrintView.tsx`        | **New.** The route: scope picker, the pages, Print and Back.                  |
| `music_app/src/features/print/print.css`            | **New.** `@media print` rules, including `break-inside: avoid`.               |
| `music_app/src/app/router.tsx`                      | The `project/:id/print` route.                                                |
| `music_app/src/components/layout/AppLayout.tsx`     | "Print…" in the Export menu.                                                  |
| `music_app/e2e/print.spec.ts`                       | **New.** Print-media assertions.                                              |

---

### Task 1: `showTrackInfo` render option

**Files:**

- Modify: `~/projects/music_lib/src/adapters/vexflow/types.ts:46-62`
- Modify: `~/projects/music_lib/src/adapters/vexflow/layout.ts:168`
- Modify: `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.ts:153`
- Test: `~/projects/music_lib/src/adapters/vexflow/layout.test.ts`, `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `RenderOptions.showTrackInfo?: boolean` (default `true`). When `false`, `computeLayout`'s left margin is `LEFT_MARGIN` alone and `CanvasScoreRenderer.render` does not draw the gutter.

- [ ] **Step 1: Write the failing layout test**

Add to `~/projects/music_lib/src/adapters/vexflow/layout.test.ts`, matching the file's existing option-building style:

```ts
describe('showTrackInfo', () => {
  it('reserves the gutter column by default', () => {
    const score = twoTrackScore();
    const plan = computeLayout(score, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: LIGHT_RENDER_THEME,
    });
    expect(plan.systems[0].xLeft).toBeGreaterThanOrEqual(TRACK_INFO_WIDTH);
  });

  it('gives the gutter column back to the music when off', () => {
    // 220px is a fifth of a page; printing has no track names or mute buttons
    // to put there.
    const score = twoTrackScore();
    const withGutter = computeLayout(score, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: LIGHT_RENDER_THEME,
    });
    const without = computeLayout(score, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: LIGHT_RENDER_THEME,
      showTrackInfo: false,
    });

    expect(without.systems[0].xLeft).toBeLessThan(withGutter.systems[0].xLeft);
    expect(withGutter.systems[0].xLeft - without.systems[0].xLeft).toBe(TRACK_INFO_WIDTH);
  });

  it('fits more music per system without the gutter', () => {
    const score = twinkleScore();
    const withGutter = computeLayout(score, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: LIGHT_RENDER_THEME,
    });
    const without = computeLayout(score, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: LIGHT_RENDER_THEME,
      showTrackInfo: false,
    });
    expect(without.systems.length).toBeLessThanOrEqual(withGutter.systems.length);
  });
});
```

Check the imports at the top of that file and add whatever is missing (`TRACK_INFO_WIDTH`, `twoTrackScore`, `twinkleScore`, `LIGHT_RENDER_THEME` — the file already builds render options, so copy its existing theme constant rather than inventing one).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test layout`
Expected: FAIL — `showTrackInfo` is not a known option, so both plans are identical and the margins match.

- [ ] **Step 3: Add the option to the type**

In `~/projects/music_lib/src/adapters/vexflow/types.ts`, inside `RenderOptions`, above `theme`:

```ts
  /**
   * Whether to reserve and draw the left track-info gutter (name, instrument,
   * mute/solo). Default `true`.
   *
   * Off for print: paper has no buttons to press, and the 220px the gutter
   * reserves is a fifth of a page width that the music can use instead.
   */
  showTrackInfo?: boolean;
```

- [ ] **Step 4: Drop the reserved column in layout**

In `~/projects/music_lib/src/adapters/vexflow/layout.ts`, replace line 168:

```ts
const leftMargin = LEFT_MARGIN + TRACK_INFO_WIDTH;
```

with:

```ts
// The gutter's reserved column is part of the left margin, so turning the
// gutter off has to shrink the margin too — otherwise the space stays
// blank and the music is simply indented for no reason.
const showTrackInfo = options.showTrackInfo ?? true;
const leftMargin = LEFT_MARGIN + (showTrackInfo ? TRACK_INFO_WIDTH : 0);
```

- [ ] **Step 5: Run the layout tests**

Run: `cd ~/projects/music_lib && bun run test layout`
Expected: PASS. If `totalWidth <= width` regressions appear, they are real — the packing budget derives from `leftMargin`, and it must still hold with the smaller margin.

- [ ] **Step 6: Write the failing renderer test**

Add to `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.test.ts`, following the file's existing `createMock2DContext` setup:

```ts
describe('showTrackInfo', () => {
  /** Track names are drawn as text; the mock context records every fillText. */
  function drawnText(score: Score, showTrackInfo: boolean): string[] {
    const ctx = createMock2DContext();
    new CanvasScoreRenderer().render(score, ctx as unknown as CanvasRenderingContext2D, {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: LIGHT_RENDER_THEME,
      viewport: { top: 0, bottom: 5000 },
      showTrackInfo,
    });
    return ctx.calls.filter((c) => c.method === 'fillText').map((c) => String(c.args[0]));
  }

  it('draws the track name by default', () => {
    const score = twoTrackScore();
    expect(drawnText(score, true).join(' ')).toContain(score.tracks[0].name);
  });

  it('draws no track name when off', () => {
    // Mute and solo on paper would be the giveaway; the name is what proves
    // the whole gutter is gone.
    const score = twoTrackScore();
    expect(drawnText(score, false).join(' ')).not.toContain(score.tracks[0].name);
  });
});
```

`createMock2DContext`'s recorded-call shape may differ — read it in `~/projects/music_lib/src/adapters/vexflow/canvas-stub.ts` (or wherever `bun run test canvas-renderer` shows it imported from) and adapt `ctx.calls` to whatever it actually records. Do not weaken the assertion to "did not throw".

- [ ] **Step 7: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test canvas-renderer`
Expected: FAIL — the name is drawn in both cases.

- [ ] **Step 8: Skip the gutter when off**

In `~/projects/music_lib/src/adapters/vexflow/canvas-renderer.ts`, replace line 153:

```ts
this.drawTrackInfoGutter(plan, ctx, z, dpr, visibleSystems, options);
```

with:

```ts
// Last, so it overlays any content that scrolled underneath it — and not
// at all for print, where there is nothing to click.
if (options.showTrackInfo ?? true) {
  this.drawTrackInfoGutter(plan, ctx, z, dpr, visibleSystems, options);
}
```

- [ ] **Step 9: Verify the package**

Run: `cd ~/projects/music_lib && bun run verify`
Expected: PASS.

- [ ] **Step 10: Stage the build for `music_app`**

```bash
cd ~/projects/music_lib && bun run build
cp -r dist ~/projects/music_app/node_modules/@sudobility/music_lib/
rm -rf ~/projects/music_app/node_modules/.vite
```

---

### Task 2: Print layout maths

**Files:**

- Create: `~/projects/music_app/src/features/print/print-layout.ts`
- Create: `~/projects/music_app/src/features/print/print-layout.test.ts`

**Interfaces:**

- Consumes: `showTrackInfo` (Task 1).
- Produces:

```ts
export const PRINT_WIDTH = 1000;
export const PRINT_SCALE = 3;
export type PrintPage = { systemIndex: number; top: number; bottom: number; height: number };
export function printRenderOptions(trackIds: string[]): Omit<CanvasRenderOptions, 'viewport'>;
export function printSystems(plan: LayoutPlan): PrintPage[];
```

- [ ] **Step 1: Write the failing test**

Create `~/projects/music_app/src/features/print/print-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeLayout, twinkleScore } from '@sudobility/music_lib';
import { LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import {
  PRINT_SCALE,
  PRINT_WIDTH,
  printRenderOptions,
  printSystems,
} from '@/features/print/print-layout';

const plan = () =>
  computeLayout(twinkleScore(), {
    zoom: 1,
    layoutMode: 'page',
    width: PRINT_WIDTH,
    theme: LIGHT_RENDER_THEME,
    showTrackInfo: false,
  });

describe('printRenderOptions', () => {
  it('wraps to the page, never one long line', () => {
    // Continuous mode is one system as wide as the piece; on paper it would
    // print a single unreadable strip.
    expect(printRenderOptions([]).layoutMode).toBe('page');
  });

  it('carries no editing state', () => {
    // A printed page shows the music, not what happened to be selected.
    const options = printRenderOptions([]);
    expect(options.noteColors).toBeUndefined();
    expect(options.activeTrackId ?? null).toBeNull();
    expect(options.selectedMeasureIds).toBeUndefined();
  });

  it('always uses the light theme, whatever the app is set to', () => {
    expect(printRenderOptions([]).theme).toBe(LIGHT_RENDER_THEME);
  });

  it('suppresses the track gutter', () => {
    expect(printRenderOptions([]).showTrackInfo).toBe(false);
  });

  it('passes the track filter through', () => {
    expect(printRenderOptions(['t1']).trackIds).toEqual(['t1']);
  });
});

describe('printSystems', () => {
  it('returns one entry per system in the plan', () => {
    const p = plan();
    expect(printSystems(p)).toHaveLength(p.systems.length);
  });

  it('spans each system from its measure-number band to its bottom', () => {
    // gutterTop, not yTop: the measure numbers sit above the stave and would
    // be sliced off otherwise.
    const p = plan();
    const pages = printSystems(p);
    expect(pages[0].top).toBe(p.systems[0].gutterTop);
    expect(pages[0].bottom).toBe(p.systems[0].yBottom);
  });

  it('reports a positive height for every system', () => {
    for (const page of printSystems(plan())) {
      expect(page.height).toBeGreaterThan(0);
    }
  });

  it('keeps the systems in score order', () => {
    const pages = printSystems(plan());
    const tops = pages.map((p) => p.top);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  it('renders above screen resolution', () => {
    // ~300dpi once the browser scales it onto the page.
    expect(PRINT_SCALE).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test print-layout`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement it**

Create `~/projects/music_app/src/features/print/print-layout.ts`:

```ts
/**
 * The render options and per-system slices a print run needs.
 *
 * Pure over a layout plan — no DOM, no store — so the decisions about what
 * print is (page mode, light theme, no editing state, no gutter) are testable
 * without rendering anything.
 */
import { TRACK_INFO_WIDTH } from '@sudobility/music_lib';
import type { CanvasRenderOptions, LayoutPlan } from '@sudobility/music_lib';
import { LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';

/**
 * Logical width the score is laid out at.
 *
 * Not a paper width: each system canvas is displayed at `width: 100%`, so the
 * browser scales this to whatever the printer's page is. What this number
 * actually decides is how many measures fit on a line — wide enough to be
 * musical, narrow enough that the scaled-down result stays legible.
 */
export const PRINT_WIDTH = 1000;

/** Backing-store scale. Roughly 300dpi once scaled onto the page. */
export const PRINT_SCALE = 3;

export type PrintPage = {
  systemIndex: number;
  top: number;
  bottom: number;
  height: number;
};

/**
 * Render options for print: page mode, light theme, no gutter, no editing
 * state.
 *
 * Editing state is omitted rather than cleared — an absent `noteColors` is
 * how the renderer is told "everything is normal", and passing an empty map
 * would say the same thing less clearly.
 */
export function printRenderOptions(trackIds: string[]): Omit<CanvasRenderOptions, 'viewport'> {
  return {
    zoom: 1,
    layoutMode: 'page',
    width: PRINT_WIDTH,
    theme: LIGHT_RENDER_THEME,
    showTrackInfo: false,
    ...(trackIds.length > 0 ? { trackIds } : {}),
    devicePixelRatio: PRINT_SCALE,
  };
}

/**
 * One slice per system, each spanning its measure-number band to its bottom.
 *
 * `gutterTop` rather than `yTop`: the measure numbers are drawn above the
 * stave, and slicing at `yTop` would cut them off.
 */
export function printSystems(plan: LayoutPlan): PrintPage[] {
  return plan.systems.map((system, systemIndex) => ({
    systemIndex,
    top: system.gutterTop,
    bottom: system.yBottom,
    height: system.yBottom - system.gutterTop,
  }));
}
```

If `TRACK_INFO_WIDTH` turns out to be unused after writing this, remove the import — it is listed only because the width constant may be wanted for a margin.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test print-layout`
Expected: PASS.

---

### Task 3: One system, one canvas

**Files:**

- Create: `~/projects/music_app/src/features/print/PrintSystem.tsx`
- Create: `~/projects/music_app/src/features/print/PrintSystem.test.tsx`

**Interfaces:**

- Consumes: `PrintPage`, `printRenderOptions`, `PRINT_SCALE`, `PRINT_WIDTH` (Task 2).
- Produces: `<PrintSystem score={Score} page={PrintPage} trackIds={string[]} />`.

- [ ] **Step 1: Write the failing test**

Create `~/projects/music_app/src/features/print/PrintSystem.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { computeLayout, twinkleScore } from '@sudobility/music_lib';
import { LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import { PRINT_SCALE, PRINT_WIDTH, printSystems } from '@/features/print/print-layout';
import { PrintSystem } from '@/features/print/PrintSystem';

function firstPage() {
  const score = twinkleScore();
  const plan = computeLayout(score, {
    zoom: 1,
    layoutMode: 'page',
    width: PRINT_WIDTH,
    theme: LIGHT_RENDER_THEME,
    showTrackInfo: false,
  });
  return { score, page: printSystems(plan)[0] };
}

describe('PrintSystem', () => {
  it('renders one canvas', () => {
    const { score, page } = firstPage();
    const { container } = render(<PrintSystem score={score} page={page} trackIds={[]} />);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('sizes the backing store above screen resolution', () => {
    // The canvas is displayed at the page width but drawn much larger, or the
    // print comes out visibly pixelated.
    const { score, page } = firstPage();
    const { container } = render(<PrintSystem score={score} page={page} trackIds={[]} />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(Math.floor(PRINT_WIDTH * PRINT_SCALE));
    expect(canvas.height).toBe(Math.floor(page.height * PRINT_SCALE));
  });

  it('is a block that a page break may not fall inside', () => {
    // This is what puts breaks between systems rather than through one.
    const { score, page } = firstPage();
    const { container } = render(<PrintSystem score={score} page={page} trackIds={[]} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.breakInside).toBe('avoid');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test PrintSystem`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement it**

Create `~/projects/music_app/src/features/print/PrintSystem.tsx`:

```tsx
/**
 * One system of the score, drawn into its own canvas.
 *
 * One canvas per system is what makes page breaks fall between systems: each
 * is an indivisible block, so the browser fits as many whole ones per page as
 * the paper allows, whatever paper that is. No pagination arithmetic, and no
 * paper-size picker — until feature 6 needs to choose turns, at which point
 * this becomes a page's worth of systems instead.
 */
import { useEffect, useRef } from 'react';
import { CanvasScoreRenderer } from '@sudobility/music_lib';
import type { Score } from '@sudobility/music_types';
import { PRINT_SCALE, PRINT_WIDTH, printRenderOptions } from '@/features/print/print-layout';
import type { PrintPage } from '@/features/print/print-layout';

export type PrintSystemProps = {
  score: Score;
  page: PrintPage;
  trackIds: string[];
};

export function PrintSystem({ score, page, trackIds }: PrintSystemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = Math.floor(PRINT_WIDTH * PRINT_SCALE);
    canvas.height = Math.floor(page.height * PRINT_SCALE);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    new CanvasScoreRenderer().render(score, ctx, {
      ...printRenderOptions(trackIds),
      viewport: { top: page.top, bottom: page.bottom },
    });
  }, [score, page, trackIds]);

  return (
    <div
      data-testid={`print-system-${page.systemIndex}`}
      // Inline rather than a class: this is the rule the whole feature exists
      // to guarantee, and it should be visible at the element that carries it.
      style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test PrintSystem`
Expected: PASS. jsdom has no canvas, but `src/test/setup.ts` already stubs `HTMLCanvasElement.getContext` with music_lib's `createMock2DContext`, so the render call is exercised rather than skipped.

---

### Task 4: The print view

**Files:**

- Create: `~/projects/music_app/src/features/print/PrintView.tsx`
- Create: `~/projects/music_app/src/features/print/print.css`
- Create: `~/projects/music_app/src/features/print/PrintView.test.tsx`

**Interfaces:**

- Consumes: `printSystems`, `printRenderOptions`, `PRINT_WIDTH` (Task 2); `PrintSystem` (Task 3).
- Produces: `<PrintView store={EditorStoreApi} onBack={() => void} />`.

- [ ] **Step 1: Write the failing test**

Create `~/projects/music_app/src/features/print/PrintView.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  computeLayout,
  createAppStore,
  testStoreContext,
  twoTrackScore,
} from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import { PRINT_WIDTH } from '@/features/print/print-layout';
import { PrintView } from '@/features/print/PrintView';

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twoTrackScore());
  return store;
}

function systemCount(trackIds: string[] = []): number {
  return computeLayout(twoTrackScore(), {
    zoom: 1,
    layoutMode: 'page',
    width: PRINT_WIDTH,
    theme: LIGHT_RENDER_THEME,
    showTrackInfo: false,
    ...(trackIds.length > 0 ? { trackIds } : {}),
  }).systems.length;
}

describe('PrintView', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  it('renders every system of the score', () => {
    const store = makeStore();
    const { container } = render(<PrintView store={store} onBack={() => {}} />);
    expect(container.querySelectorAll('[data-testid^="print-system-"]')).toHaveLength(
      systemCount(),
    );
  });

  it('prints the whole score by default', () => {
    const store = makeStore();
    render(<PrintView store={store} onBack={() => {}} />);
    expect(screen.getByLabelText('What to print')).toHaveTextContent('Whole score');
  });

  it('warns about a single track, and only about a single track', async () => {
    // Until transposition and multi-measure rests land, a filtered track is a
    // lead sheet, not a part. Saying so is the honest thing.
    const user = userEvent.setup();
    const store = makeStore();
    render(<PrintView store={store} onBack={() => {}} />);

    expect(screen.queryByText(/not yet an orchestral part/i)).toBeNull();

    await user.click(screen.getByLabelText('What to print'));
    await user.click(screen.getByRole('option', { name: store.getState().score!.tracks[0].name }));

    expect(screen.getByText(/not yet an orchestral part/i)).toBeInTheDocument();
  });

  it('calls print when asked', () => {
    const store = makeStore();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<PrintView store={store} onBack={() => {}} />);

    screen.getByRole('button', { name: 'Print' }).click();

    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('goes back to the editor', () => {
    const store = makeStore();
    const onBack = vi.fn();
    render(<PrintView store={store} onBack={onBack} />);
    screen.getByRole('button', { name: 'Back to editor' }).click();
    expect(onBack).toHaveBeenCalled();
  });

  it('renders nothing but a message with no score', () => {
    const store = createAppStore({ context: testStoreContext() }) as EditorStoreApi;
    const { container } = render(<PrintView store={store} onBack={() => {}} />);
    expect(container.querySelectorAll('[data-testid^="print-system-"]')).toHaveLength(0);
    expect(screen.getByText(/nothing to print/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the print stylesheet**

Create `~/projects/music_app/src/features/print/print.css`:

```css
/*
 * Print rules for the print view.
 *
 * The view is a normal page on screen; these only apply when printing. The
 * browser owns pagination — each system is a block it may not break inside,
 * so it fits as many whole systems per page as the chosen paper allows.
 * Feature 6 replaces this with explicit pagination when page turns need to
 * land on rests.
 */
@media print {
  /* The chrome is for choosing what to print, not part of the printout. */
  .print-chrome {
    display: none !important;
  }

  .print-pages {
    margin: 0;
    padding: 0;
  }

  /* The rule the whole feature exists to guarantee. */
  .print-pages > * {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Let the printer's own margins apply, whatever paper it is. */
  @page {
    margin: 12mm;
  }
}
```

- [ ] **Step 4: Implement the view**

Create `~/projects/music_app/src/features/print/PrintView.tsx`:

```tsx
/**
 * The print view: the score laid out for paper, with the controls that pick
 * what goes on it.
 *
 * A route of its own rather than an overlay, because printing prints the whole
 * document — mounting only this is simpler than hiding the editor's chrome
 * with print rules.
 */
import { useMemo, useState } from 'react';
import { Button, Select, SelectContent, SelectItem, SelectTrigger } from '@sudobility/components';
import { computeLayout, selectVisibleTrackIds } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { PRINT_WIDTH, printRenderOptions, printSystems } from '@/features/print/print-layout';
import { PrintSystem } from '@/features/print/PrintSystem';
import '@/features/print/print.css';

export type PrintViewProps = {
  store: EditorStoreApi;
  onBack: () => void;
};

/** The sentinel for "everything", since a Select cannot carry an empty value. */
const WHOLE_SCORE = 'whole-score';

export function PrintView({ store, onBack }: PrintViewProps) {
  const score = store((s) => s.score);
  const visibleTrackIds = store(selectVisibleTrackIds);
  const [scope, setScope] = useState<string>(WHOLE_SCORE);

  const trackIds = scope === WHOLE_SCORE ? visibleTrackIds : [scope];
  const isSingleTrack = scope !== WHOLE_SCORE;

  const pages = useMemo(() => {
    if (!score) return [];
    return printSystems(
      computeLayout(score, { ...printRenderOptions(trackIds), width: PRINT_WIDTH }),
    );
  }, [score, trackIds]);

  const scopeLabel =
    scope === WHOLE_SCORE
      ? 'Whole score'
      : (score?.tracks.find((t) => t.id === scope)?.name ?? 'Whole score');

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="print-chrome flex flex-wrap items-center gap-3 border-b border-neutral-300 px-4 py-3">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger aria-label="What to print" className="h-auto w-auto px-3 py-1.5">
            <span>{scopeLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WHOLE_SCORE}>Whole score</SelectItem>
            {(score?.tracks ?? []).map((track) => (
              <SelectItem key={track.id} value={track.id}>
                {track.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button type="button" variant="primary" onClick={() => window.print()}>
          Print
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back to editor
        </Button>

        {isSingleTrack ? (
          <p className="w-full text-sm text-neutral-600">
            Single tracks print at concert pitch, with every bar of rest written out. Fine for a
            lead sheet or a piano part; not yet an orchestral part.
          </p>
        ) : null}
      </div>

      {score && pages.length > 0 ? (
        <div className="print-pages mx-auto max-w-[1000px] px-4 py-6">
          {pages.map((page) => (
            <PrintSystem key={page.systemIndex} score={score} page={page} trackIds={trackIds} />
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-neutral-600">There is nothing to print yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test PrintView`
Expected: PASS. If the Select will not open under `userEvent` in jsdom, check `src/test/setup.ts` — it already shims `hasPointerCapture` and `scrollIntoView` for exactly this.

---

### Task 5: Reaching it

**Files:**

- Modify: `~/projects/music_app/src/app/router.tsx:114`
- Modify: `~/projects/music_app/src/components/layout/AppLayout.tsx`
- Test: `~/projects/music_app/src/app/router.test.tsx`

**Interfaces:**

- Consumes: `PrintView` (Task 4).
- Produces: the route `/:lang/project/:id/print`, and a "Print…" item in the Export menu.

- [ ] **Step 1: Write the failing route test**

Add to `~/projects/music_app/src/app/router.test.tsx`, following how that file already renders the router at a path:

```tsx
it('renders the print view at project/:id/print', async () => {
  window.history.pushState({}, '', '/en/project/proj-1/print');
  renderRouter();
  expect(await screen.findByRole('button', { name: 'Print' })).toBeInTheDocument();
});
```

Match `renderRouter` to whatever the file's existing helper is called, and reuse its store and app-services setup.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test router`
Expected: FAIL — the path falls through to the catch-all redirect.

- [ ] **Step 3: Add the route**

In `~/projects/music_app/src/app/router.tsx`, below the existing project route at line 114:

```tsx
          <Route path="project/:id" element={<ProjectRoute store={store} />} />
          <Route path="project/:id/print" element={<PrintRoute store={store} />} />
```

and add the route component beside `ProjectRoute`:

```tsx
/**
 * The print view for an already-open project.
 *
 * Reuses `ProjectRoute`'s opening logic by simply requiring the project to be
 * open: you reach print from inside the editor, so it always is. Navigating
 * straight to the URL with nothing open shows the view's own empty state
 * rather than silently loading — one less path that can fail.
 */
function PrintRoute({ store }: { store: EditorStoreApi }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const lang = useCurrentLanguage();
  return <PrintView store={store} onBack={() => navigate(`/${lang}/project/${id ?? ''}`)} />;
}
```

Import `PrintView` from `@/features/print/PrintView`.

- [ ] **Step 4: Run the route test**

Run: `cd ~/projects/music_app && bun run test router`
Expected: PASS.

- [ ] **Step 5: Add the Export menu entry**

In `~/projects/music_app/src/components/layout/AppLayout.tsx`, in the export menu's `role="menu"` block, above the MIDI item:

```tsx
<Button
  type="button"
  variant="ghost"
  role="menuitem"
  onClick={() => {
    exportMenu.setOpen(false);
    onNavigate?.(`/project/${store.getState().projectId ?? ''}/print`);
  }}
  disabled={!score}
  className={MENU_ITEM_CLASS}
>
  Print…
</Button>
```

`onNavigate` is already language-prefixed by `router.tsx`'s `useLocalizedNavigate`, so the path here is language-relative.

- [ ] **Step 6: Verify**

Run: `cd ~/projects/music_app && bun run verify`
Expected: PASS.

---

### Task 6: Print-media end to end

**Files:**

- Create: `~/projects/music_app/e2e/print.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

**Why e2e:** a unit test cannot see print CSS. `break-inside: avoid` and the hidden chrome only exist under print media, and they are the whole feature.

- [ ] **Step 1: Write the spec**

Create `~/projects/music_app/e2e/print.spec.ts`:

```ts
/**
 * The print view under print media.
 *
 * Unit tests cannot see `@media print`, and the two things that matter here —
 * page breaks never falling through a system, and the chrome not appearing on
 * paper — exist only there.
 */
import { expect, test } from '@playwright/test';
import { createNewProject, generateWholeScore, gotoDashboard, waitForNotation } from './helpers';

test.describe('printing', () => {
  test('every system is a block a page break may not fall inside', async ({ page }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Print Check');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 16 });
    await waitForNotation(page);

    await page.getByLabel('Export menu').click();
    await page.getByRole('menuitem', { name: 'Print…' }).click();
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();

    const systems = page.locator('[data-testid^="print-system-"]');
    await expect(systems.first()).toBeVisible();
    const count = await systems.count();
    expect(count).toBeGreaterThan(1);

    await page.emulateMedia({ media: 'print' });

    // Every system, not just the first: one unbroken block is the guarantee.
    for (let i = 0; i < count; i++) {
      const value = await systems.nth(i).evaluate((el) => getComputedStyle(el).breakInside);
      expect(value, `system ${i}`).toBe('avoid');
    }
  });

  test('the chrome does not print', async ({ page }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Print Chrome');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 8 });
    await waitForNotation(page);

    await page.getByLabel('Export menu').click();
    await page.getByRole('menuitem', { name: 'Print…' }).click();

    const printButton = page.getByRole('button', { name: 'Print' });
    await expect(printButton).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    await expect(printButton).toBeHidden();
  });

  test('a single track prints fewer staves than the score', async ({ page }) => {
    await gotoDashboard(page);
    await createNewProject(page, 'Print Part');
    await generateWholeScore(page, { prompt: 'Create a calm piano study', measures: 8 });
    await waitForNotation(page);

    await page.getByLabel('Export menu').click();
    await page.getByRole('menuitem', { name: 'Print…' }).click();

    const scoreSystems = await page.locator('[data-testid^="print-system-"]').count();

    await page.getByLabel('What to print').click();
    await page.getByRole('option').nth(1).click();

    await expect(page.getByText(/not yet an orchestral part/i)).toBeVisible();
    // One track needs no more systems than the whole score does.
    const partSystems = await page.locator('[data-testid^="print-system-"]').count();
    expect(partSystems).toBeLessThanOrEqual(scoreSystems);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd ~/projects/music_app
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e print
```

Expected: PASS. Needs a local Postgres `music_test` DB and `../music_api`'s dependencies installed. If the browser reports a missing export from `@sudobility/music_lib`, the staged build is stale — redo Task 1's Step 10.

- [ ] **Step 3: Full suites**

```bash
cd ~/projects/music_lib && bun run verify
cd ~/projects/music_app && bun run verify
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
bun run test:e2e
```

Expected: all pass.

- [ ] **Step 4: Look at a printed page**

No automated test can tell you whether this is legible on paper. Open the print view, use the browser's print dialog to save a PDF at A4 and at Letter, and check: staves are not pixelated, no page break falls through a system, no mute/solo buttons appear, and the music is not indented by an empty gutter.

Report what you see. If the raster quality is poor, that is the signal for the SVG renderer discussed during design — do not raise `PRINT_SCALE` past 4 without measuring memory on a long score.

---

## Self-Review

**Spec coverage.** One canvas per system with `break-inside: avoid` → Tasks 2, 3. Browser pagination, no paper picker → Task 3's doc comment and `print.css`. `devicePixelRatio: 3` → Task 2. `showTrackInfo` suppressing the gutter and reclaiming the margin → Task 1. Light theme, no editing state → Task 2, asserted. Measure numbers kept → Task 2 slices from `gutterTop`, tested. Dedicated route reached from the Export menu → Task 5. Scope picker with the single-track caveat → Task 4. Testing table → Tasks 1-6, including the print-media e2e.

**Deliberate gaps, stated rather than hidden:**

- **`PRINT_WIDTH = 1000` is a judgement, not a derivation.** It decides measures-per-line; the browser scales it to any paper. If lines come out too dense on A4, this is the number to change, and Task 6 Step 4 is where that would be noticed.
- **No test asserts print resolution is _enough_.** `PRINT_SCALE >= 3` is checked, but whether 300dpi looks right on paper is the human check in Task 6 Step 4.
- **Features 2-6 are untouched**, as the spec states. The single-track caveat text is deleted by feature 3.

**Type consistency.** `PrintPage` has `systemIndex`/`top`/`bottom`/`height` in Tasks 2, 3 and 4 alike. `printRenderOptions(trackIds: string[])` returns `Omit<CanvasRenderOptions, 'viewport'>` and is called with a spread plus `viewport` in Task 3, plus `width` in Task 4. `showTrackInfo?: boolean` is the same name in `RenderOptions` (Task 1) and every caller. `PrintSystem` takes `score`/`page`/`trackIds` in Tasks 3 and 4.

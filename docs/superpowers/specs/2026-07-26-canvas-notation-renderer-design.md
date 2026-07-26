# Canvas Notation Renderer — Design

**Goal:** Replace the notation view's SVG rendering with a windowed canvas renderer so arbitrarily large scores render and scroll fast, with zero change in user-visible behavior (selection, highlights, caret, click-to-seek, zoom, themes).

**Why:** SVG builds one DOM node per glyph. Large scores (200+ measures) produce tens of thousands of nodes and a ~28,000px-tall SVG; browsers also cap canvas/SVG raster surfaces around 16,000px, so a single full-height surface cannot work at all past that. A viewport-sized canvas that draws only the visible window makes per-frame cost proportional to what's on screen, not to the score.

**Scale target:** Effectively unbounded. Hard rule: no per-frame or per-interaction work may be O(score); only O(visible) or O(log n) lookups. Whole-score work (layout) is a single cached O(n) pass, recomputed only when score/zoom/width/layout-mode change. Stress fixture: 10,000+ measures.

## Repos touched

- `music_lib` — new canvas renderer + layout lookups (published; app consumes via npm, so lib lands first).
- `music_app` — ScoreEditorView switches over; SVG interaction code replaced by geometric equivalents.
- Piano roll: untouched (already plain DOM).

## Architecture

### Scroll/DOM structure (music_app, ScoreEditorView)

```
<div scrollBox overflow-auto>              ← scrollbar owner (unchanged testid)
  <div sticky top-0 height-0 overflow-visible>  ← pins children to the viewport
    <canvas score />                       ← viewport-sized, notation glyphs
    <canvas overlay absolute inset-0 />    ← viewport-sized, highlights
  </div>
  <div spacer height=totalHeight*zoom>     ← provides scroll extent; no content
  <div caret />                            ← existing DOM caret, unchanged
</div>
```

(The sticky wrapper comes _before_ the spacer: a sticky element placed after
it would have its static position below the spacer and never pin to the top.)

Both canvases have CSS size = viewport, backing-store size = viewport × devicePixelRatio, and draw with `ctx.setTransform(zoom·dpr, 0, 0, zoom·dpr, 0, −scrollTop·dpr)` so all drawing stays in the layout's logical units. A ResizeObserver (already present for the culling fix) re-sizes the backing stores; scrolling redraws via the existing rAF-throttled scroll handler.

### CanvasScoreRenderer (music_lib/src/adapters/vexflow/canvas-renderer.ts)

`render(score, canvasCtx, { zoom, layoutMode, width, theme, viewport }) → CanvasRenderResult`

- Computes/reuses the cached `LayoutPlan` (unchanged `computeLayout`).
- Determines visible systems from `viewport` (`visibleSystemMeasureIndices`, unchanged).
- Draws ONLY those systems through VexFlow's CANVAS backend (staves, clefs/keys/times, notes, beams, ties), offset by each system's layout position.
- Records `idToBBox` (note/rest events) and `measureIdToBBox` for the drawn window — same map shapes the SVG renderer produces today, minus DOM elements. `RenderResult.idToElement` disappears; a `CanvasRenderResult` type replaces it.
- Theme colors come from the same literal `RenderTheme` (canvas fillStyle/strokeStyle).

The SVG renderer and `applyHighlights` (DOM style mutation) are deleted once the app has switched — full replacement, one code path.

### Highlight overlay (music_lib)

`paintHighlights(ctx, result, { selectedIds, playingIds, previewIds }, theme)` — clears the overlay and paints translucent rounded rects/tints over the recorded bboxes. Selection, playback active-notes, and preview highlights repaint only this overlay; the score canvas is untouched (preserves today's "highlight changes never re-render notation" property).

### Layout lookups (music_lib/src/adapters/vexflow/layout.ts)

- `systemAtY(plan, y)` — binary search over y-sorted systems.
- `measureAtX(system, plan, x)` — binary search over x-sorted measures.
- Existing `caretPositionForTick`/`tickForPoint` (currently app-side `playhead.ts`) switch their linear scans to these lookups; they move into music_lib alongside them (they are pure layout logic, per the architecture rule that non-UI logic lives in lib).

### Interactions (music_app)

All gestures keep exact current behavior, resolved geometrically instead of via SVG DOM ids:

- Click: point → note bbox hit (`idToBBox`) → select / shift-toggle; else measure hit (`measureAtX`/`systemAtY`) → select measure + seek; else in-system → seek; dead space → nothing. Preview guard unchanged.
- Drag-box select: unchanged (already bbox-based via `eventIdsInBox`).
- Caret + click-to-seek: unchanged behavior, backed by the lib-side helpers.
- Auto-scroll to playback measure: unchanged (`boxForMeasureIndex`).
- Accessibility: the interaction div keeps `role="application"`, aria labels, and keyboard shortcuts; no per-note DOM means no per-note tab stops (same as today — notes were never focusable).

## Error handling

- A draw failure for one system (corrupt measure) logs and skips that system, draws the rest; the store's validation panel already surfaces content errors. No silent full-canvas blanking.
- `devicePixelRatio`/zoom guards reuse `resolveZoom`; zero-sized viewport skips drawing (same contract as the current `clientHeight <= 0 → undefined` rule).

## Performance budgets (stress fixture: 10,000 measures, 2 tracks)

- Initial visible draw and scroll-frame redraw: O(visible systems); benchmarked < 8 ms/frame in the existing benchmark harness (music_lib `services/benchmark`).
- Layout pass: single O(n); measured and recorded in the benchmark, not asserted per-frame.
- Deferred (only if profiling shows need): incremental reflow from the first dirty system on edits.

## Testing

- **music_lib unit:** mock CanvasRenderingContext2D recording draw calls — asserts only visible systems draw, bbox maps cover exactly the drawn window, highlight painter paints expected rects, binary-search lookups round-trip with `computeLayout` output.
- **music_app component:** existing ScoreEditorView tests keep their store-level assertions; DOM-id click helpers (`noteGroup`) become bbox-coordinate click helpers. jsdom has no real canvas — the 2D context is stubbed in `src/test/setup.ts` (same spirit as the existing `getBBox` stub).
- **e2e:** notes are no longer DOM nodes. The app exposes a test/dev-only handle `window.__scoresmith` (current `CanvasRenderResult` bbox maps + layout plan + zoom/scroll) when `VITE_E2E=1`; e2e helpers resolve a note id → viewport coordinates → `page.mouse.click`. All 10 scenarios keep note-exact behavior. A screenshot smoke assertion guards "canvas actually painted pixels".

## Rollout

1. music_lib: add canvas renderer, highlight painter, lookups, moved playhead helpers, tests, benchmark entry → publish (minor bump via push_all.sh).
2. music_app: switch ScoreEditorView to spacer+canvas structure, geometric interactions, e2e handle + helper rewrite; delete SVG-specific code paths from the view.
3. music_lib: delete the SVG renderer + `applyHighlights` in the following bump once the app no longer imports them.

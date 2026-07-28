# Editor redesign: note coloring, caret-anchored selection, active track, split view

Date: 2026-07-27
Status: approved (design), pending implementation plan

Replaces the score editor's highlight-rectangle overlay with per-note coloring,
rebuilds the click model around a caret anchor, introduces an active track, and
shows notation and piano roll simultaneously instead of as alternate modes.

Repos touched: `music_lib` (renderer, store slices, playback controller) and
`music_app` (views, layout, interactions). No `music_types`, `music_client`, or
`music_api` changes — nothing here touches the score schema or the wire format.

## Goals

1. Notes carry their own state color. No highlight rectangles anywhere.
2. The caret is the anchor for both selection and playback start.
3. One track is always "active"; it is visually distinct and drives the piano roll.
4. Notation and piano roll are visible at the same time, not switched between.
5. During playback, the piano roll's keyboard lights up the active track's sounding pitches.

## Non-goals

- No score-schema change. Note provenance is not persisted.
- No change to the command/undo model, quantization, import/export, or generation
  request flow.
- The piano roll's own drag interactions (move/resize/velocity/voice-lane) and
  its command dispatch are unchanged. Only which tracks it displays, how notes
  are colored, and its placement in the layout change.
- The notation and piano roll scroll positions are **not** synchronized. They are
  separate scroll containers with separate horizontal offsets. Syncing them is a
  plausible follow-up but is out of scope here.

---

## 1. Color system

`RenderTheme` in `music_lib/src/adapters/vexflow/types.ts` is redefined around
semantic roles. The current fields (`foreground`, `selection`, `playback`,
`preview`) are replaced, not extended — `selection`/`playback`/`preview` exist
only to feed the overlay painter, which this design deletes.

```ts
export type NoteColorRole = 'normal' | 'selected' | 'regenerated' | 'playing';

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
  /** Playback caret (a DOM div in the app, but the value lives with the theme). */
  caret: string;
};
```

Concrete values live in `music_app/src/features/score-editor/ScoreEditorView.tsx`
as `LIGHT_RENDER_THEME` / `DARK_RENDER_THEME`, replacing the existing pair. They
stay literal color strings: VexFlow draws to canvas/SVG attributes, not CSS, so
custom properties do not work here (this constraint is already documented on the
existing constants and is unchanged).

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

These are starting values, each ≥4.5:1 against its mode's stave background
(white / `#121212`). They may be nudged during implementation if a contrast
check fails, but the role set and the light/dark pairing are fixed.

### Precedence

`playing > regenerated > selected > normal`.

Pressing play clears the selection, so `playing` and `selected` cannot normally
coexist. The ordering only resolves the edge case where the user selects notes
while playback is running; there, blue wins so playback stays followable.

### Non-color redundancy

The deleted overlay encoded state redundantly through stroke patterns (solid /
dashed / dotted) to satisfy spec §27 "do not rely on color alone". Color alone
now carries note state on the canvas. The redundant channel moves to the status
bar and the existing SR-only summary (`selectionSummaryLabel`), which already
announce selection count and are extended to announce the regenerated state.
This is a deliberate accessibility trade-off, recorded here so it is not
mistaken for an oversight.

### Breaking change

`RenderTheme`, `paintHighlights`, and `HighlightSets` are public exports of
`@sudobility/music_lib`. Removing/redefining them is a breaking change to a
published package. `music_app` is the only consumer, so this ships as a
coordinated version bump of both repos rather than a deprecation cycle.

---

## 2. Renderer

`music_lib/src/adapters/vexflow/canvas-renderer.ts`.

Today `render()` sets one global fill/stroke for the entire draw
(`vexCtx.setFillStyle(options.theme.foreground)`). Per-note color replaces that.

`CanvasRenderOptions` gains:

```ts
/** eventId -> color role. Absent ids render as 'normal'. */
noteColors?: ReadonlyMap<string, NoteColorRole>;
/** Track whose staves render in `staveActive`; null = none. */
activeTrackId?: string | null;
/** Measure ids whose gutter cell is tinted as selected (§5). */
selectedMeasureIds?: ReadonlySet<string>;
```

In `drawSystem`, before `voicesToDraw.forEach(v => v.draw(vexCtx))`:

- For each channel entry, resolve the highest-precedence role across
  `meta.eventIds` (a chord, or a duration-decomposed long note, maps to several
  event ids) and call `note.setStyle({ fillStyle, strokeStyle })`.
- For each `Stave`, call `setStyle({ strokeStyle })` with `staveActive` or
  `staveInactive` by track.

Two VexFlow behaviors must be verified during implementation rather than
assumed, because they determine whether extra styling calls are needed:

1. Whether `StaveNote.setStyle` reaches accidentals and augmentation dots, which
   are separate modifiers. If not, they are styled explicitly via
   `note.getModifiers()`.
2. Whether `Stave.setStyle` bleeds into the clef / key signature / time
   signature glyphs drawn by that stave. If it does, those are reset to
   `theme.foreground` so an inactive track's clef does not wash out.

### Performance

A color change now dirties the notation canvas, which the previous overlay
design avoided. This is acceptable and was measured against the existing
architecture, not assumed:

- The O(n) `computeLayout` pass is cached in `planFor()` keyed on
  score/zoom/layoutMode/width/trackIds. A color change invalidates none of
  those, so layout is not recomputed.
- A redraw is therefore only the visible window — the same work a scroll frame
  already performs at 60fps.
- `onActiveNotes` fires on note-on/note-off boundaries, not per frame. The 30Hz
  `onPositionTick` moves only the caret, which is a DOM div outside the canvas.

Redraw rate during playback is therefore a few times per second, not 30Hz.

### Measure-number gutter

`layout.ts` gains a `MEASURE_HEADER_HEIGHT` band above each system's top stave,
carved out of the existing `SYSTEM_GAP` (40px) so total height and system
positions do not change. `SystemLayout` exposes the band's `y` extent; per-measure
`x`/`width` come from the existing `MeasureLayout.box`.

The renderer draws the measure number in `theme.foreground`. The band is the hit
zone for measure selection (§5).

### Deletions

- `music_lib/src/adapters/vexflow/overlay.ts` and its test.
- `paintHighlights` / `HighlightSets` from the package root exports.
- The overlay canvas, `overlayCanvasRef`, and `drawOverlay` in `ScoreEditorView`.
  The component drops from two canvases to one.

---

## 3. Store

All three additions are UI state. Nothing here touches `Score`.

### `ui-slice`

```ts
activeTrackId: UUID | null;   // null = "not explicitly chosen"
setActiveTrack: (trackId: UUID | null) => void;
```

A `selectActiveTrackId(state)` selector in `store/selectors.ts` resolves the
effective value: the stored id if it still resolves against the current score,
otherwise the first track's id, otherwise `null` (no tracks). This handles both
"only one track, so it is active" and "the active track was deleted" without a
subscription or a reconciliation effect.

**Not persisted.** A track id is meaningful only within one project, so writing
it to device-level `PrefsStorage` would carry a dead id across projects. It
resets to "first track" on load, which is the specified default anyway. (The
piano roll's collapsed state *is* persisted — that is device preference, not
project state.)

Removed from `ui-slice`: `view: ViewMode` and `setView`. The `ViewMode` type
goes with them.

### `selection-slice`

```ts
/** True when the current selection is the direct product of an accepted
 *  regeneration. Cleared by `setSelection`; set only by `acceptCandidate`. */
selectionRegenerated: boolean;
```

`setSelection` clears it unconditionally. Because `toggleEvent`,
`selectMeasures`, `selectTrack`, and `clearSelection` all funnel through
`setSelection`, every selection change reverts brown to the normal selected
color with no further wiring.

### `generation-slice`

`acceptCandidate` (`generation-slice.ts:248`) currently sets `eventIds: []`
because "event ids never survive a splice". That reasoning applies to *old* ids;
the candidate fragment's *new* ids are known. It changes to:

- collect every event id from `candidate.fragment.tracks[].measures[].voices[].events[]`
- set `selection.eventIds` to those ids (measure remapping is unchanged)
- set `selectionRegenerated = true` in the same `set()` call

`normalizeSelection` still runs afterward and drops anything that does not
resolve, so a mapping miss degrades to "unselected" rather than a populated-but-
broken selection — the existing guarantee is preserved.

### Caret

No new state. The caret is `playback-slice.positionTick`, unchanged. This is what
makes "play from caret" require no plumbing: the engine resumes from the
transport position, and a caret seek is what set it.

---

## 4. Playback

`music_lib/src/services/playback/controller.ts`.

`togglePlay()` calls `clearSelection()` on the stopped/paused → playing
transition only. Not on pause, not on stop. Spacebar routes through the same
method (`useEditorShortcuts.ts:66`) and inherits the behavior.

Existing transport behavior is explicitly retained:

- **pause** leaves `positionTick` where it is; the caret stays put.
- **stop** resets `positionTick` to 0; the caret snaps to the score start.

No other controller change. `playPreview`/`stopPreview` and the
`handleScoreChange` reload machinery are untouched.

---

## 5. Click model

`ScoreEditorView.handleClick` (`ScoreEditorView.tsx:495`) is rewritten to this
table. "Caret" means `playbackController.seek(tick)`.

| Gesture | Caret | Selection | Active track |
| --- | --- | --- | --- |
| Click empty stave / barline | → clicked tick | cleared | → clicked track |
| Click a note | → note's `startTick` | that note only | → note's track |
| Cmd-click | unchanged | notes from caret tick → clicked tick, active track | unchanged |
| Cmd-shift-click | unchanged | same span, all tracks | unchanged |
| Click measure gutter | unchanged | that measure index, active track | unchanged |
| Cmd-shift-click measure gutter | unchanged | that measure index, all tracks | unchanged |
| Drag | unchanged | rubber band (as today), plus autoscroll (§6) | unchanged |

Three deliberate choices:

- **Plain click clears the selection.** This makes the caret the anchor for the
  next cmd-click range.
- **Cmd-click does not move the caret.** This lets the user extend the same
  range repeatedly from one anchor.
- **Cmd-click with the caret never moved** ranges from tick 0, since
  `positionTick` starts at 0. No special case; that is the caret's real position.

A measure gutter cell spans one measure *index* across the whole system. Because
measure ids are per-track, "that measure index, active track" resolves to
`activeTrack.measures[index].id`, and the cmd-shift variant collects that index's
measure id from every track.

**Selected-measure feedback.** Measure selection previously had no visual (the
old overlay painted only `selection.eventIds`). Now that it is a first-class
gesture with its own hit zone, a selected measure tints its gutter cell in
`noteSelected` (or `noteRegenerated` when `selectionRegenerated` is set). Without
this the gesture gives no confirmation it landed.

Existing behavior removed: clicking a stave no longer selects that measure. That
gesture moves to the measure gutter, preserving the regeneration workflow
("select measures 3 and 4").

The preview guard is retained verbatim: while `previewFragment` is set, every
canvas click is ignored, because on-screen ids may belong to the spliced-in
candidate rather than the committed score.

### Range selection

A new pure function in `features/score-editor/hit-test.ts` (or a sibling
`range-select.ts`):

```ts
export function noteIdsInTickRange(
  score: Score,
  fromTick: number,
  toTick: number,
  trackIds: UUID[],
): UUID[];
```

Selects notes whose `startTick` falls in `[min(from,to), max(from,to))` —
half-open, so a note starting exactly at the range end is excluded.

The resulting selection sets **both** `eventIds` and `range`. The explicit
`range` matters: regenerating a span of empty measures must still work, and
`selectionToRange` cannot derive a span from an empty `eventIds` list.

`selectionToRange` already snaps any range outward to full-measure boundaries on
every implicated track, so regeneration receives the same tick span it does
today.

---

## 6. Drag autoscroll

In `ScoreEditorView.handlePointerMove`: when the pointer is within
`AUTOSCROLL_EDGE_PX` (~48) of the scroll box edge, a `requestAnimationFrame`
loop scrolls the box at a rate proportional to the overshoot distance, capped at
a maximum px/frame. The loop stops on pointerup, pointercancel, and unmount.

Axis is chosen by layout mode:

- `continuous` → horizontal only
- `page` → vertical only

The drag box is already tracked in content coordinates
(`pointFromEvent` adds `scrollLeft`/`scrollTop`), so it keeps extending
correctly as the view scrolls. The existing `onScroll` → `draw()` path repaints
the newly-exposed window; no new redraw wiring is needed.

Scope: notation view only. The piano roll's drag has a separate handler and was
not part of this request.

---

## 7. Layout

`AppLayout.tsx`. The piano roll becomes a **full-width** sibling of
`TransportBar` in the root flex column, below the three-pane row:

```
[ header / app bar ]
[ track panel | center column (toolbar + ScoreEditorView) | inspector ]   flex-1, min-h-0
[ PianoRollView ]        full width, shrink-0, fixed height, collapsible
[ TransportBar ]
[ status bar ]
```

- Fixed height (`PIANO_ROLL_PANEL_HEIGHT`, ~280px). Not resizable.
- Collapsible via a chevron in the piano-roll toolbar. Collapsed renders the
  toolbar strip only, so the expand control never disappears.
- Collapsed state persists through `PrefsStorage`.
- Horizontally scrollable across the full score range. Its own scroll container,
  independent of the notation's (see Non-goals).

`ScoreEditorView` keeps `flex-1 min-h-0` inside the center column and continues
to own its own vertical scroll.

Removed:

- The `Editor view` toggle group from `EditorToolbar.tsx:410` and
  `PianoRollToolbar.tsx:328`.
- `PianoRollToolbar`'s **Track filter** control. `visibleTrackIds` now derives
  from `selectActiveTrackId`, so a manual filter would fight it.

---

## 8. Piano roll

- Shows the **active track only**. `visibleTrackIds` becomes
  `new Set([activeTrackId])` derived from the store instead of the current local
  `useState` (`PianoRollView.tsx:229`).
- Note colors follow the same four roles as notation. With one track displayed,
  `trackColor()` no longer carries information and is dropped for note fills;
  it may remain for the track label.
- Playback key highlighting: `activeNoteIds` → `findEvent` → keep only events on
  the active track → `pitchToMidi` → a `Set<number>` of sounding pitches.
  Keyboard rows whose midi is in that set paint `notePlaying`.

This lives in its own subcomponent subscribing to `activeNoteIds` alone,
following the existing `PlaybackCursor` pattern (`PianoRollView.tsx:124`).
Without that isolation, every note boundary would re-render the memoized
note and grid layers, defeating the virtualization those layers exist for.

---

## 9. Track panel

`TrackPanel` rows set the active track on click and render an active marker.

This is an addition beyond the literal request, included because the piano roll
now shows only the active track: without it, changing tracks requires locating
that track's stave in the notation and clicking it. Row click currently calls
`selectTrack`; it will call both `selectTrack` and `setActiveTrack`.

---

## 10. Testing

Following the repos' existing convention — pure logic unit-tested directly,
components tested against a real store via `createAppStore()`.

**New pure-function tests**
- `noteIdsInTickRange`: half-open boundary, reversed from/to, multi-track scope,
  empty span.
- Color-role resolution: precedence ordering, multi-event-id notes (chords,
  decomposed long notes).
- Autoscroll: axis selection by layout mode, rate curve, no scroll outside the
  edge band.
- `selectActiveTrackId`: null → first track, stale id → first track, no tracks → null.

**Renderer tests** (`canvas-renderer.test.ts`)
- `setStyle` called with the expected color per role.
- Stave stroke differs between active and inactive tracks.
- Measure-number gutter geometry stays within the reclaimed `SYSTEM_GAP` and
  `totalHeight` is unchanged.
- A selected measure's gutter cell is tinted; an unselected one is not.

**Component tests**
- One test per row of the §5 gesture table, asserting caret / selection /
  active-track outcome against a real store.
- Play clears the selection; pause and stop do not.
- Pause keeps `positionTick`; stop resets it to 0.
- `acceptCandidate` selects the fragment's new event ids and sets
  `selectionRegenerated`; the next `setSelection` clears it.
- Piano roll renders only the active track; keyboard highlights only the active
  track's sounding pitches.
- Collapse toggles the panel and persists.

**Removed tests**
- `overlay.test.ts` in `music_lib`.
- View-toggle tests in `EditorToolbar.test.tsx` and `PianoRollToolbar.test.tsx`.
- Track-filter tests in `PianoRollToolbar.test.tsx`.
- Every `paintHighlights` assertion in `ScoreEditorView.test.tsx`.

**E2E** (`music_app/e2e/`)
- The `window.__scoresmith` handle still resolves ids to coordinates from the
  live render result, unchanged.
- Specs asserting the notation/piano-roll mode switch are rewritten for the
  simultaneous layout.

Both repos must pass `bun run verify` (typecheck + lint + test + build).

## Sequencing

`music_lib` changes land first and are published, since `music_app` consumes the
new `RenderTheme` and renderer options. Within `music_lib`: theme/renderer,
then store slices, then the playback controller. Within `music_app`: renderer
wiring, then the click model, then the layout, then the piano roll.

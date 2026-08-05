# Track info in the canvas; track editing beside the keyboard

Date: 2026-07-29
Status: approved

Moves read-only track information into the notation canvas as a left gutter
drawn with the staves, and moves the track editing controls to a panel beside
the piano keyboard, keyed off the active track.

Supersedes §4 of
[2026-07-29-instruments-and-track-alignment-design.md](./2026-07-29-instruments-and-track-alignment-design.md)
— the DOM track panel and the geometry channel that fed it are both deleted.

Repos touched: `music_lib` (layout reserve, gutter drawing) and `music_app`
(hit test, editing panel, layout, deletions). No `music_types` change.

## Why

Aligning a DOM list to the staves needed a reported-geometry channel, imperative
row positioning, and a second scroll container that had to be prevented from
scrolling. It shipped twice with the same class of bug: the panel kept its own
`overflow`, so it scrolled independently of the sheet it was mirroring — once on
the wrapping column, then again on the component's own root.

Drawing the info in the canvas removes the problem rather than managing it. The
gutter is in the same coordinate space as the staves, so alignment is
structural: there is nothing to synchronise and no second scroller to contain.

It also gains the engraved-score behaviour of labelling every system, because
the gutter repeats per system for free.

## Goals

1. Every stave has its track's name, instrument and mute/solo state beside it.
2. Alignment cannot drift, because there is no separate coordinate space.
3. Editing controls are available for the active track, beside the keyboard that
   already depends on the active track.
4. The gutter and the editing panel share one width.

## Non-goals

- The gutter is **read-only** apart from selection. No inline rename, no
  controls drawn on the canvas.
- No per-system abbreviation ("Piano" then "Pno."). Every system shows the same
  text.
- No reordering tracks by dragging the gutter.
- No `music_types` change; no new store state.

---

## 1. Reserving the gutter (`music_lib/src/adapters/vexflow/layout.ts`)

```ts
/**
 * Width reserved at the left of every system for the track-info gutter, and
 * the width the app's track editing panel matches.
 */
export const TRACK_INFO_WIDTH = 220;
```

`computeLayout`'s `leftMargin` becomes `LEFT_MARGIN + TRACK_INFO_WIDTH`. Every
stave shifts right by that much and the space is reserved by construction —
no other layout maths changes, and `totalWidth` grows accordingly since it is
derived from the system extent.

## 2. Drawing the gutter (`music_lib/src/adapters/vexflow/canvas-renderer.ts`)

For each visible system, for each track, in the band `[stave.y, stave.y +
stave.height]`:

- the track's `name`, in the primary weight;
- its `instrumentName` below, smaller;
- `M` when `muted`, `S` when `solo`.

**No new render option.** `Track` already carries `name`, `instrumentName`,
`muted` and `solo`, and `plan.trackLayouts[i].track` is the live track, so the
renderer reads them directly. `options.activeTrackId` (already present, added
for stave colouring) selects `theme.staveActive` for that track's text and
`theme.staveInactive` for the rest.

### 2.1 Viewport pinning

The gutter is drawn **pinned to the viewport's left edge**, not at content x=0.

This is required, not cosmetic. In continuous mode the score is one very wide
system scrolled horizontally; a gutter drawn in content space would slide out of
view, which is the one thing a permanent label column cannot do. The renderer
already applies a `-viewportLeft` horizontal offset to the draw transform, so the
gutter pass re-applies the transform with the horizontal offset zeroed, keeping
the vertical scroll.

It draws an opaque `theme` background first, so staves scrolling underneath do
not show through.

Consequence recorded for the hit test (§3): the gutter's position is fixed in
**viewport** coordinates while everything else the renderer draws is fixed in
**content** coordinates. This is the only place the two differ.

## 3. Selecting a track from the gutter (`music_app`)

New pure module `src/features/score-editor/track-gutter.ts`:

```ts
/** The track whose gutter cell contains `point`, or `null`. Viewport coordinates, because the gutter is viewport-pinned (§2.1). */
export function trackIdAtGutterPoint(
  plan: LayoutPlan,
  zoom: number,
  scrollTop: number,
  point: { x: number; y: number },
): string | null;
```

Returns `null` when `point.x` is outside `[0, TRACK_INFO_WIDTH * zoom]`.
Otherwise it walks every system's tracks — not just the topmost, since the
gutter repeats — and returns the track whose band contains `point.y`.

`ScoreEditorView.handleClick` consults it before the measure-gutter and
note/stave branches, since the track gutter sits left of all of them. A hit sets
the active track and selects it (`setActiveTrack` + `selectTrack`), and does
**not** move the caret: the gutter is not part of the timeline.

The handler's existing `point` is relative to the interaction container, which
spans the full scrollable content — so it is in content coordinates and cannot
be used here. The gutter branch computes its own viewport-relative point from
the scroll box instead:

```ts
const boxRect = scrollBoxRef.current.getBoundingClientRect();
const viewportPoint = { x: event.clientX - boxRect.left, y: event.clientY - boxRect.top };
```

That difference is the whole reason §2.1 is called out; getting it wrong would
put the hit region in the right place only at scroll position zero.

## 4. Track editing panel (`music_app`)

New `src/features/tracks/TrackEditorPanel.tsx`, `TRACK_INFO_WIDTH` wide, to the
left of the keyboard inside the existing bottom panel:

```
┌──────────────────┬────────────────────────────────┐
│ Piano        + ✕ │ 🎹 Acoustic Grand Piano     ▾  │
│ 🎹 Ac. Grand  ▾  ├────────────────────────────────┤
│ treble        ▾  │ ▌█▌█▌ ▌█▌█▌█▌ ▌█▌█▌ ▌█▌█▌█▌   │
│ M  S             │ │ │ │ │ │ │ │ │ │ │ │ │ │ │   │
│ Vol ▬▬▬▬▬○▬▬     │ C2      C3      C4      C5     │
│ Pan ▬▬▬○▬▬▬▬     │                                │
└──────────────────┴────────────────────────────────┘
```

It edits the **active track** only: name, instrument (icon + family-grouped
`Select`), clef, mute/solo, volume, pan — every control the deleted `TrackPanel`
had, minus the per-track repetition. Plus `+` to add a track and `✕` to delete
the active one.

All mutations route through `changeTrackPropsCommand` / `addTrackCommand` /
`deleteTrackCommand` exactly as before, so they stay undoable. Delete keeps the
existing `ConfirmDialog`.

With no score, the panel renders an empty state rather than nothing, so the
bottom row keeps its shape.

### 4.1 Panel height

The bottom panel goes from 150px to **190px**. Those controls do not fit in 150
at 220px wide, and the keyboard benefits from slightly taller keys.

The editing panel may scroll internally when a short window squeezes it. That
was _wrong_ for the old track list, which had to mirror the sheet; this panel
mirrors nothing, so an internal scrollbar costs nothing.

## 5. Deletions

- `src/components/layout/TrackPanel.tsx` and its test.
- `src/features/score-editor/stave-layout.ts` and its test.
- `src/features/score-editor/stave-layout-channel.ts` and its test.
- `ScoreEditorView`'s `staveLayout` prop and `reportStaveLayout`, and the
  `reportStaveLayout()` call in the scroll frame.
- `AppLayout`'s left track-panel column, its `trackPanelOpen` state and the
  "Toggle track panel" button — there is no left column left to toggle.

The `overflow-auto` bug on `TrackPanel`'s root is not patched separately; it
goes with the component.

## 6. Testing

**`music_lib`**

- `layout.test.ts`: `leftMargin` includes `TRACK_INFO_WIDTH`; the first stave's
  `box.x` shifts by exactly that; `totalWidth` grows accordingly.
- `canvas-renderer.test.ts`: the name, instrument, and `M`/`S` are drawn for
  every visible system × track; the active track's text uses
  `theme.staveActive` and others `staveInactive`; a background rect is filled
  behind the gutter; under a horizontal viewport offset the gutter's drawn x
  stays at the viewport edge while stave content moves.

**`music_app`**

- `track-gutter.test.ts`: hits inside a band return that track; x beyond the
  gutter returns `null`; bands in the _second_ system resolve (the repeat case);
  zoom scales the hit region; an empty plan returns `null`.
- `ScoreEditorView.test.tsx`: a gutter click sets the active track and selects
  it, and does not seek.
- `TrackEditorPanel.test.tsx`: shows the active track; follows an active-track
  change; edits name/instrument/clef/mute/solo/volume/pan through commands;
  add and delete work; renders an empty state with no score.
- `AppLayout.test.tsx`: no left track column; the editing panel sits beside the
  keyboard.
- e2e: the old track-panel assertions are replaced by a gutter click making a
  track active and the editing panel following.

Both repos must pass `bun run verify`; `music_app` must also pass
`bun run test:e2e`.

## 7. Sequencing

`music_lib` (§1–2) lands and publishes first; `music_app` (§3–5) follows in one
pass, since deleting `TrackPanel` and adding `TrackEditorPanel` cannot be split
without leaving the app without track controls.

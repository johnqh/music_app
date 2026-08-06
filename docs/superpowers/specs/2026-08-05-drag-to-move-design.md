# Drag to move notes

**Status:** draft 2026-08-05
**Goal:** drag selected notes to another time, another track, or both — a cut and paste you can do with the mouse.

## The gesture

**Option/Alt + drag.**

Plain drag is spoken for twice over: on the one selected note it is a pitch drag, and anywhere else it is a box select. Option is free, and because the modifier states the intent outright, Option+press works on **any** note and selects it if it was not selected already. Pitch-drag's deliberate "must be selected first" rule exists to keep an ordinary drag across the staff a box select; an explicit modifier has no such problem.

```
drag            → pitch (up/down, same staff)
Option + drag   → move  (any track, any tick)
drag on empty   → box select
```

Nothing existing changes.

## What moves

**The whole selection, together.** The note under the pointer at press is the **anchor**; every other selected note keeps its tick offset from the anchor, so a phrase keeps its shape.

## Where it lands

- **Time** — `tickForPoint` at the drop, snapped to the toolbar's snap grid. The same function the caret already uses, so a note lands exactly where a click would put the caret. `deltaTicks = snappedTarget − anchor.startTick`, applied to every dragged note.
- **Track** — every dragged note lands on the track under the pointer. For a single-track drag that is simply "move it there"; for a selection spanning tracks it merges them onto the target, which is what dragging them all onto the cello means.
- **Pitch** — unchanged. **Vertical movement means _which track_, never _what pitch_.** A note dragged from flute to cello sounds identical; you are reassigning who plays it, not rewriting the music. This is what keeps the gesture cleanly separate from pitch-drag.
- **Voice** — the note's own voice index, clamped to the voices the target track has.

A consequence worth stating plainly: a target track with a different clef **draws the note in a different place while it sounds the same**. Correct, and surprising exactly once.

## Collisions

**A drop obeys the toolbar's edit mode**, like every other write — the piano keyboard, the duration buttons, paste:

```
replace → dropped notes clear the span they land on
stack   → dropped notes join what is there
insert  → existing music ripples later to make room
```

To keep the whole gesture **one undo step**, the collision rule is a parameter of the domain command rather than something the app composes from several dispatches. `insertChordAtCaret` dispatches separately today and so costs several undo steps; a drag must not, any more than a pitch drag does. The domain already has precedent for encoding a collision strategy as a command — `insertWithRippleCommand`.

The command therefore takes `collision: 'stack' | 'replace' | 'ripple'`, a pure strategy enum with no store dependency; the app maps `EditMode` onto it.

## Feedback while dragging

**A drop indicator: the target staff highlighted, and a caret at the snapped destination tick.**

```
Flute   ──●──────────   (source, unchanged)

Cello   ░░░░░░░│░░░░░   ← staff highlighted
               ↑          caret at snapped tick
```

Not a live preview of the notes. Splicing notes into another track's measures changes those measures' contents and forces a full relayout — the per-frame cost the playback work was built to avoid. Pitch-drag can afford its preview because it only redraws when the step count changes; a move cannot. The indicator redraws only when the target track or tick changes, and it names the two things that actually decide the outcome.

## What already exists

`moveNotesCommand(eventIds, { deltaTicks, deltaSemitones })` already relocates notes **within** a track, including tie cleanup on partners left behind, re-homing notes into their destination measure, and clamping at the end of the track. It survived the piano-roll removal and is still tested. This feature needs the **cross-track** case and the gesture; the within-track path should reuse that machinery rather than grow a parallel one.

Edge autoscroll during the drag reuses `autoscroll.ts`, as box-select already does.

`trackIdAtGutterPoint` does the y-band search that maps a point to a track, but it is x-constrained to the gutter and works in **viewport** coordinates — the one deliberate exception in the editor, because the gutter is pinned to the viewport. The drop needs the same search in **content** coordinates and unconstrained in x, so it is a sibling in `hit-test.ts`, not a change to that function.

## Testing

- A note dragged within its track lands on the snapped tick, keeping its pitch.
- A note dragged to another track keeps its **sounding pitch** and changes track — the central claim.
- A multi-note selection keeps its internal tick offsets.
- A selection spanning tracks all lands on the target track.
- Each edit mode does what it says at the destination: `replace` clears the span, `stack` joins, `insert` ripples.
- **The whole gesture is one undo step**, and undo restores both the source and the destination.
- Ties to notes left behind are cleaned up (already true of `moveNotesCommand`; pinned so the cross-track path cannot lose it).
- A drop past the end of the track clamps rather than vanishing.
- Option+press on an unselected note selects it and drags it.
- A plain drag on a selected note is still a pitch drag, and a plain drag on empty staff is still a box select — the two regressions this feature could cause.
- **e2e** — drag a note from one track to another; it sounds the same and belongs to the other track.

## Out of scope

- **Copy on drag** (Option+Shift). A small addition on top of the move machinery, deliberately deferred.
- **Dragging rests.** Only notes.
- **Reordering the tracks themselves.**
- **Dragging across a system boundary by dropping outside the viewport** beyond what edge autoscroll already gives.
- **Changing pitch and position in one gesture.** Pitch is pitch-drag's job; this moves _when_ and _who_.

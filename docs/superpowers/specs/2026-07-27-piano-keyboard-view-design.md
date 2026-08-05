# Piano keyboard view

Date: 2026-07-27
Status: approved

Replaces the piano-roll timeline in the bottom panel with a picture of a piano
keyboard whose keys light up as the active track plays, so a musician can watch
which keys to press and learn the piece.

Supersedes the piano-roll half of
[2026-07-27-editor-redesign-design.md](./2026-07-27-editor-redesign-design.md).
Everything that spec says about notation — note coloring, the caret-anchored
click model, the measure gutter, the active track — is unchanged.

Repo touched: `music_app` only. No `music_lib` change: the keyboard reads
`activeNoteIds` and `selectActiveTrackId`, both of which already exist.

## Goals

1. The bottom panel shows a real piano keyboard: 88 keys, white and black, in
   their true physical arrangement.
2. During playback, the keys the active track is sounding light up.
3. Key positions are stable, so a shape learned here transfers to a real piano.

## Non-goals

- **Not interactive.** Clicking a key does not play a note or enter one. This is
  a read-only practice aid; the notation view remains the editor.
- No fingering, hand assignment, or chord naming.
- No sustain-pedal or dynamics indication.
- Nothing lights when playback is stopped or paused (see §3).
- **No special handling for non-pitched tracks.** If the active track is a
  percussion kit, its MIDI numbers light the corresponding keys, which is
  musically meaningless but harmless. Choosing which track to watch is the
  user's; special-casing clef types is not worth the branch.

## 1. Geometry

New pure module `src/features/piano-keyboard/keyboard-geometry.ts`. No React, no
store — the key layout is arithmetic and is unit-tested directly.

The piano roll modelled pitch as one uniform row per semitone. A real keyboard
cannot: white keys tile edge to edge and black keys straddle the boundary
_between_ two whites, overlapping both.

```
 ┌─┬─┬─┬─┬─┬─┬─┐
 │ │█│ │█│ │ │█│      white: x = whiteIndex * w
 │ └┬┘ └┬┘ │ └┬┘      black: x = (whiteIndex + 1) * w - bw / 2
 │C │D │E │F │G │
 └──┴──┴──┴──┴──┘
```

```ts
/** A0 — the lowest key on a standard 88-key piano. */
export const KEYBOARD_MIN_MIDI = 21;
/** C8 — the highest. */
export const KEYBOARD_MAX_MIDI = 108;
/** 88 keys span 52 whites; the blacks overlay them and add no width. */
export const WHITE_KEY_COUNT = 52;

/**
 * Below this the keys stop shrinking and the keyboard scrolls horizontally
 * instead — 52 × 14 = 728px, so any window narrower than that scrolls.
 */
export const MIN_WHITE_KEY_WIDTH = 14;

/** Black keys, as a fraction of a white key. */
export const BLACK_KEY_WIDTH_RATIO = 0.6;
export const BLACK_KEY_HEIGHT_RATIO = 0.62;

export type PianoKey = {
  midi: number;
  isBlack: boolean;
  /** Left edge in px, from the keyboard's own origin. */
  x: number;
  width: number;
  height: number;
  /** Set on each C only (`C4`), so octaves are locatable without labelling all 88. */
  label: string | null;
};

/** True for the five black keys per octave (pitch classes 1, 3, 6, 8, 10). */
export function isBlackKey(midi: number): boolean;

/** A midi number as a pitch string, e.g. `C4`, `F#3` — sharp spelling, since a keyboard has no key signature to spell against. */
export function noteLabel(midi: number): string;

/** Total width of the keyboard at a given white-key width. */
export function keyboardWidth(whiteKeyWidth: number): number;

/**
 * Every key in draw order: all 52 whites first, then the 36 blacks, so a
 * caller can render the array straight through and have the blacks land on
 * top without any z-index bookkeeping.
 */
export function computeKeys(whiteKeyWidth: number, whiteKeyHeight: number): PianoKey[];
```

`isBlackKey` and `noteLabel` move here verbatim from the deleted
`piano-roll/geometry.ts`; they are unchanged.

## 2. Rendering

`src/features/piano-keyboard/PianoKeyboardView.tsx`.

Absolutely-positioned divs, not canvas. 88 elements is trivial to lay out, gives
every key a `data-testid` for free, and matches the piano roll's precedent — the
canvas renderer exists for notation because VexFlow needs it, not as a house
style.

Layout:

```
┌────────────────────────────────────────────────┐
│ Piano — Treble                              ▾  │  header strip
├────────────────────────────────────────────────┤
│ ▌█▌█▌ ▌█▌█▌█▌ ▌█▌█▌ ▌█▌█▌█▌ ▌█▌█▌ ▌█▌█▌█▌ ▌   │  88 keys
│ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │   │
│ C1      C2      C3      C4      C5      C6     │
└────────────────────────────────────────────────┘
```

The header names the track being shown — without it there is no way to tell
which hand is on screen, since the keyboard itself carries no track identity.
It also holds the collapse chevron, which previously lived on the piano-roll
toolbar.

Both key dimensions are derived from the panel's measured box, via the same
`ResizeObserver` pattern the notation view uses for `viewWidth`:

- `whiteKeyWidth = max(MIN_WHITE_KEY_WIDTH, measuredWidth / 52)` — keys stretch
  to fill, and below the floor the keyboard keeps its 728px width and the
  container scrolls horizontally instead of shrinking past readability.
- `whiteKeyHeight = panelHeight − headerHeight − labelGutter`, so the keys fill
  whatever vertical room the panel has. There is no vertical scrolling.

With no score loaded, or no resolvable active track, all 88 keys render unlit.
That is the empty state; there is no separate placeholder.

## 3. Lighting

Reuses `playingPitchesForTrack(score, activeNoteIds, trackId)` unchanged (it
moves from `piano-roll/` to `piano-keyboard/`), which resolves `activeNoteIds`
to MIDI numbers and filters to the active track.

A lit key is `theme.notePlaying` from the shared `render-theme.ts`, so the
keyboard, the notation and the score agree on what "sounding" looks like.

**Gated on `playbackState === 'playing'`.** This is required, not cosmetic: the
Tone engine clears active notes on `stop()` but _not_ on `pause()`, so without
the gate a pause would leave whatever was mid-chord stuck lit indefinitely.

**Non-color cue** (spec §27, matching the treatment the notation and the score
already use): a lit key renders _pressed_ — translated 2px down and given an
inset shadow, and marked `data-playing="true"` for tests. That is the
physically correct metaphor for a struck key, it survives grayscale, and it
means lighting is never carried by hue alone.

The component subscribes to `activeNoteIds` at its own top level. Unlike the
piano roll there is no memoized note grid to protect, so no inner isolation
component is needed; a note boundary re-renders 88 cheap divs.

## 4. Layout

`AppLayout` swaps `PianoRollView` for `PianoKeyboardView` in the existing
full-width bottom panel. `PIANO_ROLL_PANEL_HEIGHT` (280) becomes
`PIANO_KEYBOARD_PANEL_HEIGHT` (150) — a keyboard needs far less room than a
timeline.

That reclaims ~130px for the notation, which matters: on a 720px window the
score pane had been squeezed to 96px, small enough that a measure two systems
down needed scrolling to reach.

The collapsible panel and its persisted collapsed flag are unchanged.

## 5. Removing the piano roll

`src/features/piano-roll/` is deleted, not left unmounted: nothing can reach it
once `AppLayout` stops importing it, and ~2,000 lines of unreachable code with
its own test suite is worse than a git revert away. `AppLayout` is the only
file outside the folder that imports from it (verified).

Deleted: `PianoRollView`, `PianoRollToolbar`, `geometry.ts`,
`interactions.ts`, `render-counters.ts`, and their tests. `playing-pitches.ts`
and its test move to `piano-keyboard/`. `isBlackKey`/`noteLabel` move into
`keyboard-geometry.ts`.

### What this costs, checked rather than assumed

Still available elsewhere:

| Capability                                       | Now reached via                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Quantize                                         | `EditorToolbar` (has its own grid select)                                       |
| Velocity                                         | `InspectorPanel`'s Velocity field                                               |
| Loop from selection                              | the transport's Loop button (`toggleLoop` uses the selection when there is one) |
| Delete / transpose / duration / accidental / tie | notation toolbar and keyboard shortcuts                                         |

Genuinely lost:

- **Dragging a note to move or resize it.** Transposition survives via arrow
  keys and duration via the toolbar, but there is no longer any mouse gesture
  that changes a note's _start tick_. `moveNotesCommand` and
  `resizeNotesCommand` keep working; nothing in the UI calls them.
- **Voice reassignment.** The voice-lane strip was the only surface for
  `changeVoiceCommand`.

Both are recorded here so their absence reads as a decision rather than a
regression. Re-exposing them on the notation view is a plausible follow-up.

## 6. Testing

**`keyboard-geometry.test.ts`** (pure):

- exactly 88 keys, 52 white and 36 black;
- the whites, taken in array order, tile left to right with no gap and no
  overlap and ascend in midi;
- each black key straddles the boundary between its neighbouring whites;
- blacks are narrower and shorter than whites;
- `keyboardWidth` is `52 × w` and independent of the blacks;
- a label appears on every C and nowhere else;
- the first key is A0 and the last is C8.

**`PianoKeyboardView.test.tsx`** (real store):

- renders 88 keys;
- a sounding note on the active track lights its key, and the key reports itself
  as pressed for the non-color cue;
- a sounding note on a _different_ track lights nothing;
- pausing goes dark while `activeNoteIds` is still populated — the regression
  the `playbackState` gate exists to prevent;
- stopped shows nothing;
- the header names the active track and follows it when it changes;
- collapsed renders the header only, so the expand control survives.

**`playing-pitches.test.ts`** moves across unchanged.

**e2e**: `piano-roll-editing.spec.ts` is deleted with the capability it covered.
`acceptance.spec.ts`'s piano-roll drag section (spec §39 items 16–19) is
replaced by asserting the keyboard is present and lights during playback.
`caret-selection.spec.ts`'s split-view assertions retarget the keyboard panel.

Both repos must pass `bun run verify`; `music_app` must also pass
`bun run test:e2e`.

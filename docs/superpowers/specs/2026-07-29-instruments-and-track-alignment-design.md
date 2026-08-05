# Instruments and track/stave alignment

Date: 2026-07-29
Status: approved

Two independent features, specified together and built in four phases:

1. The full General MIDI instrument set, with icons and a real picker.
2. The left-hand track list aligned to the staves it describes.

Repos touched: `music_lib` (catalogue, synth mapping) and `music_app` (picker,
icons, keyboard header, alignment). **No `music_types` change** — see §1.

## Goals

1. Any of the 128 General MIDI programs can be chosen for a track.
2. An icon identifies a track's instrument at a glance.
3. The piano keyboard names the active track's instrument.
4. A track's row in the left list lines up with that track's stave on the sheet.

## Non-goals

- **No instruments outside General MIDI.** An earlier draft allowed instruments
  with no GM equivalent, which would have required `midiProgram` to become
  nullable in `music_types` and a lossy-export path. Dropped: everything is one
  of the 128.
- **No MIDI export warning.** It only existed to cover non-GM instruments.
  Every track is now representable in MIDI, so a confirm dialog would never
  fire, and an unreachable code path is worse than none.
- No per-instrument sample libraries. Playback keeps synthesising through
  Tone.js; the catalogue selects a synth _category_, not a sampled voice.
- The generation panel keeps its curated six-instrument checklist (§2.3).

---

## 1. GM catalogue (`music_lib`)

New pure module `src/domain/instruments/gm.ts`. No Tone, no React — a data
table plus lookups.

```ts
export type GmFamily =
  | 'piano'
  | 'chromatic-percussion'
  | 'organ'
  | 'guitar'
  | 'bass'
  | 'strings'
  | 'ensemble'
  | 'brass'
  | 'reed'
  | 'pipe'
  | 'synth-lead'
  | 'synth-pad'
  | 'synth-effects'
  | 'ethnic'
  | 'percussive'
  | 'sound-effects';

export type GmInstrument = {
  /** 0-127, matching `Track.midiProgram`. */
  program: number;
  /** The General MIDI name, e.g. "Acoustic Grand Piano". */
  name: string;
  family: GmFamily;
};

/** All 128, in program order. */
export const GM_INSTRUMENTS: readonly GmInstrument[];
/** Display labels, e.g. `'synth-lead' -> 'Synth Lead'`. */
export const GM_FAMILY_LABELS: Record<GmFamily, string>;
/** `null` for a program outside 0-127. */
export function gmInstrument(program: number): GmInstrument | null;
/** The family a program belongs to; General MIDI groups its 128 programs into 16 families of 8, so this is arithmetic. */
export function gmFamilyOf(program: number): GmFamily;
/** Programs of one family, in program order — what the picker groups by. */
export function gmInstrumentsByFamily(family: GmFamily): readonly GmInstrument[];
```

Because families are contiguous runs of eight, `gmFamilyOf` is
`FAMILIES[Math.floor(program / 8)]` and the table stores only names. A program
outside 0–127 returns `null` rather than throwing: `Track.midiProgram` is
schema-validated to 0–127, so this is defence against a hand-edited score, not
an expected path.

### 1.1 Synth mapping — and what 128 instruments will actually sound like

This needs stating plainly, because it is the gap between what the feature
looks like and what it does.

`adapters/tone/instruments.ts` already maps GM programs to synth voices
(`categoryForProgram`). But there are only six voices —
`piano | electric-piano | strings | bass | synth-lead | drum-kit` — and the
mapping only distinguishes five program ranges. Its own comment is explicit:
everything else, _"organ, guitar, brass, reed, pipe, ensemble, sound
effects…"_, falls back to `'piano'` because "there is no dedicated voice for
those families yet".

Left alone, that means a user can pick Trumpet from the new catalogue and hear
a piano. The catalogue makes the gap visible where today it is hidden behind a
six-item list that happened to cover the voices that exist.

Phase 1 therefore does two things:

1. **Completes the mapping.** Every one of the 16 families maps to its nearest
   existing voice rather than defaulting to piano — guitar and ethnic to a
   plucked-ish voice, brass/reed/pipe to the sustained one, synth pad/effects
   to `synth-lead`, and so on. Choosing the nearest of six is honest; silently
   choosing piano for 122 of 128 is not.
2. **Records the ceiling.** Six voices cannot represent sixteen families. Real
   per-family timbres are a separate piece of work (§1.2), deliberately not
   folded in here.

Percussion continues to key off `clef === 'percussion'` rather than a program,
which is how General MIDI treats channel 10.

Behaviour change for existing scores: a track resolves by program where it
previously resolved by free-text name. For the six instruments the app shipped
before, both routes give the same category, so nothing audible changes; the
other 122 stop being pianos and become their nearest voice.

### 1.2 Out of scope: real per-family voices

Making a trumpet sound like a trumpet means designing new Tone.js voices —
roughly ten more, each with its own oscillator/envelope/filter shape — and that
is a synth-design project, not a catalogue one. It is called out here so the
limitation is a recorded decision rather than a surprise, and so it can be
picked up on its own terms later.

---

## 2. Picker and icons (`music_app`)

### 2.1 Icons

New module `src/features/instruments/instrument-icon.tsx`.

```ts
/** The emoji for a program: a hand-picked glyph for the common instruments, else the family's. */
export function instrumentEmoji(program: number): string;
export function InstrumentIcon(props: { program: number; className?: string }): JSX.Element;
```

**Emoji, not an SVG set.** This app's chrome is already emoji throughout —
`◀◀ ▶ ■ 💾 ↶ ↷ 🌓 ⚙ ✕ ▴ ▾` — so a bespoke SVG set would be the _inconsistent_
choice, and ~36 hand-drawn instrument glyphs is an illustration project with
ongoing upkeep for a label-sized affordance. Recorded here because it is a
deliberate trade, not an oversight: emoji render differently across platforms
and cannot be recoloured to the theme.

Hand-picked glyphs cover the instruments people actually reach for — acoustic
and electric piano, organ, acoustic and electric guitar, acoustic and electric
bass, violin, cello, harp, trumpet, trombone, sax, flute, clarinet, and the
drum kit. Every other program falls back to its family's glyph, so all 128 have
an icon. `instrument-icon.tsx` is the source of truth for the exact set.

The icon is decorative — it always sits beside the instrument's name — so it is
`aria-hidden`, and screen readers get the name rather than an emoji reading.

### 2.2 Track picker

`TrackPanel` replaces its read-only instrument line with an icon plus a
`Select` whose 16 groups are the GM families. Changing it dispatches the
existing `changeTrackPropsCommand` with the new `midiProgram` **and** the GM
`name` as `instrumentName`, keeping the two fields consistent — today they can
drift, since the name is free text.

128 grouped options is browsable. Filtering is deliberately not built until the
grouped list proves annoying in use.

### 2.3 Generation panel

Unchanged. Its checklist is "which instruments should the AI write for", where
a curated six is the useful question; 128 checkboxes is not. Any track's
instrument can be changed afterwards in the track panel.

---

## 3. Keyboard header (`music_app`)

`PianoKeyboardView`'s header shows the active track's icon and instrument name
instead of the literal "Piano" — it already resolves the active track for the
name, so this reads `midiProgram` from the same track.

Falls back to the track's `name` when the program has no catalogue entry, and
to plain "Keyboard" when there is no score.

---

## 4. Track rows aligned to staves (`music_app`)

### 4.1 The problem

In page mode the score wraps into systems, so each track's stave appears
several times down the page. A single vertical list on the left cannot align
with all of them. It follows the **topmost visible system**, so rows always
line up with the staves currently in view and re-lay out as that system
changes.

### 4.2 Contract

`ScoreEditorView` already holds the `LayoutPlan` and its scroll position, so it
is the only thing that can compute this. It gains one optional callback:

```ts
/** Stave rects for the topmost visible system, in viewport client coordinates. */
onStaveLayout?: (rects: readonly StaveRect[]) => void;
export type StaveRect = { trackId: UUID; top: number; height: number };
```

Client coordinates rather than content coordinates, because the consumer is a
_sibling column_ with its own origin and its own top offset (the editor toolbar
sits above the staves but not above the track panel). Each side converts
against its own bounding box and neither needs to know the other's layout.

`AppLayout` holds the latest rects in state and passes them to `TrackPanel`.
No store field: this is view geometry, not domain state, and the store's rule
is that view-layer geometry stays out of it.

A new pure helper carries the maths:

```ts
// src/features/score-editor/stave-layout.ts
export function staveRectsForViewport(
  plan: LayoutPlan,
  zoom: number,
  scrollTop: number,
  boxTop: number,
): StaveRect[];
```

It picks the first system whose bottom is below the viewport top, then returns
each track's stave box scaled by zoom and offset into client coordinates.

### 4.3 Rendering

`TrackPanel` stops scrolling on its own and becomes a positioned mirror of one
system: each row is absolutely placed at its rect's `top` (relative to the
panel's own box) with exactly that `height`.

Rows clip their content (`overflow: hidden`). At 100% zoom a stave is 100px,
which fits the name, instrument, clef and mute/solo comfortably; the volume and
pan sliders may be cut off, and at 50% zoom more is.

Hover, and the **active track**, lift the row above its neighbours — `z-index`
plus `height: auto` — so the hidden controls become reachable. That one row
stops matching its stave while lifted; every other row keeps its alignment, and
the lifted row snaps back the moment focus leaves. An internal scrollbar was
the alternative and is unusable in a 50px row.

When no rects have been reported yet — no score, or before first layout — the
panel falls back to today's plain stacked rows. That is also what the existing
tests exercise.

### 4.4 Update rate

Reported from the existing rAF-throttled scroll handler and whenever the layout
plan changes. Nothing new runs per frame, and nothing here subscribes to
`positionTick`; the playback-performance rules in `CLAUDE.md` continue to hold.

---

## 5. Testing

**Phase 1** — `gm.test.ts`: exactly 128 entries in program order; every family
has exactly 8; `gmFamilyOf` agrees with `GM_INSTRUMENTS[n].family` for all 128;
known anchors (program 0 = Acoustic Grand Piano, 40 = Violin, 56 = Trumpet,
127 = Gunshot); out-of-range returns `null`.
`instruments.test.ts` gains: each family maps to a synth category; percussion
still keys off the clef; an unknown program falls back rather than throwing.

**Phase 2** — `instrument-icon.test.ts`: every program 0–127 yields a non-empty
glyph; hand-picked programs yield their specific glyph; an unmapped program
yields its family's. `TrackPanel.test.tsx`: the picker lists all 128 grouped by
family, and choosing one dispatches a command setting both `midiProgram` and
`instrumentName`.

**Phase 3** — `PianoKeyboardView.test.tsx`: the header shows the active track's
instrument, follows a track change, and falls back with no score.

**Phase 4** — `stave-layout.test.ts`: picks the topmost visible system, scales
by zoom, offsets into client coordinates, returns one rect per track, and
returns empty for an empty plan. `TrackPanel.test.tsx`: rows adopt the reported
top/height, and fall back to stacked rows when nothing is reported.

Both repos must pass `bun run verify`; `music_app` must also pass
`bun run test:e2e`.

## 6. Sequencing

Phase 1 lands in `music_lib` and publishes before Phase 2 consumes it. Phases 2
and 3 are `music_app` only and ship together. Phase 4 is independent of 1–3 and
last, so the row layout is built around final row content.

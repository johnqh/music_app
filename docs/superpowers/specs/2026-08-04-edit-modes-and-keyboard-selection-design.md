# Edit modes, and the keyboard as a selection editor

**Status:** approved 2026-08-04
**Goal:** give note entry an explicit mode — insert, replace, or stack — and make the piano keyboard the way to add and remove notes from a selected chord.

## Why

Two complaints, one root cause: there is exactly one way to write a note, and it silently overwrites whatever was there.

- **Nothing says what happens to existing music.** Writing at an occupied tick sometimes stacks (same duration) and sometimes deletes (different duration), and nothing on screen distinguishes the two. The behaviour is real and defensible; the absence of a choice is not.
- **A chord cannot be selected or edited.** Every note of a chord shares one VexFlow `StaveNote`, and `canvas-renderer.ts` maps _every_ event id in that glyph to the _same_ bounding box. `eventIdAtPoint` returns whichever comes last in map iteration order — so clicking a chord yields an arbitrary member, and no click can select a specific note or the whole chord. Noteheads in a chord genuinely overlap, so making them individually clickable is not the fix.

## Edit mode

`ui-slice.chordMode: boolean` becomes:

```ts
export type EditMode = 'insert' | 'replace' | 'stack';
```

defaulting to `replace`, which is what the editor does today. The toolbar's chord toggle becomes a three-way segmented control, and the mode governs **everything that writes notes** — piano keys, Insert Note, Insert Rest, and paste — so the same button never means two things.

Mode decides what happens to content that is already at the caret:

| Mode      | Writing at a tick that already has notes                                                   |
| --------- | ------------------------------------------------------------------------------------------ |
| `insert`  | Notes in the **active track** at or after the caret shift later by the new note's duration |
| `replace` | The new note wins the span; what was there is overwritten                                  |
| `stack`   | The new note joins what is there as a chord                                                |

**Mode does not decide whether one gesture makes a chord.** Keys held down together are one chord in every mode, because that is what playing them means. `stack` is about _successive_ gestures joining what is already at the tick — a different question from simultaneity, and conflating them would make it impossible to play a chord in insert mode.

**`stack` is unavailable on monophonic instruments.** The option disables, with the instrument named, rather than being selectable and then refusing every edit. This reuses `gmMaxPolyphony`; the per-edit block stays as the backstop, since the active track can change while a mode is set.

## Ripple insert

A new `insertWithRippleCommand` in `music_lib` — it is score math, so it does not belong in the app. `moveNotesCommand({ deltaTicks })` already exists as the primitive; the new command collects every note in the active track at or after the caret, shifts them by the inserted duration, then writes the new note.

Two consequences follow from "active track only", and both are deliberate:

- **Parts desynchronise on purpose.** After a ripple insert the edited part sits a beat later than the others. That is what inserting into one part means, and it is the reason to have the mode at all — but it is also the most surprising thing in this design, so the mode indicator stays visible in the toolbar while `insert` is active rather than being a state you can forget you are in.
- **Overflow grows every track.** Measures are per-track, but `computeLayout` assumes all tracks share a measure grid — measure width is taken as the maximum density across tracks at each index. When shifted content runs past the final barline, `appendMeasure` extends _all_ tracks. Growing only the edited track would misalign every barline beneath it.

Content shifted past the end is never dropped. Silently discarding music is the failure this codebase has already removed elsewhere, and reintroducing it for convenience would be a regression.

## The keyboard as a selection editor

The keyboard's job follows what was last touched:

| State                   | A key press does                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Nothing selected        | Sounds the note and writes it at the caret (today's behaviour, under the current edit mode)                      |
| A single chord selected | Toggles that pitch in the chord: a lit key removes its note, an unlit key adds one at the same tick and duration |

`Esc` clears the selection and returns the keyboard to entry.

**Pitch editing engages only when the selection is a single chord** — every selected note sharing one start tick. A selection spanning several ticks has no one chord to edit, so the keyboard stays in entry mode. This is a visible, explainable line rather than a guess about intent, and it means the rule can be stated in one sentence in the UI.

Removing the last note of a chord deletes it outright; there is no empty chord. Adding a pitch respects `gmMaxPolyphony`, with the same refusal message as entry.

**Keys need a second lit state.** Selected pitches and currently-sounding pitches can be lit at the same time and mean different things, so they must not share a colour. The render themes already carry the vocabulary for this (`noteSelected` beside `notePlaying`); the keyboard should use the same pair, so a colour means the same thing on the staff and on the keys.

## Clicking a chord selects the chord

`eventIdAtPoint` returns one id. It gains a sibling — `eventIdsAtPoint` — returning every id sharing the hit box, and a plain click selects all of them. That makes "select the chord" a click, and makes adding or removing its individual notes the keyboard's job.

This is the piece that makes the feature reachable on a touchscreen, where hitting one notehead of a stacked triad is not a realistic gesture.

## What this does not change

- **Simultaneity grouping.** Keys held together still become one chord, in every mode.
- **Drag to change pitch.** Unchanged, and still requires exactly one selected note.
- **The caret.** Still the anchor for entry; ripple insert shifts content around it rather than moving it.

## Testing

- `music_lib` — `insertWithRippleCommand`: shifts only the active track; grows every track when content passes the last barline; never drops content; leaves other tracks' measure count equal to the edited one (the aligned-grid invariant).
- `music_lib` — `editMode` state, and that `stack` is reported unavailable for a monophonic program.
- `music_app` — mode dispatch for all three modes from both the keyboard and the toolbar; the single-chord rule for keyboard editing (engages for one chord, does not for a multi-tick selection); add/remove/last-note-removal; the polyphony refusal.
- `music_app` — `eventIdsAtPoint` returns every id in a shared box, and a chord click selects all of them.
- **e2e** — one per mode, plus select-a-chord-then-toggle-a-key. The previous round proved this is not optional: with `playbackController` mocked, a unit test cannot tell a chord from an arpeggio, because the caret never moves.

## Out of scope

- **Dotted notes and tuplets.** Still unwritable; a separate gap found in the same review.
- **Add / remove measure UI.** The commands exist and nothing calls them, except as ripple overflow now will.
- **A second voice.** Insert stays on `voiceIndex: 0`.
- **Per-instrument polyphony beyond GM.** The curated table is the model; nothing reads a real instrument definition.

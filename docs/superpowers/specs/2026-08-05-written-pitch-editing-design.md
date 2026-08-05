# Printing, part 7: written-pitch editing

**Status:** draft 2026-08-05
**Goal:** let a clarinet part be written and edited as the clarinet reads it, without changing what the score stores or what it sounds like.

Feature 7 of seven, and the last. Features 1 to 6 have shipped.

## The problem

The model stores **sounding** pitch, and everything downstream depends on that: playback, MIDI export, and any comparison between tracks. Feature 2 made _printing_ a part convert to written pitch, so a clarinettist's printed part reads correctly.

The editor never did. Writing a clarinet line means typing the concert pitches and trusting the printout — you cannot see what the player will read while you are writing it. That is backwards for anyone writing for transposing instruments.

## What this is, and what it is not

**A display and input transformation at the boundary. Not a model change.** The store keeps sounding pitch, always. A toggle — `Concert pitch` / `Written pitch`, the same control Sibelius and Dorico have — changes what the notation view draws and how an entered pitch is interpreted.

## The measurement that decides the architecture

Transposition here is **pitch-exact and spelling-lossy**. Over 1323 combinations of pitch, key and transposition, converting sounding → written → sounding:

|                                          |              |
| ---------------------------------------- | ------------ |
| changed the sounding pitch               | **0**        |
| changed only the spelling (C♯ became D♭) | **567**      |
| naturals affected at all                 | **0 of 343** |

So the rule is not a matter of taste:

> **Display transforms one way. Input transforms the other way, once, at the moment of entry. Stored data is never round-tripped.**

Deriving the written score for display is safe. Converting a pitch the user just entered is safe. Taking a stored note _through_ the display and back would preserve every pitch and quietly churn 40% of the accidental spellings — a deliberately spelled C♯ becoming D♭ the first time somebody toggles the view twice.

The honest consequence, stated rather than hidden: **entering an accidental in written mode may store the other spelling of the same pitch.** `transposePitch` respells into the sounding key, which is the right rule for the stored score, but it means the note you see after entry can be spelled differently from the one you picked. It will always sound identical.

## Where the transformation goes

Two functions in `music_lib`, both built on the `transposeMeasure` that `extractPart` already uses — extracted so there is one transposition in the codebase rather than two that can drift:

```ts
/** `score` with every track written as its own player reads it. */
export function writtenScore(score: Score): Score;

/** The sounding pitch that a player reading `written` on `midiProgram` produces. */
export function soundingPitch(
  written: Pitch,
  midiProgram: number,
  soundingKey: KeySignature,
): Pitch;
```

`writtenScore` is the whole-score sibling of `extractPart`'s per-track transposition: each track moves by its own `gmWrittenTransposition`, with its own key signature, so a mixed ensemble shows every staff as its player reads it.

## What needs no conversion at all

**Anything expressed in staff positions.** Diatonic transposition preserves staff position by construction, so dragging a note up two positions, or nudging it with the arrow keys, means the same thing in either representation — the edit applies to the stored sounding pitch unchanged. Pitch-drag, which is already diatonic (`shiftDiatonic`), needs nothing.

Only **absolute** pitch entry needs the inverse: a note placed by clicking a staff line, or typed as a letter name.

**Ids survive the transformation** — the derived score keeps every event and measure id, exactly as `extractPart` does — so the caret, the selection, and hit-testing all work against the displayed score with no mapping layer.

## Scope

**In:** the notation view, the inspector's pitch readout, and absolute pitch entry on the staff.

**Out, deliberately:**

- **The piano keyboard.** It is an instrument, not notation: you press a key and that pitch sounds. Making it read as a transposing instrument would mean pressing C and hearing B♭, which is true of a clarinet and false of the thing on screen. A note entered from the keyboard lands at the pitch that sounded, and the staff draws it written — which is exactly the relationship a clarinettist has with a piano.
- **Playback and MIDI export.** Sounding, always. The toggle is a lens on notation, and routing it into either would make a trumpet play a tone sharp.
- **Printing.** Feature 2 already decided this and decided it correctly: parts print written, the score prints concert. The editor toggle does not change either — a printed part does not depend on how you happened to be viewing it.
- **Preserving the user's chosen enharmonic spelling across the toggle.** See the measurement above. Doing this properly means storing the written spelling alongside the sounding pitch, which is a model change and a feature of its own.
- **A per-track display mode.** One toggle for the view.

## State

`pitchDisplay: 'concert' | 'written'` on the UI slice, persisted with the other device preferences (theme, zoom, snap) — it describes how this person likes to work, and it means the same thing in every project, unlike `activeTrackId`.

Default `concert`, so nothing changes for anyone who does not ask for it.

## Performance

The derived score must be memoized on the stored score and the mode. `computeLayout` is cached by score identity, so producing a fresh derived object per render would defeat that cache and re-format every VexFlow object on every frame — the exact cost the playback work was careful to avoid.

A non-transposing score must be **the same object**, not a copy: `writtenScore` returns its input unchanged when no track transposes, so the common case cannot regress at all.

## Testing

- `writtenScore` moves each track by its own interval, moves the key signature with it, and returns the _identical object_ when nothing transposes.
- **Sounding pitch survives written → sounding for every pitch, key and transposition** — the measurement above, pinned as a regression test, including the count of spellings that do change so a future change to `transposePitch` cannot quietly make it worse.
- A note entered in written mode is stored at its sounding pitch.
- Toggling the display never modifies the store.
- The caret and selection survive a toggle.
- Playback, MIDI export and both print modes are unaffected by the toggle.
- Toggling does not recompute the layout more than once.
- **e2e** — with a clarinet track, the toggle moves the notation a tone and leaves playback where it was.

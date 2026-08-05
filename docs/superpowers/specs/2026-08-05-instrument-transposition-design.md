# Printing, part 2: instrument transposition

**Status:** approved 2026-08-05
**Goal:** print a part in the pitch its player reads, not the pitch it sounds.

Feature 2 of seven. Feature 1 (the print view) shipped in `music_app@0.2.1`.

## Why

Hand a clarinettist a part written at concert pitch and every note is wrong by a tone. That is not a rendering nicety — it is the difference between a part a player can use and one they cannot. Transposing instruments are the majority of a wind section.

Print today says so on screen: _"Single tracks print at concert pitch…"_. This feature deletes half that sentence.

## What transposition is here

Two things move together, and both are needed or the part is unreadable:

**Pitches.** Written pitch = sounding pitch + a per-instrument interval. A B♭ trumpet reads a tone above what it sounds, so concert C is written D.

**The key signature.** A part in concert C major is written in D major for a B♭ instrument. Without this the part is full of accidentals where a key signature belongs.

The fifths shift for `s` semitones is `(s × 7) mod 12`, folded into −6…+6. Verified against the standard cases rather than trusted: +2 semitones → +2 fifths (C→D, two sharps); +7 → +1 (C→G); +9 → +3 (C→A); +3 → −3 (C→E♭, three flats); +12 → 0, because an octave does not change key.

**Order matters.** The key is transposed first, then each pitch is respelled _in the new key_ — `transposePitch(p, semitones, transposedKey)` already does this. Respelling against the original key would print a B♭ clarinet part in D major spelling G♭ where F♯ belongs.

## The table

`gmWrittenTransposition(program: number): number` in `music_lib`, the third of its kind beside `gmInstrumentRange` and `gmMaxPolyphony`, and curated the same way: a documented default with overrides where the instrument actually transposes.

**Default 0.** Most instruments are written where they sound, so the table only names the ones that are not.

| Instruments                       | Written |
| --------------------------------- | ------- |
| B♭ soprano sax, clarinet, trumpet | +2      |
| French horn, English horn         | +7      |
| E♭ alto sax                       | +9      |
| B♭ tenor sax                      | +14     |
| E♭ baritone sax                   | +21     |
| Guitar, bass, contrabass          | +12     |
| Piccolo, celesta, xylophone       | −12     |
| Glockenspiel                      | −24     |

The octave cases are as real as the others — guitar music is written an octave above where it sounds — and they cost nothing extra, since a 12-semitone shift leaves the key signature alone by the formula above.

An out-of-range program returns 0: an unknown instrument is written where it sounds rather than moved by a guess.

## Where it applies, and where it must not

**Only a printed part.** Introduced as `extractPart(score, trackId)` in `music_lib` — a print-only derived score, which features 3 to 5 then extend with multi-measure rests, rehearsal marks and cues. Having one function grow is why the part pipeline stays one thing rather than four.

Three places it must **not** reach, each for its own reason:

- **Playback.** The engine plays sounding pitch. A transposed part is a notation, not a change to the music, and routing it into playback would make a trumpet sound a tone sharp.
- **The editor.** Editing happens at concert pitch, which is what the score is. Showing written pitch there would mean every displayed note disagreed with every other track.
- **The whole-score print option.** Conductors read concert pitch; that is the convention, and the score is the one place every part must be comparable.

Nothing is written back or saved. The derived score exists for the duration of a render.

## Testing

- The table for each named instrument, and 0 for a plain one and for an out-of-range program.
- The fifths shift against every standard case above, including that an octave leaves the key untouched.
- `extractPart` on a transposing track: pitches move by the right interval, the key signature moves with them, and spelling follows the _new_ key — a B♭ part in concert C spells F♯, not G♭.
- `extractPart` on a non-transposing track returns pitches unchanged.
- The print view: a single track of a transposing instrument prints transposed; the whole score does not; the caveat no longer mentions concert pitch.
- **No test may show transposition reaching playback or the editor.** A test asserting the editor still shows concert pitch after printing a transposed part is the guard worth having, because that failure would be silent.

## Out of scope

- **Transposed conductor's scores.** Some publishers print them; the convention here is concert pitch, and offering both is a preference nobody has asked for.
- **Multi-measure rests, rehearsal marks, cues, page turns.** Features 3 to 6.
- **Written-pitch editing** — entering a clarinet part as the player reads it — is **feature 7**, deliberately last. Everything up to feature 6 only ever _reads_ the score into a derived copy; feature 7 inverts that, making the editor display one pitch domain and store another, so every point where a pitch crosses the UI boundary must convert both ways (eight files in the app today). A missed conversion does not crash — it silently stores a note a tone off. The print pipeline should be finished and proven before that lands.

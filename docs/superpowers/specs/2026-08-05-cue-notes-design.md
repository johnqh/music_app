# Printing, part 5: cue notes

**Status:** draft 2026-08-05
**Goal:** print the bar before a long entry in small notation, taken from whoever is playing it, so a player who has counted 30 bars of rest comes in confident rather than hopeful.

Feature 5 of seven. Features 1 to 4 have shipped.

## The constraint everything else follows from

**A cue is not the player's music.** It is somebody else's bar, reproduced small, as a landmark. Everything below follows from keeping that distinction absolute: the cue must be impossible to mistake for something to play, and it must never disturb the part's own rhythm, rests or bar numbering.

That has one immediate structural consequence, and it is the opposite of feature 4's:

> **Cues are derived per part, from the rest of the score.**

Rehearsal marks had to be identical everywhere. Cues must differ everywhere — each player's cue is for _their_ entry, drawn from _other_ tracks. The whole-score print gets no cues at all: a conductor is already looking at every part.

## Where a cue goes

**The bar immediately before an entrance that follows a long rest.**

- **"Long" is 8 bars or more.** Below that nobody is lost, and a cue costs a bar that would otherwise be counted inside a multi-measure rest. This is a chosen number, not a derived one.
- **One bar.** Two is the alternative and the convention permits it, but a second bar costs another written-out bar and rarely adds confidence beyond the last one.
- **No cue at the very start of a piece** — bar 1 is not an entry after a rest.

## Which instrument gets cued

**The track with the most notes in the cue bar**, ties broken by track order.

The alternative is "the melody", which we cannot identify without guessing. Note count is a poor proxy for musical prominence and a good proxy for _audibility_, which is what the cued player actually needs: something they will hear. If no other track plays in that bar, there is no cue — a bar of universal silence cues nothing.

## The cue reads in the player's own transposition

A clarinet part is written a tone above concert pitch. A flute cue printed at concert pitch inside it would be a tone wrong against everything around it, and worse than no cue.

So cues are inserted **before** transposition in `extractPart`, and `transposeMeasure` carries the cue along with the measure's own voices. The pipeline becomes:

> cue → transpose → mark → collapse

Each step's reason for its position: cues need concert pitch to be selected and then need transposing like everything else; marks must be on before collapsing; collapsing must see the finished bar.

## Model

The cue is a payload beside the measure's voices, never inside them:

```ts
export type MeasureCue = {
  /** Which instrument this is, e.g. "Flute". Drawn above the notes. */
  label: string;
  /** The cued bar's notes. Not the player's — never sounded, never selectable. */
  events: MusicalEvent[];
};

export type Measure = {
  // …
  /** Small-print notes from another instrument, printed before an entry. Print-only. */
  cue?: MeasureCue;
};
```

Keeping it out of `voices` is what makes the rest of the system correct for free: playback, export, selection and note counting all read `voices` and are already right. Nothing has to learn to skip cues.

## Interaction with multi-measure rests

**A cue bar is never absorbed into a rest run** — not by continuing one, and not by starting one. It is silent in the player's own voices, so without this it would vanish into the count it is meant to end.

Concretely, a part silent from bar 2 to 38 with an entry at 39 prints:

```
1 | 15 | [A] 17 ×16 | [B] 33 ×5 | 38 (cue: Flute) | [C] 39
```

The rest before the cue is one bar shorter than it was, and the player counts to the cue rather than to the entry. That is the point.

## Rendering

Cue notes draw on the player's own stave at a reduced glyph scale — VexFlow's `StaveNote` takes `glyph_font_scale`, the same mechanism grace notes use — with the label above them as stave text.

**The player's own whole-bar rest is not drawn in a cue bar.** Two objects competing for one bar collide, and the canvas layout has no collision avoidance. Small notes under an instrument name is the standard reading of "this is not yours"; adding a rest underneath makes it busier without making it clearer.

## Testing

- Placement: an entry after 8+ bars of rest gets a cue on the bar before it; an entry after 4 does not; bar 1 never does.
- Source: the busiest other track is chosen; a bar where nothing else plays yields no cue.
- **The cue reads in the part's transposition** — a cue in a clarinet part is a tone above the concert-pitch source. This is the test most likely to catch a pipeline reordering.
- The cue bar breaks a rest run, and is itself written out rather than collapsed.
- The whole-score print carries no cues.
- Rendering: the label is drawn (it goes through `fillText`, so the string is assertable), and a cue bar draws no whole-bar rest.
- **e2e** — a part with a long rest prints a cue bar before its entry.

## Out of scope

- **Authored cues.** Heuristic, per the roadmap.
- **Instrument abbreviations.** The convention is "Fl.", not "Flute", but we have no abbreviation table and inventing one per GM program is a feature of its own.
- **A clef change for the cue.** Cueing a bass instrument into a treble part should change clef for the cue. Doing it properly means a second stave-level clef mid-bar; without it, a low cue prints with many ledger lines. Accepted, and stated rather than hidden.
- **Multi-bar cues**, and cues anywhere but immediately before an entry.
- **Page turns.** Feature 6.

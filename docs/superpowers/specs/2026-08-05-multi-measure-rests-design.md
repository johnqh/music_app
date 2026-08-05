# Printing, part 3: multi-measure rests

**Status:** approved 2026-08-05
**Goal:** print a part where a long silence is one bar carrying its count, not twenty-four empty bars.

Feature 3 of seven. Features 1 (print view) and 2 (transposition) have shipped.

## Why

A player counting bars needs to see `24` over a single bar. Twenty-four empty bars is several wasted pages and, worse, genuinely hard to count while playing — you lose your place and there is nothing to find it with.

This is the last thing standing between a filtered track and a part. It also deletes the remaining half of the print view's caveat.

## What collapses

A run of **two or more consecutive measures in which nothing sounds** becomes one measure carrying the count. A single empty bar stays a normal whole-bar rest: `1` over a bar is noise, and every engraver writes it out.

"Nothing sounds" means every voice in the measure holds only rests. A measure with one note in a second voice is not empty.

**Runs break at a change of key or time signature.** A multi-measure rest asserts that the intervening bars are alike; spanning a 4/4-to-3/4 change would be a lie about the music, and the player would have no idea where the change happened. Feature 4 adds rehearsal marks, which must break a run for the same reason — that is noted there, not built here.

## Parts only

Collapsing happens inside `extractPart`, after transposition. **The whole-score print never collapses.** In a score, one part's silence is another's entrance: the bars are not empty, and a conductor needs every one of them. Multi-measure rests are a parts convention, not a rendering optimisation.

## The model, and the invariant it breaks

`music_types` gains one optional field:

```ts
export type Measure = {
  // …
  /**
   * How many measures of silence this one stands for, when it is a
   * multi-measure rest. Absent for an ordinary measure.
   */
  multiMeasureRestCount?: number;
};
```

Additive and ignored everywhere else, exactly like `visibleTrackIds` was.

**The derived part no longer has contiguous measures.** Collapsing twenty-four bars into one means the next measure's `startTick` jumps, and `index` skips from 3 to 27. Two things make that safe rather than reckless:

- **It is print-only.** `extractPart`'s output is never saved, never played, never edited and never validated. Feature 2 established that boundary; this is the first feature to depend on it.
- **Each survivor keeps its original `index`.** The renderer already draws measure numbers from `measure.index` rather than array position, so a part shows bar **25** after a 24-bar rest with no further work. That is what makes the count usable: the number you land on is the number in the score.

Layout iterates measures by array position, so fewer measures simply means fewer drawn.

## Rendering

`buildMeasureContent` returns `{ stave, voices, beams }`. For a measure with `multiMeasureRestCount`, it returns the stave with **no voices**, and the renderer draws a VexFlow `MultiMeasureRest(count, {})` onto that stave instead. VexFlow 4.2.5 ships it; nothing new is needed.

A collapsed measure gets a **wider slot** than an ordinary one — the horizontal bar and its numeral need room, and a 24-bar rest squeezed into one measure's width looks like a mistake. It is a fixed wider width rather than proportional to the count: a 60-bar rest should not be sixty times wider than a 2-bar one.

## Testing

- Collapsing: runs of 2+ collapse; a single empty bar does not; a run at the start, in the middle and at the end of a piece all behave; a measure with a note in any voice is never absorbed.
- Breaks: a key change and a time-signature change each split a run into two.
- Numbering: after a 24-bar rest, the next measure still reports its original index — the check that makes the feature usable rather than merely shorter.
- Parts only: the same score printed whole keeps every measure.
- `extractPart` still does not modify the score it was given.
- Rendering: a measure with a count draws a multi-measure rest and no note voices.
- **e2e** — a part with a long silence prints fewer systems than the same track uncollapsed, and the caveat is gone entirely.

## Out of scope

- **Rehearsal marks breaking runs.** Feature 4 adds the marks and the break together.
- **Cue notes inside a long rest.** Feature 5; cues exist precisely because a 24-bar rest is a long time to be lost, so the two are related but separable.
- **Rests spanning a repeat or a coda.** The model has no repeats.
- **Numbering styles.** One numeral above the bar, which is the common convention; boxed or centred variants are preferences.

# Printing, part 6: page turns

**Status:** draft 2026-08-05
**Goal:** choose which systems go on which page, so a player turns while they have a hand free rather than mid-phrase.

Feature 6 of seven. Features 1 to 5 have shipped.

## What this replaces

Feature 1 handed pagination to the browser: every system is a block with `break-inside: avoid`, so the browser fits as many whole systems per page as the paper allows. That was correct and cheap, and it was always going to be temporary — it has no opinion about _where_ the break falls, and a page turn in the middle of a phrase is a real problem for a real player.

Choosing the break means deciding which systems go on which page, which means knowing the page height. So this feature brings three things that arrive together: **a paper picker, an explicit pagination pass, and a turn-quality rule.**

## The constraint everything else follows from

**A page turn costs the player a hand.** Everything below is about buying them time to use it.

The player can begin turning when their last note on the page has finished, and must be reading again by their first note on the next. So the free time at a turn is:

> trailing silent bars of the last system on the page **+** leading silent bars of the first system on the next.

That is the number this feature maximises. A multi-measure rest counts its full length — a 13-bar rest at the foot of a page is the best turn in the piece, not one bar's worth.

## Paper

Two controls beside "What to print": **A4 / Letter / Legal**, and **Portrait / Landscape**. Default A4 portrait.

Paper only enters the maths as a ratio. The layout is computed at a fixed logical width (`PRINT_WIDTH`), and each page is displayed at the paper's printable width, so the scale is uniform and:

```
usableHeightLogical = PRINT_WIDTH × (paperHeight − 2×margin) / (paperWidth − 2×margin)
```

The margin is the 12mm the existing `@page` rule already uses; the emitted `@page { size: … }` and this calculation must be derived from one source, or pagination silently disagrees with what the printer does.

## Pagination

Greedy fill, then pull back for a better turn:

1. Take systems in order, adding while the page's total height fits `usableHeightLogical`.
2. **A single system taller than the page still gets its own page.** It will overflow, and that is better than dropping it or looping forever.
3. For a **part**, consider ending the page up to **2 systems earlier** than the greedy break. Score each candidate by the free bars above. Take the best; on a tie take the fullest page — a shorter part is worth something too, and pulling back with nothing to show for it is pure loss.
4. Never pull back to an empty page.

**Turn optimisation applies to parts only. The whole score paginates greedily.** "The player rests" means nothing on a score with a dozen staves — some track is always playing — and a conductor turns at will or has a page-turner. Applying the rule there would shorten pages to no purpose.

## Rendering

Each page becomes one block with `break-after: page`, its systems inside; `break-inside: avoid` stays on each system as a backstop. `@page { size: <paper> <orientation>; margin: 12mm }` is emitted from the picker.

## Naming

`PrintPage` currently means _one system slice_ — a name feature 1 could get away with because a page and a system were never distinguished. They are now. The slice type becomes `PrintSystemSlice`, and `PrintPage` becomes what it says: the systems on one page.

## Testing

- Systems are packed to the page and never exceed `usableHeightLogical`.
- A system taller than a page gets its own page; nothing is dropped and nothing loops.
- Landscape and portrait of the same score give different page counts.
- **A part pulls its break back onto a rest**, and the resulting page is shorter than the greedy one — the test that the feature does anything at all.
- It never pulls back more than 2 systems, and never to an empty page.
- A trailing multi-measure rest scores its full bar count, not 1.
- A whole-score print does not pull back.
- Every system appears exactly once, in order, across all pages — the invariant that a pagination bug is most likely to break.
- **e2e** — changing the paper changes the number of printed pages.

## Out of scope

- **Custom margins**, and per-page "fit to page" scaling.
- **Facing pages / duplex**, and any notion of odd vs even pages.
- **Manual page breaks.** Authored, like authored marks and cues — a feature of its own.
- **Cue-aware turns** (preferring a turn that leaves a cue visible).
- **Reflowing the layout to improve a turn** — this feature chooses among the systems `computeLayout` produced; it never changes how measures are packed into systems.
- **Written-pitch editing.** Feature 7.

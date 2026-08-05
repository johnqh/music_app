# Printing, part 4: rehearsal marks

**Status:** approved 2026-08-05
**Goal:** print lettered marks a conductor can call out — "from B" — and every player finds the same bar.

Feature 4 of seven. Features 1 to 3 have shipped.

## The constraint everything else follows from

**A rehearsal mark is only useful if it means the same thing in every part.** The conductor says "from B"; the oboe, the cellos and the score must all agree on which bar that is. A mark that appears in one part and not another, or at bar 17 in one and bar 19 in another, is worse than no mark at all — it costs rehearsal time and trust.

Since these are derived heuristically rather than authored, that has one hard consequence:

> **Marks are computed from the whole score, once, and then applied to every part.**

Deriving them per-part — "place a mark after this part's long rest" — would give each player different letters. It is the obvious implementation and it is wrong. The derivation takes a `Score` and returns marks keyed by measure index; `extractPart` then looks them up.

## Where a mark goes

Marks belong at structural boundaries. Heuristically, in priority order:

1. **A change of key or time signature.** The clearest structural signal a score carries, and already the thing that breaks a multi-measure rest.
2. **The bar after a long silence in any part** — where somebody re-enters. That is exactly the moment a conductor restarts from, and the moment a lost player needs a landmark. "Long" is the same threshold that collapses a rest: two bars or more.
3. **Otherwise, every 16 bars**, so a long unbroken stretch is not left without a landmark.

Marks are never placed **closer than 4 bars apart**. Without a floor, a passage that changes metre twice in three bars gets three marks and none of them helps. When candidates collide, the earlier one wins and the later is dropped — a mark just after a change is more useful than one just before the next.

**Bar 1 never gets a mark.** "From the top" already exists and needs no letter.

## Lettering

`A` through `Z`, then `AA`, `BB`, `CC` — the common convention, and unambiguous when spoken aloud. Not `AB`: "A-B" over a bad line sounds like two separate marks.

## Where they appear

**Both the score and every part**, unlike transposition and multi-measure rests. That is the whole point — see above. The whole-score print shows them; each single-track part shows the same letters at the same bars.

They do not appear in the editor. The editor is for writing music, and a derived mark that cannot be moved would be a control that looks editable and is not. If marks ever become authored, that is where they would surface.

## Model and rendering

`music_types` gains one optional field, alongside the one feature 3 added:

```ts
export type Measure = {
  // …
  /** Rehearsal mark shown above this measure, e.g. "B". Print-only. */
  rehearsalMark?: string;
};
```

VexFlow draws it: `stave.setSection(mark, y, xOffset, fontSize, drawRect)` puts a boxed letter above the stave. Boxed, because a bare letter next to a dynamic or a tempo marking is easy to miss.

**A mark breaks a multi-measure rest.** Feature 3 left `runContinues` as the place for this: a run may not span a bar that carries a mark, or the mark would be invisible inside a rest and the conductor's "from B" would point at nothing. This is the interaction that makes the two features order-dependent — marks must be assigned **before** rests are collapsed.

## Testing

- Placement: a key change, a time change, and the bar after a long rest each attract a mark; an unbroken stretch gets one every 16 bars; bar 1 never does.
- The 4-bar floor: two changes three bars apart yield one mark, not two, and it is the earlier.
- **Identical across parts** — the single most important test. Marks derived for a two-track score appear at the same measure indices with the same letters in both parts and in the score.
- Lettering runs A…Z then AA, BB.
- A mark breaks a rest run: silence spanning a marked bar collapses into two rests, not one.
- Rendering: a measure with a mark draws a section above the stave.
- **e2e** — the same letters appear at the same bars in the score print and in a part print.

## Out of scope

- **Authored marks.** Chosen heuristics, per the roadmap. If placement proves wrong in practice the answer is authoring, which needs an editor affordance and a stored field — a feature of its own.
- **Numbered marks, or bar-number boxes.** Letters are the convention here; offering both is a preference nobody has asked for.
- **Marks at repeats or codas.** The model has no repeats.
- **Cue notes and page turns.** Features 5 and 6.

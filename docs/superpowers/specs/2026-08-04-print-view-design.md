# Printing, part 1: the print view

**Status:** approved 2026-08-04
**Goal:** print the score, or one track, on whatever paper is in the printer — with page breaks never falling through a system.

This is the first of six features that together produce properly engraved parts. It is useful on its own: after it, you can print.

| #     | Feature                  | Lands                   |
| ----- | ------------------------ | ----------------------- |
| **1** | **Print view**           | **you can print**       |
| 2     | Instrument transposition | correct written pitches |
| 3     | Multi-measure rests      | a usable part           |
| 4     | Rehearsal marks          | rehearsable             |
| 5     | Cue notes                | playable entries        |
| 6     | Page-turn optimisation   | performance-ready       |

Rehearsal marks and cues are **derived heuristically at extraction time**, not authored — so none of them needs an editor affordance or a stored field.

## How pagination works, and why it is temporary

`computeLayout` in page mode returns systems carrying `yTop`/`yBottom`, and `CanvasScoreRenderer` already translates by `-viewport.top` while culling to systems that intersect the viewport. So each system renders into **its own canvas**, with `viewport: { top: system.gutterTop, bottom: system.yBottom }`.

Each canvas is a block with `break-inside: avoid`. **Page breaks then fall between systems by construction** — a system is one indivisible box, so the browser fits as many whole ones per page as the paper allows. Landscape, A4, Letter and Legal all work with no arithmetic and no paper-size picker.

**Feature 6 will replace this.** Choosing page turns that land on rests means deciding which systems go on which page, which requires knowing the page height — an explicit paper picker and a real pagination pass. That is a planned replacement, not an oversight: browser pagination is correct until turns need optimising, and it makes this feature small enough to ship on its own.

## Rendering for paper, not for screen

Each canvas is drawn at `devicePixelRatio: 3` — roughly 300dpi once the browser scales it to the printed width — and displayed at `width: 100%`, so the logical layout width never has to match the paper.

Three things about the screen renderer are wrong on paper, and all three are settings rather than new code:

- **The track-info gutter must go.** `layout.ts` adds `TRACK_INFO_WIDTH` (220px) to the left margin unconditionally and the renderer always calls `drawTrackInfoGutter`, so printing today would put track names, instrument icons and **mute/solo buttons on paper**, on every system. `RenderOptions` gains `showTrackInfo?: boolean` (default `true`); when false the margin drops the 220px and the gutter is not drawn. That also returns a fifth of the page width to the music.
- **Always the light theme.** `LIGHT_RENDER_THEME` regardless of the app's dark mode: paper is white.
- **No editing state.** No `noteColors`, no `activeTrackId` dimming, no caret, no selection tint. A printed page shows the music, not what happened to be selected when you hit print.

Measure numbers stay. Those are engraving, not editing state.

## The view

A dedicated route, `/:lang/project/:id/print`, reached from the existing Export menu. Printing prints the whole document, so mounting only the print view is simpler than hiding the editor's chrome with `@media print`.

It shows, above the pages and hidden when printing:

- **What to print** — the whole score (the visible tracks, stacked as on screen) or any single track.
- **Print** and **Back to editor**.

Choosing a single track filters `trackIds` to it. Until features 2 and 3 land, the view says so plainly rather than implying more than it does:

> Single tracks print at concert pitch, with every bar of rest written out. Fine for a lead sheet or a piano part; not yet an orchestral part.

That warning is removed by the feature that makes it untrue.

## What this does not do

- **No PDF export.** Print-to-PDF is in every browser's print dialog.
- **No paper-size picker.** The browser's dialog owns paper until feature 6 needs to know.
- **No page numbers or running headers.** Feature 6 owns page-level furniture, since it is the first thing that knows what a page is.
- **No transposition, multi-measure rests, rehearsal marks or cues.** Features 2-5.

## Testing

- `music_lib` — `showTrackInfo: false` removes `TRACK_INFO_WIDTH` from the layout's left margin, and the drawn output contains no gutter; the default stays `true` so every existing caller is unaffected.
- `music_app` — the print view renders one canvas per system in the plan; each canvas gets its own system's viewport; the track picker filters to one track; the caveat shows only for a single track.
- **e2e** — with `emulateMedia({ media: 'print' })`, every system is present in the DOM and each carries `break-inside: avoid`. This is the only level that can check what printing would actually produce; a unit test cannot see print CSS.

The one thing no automated test can confirm is how it looks on paper. That needs a human printing a page.

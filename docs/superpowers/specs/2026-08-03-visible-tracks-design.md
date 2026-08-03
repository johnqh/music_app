# Visible tracks

**Status:** approved 2026-08-03
**Goal:** let a reader focus on a few tracks of a many-track score — hiding the rest from the page without deleting them, and remembering the choice per project across sessions.

## Why, and what it is not

A ten-track score is unreadable when you are editing four of its parts. The existing tools do not solve this: deleting is destructive, and muting silences a track while leaving it on the page — the opposite of what is wanted.

Visibility is therefore a **view preference**, not a property of the music:

| | drawn | sounds |
| --- | --- | --- |
| visible, unmuted | yes | yes |
| **hidden** | **no** | **yes** |
| muted | yes | no |
| hidden + muted | no | no |

Keeping hidden and muted separate is the point. You can hide an accompaniment you are not editing and still hear it in context, and the control for the other case already exists.

## What the survey found

Two things materially shrink this work from its original framing.

**The endpoint already exists.** `ProjectUpdateRequest` already carries `uiPrefs`, `ProjectRecord` already returns it, and `PUT /projects/:id` already persists it to a JSONB column. No new `music_api` route is needed. The channel was built and then never used: no production code in `music_lib` reads or writes `uiPrefs`, and `project-slice.ts`'s autosave sends only `{ name, score }`. The in-memory test fake (`src/test/store-context.ts`) *does* already round-trip it on create and update, so the fake needs no change — tests can assert persistence against it immediately.

**But the deployed API would silently drop the new field.** `music_api` pins `@sudobility/music_types@^0.1.0` and validates request bodies with `zValidator('json', projectUpdateRequestSchema)`. In 0.1.0 `projectUiPrefsSchema` requires `view` *and* is a `$strip` object — so a body carrying `{ zoom, visibleTrackIds }` is rejected outright for the missing `view`, and even one carrying `view` would have `visibleTrackIds` stripped before it reached the DB. **`music_api` must upgrade `music_types` and redeploy before the app ships**, and that ordering is a hard constraint rather than a nicety: without it the feature fails silently, which is the worst way for it to fail.

The upgrade itself is trivial, and was measured rather than assumed: bumping `music_api` to `music_types@0.3.0` in a scratch clone typechecks clean and passes all 84 tests with **zero** code changes.

**The renderer already draws a subset.** `RenderOptions.trackIds` ("omit/empty = all tracks in score order") and `computeLayout` both take a track list. Hiding is a matter of passing one, not of teaching the renderer anything.

**`ProjectUiPrefs.view` is dead.** It is `{ view: 'notation' | 'piano-roll'; zoom: number }`, but the app removed that switch entirely — notation and the keyboard are shown together and there is no view mode. It is removed here rather than carried forward; nothing reads it.

## Data model

```ts
// music_types
export type ProjectUiPrefs = {
  zoom: number;
  /**
   * Track ids to draw, in score order. **Absent means all visible** — a
   * project saved before this feature, or one that never hid anything, needs
   * no migration and no backfill.
   *
   * Ids not present in the score are ignored on load rather than dropped, so
   * hiding a track, undoing its deletion, and reloading behaves.
   */
  visibleTrackIds?: string[];
};
```

Absent-means-all is what keeps this backward compatible. An empty array is *not* a valid stored state (see the invariant below), so absent is unambiguous.

## The invariant: at least one visible track

**A score always has at least one visible track.** Enforced in the domain, not in the UI, because the UI is not the only thing that can reach this state — deleting the last visible track would otherwise leave a blank page with no way back.

`music_lib` owns a single resolver:

```ts
/**
 * The tracks to draw. Falls back to every track when `visibleTrackIds` is
 * absent, empty, or names nothing that exists — a blank page is never a
 * correct answer, and this is the one place that has to be true.
 */
export function selectVisibleTrackIds(state): string[];
```

Every consumer reads through it. The setter refuses to store an empty list, and the checkbox for the last remaining visible track is disabled with a tooltip saying why, so the rule is visible before it is hit rather than only enforced after.

**Interaction with the active track.** `selectActiveTrackId` already falls back to the first track when unset or stale; it now falls back to the first *visible* one. And per the brief, **selecting a track makes it visible** — choosing a hidden track from the selector checks it in the same action, because the alternative is choosing a track and seeing nothing happen.

## The control

A new **`CheckableSelect`** in `@sudobility/components`, since it is a general shape and not a music one: pick one item, toggle many. It is `Select` with a checkbox in each row — the trigger shows the *chosen* item, each row's checkbox toggles that row's flag, and clicking the row's label chooses it.

It is a new component rather than a variant of the existing `MultiSelect`, whose whole model is "value is an array". Here there are two independent pieces of state — one selection and a set of flags — and bending a multi-select into that would make both harder to read.

```tsx
<CheckableSelect
  value={activeTrackId}
  onChange={setActiveTrack}          // also makes the track visible
  checked={visibleTrackIds}
  onCheckedChange={setVisibleTracks} // refuses to empty the list
  options={tracks.map(t => ({ value: t.id, label: t.name }))}
/>
```

It goes on the **editing bar**, in the group with layout mode, and follows the bar's existing rules: the trigger is an icon-plus-label at `ICON_GLYPH_CLASS`, and the menu portals (a hand-rolled popup would be clipped by the toolbar's horizontal overflow, as the articulation menu was).

## What visibility affects

| Surface | Behaviour |
| --- | --- |
| Notation | Draws visible tracks only — `trackIds` into `computeLayout`/`render`. The track-info gutter follows automatically, since it iterates the plan. |
| Active track | Falls back to the first *visible* track; choosing a hidden one reveals it. |
| Piano keyboard | Unchanged — it already follows the active track, which is always visible. |
| Playback | **Unchanged.** Hidden tracks still sound. |
| Validation / issue count | Unchanged — a problem in a hidden track is still a problem with the piece. |
| Export | **Asks**, see below. |

## Export

When a score has hidden tracks, exporting MIDI or MusicXML asks which is wanted:

> **Export hidden tracks?** This score has 6 hidden tracks.
> [ Whole score ] [ Visible tracks only ] [ Cancel ]

With nothing hidden there is no question to ask and no dialog appears.

This is the one place the feature is allowed to change what leaves the app, and it is deliberate: a file that quietly omits parts is hard to notice until it matters, and silently exporting everything would equally surprise someone who hid tracks precisely to extract a subset. Asking only when the answer could differ keeps the common path unchanged.

"Visible tracks only" exports a filtered copy of the score; it does not alter the project. The filter itself (`scoreWithTracks`) lives in `music_lib` rather than the app, since it reads and rewrites a `Score` — and it returns the score by reference when nothing is filtered, so the common path costs nothing.

## Persistence

Through the existing endpoint. `project-slice.ts`'s autosaver currently sends `{ name, score }` and gains `uiPrefs`, so visibility rides the same debounce as every other edit — no second save path, no new failure mode.

Two consequences worth stating:

- **Changing visibility marks the project dirty** and triggers the autosave, exactly as an edit does. It is a persisted preference, so it must be.
- **Changing visibility is not undoable.** It is not a score command and never enters the undo stack. Ctrl-Z after hiding a track undoes the last *musical* edit — which is right, but is the sort of thing that surprises people, so the checkbox state is plainly visible in the control at all times.

## Testing

- `music_types` — schema accepts `visibleTrackIds`, and accepts its absence.
- `music_lib` — `selectVisibleTrackIds` falls back to all tracks for absent/empty/stale input; the setter refuses an empty list; `selectActiveTrackId` prefers a visible track; the autosaver includes `uiPrefs`.
- `music_io` — untouched.
- `@sudobility/components` — `CheckableSelect`: choosing, toggling, the disabled last checkbox, and that its menu is not clipped by an overflow ancestor.
- `music_app` — the toolbar control; notation draws only visible tracks; choosing a hidden track reveals it; the export dialog appears only when something is hidden, and each branch exports what it says.
- **e2e** — hide a track, reload the project, and confirm it is still hidden. That is the whole feature in one test: it is the round trip, not any single layer, that this is for.

## Out of scope

- **Per-user visibility.** One setting per project, shared by anyone who opens it. The app has no notion of per-user view state and this does not add one.
- **Reordering tracks.** The selector shows score order and does not change it.
- **Hiding by instrument, family, or any other rule.** Explicit checkboxes only.
- **A new `music_api` route.** None is needed — `uiPrefs` already round-trips. `music_api` does need its `music_types` dependency bumped and a redeploy, but that is a version bump, not a route.

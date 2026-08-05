# Visible Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader hide tracks of a many-track score from the page — without deleting them and without silencing them — and remember the choice per project across sessions.

**Architecture:** A new optional `visibleTrackIds` on the existing `ProjectUiPrefs`, persisted through the `PUT /projects/:id` endpoint that already carries `uiPrefs`. `music_lib` owns the resolver and the "at least one visible" invariant; `music_app` passes the resolved list into `computeLayout`'s existing `trackIds` option, which already draws a subset. Playback is untouched — hidden tracks still sound.

**Tech Stack:** TypeScript (strict), zod, Zustand + immer, React 19, Radix Select, VexFlow (canvas), Vitest + Testing Library, Playwright, Bun.

## Global Constraints

- **Ship order is mandatory: `music_types` → `music_api` (deploy) → `music_lib` → `mail_box_components` → `music_app`.** `music_api` validates request bodies with `zValidator('json', projectUpdateRequestSchema)` against its _own_ pinned `music_types`. On the currently-deployed `^0.1.0`, `projectUiPrefsSchema` requires `view` and is a `$strip` object — a body of `{ zoom, visibleTrackIds }` is rejected for the missing `view`, and even with `view` present `visibleTrackIds` is stripped before reaching the DB. Shipping the app first makes the feature fail _silently_.
- **`visibleTrackIds` absent means all tracks visible.** No migration, no backfill. An empty array is never a valid stored value.
- **At least one track is always visible.** Enforced in `music_lib`, not in the UI.
- **Hidden ≠ muted.** Hidden tracks are not drawn but still sound. Nothing in this plan touches `PlaybackEngine`, `setTrackMute`, or `setTrackSolo`.
- **No business logic in `music_app`.** Anything that reads or rewrites a `Score` belongs in `music_lib` (see `music_app/CLAUDE.md`).
- **Changing visibility marks the project dirty** and rides the existing autosave debounce. It is _not_ a score command and never enters the undo stack.
- Every repo gates on `bun run verify` (typecheck + lint + test + build) before push.

---

## File Structure

| File                                                            | Responsibility                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `music_types/src/index.ts`                                      | `ProjectUiPrefs` type + `projectUiPrefsSchema`: add `visibleTrackIds`, drop dead `view`.    |
| `music_api/package.json`                                        | Bump `@sudobility/music_types` so the validator stops stripping the new field.              |
| `music_lib/src/store/slices/ui-slice.ts`                        | `visibleTrackIds` state, `setVisibleTracks`, and `setActiveTrack` revealing a hidden track. |
| `music_lib/src/store/selectors.ts`                              | `selectVisibleTrackIds` (the invariant lives here); `selectActiveTrackId` composes over it. |
| `music_lib/src/domain/score/queries.ts`                         | `scoreWithTracks` — the filtered copy that "export visible only" writes.                    |
| `music_lib/src/store/slices/project-slice.ts`                   | Hydrate `uiPrefs` on open; send `uiPrefs` on autosave.                                      |
| `mail_box_components/src/ui/checkable-select.tsx`               | `CheckableSelect`: one chosen value + a set of checked flags, in a portalled menu.          |
| `music_app/src/features/score-editor/TrackVisibilitySelect.tsx` | The toolbar control, wired to the store.                                                    |
| `music_app/src/features/score-editor/ScoreEditorView.tsx`       | Pass visible ids into `computeLayout`; mount the control.                                   |
| `music_app/src/components/dialogs/ExportScopeDialog.tsx`        | The whole-score vs visible-only choice.                                                     |
| `music_app/src/components/layout/AppLayout.tsx`                 | Route the two export handlers through that choice.                                          |
| `music_app/e2e/visible-tracks.spec.ts`                          | The round trip: hide, reload, still hidden.                                                 |

---

### Task 1: `music_types` — the field

**Files:**

- Modify: `~/projects/music_types/src/index.ts:473` (type), `:510-513` (schema)
- Test: `~/projects/music_types/src/api.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type ProjectUiPrefs = { zoom: number; visibleTrackIds?: string[] }` and `projectUiPrefsSchema`, both exported from the package root. Every later task depends on these names.

- [ ] **Step 1: Write the failing tests**

In `~/projects/music_types/src/api.test.ts`, add:

```ts
it('accepts uiPrefs carrying visibleTrackIds', () => {
  const parsed = projectUpdateRequestSchema.parse({
    uiPrefs: { zoom: 1, visibleTrackIds: ['t1', 't2'] },
  });
  expect(parsed.uiPrefs?.visibleTrackIds).toEqual(['t1', 't2']);
});

it('accepts uiPrefs without visibleTrackIds, meaning all tracks visible', () => {
  const parsed = projectUpdateRequestSchema.parse({ uiPrefs: { zoom: 1 } });
  expect(parsed.uiPrefs?.visibleTrackIds).toBeUndefined();
});

it('rejects an empty visibleTrackIds, which would mean a blank page', () => {
  expect(() =>
    projectUpdateRequestSchema.parse({ uiPrefs: { zoom: 1, visibleTrackIds: [] } }),
  ).toThrow();
});
```

Then fix the two existing tests that assert the dead `view` field. At `~/projects/music_types/src/api.test.ts:43`, change `uiPrefs: { view: 'notation', zoom: 1 },` to `uiPrefs: { zoom: 1 },`. Delete the whole `it('rejects an update with an invalid uiPrefs view', ...)` case beginning at line 63 — the field it guards no longer exists.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/music_types && bun run test`
Expected: FAIL — the `visibleTrackIds` cases fail because the schema strips the unknown key (so it reads back `undefined`), and the empty-array case fails because nothing rejects it.

- [ ] **Step 3: Change the type**

Replace `~/projects/music_types/src/index.ts:473`:

```ts
export type ProjectUiPrefs = {
  zoom: number;
  /**
   * Track ids to draw. **Absent means every track is visible** — a project
   * saved before this field existed, or one that never hid anything, needs no
   * migration and no backfill. An empty array is not a valid value: a blank
   * page is never what anyone meant.
   *
   * Ids naming tracks that no longer exist are ignored on load rather than
   * treated as an error, so hiding a track, deleting it, and undoing the
   * deletion all behave.
   */
  visibleTrackIds?: string[];
};
```

- [ ] **Step 4: Change the schema**

Replace `~/projects/music_types/src/index.ts:510-513`:

```ts
export const projectUiPrefsSchema = z.object({
  zoom: z.number().positive(),
  visibleTrackIds: z.array(z.string().min(1)).nonempty().optional(),
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_types && bun run verify`
Expected: PASS, all suites.

- [ ] **Step 6: Publish 0.4.0**

`view` was a required property and is gone, so this is a breaking change to the type even though nothing read it.

```bash
cd ~/projects/music_types
npm version minor          # 0.3.0 -> 0.4.0
git add -A && git commit -m "feat: visibleTrackIds on ProjectUiPrefs, drop dead view field

The view field described a notation/piano-roll switch the app no longer has --
notation and the keyboard are shown together. Nothing read it.

visibleTrackIds is optional and non-empty when present: absent means every
track is visible, which is what makes existing projects need no migration,
and an empty array is rejected because a blank page is never what anyone
meant by hiding tracks."
git push && npm publish
```

- [ ] **Step 7: Verify the publish landed**

Run: `npm view @sudobility/music_types version`
Expected: `0.4.0`

---

### Task 2: `music_api` — stop stripping the field

**Files:**

- Modify: `~/projects/music_api/package.json:22`
- Test: `~/projects/music_api/src/routes/projects.test.ts` (or the existing project route test file — find it with `ls ~/projects/music_api/src/routes/*.test.ts`)

**Interfaces:**

- Consumes: `projectUiPrefsSchema` from Task 1.
- Produces: a deployed API that persists `uiPrefs.visibleTrackIds`. No new route, no new export.

**Why this task exists:** the route already stores `uiPrefs` into a JSONB column (`src/services/projects.ts:84,102`). The problem is upstream of it — `zValidator('json', projectUpdateRequestSchema)` at `src/routes/projects.ts:38` runs the _old_ schema, which requires `view` and strips unknown keys. Without this bump the app's writes are rejected or silently truncated.

- [ ] **Step 1: Write the failing test**

Add to the project routes test file:

```ts
it('persists uiPrefs.visibleTrackIds through an update', async () => {
  const created = await createTestProject({ name: 'Vis', score: testScore() });

  const res = await app.request(`/projects/${created.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ uiPrefs: { zoom: 1, visibleTrackIds: ['t1'] } }),
  });
  expect(res.status).toBe(200);

  // Read it back rather than trusting the response: the bug this guards
  // against is the validator stripping the field on its way to the DB, which
  // a response echoing the request body would hide.
  const reread = await app.request(`/projects/${created.id}`, { headers: authHeaders() });
  const body = await reread.json();
  expect(body.uiPrefs.visibleTrackIds).toEqual(['t1']);
});
```

Match the surrounding file's helpers — read the existing tests in that file first and reuse whatever they use to build a project and auth headers (`createTestProject`/`authHeaders`/`testScore` above are placeholders for the names already in that file).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_api && bun run test`
Expected: FAIL — either a 400 (missing `view`) or `body.uiPrefs.visibleTrackIds` is `undefined` (stripped).

- [ ] **Step 3: Bump the dependency**

```bash
cd ~/projects/music_api && bun add @sudobility/music_types@^0.4.0
```

- [ ] **Step 4: Verify**

Run: `cd ~/projects/music_api && bun run typecheck && bun run test`
Expected: PASS, including the new test. This bump was measured in advance against 0.3.0 — typecheck clean, 84/84 passing, zero code changes — so if anything else breaks here, stop and report it rather than working around it.

- [ ] **Step 5: Commit, push and deploy**

```bash
cd ~/projects/music_api
git add -A && git commit -m "fix: bump music_types so uiPrefs.visibleTrackIds survives validation

The route already writes uiPrefs to its JSONB column; the field was being lost
upstream of it. zValidator runs projectUpdateRequestSchema from the pinned
music_types, and on 0.1.0 that schema still required the dead view field and
stripped unknown keys -- so a body carrying visibleTrackIds was rejected
outright, and one carrying view would have had visibleTrackIds silently
removed before it reached the database.

Test reads the project back rather than trusting the PUT response, since an
echoed request body would hide exactly this failure."
git push
```

Then deploy, and confirm against the deployed instance before starting Task 3 — the remaining tasks all assume the field round-trips.

---

### Task 3: `music_lib` — the resolver and the invariant

**Files:**

- Modify: `~/projects/music_lib/src/store/slices/ui-slice.ts`
- Modify: `~/projects/music_lib/src/store/selectors.ts:125-134`
- Test: `~/projects/music_lib/src/store/selectors.test.ts`, `~/projects/music_lib/src/store/slices/ui-slice.test.ts`

**Interfaces:**

- Consumes: `ProjectUiPrefs` from Task 1.
- Produces:
  - `UiSlice.visibleTrackIds: string[] | null` — `null` means "all visible".
  - `UiSlice.setVisibleTracks: (trackIds: string[]) => void`
  - `selectVisibleTrackIds: (state: AppState) => string[]` — resolved, in score order, never empty when the score has tracks.
  - `selectActiveTrackId: (state: AppState) => string | null` — unchanged signature, now prefers a visible track.

- [ ] **Step 1: Write the failing selector tests**

Add to `~/projects/music_lib/src/store/selectors.test.ts`. Use whatever score factory the surrounding tests already use; the assertions below assume a three-track score whose ids are `a`, `b`, `c`.

```ts
describe('selectVisibleTrackIds', () => {
  it('returns every track when visibleTrackIds is null', () => {
    const state = stateWith({ score: threeTrackScore(), visibleTrackIds: null });
    expect(selectVisibleTrackIds(state)).toEqual(['a', 'b', 'c']);
  });

  it('returns the stored subset', () => {
    const state = stateWith({ score: threeTrackScore(), visibleTrackIds: ['b'] });
    expect(selectVisibleTrackIds(state)).toEqual(['b']);
  });

  it('returns them in score order, not stored order', () => {
    // The order tracks are drawn in is the score's, not the order the user
    // happened to tick the boxes.
    const state = stateWith({ score: threeTrackScore(), visibleTrackIds: ['c', 'a'] });
    expect(selectVisibleTrackIds(state)).toEqual(['a', 'c']);
  });

  it('drops ids that no longer resolve', () => {
    const state = stateWith({ score: threeTrackScore(), visibleTrackIds: ['a', 'gone'] });
    expect(selectVisibleTrackIds(state)).toEqual(['a']);
  });

  it('falls back to every track when nothing stored resolves', () => {
    // A blank page is never the right answer, so this is the one place the
    // invariant has to hold no matter what is stored.
    const state = stateWith({ score: threeTrackScore(), visibleTrackIds: ['gone'] });
    expect(selectVisibleTrackIds(state)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] when there is no score', () => {
    expect(selectVisibleTrackIds(stateWith({ score: null, visibleTrackIds: null }))).toEqual([]);
  });

  it('returns the same array reference when its inputs have not changed', () => {
    const state = stateWith({ score: threeTrackScore(), visibleTrackIds: ['a'] });
    expect(selectVisibleTrackIds(state)).toBe(selectVisibleTrackIds(state));
  });
});

describe('selectActiveTrackId with hidden tracks', () => {
  it('falls back to the first visible track, not the first track', () => {
    const state = stateWith({
      score: threeTrackScore(),
      activeTrackId: null,
      visibleTrackIds: ['b', 'c'],
    });
    expect(selectActiveTrackId(state)).toBe('b');
  });

  it('falls back off an explicitly-set track that is hidden', () => {
    const state = stateWith({
      score: threeTrackScore(),
      activeTrackId: 'a',
      visibleTrackIds: ['b'],
    });
    expect(selectActiveTrackId(state)).toBe('b');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ~/projects/music_lib && bun run test selectors`
Expected: FAIL — `selectVisibleTrackIds` is not exported.

- [ ] **Step 3: Add the state and the setter**

In `~/projects/music_lib/src/store/slices/ui-slice.ts`, add to the `UiSlice` type after `activeTrackId`:

```ts
  /**
   * The tracks to draw, or `null` for "all of them".
   *
   * `null` rather than a filled-in array of every id, because that is what
   * distinguishes "this project has never hidden anything" from "somebody
   * ticked every box" — the first needs nothing persisted and stays correct
   * when a track is added, the second would go stale the moment one was.
   *
   * Read it through `selectVisibleTrackIds`, which resolves it against the
   * score and guarantees the result is non-empty.
   */
  visibleTrackIds: string[] | null;

  /**
   * Sets which tracks are drawn, and marks the project dirty so the choice
   * persists on the next autosave.
   *
   * An empty list is refused rather than stored: it would leave a blank page
   * with no control left to click to get back. The UI disables the last
   * remaining checkbox so this is visible before it is hit, but the rule
   * belongs here, because the UI is not the only caller.
   */
  setVisibleTracks: (trackIds: string[]) => void;
```

Change the slice creator's signature from `(set) =>` to `(set, get) =>`, add the initial value beside `activeTrackId: null`:

```ts
  visibleTrackIds: null,
```

and add the action:

```ts
  setVisibleTracks: (trackIds) => {
    if (trackIds.length === 0) return;
    set((state) => {
      state.visibleTrackIds = [...trackIds];
    });
    get().markDirty();
  },
```

- [ ] **Step 4: Make `setActiveTrack` reveal a hidden track**

Replace the existing `setActiveTrack` in the same file:

```ts
  setActiveTrack: (trackId) => {
    let revealed = false;
    set((state) => {
      state.activeTrackId = trackId;
      // Choosing a track you cannot see and having nothing happen is not a
      // defensible outcome, so selecting reveals.
      if (trackId && state.visibleTrackIds && !state.visibleTrackIds.includes(trackId)) {
        state.visibleTrackIds = [...state.visibleTrackIds, trackId];
        revealed = true;
      }
    });
    if (revealed) get().markDirty();
  },
```

- [ ] **Step 5: Add the resolver and recompose `selectActiveTrackId`**

Replace `~/projects/music_lib/src/store/selectors.ts:117-134` (the `selectActiveTrackId` block and its doc comment) with:

```ts
/**
 * The tracks to draw, in score order.
 *
 * Falls back to every track when `visibleTrackIds` is null, or when nothing it
 * names still resolves against the score. That fallback is the whole point of
 * routing every consumer through here: a blank page is never a correct answer,
 * and this is the one place that has to be true.
 *
 * Filters the score's own id list rather than the stored one, so the result is
 * in score order regardless of the order the boxes were ticked.
 */
export const selectVisibleTrackIds = memoize2(
  (state) => state.score,
  (state) => state.visibleTrackIds,
  (score, visibleTrackIds): string[] => {
    if (!score || score.tracks.length === 0) return [];
    const all = score.tracks.map((t) => t.id);
    if (!visibleTrackIds) return all;
    const wanted = new Set(visibleTrackIds);
    const kept = all.filter((id) => wanted.has(id));
    return kept.length > 0 ? kept : all;
  },
);

/**
 * The effective active track id: the explicitly-set one when it still resolves
 * against the *visible* tracks, else the first visible track, else `null` (no
 * score, or a score with no tracks).
 *
 * Resolving here rather than reconciling `ui-slice.activeTrackId` on every
 * score change means "only one track, so it's active", "the active track was
 * just deleted" and "the active track was hidden" all fall out with no
 * subscription and no effect.
 *
 * Composed over `selectVisibleTrackIds` rather than reading `state.score`
 * directly: that selector is memoized, so its result is reference-stable and
 * can serve as this one's memo input.
 */
export const selectActiveTrackId = memoize2(
  selectVisibleTrackIds,
  (state) => state.activeTrackId,
  (visibleIds, activeTrackId): string | null => {
    if (visibleIds.length === 0) return null;
    if (activeTrackId && visibleIds.includes(activeTrackId)) return activeTrackId;
    return visibleIds[0];
  },
);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test selectors`
Expected: PASS.

- [ ] **Step 7: Write the failing slice tests**

Add to `~/projects/music_lib/src/store/slices/ui-slice.test.ts`, following the file's existing store-construction helper:

```ts
it('setVisibleTracks stores the list and marks dirty', () => {
  const store = createTestStore();
  store.getState().setVisibleTracks(['a', 'b']);
  expect(store.getState().visibleTrackIds).toEqual(['a', 'b']);
  expect(store.getState().dirty).toBe(true);
});

it('setVisibleTracks refuses an empty list', () => {
  const store = createTestStore();
  store.getState().setVisibleTracks(['a']);
  store.getState().setVisibleTracks([]);
  expect(store.getState().visibleTrackIds).toEqual(['a']);
});

it('setActiveTrack reveals a hidden track', () => {
  const store = createTestStore();
  store.getState().setVisibleTracks(['a']);
  store.getState().setActiveTrack('b');
  expect(store.getState().visibleTrackIds).toEqual(['a', 'b']);
});

it('setActiveTrack does not touch visibility when nothing is hidden', () => {
  const store = createTestStore();
  store.getState().setActiveTrack('b');
  expect(store.getState().visibleTrackIds).toBeNull();
});
```

- [ ] **Step 8: Run them**

Run: `cd ~/projects/music_lib && bun run test ui-slice`
Expected: PASS (the implementation from Steps 3-4 already satisfies them).

- [ ] **Step 9: Commit**

```bash
cd ~/projects/music_lib
git add -A && git commit -m "feat: visible tracks state, resolver and invariant

visibleTrackIds is null rather than a filled-in array of every id, because
that is what distinguishes a project that has never hidden anything from one
where somebody ticked every box -- the first stays correct when a track is
added, the second would go stale immediately.

selectVisibleTrackIds is the one place the at-least-one-visible invariant
holds. It filters the score's own id list rather than the stored one, so the
draw order is the score's regardless of the order the boxes were ticked, and
it falls back to every track when nothing stored still resolves.

selectActiveTrackId now composes over it instead of reading state.score, so
'the active track was hidden' falls out the same way 'the active track was
deleted' already did -- no reconciliation effect. Selecting a hidden track
reveals it, since choosing a track and seeing nothing happen is not a
defensible outcome."
```

---

### Task 4: `music_lib` — persistence and the export filter

**Files:**

- Modify: `~/projects/music_lib/src/store/slices/project-slice.ts:59-63` (save), `:104-113` (adopt)
- Modify: `~/projects/music_lib/src/domain/score/queries.ts`
- Test: `~/projects/music_lib/src/store/slices/project-slice.test.ts`, `~/projects/music_lib/src/domain/score/queries.test.ts`

**Interfaces:**

- Consumes: `selectVisibleTrackIds` and `UiSlice.visibleTrackIds` from Task 3; `ProjectUiPrefs` from Task 1.
- Produces: `scoreWithTracks(score: Score, trackIds: string[]): Score`, exported from the package root via the existing `export * from './domain/score/queries.js'`.

- [ ] **Step 1: Write the failing persistence tests**

Add to `~/projects/music_lib/src/store/slices/project-slice.test.ts`, using the file's existing `testStoreContext()` fake:

```ts
it('sends visibleTrackIds on autosave', async () => {
  const { store } = await openTestProject();
  store.getState().setVisibleTracks(['a']);
  await store.getState().saveNow();

  const record = await context.client.getProject(store.getState().projectId!, 'token');
  expect(record.uiPrefs?.visibleTrackIds).toEqual(['a']);
});

it('omits visibleTrackIds when nothing is hidden', async () => {
  const { store } = await openTestProject();
  store.getState().markDirty();
  await store.getState().saveNow();

  const record = await context.client.getProject(store.getState().projectId!, 'token');
  expect(record.uiPrefs?.visibleTrackIds).toBeUndefined();
});

it('hydrates visibleTrackIds when opening a project', async () => {
  const created = await context.client.createProject(
    { name: 'P', score: threeTrackScore(), uiPrefs: { zoom: 1, visibleTrackIds: ['b'] } },
    'token',
  );
  await store.getState().openProject(created.id);
  expect(store.getState().visibleTrackIds).toEqual(['b']);
});

it('resets visibility to all-visible when opening a project that hid nothing', async () => {
  // Without the reset, switching projects would carry the previous
  // project's hidden tracks into a score whose ids mean nothing.
  const created = await context.client.createProject(
    { name: 'P', score: threeTrackScore() },
    'token',
  );
  store.getState().setVisibleTracks(['a']);
  await store.getState().openProject(created.id);
  expect(store.getState().visibleTrackIds).toBeNull();
});
```

Adapt `openTestProject`/`context`/`store` to the helpers already in that file.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ~/projects/music_lib && bun run test project-slice`
Expected: FAIL — nothing sends or hydrates `uiPrefs`.

- [ ] **Step 3: Send `uiPrefs` on save**

In `~/projects/music_lib/src/store/slices/project-slice.ts`, replace the `updateProject` call at line 59:

```ts
const visibleTrackIds = get().visibleTrackIds;
const saved = await context.client.updateProject(
  record.id,
  {
    name: record.name,
    score,
    // zoom rides along because ProjectUiPrefs requires it; changing
    // it deliberately does NOT mark the project dirty, so it
    // persists opportunistically on the next real save rather than
    // adding a write on every zoom click.
    uiPrefs: {
      zoom: get().zoom,
      ...(visibleTrackIds ? { visibleTrackIds } : {}),
    },
  },
  token,
);
```

- [ ] **Step 4: Hydrate on adopt**

In the same file, inside `adopt`'s `set((state) => {...})` block (after `state.saveState = 'saved';`):

```ts
// Reset, not merge: a track id means nothing outside the project it
// came from, so carrying the outgoing project's hidden set into the
// incoming one would hide arbitrary tracks.
state.visibleTrackIds = record.uiPrefs?.visibleTrackIds ?? null;
if (record.uiPrefs?.zoom) state.zoom = record.uiPrefs.zoom;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run test project-slice`
Expected: PASS.

- [ ] **Step 6: Write the failing `scoreWithTracks` test**

Add to `~/projects/music_lib/src/domain/score/queries.test.ts`:

```ts
describe('scoreWithTracks', () => {
  it('keeps only the named tracks, in score order', () => {
    const score = threeTrackScore();
    expect(scoreWithTracks(score, ['c', 'a']).tracks.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('ignores ids that do not resolve', () => {
    const score = threeTrackScore();
    expect(scoreWithTracks(score, ['a', 'gone']).tracks.map((t) => t.id)).toEqual(['a']);
  });

  it('returns the same score when every track is named', () => {
    // Reference equality, not deep equality: exporting an unfiltered score
    // should cost nothing.
    const score = threeTrackScore();
    expect(scoreWithTracks(score, ['a', 'b', 'c'])).toBe(score);
  });

  it('leaves the tracks it keeps untouched', () => {
    const score = threeTrackScore();
    expect(scoreWithTracks(score, ['b']).tracks[0]).toBe(score.tracks[1]);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd ~/projects/music_lib && bun run test queries`
Expected: FAIL — `scoreWithTracks` is not exported.

- [ ] **Step 8: Implement it**

Append to `~/projects/music_lib/src/domain/score/queries.ts`:

```ts
/**
 * `score` with only the named tracks, in score order.
 *
 * Returns `score` itself when `trackIds` names every track, so the common
 * "nothing is hidden" export path costs nothing. Kept tracks are returned by
 * reference — this filters, it never rewrites the music.
 */
export function scoreWithTracks(score: Score, trackIds: string[]): Score {
  const wanted = new Set(trackIds);
  const tracks = score.tracks.filter((t) => wanted.has(t.id));
  if (tracks.length === score.tracks.length) return score;
  return { ...score, tracks };
}
```

Check the file's existing imports include `Score`; add it to the `import type { ... } from '@sudobility/music_types';` line if not.

- [ ] **Step 9: Verify and publish**

Run: `cd ~/projects/music_lib && bun run verify`
Expected: PASS.

```bash
cd ~/projects/music_lib
bun add @sudobility/music_types@^0.4.0
bun run verify
npm version minor          # 1.3.x -> 1.4.0
git add -A && git commit -m "feat: persist visible tracks, and filter a score to them

Visibility rides the existing autosave debounce rather than getting its own
save path. zoom rides along because ProjectUiPrefs requires it, but changing
zoom deliberately does not mark the project dirty -- it persists
opportunistically on the next real save instead of adding a write per click.

adopt() resets visibility rather than merging it: a track id means nothing
outside the project it came from, so carrying the outgoing project's hidden
set into the incoming one would hide arbitrary tracks.

scoreWithTracks returns the score itself when nothing is filtered, so the
common export path costs nothing."
git push && npm publish
```

---

### Task 5: `mail_box_components` — `CheckableSelect`

**Files:**

- Create: `~/projects/mail_box_components/src/ui/checkable-select.tsx`
- Create: `~/projects/mail_box_components/src/__tests__/checkable-select.test.tsx`
- Modify: `~/projects/mail_box_components/src/forms/inputs/index.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks. It is a generic control and knows nothing about tracks or music.
- Produces:

```ts
export interface CheckableSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface CheckableSelectProps {
  options: CheckableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  checked: string[];
  onCheckedChange: (checked: string[]) => void;
  minChecked?: number; // default 1
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
}
export const CheckableSelect: React.FC<CheckableSelectProps>;
```

**Why not extend `MultiSelect`:** it models "value is an array". Here there are two independent pieces of state — one chosen value and a set of flags — and bending one into the other makes both harder to read. It also matters that `MultiSelect` is hand-rolled over an absolutely-positioned `div`; this control must live inside the editor toolbar's `overflow-x-auto` scroller, which clips absolutely-positioned descendants. Building on `@radix-ui/react-select` (already a dependency) gets the portal for free — the same fix the articulation menu needed.

- [ ] **Step 1: Write the failing tests**

Create `~/projects/mail_box_components/src/__tests__/checkable-select.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckableSelect } from '../ui/checkable-select';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function setup(overrides: Partial<React.ComponentProps<typeof CheckableSelect>> = {}) {
  const onChange = vi.fn();
  const onCheckedChange = vi.fn();
  render(
    <CheckableSelect
      options={OPTIONS}
      value="a"
      onChange={onChange}
      checked={['a', 'b', 'c']}
      onCheckedChange={onCheckedChange}
      ariaLabel="Pick one"
      {...overrides}
    />,
  );
  return { onChange, onCheckedChange };
}

describe('CheckableSelect', () => {
  it('shows the chosen option on the trigger', () => {
    setup();
    expect(screen.getByLabelText('Pick one')).toHaveTextContent('Alpha');
  });

  it('choosing a row reports the new value', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByLabelText('Pick one'));
    await user.click(screen.getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('unticking a checkbox reports the smaller set without choosing that row', async () => {
    const user = userEvent.setup();
    const { onChange, onCheckedChange } = setup();
    await user.click(screen.getByLabelText('Pick one'));
    await user.click(screen.getByRole('checkbox', { name: 'Show Beta' }));
    expect(onCheckedChange).toHaveBeenCalledWith(['a', 'c']);
    // The click was on the checkbox, not the row -- toggling visibility must
    // not also change which item is chosen.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ticking a checkbox reports the larger set', async () => {
    const user = userEvent.setup();
    const { onCheckedChange } = setup({ checked: ['a'] });
    await user.click(screen.getByLabelText('Pick one'));
    await user.click(screen.getByRole('checkbox', { name: 'Show Beta' }));
    expect(onCheckedChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('disables the last checkbox so the set cannot be emptied', async () => {
    const user = userEvent.setup();
    setup({ checked: ['a'] });
    await user.click(screen.getByLabelText('Pick one'));
    expect(screen.getByRole('checkbox', { name: 'Show Alpha' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Show Beta' })).toBeEnabled();
  });

  it('renders its menu outside an overflow-hidden ancestor', async () => {
    // The control is meant for toolbars, which scroll horizontally. An
    // absolutely-positioned menu would be clipped by that ancestor; a
    // portalled one is not. Assert the portal, since clipping is invisible to
    // getBoundingClientRect in jsdom.
    const user = userEvent.setup();
    const { container } = render(
      <div style={{ overflowX: 'auto' }}>
        <CheckableSelect
          options={OPTIONS}
          value="a"
          onChange={() => {}}
          checked={['a', 'b', 'c']}
          onCheckedChange={() => {}}
          ariaLabel="Pick one"
        />
      </div>,
    );
    await user.click(screen.getByLabelText('Pick one'));
    const menuItem = screen.getByText('Beta');
    expect(container.contains(menuItem)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ~/projects/mail_box_components && bun run test checkable-select`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the component**

Create `~/projects/mail_box_components/src/ui/checkable-select.tsx`:

```tsx
import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { cn } from '../lib/utils';
import { SelectContent } from './select';

export interface CheckableSelectOption {
  /** Stable identity, reported to `onChange`/`onCheckedChange`. */
  value: string;
  /** Shown on the row and on the trigger when chosen. */
  label: string;
  /** Greys the row out; it can be neither chosen nor toggled. */
  disabled?: boolean;
}

export interface CheckableSelectProps {
  options: CheckableSelectOption[];
  /** The chosen option. */
  value: string;
  /** Called with the newly chosen option's value. */
  onChange: (value: string) => void;
  /** The ticked options. */
  checked: string[];
  /** Called with the whole new ticked set, in `options` order. */
  onCheckedChange: (checked: string[]) => void;
  /**
   * How few options may stay ticked. At the floor, every ticked checkbox is
   * disabled, so the rule is visible before it is hit rather than only
   * enforced after.
   */
  minChecked?: number;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
}

/**
 * A select whose rows each carry a checkbox: one chosen value, plus an
 * independent set of ticked options.
 *
 * Distinct from `MultiSelect`, whose whole model is "value is an array" —
 * here the two pieces of state are independent, and collapsing them into one
 * makes both harder to read.
 *
 * Built on Radix Select so the menu is portalled. That is not incidental: the
 * control is meant for toolbars, which scroll horizontally, and an ancestor
 * with `overflow-x` set makes the y axis non-visible too — an absolutely
 * positioned menu would be clipped.
 */
export const CheckableSelect: React.FC<CheckableSelectProps> = ({
  options,
  value,
  onChange,
  checked,
  onCheckedChange,
  minChecked = 1,
  ariaLabel,
  className,
  placeholder = 'Select…',
}) => {
  const checkedSet = React.useMemo(() => new Set(checked), [checked]);
  const atFloor = checkedSet.size <= minChecked;
  const chosen = options.find((o) => o.value === value);

  const toggle = (option: CheckableSelectOption): void => {
    const next = new Set(checkedSet);
    if (next.has(option.value)) next.delete(option.value);
    else next.add(option.value);
    // Report in `options` order rather than click order: callers persist this,
    // and a set that reshuffles itself on every click is noise in a diff.
    onCheckedChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };

  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex h-9 items-center justify-between gap-1 rounded-md border border-theme-border px-2 text-sm',
          className,
        )}
      >
        <span className="truncate">{chosen ? chosen.label : placeholder}</span>
        <SelectPrimitive.Icon asChild>
          <ChevronDownIcon className="size-4 shrink-0 opacity-60" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectContent>
        {options.map((option) => {
          const isChecked = checkedSet.has(option.value);
          return (
            <SelectPrimitive.Item
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="relative flex cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-theme-bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            >
              <input
                type="checkbox"
                aria-label={`Show ${option.label}`}
                checked={isChecked}
                // At the floor only the ticked ones lock: unticked rows must
                // stay clickable, or the set could never grow back.
                disabled={option.disabled || (isChecked && atFloor)}
                onChange={() => toggle(option)}
                // Radix treats a click anywhere in an Item as choosing it and
                // closes the menu. Both are wrong for the checkbox: ticking is
                // not choosing, and closing after each tick would make setting
                // several a chore.
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="size-4 shrink-0 accent-theme-primary"
              />
              <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            </SelectPrimitive.Item>
          );
        })}
      </SelectContent>
    </SelectPrimitive.Root>
  );
};
```

If `SelectContent` is not exported from `./select`, export it there — it already exists at `src/ui/select.tsx:117` and carries the `min-w-[var(--radix-select-trigger-width)]` fix this control also needs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/mail_box_components && bun run test checkable-select`
Expected: PASS. If a Radix pointer-events guard makes `userEvent.click` on a menu row fail under jsdom, follow whatever pattern `src/__tests__/sheet-selector.test.tsx` already uses for the same problem — do not weaken the assertions.

- [ ] **Step 5: Export it**

Add to `~/projects/mail_box_components/src/forms/inputs/index.ts`, beside the existing `export * from '../../ui/multi-select';`:

```ts
export * from '../../ui/checkable-select';
```

- [ ] **Step 6: Verify, publish**

Run: `cd ~/projects/mail_box_components && bun run verify`
Expected: PASS.

```bash
cd ~/projects/mail_box_components
npm version minor          # 5.0.104 -> 5.1.0
git add -A && git commit -m "feat: CheckableSelect -- one chosen value plus a set of ticked rows

Not a MultiSelect variant: that component's whole model is 'value is an
array', and here the two pieces of state are independent. Collapsing them
would make both harder to read.

Built on Radix Select rather than MultiSelect's hand-rolled absolutely
positioned dropdown, because the control is meant for toolbars, which scroll
horizontally -- and an ancestor with overflow-x set makes the y axis
non-visible too, clipping an absolutely positioned menu. Radix portals, which
is the same fix the articulation menu needed.

The checkbox stops click, pointerdown and keydown propagation: Radix treats a
click anywhere in an Item as choosing it and closes the menu, and both are
wrong here -- ticking is not choosing, and closing after each tick would make
setting several a chore.

At minChecked only the ticked boxes lock; unticked rows stay clickable, or the
set could never grow back."
git push && npm publish
```

---

### Task 6: `music_app` — the toolbar control

**Files:**

- Create: `~/projects/music_app/src/features/score-editor/TrackVisibilitySelect.tsx`
- Create: `~/projects/music_app/src/features/score-editor/TrackVisibilitySelect.test.tsx`
- Modify: `~/projects/music_app/src/features/score-editor/EditorToolbar.tsx` (mount it in the layout-mode group's row, before the `VerticalDivider` at line 432)
- Modify: `~/projects/music_app/package.json` (dependency bumps)

**Interfaces:**

- Consumes: `CheckableSelect` (Task 5); `selectVisibleTrackIds`, `selectActiveTrackId`, `setVisibleTracks`, `setActiveTrack` (Tasks 3-4).
- Produces: `<TrackVisibilitySelect store={store} />`.

- [ ] **Step 1: Bump dependencies**

```bash
cd ~/projects/music_app
bun add @sudobility/components@^5.1.0 @sudobility/music_lib@^1.4.0 @sudobility/music_types@^0.4.0
bun run verify
```

Expected: PASS. `ProjectUiPrefs.view` was removed in Task 1 — if anything in this app still references it, fix those references now; `grep -rn "uiPrefs" src` should show nothing that names `view`.

- [ ] **Step 2: Write the failing test**

Create `~/projects/music_app/src/features/score-editor/TrackVisibilitySelect.test.tsx`, following the store/render setup already used by `EditorToolbar.test.tsx`:

```tsx
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installTestAppServices, resetTestAppServices } from '../../test/app-services';
import { TrackVisibilitySelect } from './TrackVisibilitySelect';

describe('TrackVisibilitySelect', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  it('shows the active track on the trigger', () => {
    const store = storeWithThreeTracks();
    render(<TrackVisibilitySelect store={store} />);
    expect(screen.getByLabelText('Visible tracks')).toHaveTextContent(
      store.getState().score!.tracks[0].name,
    );
  });

  it('unticking a track hides it', async () => {
    const user = userEvent.setup();
    const store = storeWithThreeTracks();
    const [, second] = store.getState().score!.tracks;
    render(<TrackVisibilitySelect store={store} />);

    await user.click(screen.getByLabelText('Visible tracks'));
    await user.click(screen.getByRole('checkbox', { name: `Show ${second.name}` }));

    expect(store.getState().visibleTrackIds).not.toContain(second.id);
  });

  it('choosing a hidden track reveals it', async () => {
    const user = userEvent.setup();
    const store = storeWithThreeTracks();
    const [first, second] = store.getState().score!.tracks;
    store.getState().setVisibleTracks([first.id]);
    render(<TrackVisibilitySelect store={store} />);

    await user.click(screen.getByLabelText('Visible tracks'));
    await user.click(screen.getByText(second.name));

    expect(store.getState().visibleTrackIds).toContain(second.id);
    expect(store.getState().activeTrackId).toBe(second.id);
  });

  it('locks the last visible track so the score cannot go blank', async () => {
    const user = userEvent.setup();
    const store = storeWithThreeTracks();
    const [first] = store.getState().score!.tracks;
    store.getState().setVisibleTracks([first.id]);
    render(<TrackVisibilitySelect store={store} />);

    await user.click(screen.getByLabelText('Visible tracks'));
    expect(screen.getByRole('checkbox', { name: `Show ${first.name}` })).toBeDisabled();
  });

  it('renders nothing when the score has one track', () => {
    // With one track there is nothing to choose between and nothing that could
    // be hidden, so the control would be a permanently-disabled no-op.
    const store = storeWithOneTrack();
    render(<TrackVisibilitySelect store={store} />);
    expect(screen.queryByLabelText('Visible tracks')).toBeNull();
  });
});
```

Write `storeWithThreeTracks`/`storeWithOneTrack` using whatever score factory `EditorToolbar.test.tsx` already imports.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test TrackVisibilitySelect`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Implement it**

Create `~/projects/music_app/src/features/score-editor/TrackVisibilitySelect.tsx`:

```tsx
/**
 * The editing bar's track control: which track is active, and which tracks are
 * drawn at all.
 *
 * One control for both, because they are the same question asked twice — you
 * pick the track you are working on from the same list you decide to look at.
 */
import { CheckableSelect } from '@sudobility/components';
import { selectActiveTrackId, selectVisibleTrackIds } from '@sudobility/music_lib';
import { Tooltip } from '@sudobility/components';
import type { AppStore } from '../../types/store';

export type TrackVisibilitySelectProps = { store: AppStore };

export function TrackVisibilitySelect({ store }: TrackVisibilitySelectProps) {
  const tracks = store((state) => state.score?.tracks ?? []);
  const visibleIds = store(selectVisibleTrackIds);
  const activeId = store(selectActiveTrackId);
  const setActiveTrack = store((state) => state.setActiveTrack);
  const setVisibleTracks = store((state) => state.setVisibleTracks);

  // Nothing to choose between and nothing that could be hidden: the control
  // would be a permanently-disabled no-op taking up toolbar width.
  if (tracks.length < 2 || !activeId) return null;

  return (
    <Tooltip placement="bottom" content="Active track, and which tracks are shown">
      <CheckableSelect
        ariaLabel="Visible tracks"
        options={tracks.map((track) => ({ value: track.id, label: track.name }))}
        value={activeId}
        onChange={setActiveTrack}
        checked={visibleIds}
        onCheckedChange={setVisibleTracks}
        className="w-[160px]"
      />
    </Tooltip>
  );
}
```

Match the store-hook idiom the other files in this directory use — check how `EditorToolbar.tsx` reads state from its `store` prop and follow it exactly, including the import path for the store type.

- [ ] **Step 5: Mount it in the toolbar**

In `~/projects/music_app/src/features/score-editor/EditorToolbar.tsx`, immediately before the `<VerticalDivider />` at line 432 (the one preceding the "Layout mode" group), add:

```tsx
      <VerticalDivider />

      <TrackVisibilitySelect store={store} />
```

and import it at the top of the file:

```tsx
import { TrackVisibilitySelect } from './TrackVisibilitySelect';
```

- [ ] **Step 6: Run the tests**

Run: `cd ~/projects/music_app && bun run test TrackVisibilitySelect EditorToolbar`
Expected: PASS, both files.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/music_app
git add -A && git commit -m "feat: track visibility control on the editing bar

One control for the active track and for which tracks are drawn, because they
are the same question asked twice -- you pick the track you are working on
from the same list you decide to look at.

Hidden below two tracks: with one track there is nothing to choose between and
nothing that could be hidden, so the control would be a permanently-disabled
no-op taking up toolbar width."
```

---

### Task 7: `music_app` — draw only the visible tracks

**Files:**

- Modify: `~/projects/music_app/src/features/score-editor/ScoreEditorView.tsx:481-484`
- Test: `~/projects/music_app/src/features/score-editor/ScoreEditorView.test.tsx`

**Interfaces:**

- Consumes: `selectVisibleTrackIds` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `~/projects/music_app/src/features/score-editor/ScoreEditorView.test.tsx`, in the style of the existing `computeLayout`-based assertions around line 551:

```tsx
it('lays out only the visible tracks', () => {
  const store = storeWithThreeTracks();
  const [first, second] = store.getState().score!.tracks;
  store.getState().setVisibleTracks([first.id]);
  renderEditor(store);

  const plan = layoutPlanFromRender();
  const drawn = new Set(plan.systems.flatMap((s) => s.staves.map((st) => st.trackId)));
  expect(drawn.has(first.id)).toBe(true);
  expect(drawn.has(second.id)).toBe(false);
});

it('lays out every track when nothing is hidden', () => {
  const store = storeWithThreeTracks();
  renderEditor(store);
  const plan = layoutPlanFromRender();
  const drawn = new Set(plan.systems.flatMap((s) => s.staves.map((st) => st.trackId)));
  expect(drawn.size).toBe(3);
});
```

Use whatever mechanism the surrounding tests already use to reach the rendered plan (the file computes plans directly via `computeLayout` in several places — mirror the closest existing example, and read the real `LayoutPlan` shape in `music_lib/src/adapters/vexflow/layout.ts` rather than assuming `systems`/`staves`/`trackId` field names).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test ScoreEditorView`
Expected: FAIL — the second track is still laid out.

- [ ] **Step 3: Pass the ids into the layout**

In `~/projects/music_app/src/features/score-editor/ScoreEditorView.tsx`, add near the other store reads:

```tsx
const visibleTrackIds = useAppStore(selectVisibleTrackIds);
```

(matching the file's existing store-read idiom), import `selectVisibleTrackIds` from `@sudobility/music_lib` alongside `computeLayout`, and replace the `layoutPlan` memo at line 481:

```tsx
const layoutPlan = useMemo(() => {
  if (!displayScore) return null;
  return computeLayout(displayScore, {
    zoom,
    layoutMode,
    width: viewWidth,
    theme: renderTheme,
    // `computeLayout` already renders a subset and drops ids that do not
    // resolve, so hiding a track costs one option rather than a code path.
    trackIds: visibleTrackIds,
  });
}, [displayScore, zoom, layoutMode, renderTheme, viewWidth, visibleTrackIds]);
```

`selectVisibleTrackIds` is memoized, so its result is reference-stable and safe as a dependency — it will not re-run this memo on unrelated store updates.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test ScoreEditorView`
Expected: PASS, including every pre-existing test in the file. The hit-testing, caret and playback-scroll tests all read this same plan; if any of them break, the cause is real, not a stale expectation.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_app
git add -A && git commit -m "feat: notation draws only the visible tracks

computeLayout already rendered a subset through trackIds and already dropped
ids that do not resolve, so this is one option rather than a code path. The
track-info gutter follows for free, since it iterates the plan.

selectVisibleTrackIds is memoized, so it is reference-stable and safe as a
memo dependency -- it will not re-run the layout on unrelated store updates."
```

---

### Task 8: `music_app` — the export choice

**Files:**

- Create: `~/projects/music_app/src/components/dialogs/ExportScopeDialog.tsx`
- Create: `~/projects/music_app/src/components/dialogs/ExportScopeDialog.test.tsx`
- Modify: `~/projects/music_app/src/components/layout/AppLayout.tsx:230-257`
- Test: `~/projects/music_app/src/components/layout/AppLayout.test.tsx`

**Interfaces:**

- Consumes: `scoreWithTracks` (Task 4), `selectVisibleTrackIds` (Task 3).
- Produces: `<ExportScopeDialog open hiddenCount onChoose onCancel />` where `onChoose: (scope: 'all' | 'visible') => void`.

- [ ] **Step 1: Write the failing dialog test**

Create `~/projects/music_app/src/components/dialogs/ExportScopeDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportScopeDialog } from './ExportScopeDialog';

describe('ExportScopeDialog', () => {
  it('says how many tracks are hidden', () => {
    render(<ExportScopeDialog open hiddenCount={6} onChoose={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/6 hidden tracks/)).toBeInTheDocument();
  });

  it('says it in the singular for one', () => {
    render(<ExportScopeDialog open hiddenCount={1} onChoose={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/1 hidden track\b/)).toBeInTheDocument();
  });

  it('reports the whole-score choice', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<ExportScopeDialog open hiddenCount={2} onChoose={onChoose} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Whole score' }));
    expect(onChoose).toHaveBeenCalledWith('all');
  });

  it('reports the visible-only choice', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<ExportScopeDialog open hiddenCount={2} onChoose={onChoose} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Visible tracks only' }));
    expect(onChoose).toHaveBeenCalledWith('visible');
  });

  it('cancels without choosing', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(<ExportScopeDialog open hiddenCount={2} onChoose={onChoose} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test ExportScopeDialog`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the dialog**

Create `~/projects/music_app/src/components/dialogs/ExportScopeDialog.tsx`, following `ShortcutHelpDialog.tsx`'s use of `Dialog` from `@sudobility/components`:

```tsx
/**
 * Asks whether an export should carry the hidden tracks.
 *
 * Only shown when some are hidden. A file that quietly omits parts is hard to
 * notice until it matters, and silently exporting everything would equally
 * surprise someone who hid tracks precisely to extract a subset — so the
 * question is asked exactly when the two answers differ, and never otherwise.
 */
import { Button, Dialog } from '@sudobility/components';

export type ExportScope = 'all' | 'visible';

export type ExportScopeDialogProps = {
  open: boolean;
  hiddenCount: number;
  onChoose: (scope: ExportScope) => void;
  onCancel: () => void;
};

export function ExportScopeDialog({
  open,
  hiddenCount,
  onChoose,
  onCancel,
}: ExportScopeDialogProps) {
  return (
    <Dialog isOpen={open} onClose={onCancel} size="sm" showCloseButton={false}>
      <div className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="text-base font-medium text-theme-text-primary">Export hidden tracks?</h2>
          <p className="mt-1 text-sm text-theme-text-secondary">
            This score has {hiddenCount} hidden {hiddenCount === 1 ? 'track' : 'tracks'}.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => onChoose('visible')}>
            Visible tracks only
          </Button>
          <Button type="button" variant="primary" onClick={() => onChoose('all')}>
            Whole score
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
```

Check `ShortcutHelpDialog.tsx` for the `Button` variant names this app actually uses and match them.

- [ ] **Step 4: Run the dialog tests**

Run: `cd ~/projects/music_app && bun run test ExportScopeDialog`
Expected: PASS.

- [ ] **Step 5: Write the failing wiring tests**

Add to `~/projects/music_app/src/components/layout/AppLayout.test.tsx`:

```tsx
it('exports without asking when nothing is hidden', async () => {
  const user = userEvent.setup();
  const store = storeWithThreeTracks();
  renderAppLayout(store);
  await openExportMenu(user);
  await user.click(screen.getByRole('menuitem', { name: /MIDI/ }));
  expect(screen.queryByText('Export hidden tracks?')).toBeNull();
  expect(savedFiles()).toHaveLength(1);
});

it('asks when tracks are hidden, and exports the whole score on that choice', async () => {
  const user = userEvent.setup();
  const store = storeWithThreeTracks();
  store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]);
  renderAppLayout(store);
  await openExportMenu(user);
  await user.click(screen.getByRole('menuitem', { name: /MIDI/ }));

  expect(await screen.findByText('Export hidden tracks?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Whole score' }));
  expect(exportedTrackCount()).toBe(3);
});

it('exports only the visible tracks on that choice', async () => {
  const user = userEvent.setup();
  const store = storeWithThreeTracks();
  store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]);
  renderAppLayout(store);
  await openExportMenu(user);
  await user.click(screen.getByRole('menuitem', { name: /MIDI/ }));
  await user.click(screen.getByRole('button', { name: 'Visible tracks only' }));
  expect(exportedTrackCount()).toBe(1);
});

it('cancelling writes no file', async () => {
  const user = userEvent.setup();
  const store = storeWithThreeTracks();
  store.getState().setVisibleTracks([store.getState().score!.tracks[0].id]);
  renderAppLayout(store);
  await openExportMenu(user);
  await user.click(screen.getByRole('menuitem', { name: /MIDI/ }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(savedFiles()).toHaveLength(0);
});
```

Build `savedFiles()`/`exportedTrackCount()` on the `fileExporter` fake that `installTestAppServices()` already wires up — read `src/test/app-services.ts` to see what it records, and decode the saved MIDI bytes with `getAppServices().io.midiCodec.decode` to count tracks. Match `openExportMenu`/`renderAppLayout` to whatever the file already does to open that menu.

- [ ] **Step 6: Run them to verify they fail**

Run: `cd ~/projects/music_app && bun run test AppLayout`
Expected: FAIL — no dialog appears and the whole score is always exported.

- [ ] **Step 7: Wire the handlers**

In `~/projects/music_app/src/components/layout/AppLayout.tsx`, add near the other hooks:

```tsx
const visibleTrackIds = useAppStore(selectVisibleTrackIds);
const hiddenCount = (score?.tracks.length ?? 0) - visibleTrackIds.length;
const [pendingExport, setPendingExport] = useState<null | ((scope: ExportScope) => void)>(null);

/**
 * Runs `write` against the score the user asked for, asking first only when
 * the two possible answers actually differ.
 */
const withExportScope = (write: (score: Score) => Promise<void>) => {
  if (!score) return;
  if (hiddenCount <= 0) {
    void write(score);
    return;
  }
  // Stored as a thunk-returning setter: React would otherwise call a
  // function passed to setState as an updater.
  setPendingExport(() => (scope: ExportScope) => {
    setPendingExport(null);
    void write(scope === 'all' ? score : scoreWithTracks(score, visibleTrackIds));
  });
};
```

Rewrite the two handlers to take the score as an argument and go through it:

```tsx
const handleExportMidi = (): void => {
  withExportScope(async (target) => {
    try {
      const bytes = exportMidi(target, getAppServices().io.midiCodec);
      await getAppServices().io.fileExporter.save(
        `${midiSafeFilename(target.metadata.title)}.mid`,
        bytes,
        'audio/midi',
      );
    } catch (err) {
      reportError(err, { context: 'MIDI export failed', store });
    }
  });
  exportMenu.setOpen(false);
};

const handleExportMusicXml = (): void => {
  withExportScope(async (target) => {
    try {
      const xml = exportMusicXml(target);
      await getAppServices().io.fileExporter.save(
        `${musicXmlSafeFilename(target.metadata.title)}.musicxml`,
        xml,
        'application/vnd.recordare.musicxml+xml',
      );
    } catch (err) {
      reportError(err, { context: 'MusicXML export failed', store });
    }
  });
  exportMenu.setOpen(false);
};
```

Leave `handleExportProjectJson` alone: a project export is the project, not a view of it.

Then mount the dialog beside the other dialogs in the returned tree:

```tsx
<ExportScopeDialog
  open={pendingExport !== null}
  hiddenCount={hiddenCount}
  onChoose={(scope) => pendingExport?.(scope)}
  onCancel={() => setPendingExport(null)}
/>
```

Add the imports: `ExportScopeDialog` and its `ExportScope` type from `../dialogs/ExportScopeDialog`, `scoreWithTracks` and `selectVisibleTrackIds` from `@sudobility/music_lib`, `Score` type from `@sudobility/music_types`, and `useState` from `react` if not already imported.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test AppLayout ExportScopeDialog`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd ~/projects/music_app
git add -A && git commit -m "feat: ask which tracks an export should carry

Only when some are hidden. A file that quietly omits parts is hard to notice
until it matters, and silently exporting everything would equally surprise
someone who hid tracks precisely to extract a subset -- so the question gets
asked exactly when the two answers differ, and never otherwise.

Project JSON export is untouched: that is the project, not a view of it."
```

---

### Task 9: `music_app` — the round trip

**Files:**

- Create: `~/projects/music_app/e2e/visible-tracks.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

**Why this task exists:** every layer is unit-tested against a fake. The failure this feature is actually exposed to — a field lost between the browser and Postgres — is invisible to all of them. Only the round trip catches it.

- [ ] **Step 1: Write the spec**

Create `~/projects/music_app/e2e/visible-tracks.spec.ts`, following the setup in the existing specs (read one first — `e2e/helpers.ts` has the project-creation and canvas-coordinate helpers):

```ts
import { expect, test } from '@playwright/test';
import { createProjectWithTracks, openProject } from './helpers';

test('a hidden track stays hidden across a reload', async ({ page }) => {
  const projectId = await createProjectWithTracks(page, 3);
  await openProject(page, projectId);

  await page.getByLabel('Visible tracks').click();
  await page
    .getByRole('checkbox', { name: /^Show / })
    .nth(1)
    .uncheck();
  await page.keyboard.press('Escape');

  // Wait for the autosave to land before reloading, or the assertion races it.
  await expect(page.getByLabel('Save state')).toHaveText(/Saved/i);

  await page.reload();
  await openProject(page, projectId);
  await page.getByLabel('Visible tracks').click();
  await expect(page.getByRole('checkbox', { name: /^Show / }).nth(1)).not.toBeChecked();
});
```

Adapt the helper names and the save-state locator to what `e2e/helpers.ts` and the app actually expose — if there is no accessible save-state readout to wait on, call the app's explicit save (the Save control) and wait for its result rather than adding a fixed timeout.

- [ ] **Step 2: Run it**

```bash
cd ~/projects/music_app
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
bun run test:e2e visible-tracks
```

Expected: PASS. This needs a local Postgres `music_test` DB and `../music_api`'s dependencies installed. **`../music_api` must be on the Task 2 dependency bump** — the e2e run boots that repo's server, so a stale checkout there reproduces exactly the silent-strip bug this test exists to catch, and the failure will look like the app's bug rather than the API's.

- [ ] **Step 3: Full verify**

Run: `cd ~/projects/music_app && bun run verify`
Expected: PASS.

- [ ] **Step 4: Commit, bump and push**

```bash
cd ~/projects/music_app
npm version minor          # 0.1.7 -> 0.2.0
git add -A && git commit -m "test: visible tracks survive a reload

Every layer below this is unit-tested against a fake, and the failure this
feature is actually exposed to -- a field lost somewhere between the browser
and Postgres -- is invisible to all of them. Only the round trip catches it."
git push
```

---

## Self-Review

**Spec coverage.** Data model → Task 1. The at-least-one-visible invariant → Task 3 (domain) and Tasks 5-6 (the disabled last checkbox). Active-track fallback and reveal-on-select → Task 3. The control → Tasks 5-6. Notation draws visible only → Task 7. Playback unchanged → no task touches it, deliberately. Export choice → Task 8. Persistence → Tasks 1, 2, 4. Testing table → Tasks 1-9. The deployed-API constraint the spec added → Task 2 and the Global Constraints.

**Deliberate gaps, stated rather than hidden:**

- **The canvas track-info gutter still draws literal `M`/`S` text** (`music_lib`'s `drawTrackInfoGutter`). Pre-existing, unrelated, untouched.
- **`music_client` needs no change.** `updateProject` passes `ProjectUpdateRequest` straight through; adding a field to that type is enough. If its tests pin a literal `uiPrefs` shape, Task 4's dependency bump will surface it there.
- **Zoom becomes persisted per project** as a side effect of Task 4 — `ProjectUiPrefs.zoom` is required, so sending `uiPrefs` means sending it, and hydrating on open follows. Changing zoom deliberately does _not_ mark the project dirty, so this adds no writes; it rides the next real save. Flag it to the user rather than treating it as free.
- **Hidden tracks and the piano keyboard** need no work: the keyboard follows the active track, which the Task 3 selector guarantees is visible.

**Type consistency.** `visibleTrackIds` is `string[] | null` in the store (null = all) and `string[] | undefined` on the wire (absent = all) — the boundary conversion happens in exactly two places, both in Task 4 (`?? null` on adopt, spread-if-present on save). `selectVisibleTrackIds` returns `string[]` everywhere and is the only thing consumers read. `setVisibleTracks` takes `string[]` in Tasks 3, 5 and 6 alike; `CheckableSelect`'s `onCheckedChange` has the matching `(checked: string[]) => void`.

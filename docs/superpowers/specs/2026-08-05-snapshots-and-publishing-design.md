# Snapshots and publishing

**Status:** draft 2026-08-05
**Goal:** let a project be pinned at a moment that never changes again, moved back to, branched from — and optionally shared with anyone by URL.

## The constraint everything else follows from

**A snapshot never changes once saved.** Autosave keeps overwriting the live project; a snapshot is the opposite promise. Everything below protects that: snapshots store their own full copy of the score, nothing edits one in place, and the only mutable thing about a snapshot is whether other people may see it.

## The shape: a tree, not a list

Opening an old snapshot and carrying on **branches**. If v3 exists and you open v2, work, and snapshot again, the new one is a sibling of v3, not its successor:

```
v1 ── v2 ── v3
       └─── v4       ← opened v2, worked, snapshotted
```

Every snapshot records the snapshot it grew from. This is the only shape where "go back and try it another way" is _recorded_ rather than silently losing one path or the other — and it is what makes a flowchart worth drawing instead of a list.

The **live project** carries a pointer to the snapshot it is currently descended from, so a new snapshot knows where to attach. Creating a snapshot moves that pointer to the snapshot just created; opening one sets it to the snapshot opened.

## What a snapshot is

A full copy of the score at that moment, plus the project's UI preferences, a name, a timestamp, and its parent. **Full copies, not diffs** — a score is small JSON, and reconstructing a version by replaying deltas is exactly the kind of thing that quietly stops being reproducible. Immutability is the whole product here; it should be structural, not derived.

## Creating

An action in the project menu: **Create snapshot…**, which asks for a name and offers a **Publish** checkbox.

Work is not interrupted. The live project keeps going, now parented to the snapshot just made.

## Opening

Opening is destructive to the live project, so it is guarded:

1. A warning that current work will be replaced.
2. An offer to snapshot the current work first — one click, so the destructive path always has a non-destructive escape.
3. On confirm, the live project's score is overwritten by the snapshot's, and its parent pointer is set to that snapshot.

**Nothing is deleted.** v3 still exists after you open v2; it is simply on another branch.

## The picker

A flowchart: one node per snapshot, edges to parents, laid out by generation. The live project appears as a distinguished node (dashed, "current work") hanging off its parent, so "you are here" is answerable at a glance — the question the whole screen exists to answer.

Nodes show the name and date, and a marker when published.

## Naming

Free text, defaulting to `Version N` where N is the count of snapshots in the project plus one — **global creation order, not per-branch**. `Version 4` on a branch off `Version 2` is not confusing; `Version 2.1.1` is.

## Publishing

Publishing makes a snapshot readable by anyone with its URL, and lists it on Community.

- The **Publish** checkbox at creation is a shortcut. Any snapshot can be published or unpublished at any time afterwards.
- This does not violate immutability: published-ness is metadata about _sharing_, not part of the music.
- **Unpublishing** removes it from Community and makes the URL 404. Anyone holding the link loses access. That is the point of having it.
- The URL is a fixed path per published snapshot, keyed by an **unguessable random id** rather than a name-derived slug. No collisions, no squatting on names, no renaming breaking links.

### Attribution

A publisher name, typed the first time you publish and pre-filled thereafter. Stored per user.

**The account email is never shown.** It is the only identity the backend holds today, and a public page is the wrong place for it.

## The public surface

Two routes work with no account at all:

```
/community        browse everything published
/p/<id>           view and play one published snapshot
```

This means the app shell must render for a signed-out visitor. The auth gate currently wraps everything; it grows an exception for exactly these two routes.

**A visitor may view and play. Nothing else.** No editing, no printing, no export, no copying. The transport works, the notation is readable, and the page has a **Share** button showing the URL.

## Data model

`music_types` gains a `Snapshot` and the requests around it; `music_api` gains one table:

```ts
export type Snapshot = {
  id: UUID;
  projectId: UUID;
  /** The snapshot this one grew from. Null for the first in a project. */
  parentId: UUID | null;
  name: string;
  score: Score;
  uiPrefs?: ProjectUiPrefs;
  /** Set when published; the public URL is /p/<publicId>. Absent when not. */
  publicId?: string;
  publisherName?: string;
  createdAt: string;
};
```

`projects` gains `parentSnapshotId` — which snapshot the live work descends from.

Routes: authenticated CRUD for a project's snapshots plus publish/unpublish; **unauthenticated** `GET /public/snapshots/:publicId` and `GET /public/community`.

## Testing

- A snapshot is a full, independent copy: editing the project afterwards does not change it.
- Creating a snapshot re-parents the live project; opening one re-parents it to the opened snapshot.
- Opening v2 while v3 exists leaves v3 intact, and the next snapshot is v2's child — **the test that the tree is real**.
- Default names count globally, so a branch does not restart numbering.
- Publish yields a URL; unpublish 404s it and removes it from Community.
- The public routes serve **without** an Authorization header, and the authenticated ones still reject without one.
- A published snapshot's payload carries no email.
- The published view offers no edit affordance, and the store it loads is not writable through the UI.
- The flowchart places every snapshot and the live node, with correct parent edges.
- **e2e** — snapshot, edit, open the snapshot, confirm the edit is gone and the snapshot is unchanged; publish, open the URL in a signed-out context, play it.

## Out of scope

- **Deleting snapshots.** Immutability first; deletion is a separate decision with its own dangers.
- **Copying a published snapshot into your own projects.** The natural next feature, deliberately not this one.
- **Moderation, reporting or curation of Community.** Everything published is listed, newest first. Worth revisiting the moment it is used in anger.
- **Diffing or merging branches.**
- **Per-snapshot comments or descriptions** beyond the name.
- **Audio and .MOD formats.** The next two projects.

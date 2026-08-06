# Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pin a project at a moment that never changes again, move back to it, and branch from it.

**Architecture:** A `snapshots` table holding a full copy of the score plus a parent pointer, and a `parentSnapshotId` on `projects` saying where the live work sits in that tree. `music_app` gets a create action, a flowchart picker, and a guarded open.

**Tech Stack:** TypeScript (strict), Hono + Drizzle + PostgreSQL, React 19, React Query, Zustand, Vitest, Playwright, Bun.

## Global Constraints

- **A snapshot never changes once saved.** No route updates a snapshot's score or name. The only mutable field is the publishing metadata, which the _second_ plan adds.
- **Full copies, not diffs.**
- **The history is a tree.** Every snapshot has `parentId`; the live project has `parentSnapshotId`.
- **Opening is destructive to the live project and only to it.** No snapshot is ever deleted or altered by opening another.
- **Default names count globally** — `Version N` where N is the project's snapshot count plus one, regardless of branch.
- **This plan stops short of publishing.** No public routes, no `publicId`, no Community. That is the second plan against the same spec.
- **Do not commit or push.** `scripts/push_all.sh` does that.
- Publish order when a package changes: `music_types` → `music_client` → `music_app`; `music_api` is private and consumes `music_types` directly.

---

## File Structure

| File                                                   | Responsibility                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `music_types/src/index.ts`                             | `Snapshot`, `SnapshotSummary`, create-request schema, `parentSnapshotId`. |
| `music_api/src/db/index.ts`                            | `CREATE TABLE snapshots`.                                                 |
| `music_api/src/db/schema.ts`                           | Drizzle table, kept in sync.                                              |
| `music_api/src/services/snapshots.ts`                  | **New.** list / get / create; re-parenting the project.                   |
| `music_api/src/routes/snapshots.ts`                    | **New.** Authenticated routes.                                            |
| `music_client/src/hooks/use-snapshots.ts`              | **New.** Query and mutation hooks.                                        |
| `music_app/src/features/snapshots/snapshot-tree.ts`    | **New.** Pure: laying the tree out.                                       |
| `music_app/src/features/snapshots/SnapshotDialogs.tsx` | **New.** Create dialog and the guarded open.                              |

---

### Task 1: The model

**Files:**

- Modify: `~/projects/music_types/src/index.ts`
- Test: `~/projects/music_types/src/api.test.ts`

**Interfaces:**

- Produces:

```ts
export type Snapshot = {
  id: UUID;
  projectId: UUID;
  parentId: UUID | null;
  name: string;
  score: Score;
  uiPrefs?: ProjectUiPrefs;
  createdAt: string;
};
/** A snapshot without its score — what the picker lists. */
export type SnapshotSummary = Omit<Snapshot, 'score' | 'uiPrefs'>;
export const snapshotSchema: z.ZodType<Snapshot>;
export const snapshotSummarySchema: z.ZodType<SnapshotSummary>;
export const snapshotCreateRequestSchema: z.ZodType<{ name: string }>;
```

and `ProjectRecord.parentSnapshotId?: UUID | null`.

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_types/src/api.test.ts`:

```ts
describe('snapshot schemas', () => {
  const score = createEmptyScore({ title: 'P', measures: 1, tracks: [{ name: 'Piano' }] });
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    parentId: null,
    name: 'Version 1',
    score,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts a snapshot with no parent, which is the first in a project', () => {
    expect(snapshotSchema.parse(base).parentId).toBeNull();
  });

  it('accepts a snapshot that grew from another', () => {
    const child = { ...base, id: '33333333-3333-4333-8333-333333333333', parentId: base.id };
    expect(snapshotSchema.parse(child).parentId).toBe(base.id);
  });

  it('rejects an unnamed snapshot', () => {
    // A nameless version cannot be chosen from a picker.
    expect(() => snapshotSchema.parse({ ...base, name: '' })).toThrow();
  });

  it('summarises without the score, which the picker never needs', () => {
    const summary = snapshotSummarySchema.parse({ ...base, score: undefined });
    expect('score' in summary).toBe(false);
  });

  it('accepts a create request carrying just a name', () => {
    expect(snapshotCreateRequestSchema.parse({ name: 'Before the coda' }).name).toBe(
      'Before the coda',
    );
  });

  it('accepts a project record that knows which snapshot it descends from', () => {
    const record = projectRecordSchema.parse({
      id: 'p1',
      name: 'A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
      score,
      parentSnapshotId: base.id,
    });
    expect(record.parentSnapshotId).toBe(base.id);
  });

  it('accepts a project record with no parent, which is one never snapshotted', () => {
    const record = projectRecordSchema.parse({
      id: 'p1',
      name: 'A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
      score,
    });
    expect(record.parentSnapshotId ?? null).toBeNull();
  });
});
```

Add `snapshotSchema`, `snapshotSummarySchema`, `snapshotCreateRequestSchema` to the file's `./index` import.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_types && bun run test`
Expected: FAIL — the schemas do not exist.

- [x] **Step 3: Add the types and schemas**

In `~/projects/music_types/src/index.ts`, after the project types:

```ts
/**
 * A project pinned at a moment, which never changes again.
 *
 * Holds its **own full copy** of the score rather than a delta: reconstructing
 * a version by replaying diffs is exactly the thing that quietly stops being
 * reproducible, and immutability is the whole point here.
 */
export type Snapshot = {
  id: UUID;
  projectId: UUID;
  /** The snapshot this one grew from. Null for the first in a project. */
  parentId: UUID | null;
  name: string;
  score: Score;
  uiPrefs?: ProjectUiPrefs;
  createdAt: string;
};

/** A snapshot without its score — what the picker lists, so it stays cheap. */
export type SnapshotSummary = Omit<Snapshot, 'score' | 'uiPrefs'>;
```

and beside the other schemas:

```ts
export const snapshotSummarySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  name: z.string().min(1),
  createdAt: z.string().min(1),
});

export const snapshotSchema = snapshotSummarySchema.extend({
  score: scoreSchema,
  uiPrefs: projectUiPrefsSchema.optional(),
});

export const snapshotCreateRequestSchema = z.object({
  name: z.string().min(1).max(200),
});
```

In `projectRecordSchema` and the `ProjectRecord` type, add:

```ts
  /** Which snapshot the live work descends from, so a new one attaches there. */
  parentSnapshotId: z.string().min(1).nullable().optional(),
```

`scoreSchema` (line 324) and `projectUiPrefsSchema` (line 565) already exist
under those exact names; `snapshotSchema` must be declared after both.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_types && bun run verify`
Expected: PASS.

- [x] **Step 5: Publish and consume**

Bump the minor in `package.json` by hand, then:

```bash
cd ~/projects/music_types && npm publish
cd ~/projects/music_api && bun update @sudobility/music_types && bun run typecheck
```

`bun add <pkg>@<version>` frequently cannot resolve a just-published version for
several minutes while the registry propagates; `bun update` resolves it where
`bun add` and `bun install` do not. Do not use `npm version` — it commits.

---

### Task 2: Storage and routes

**Files:**

- Modify: `~/projects/music_api/src/db/index.ts`, `~/projects/music_api/src/db/schema.ts`
- Create: `~/projects/music_api/src/services/snapshots.ts`
- Create: `~/projects/music_api/src/routes/snapshots.ts`
- Modify: `~/projects/music_api/src/routes/index.ts`
- Create: `~/projects/music_api/src/routes/snapshots.integration.test.ts`

**Interfaces:**

- Produces:

```ts
export async function listSnapshots(
  db: Db,
  userId: string,
  projectId: string,
): Promise<SnapshotSummary[]>;
export async function getSnapshot(db: Db, userId: string, id: string): Promise<Snapshot | null>;
export async function createSnapshot(
  db: Db,
  userId: string,
  projectId: string,
  name: string,
): Promise<Snapshot>;
export async function openSnapshot(
  db: Db,
  userId: string,
  id: string,
): Promise<ProjectRecord | null>;
```

- [x] **Step 1: Write the failing test**

Create `~/projects/music_api/src/routes/snapshots.integration.test.ts`, following
the shape of `projects.integration.test.ts` (same app bootstrap, same auth stub):

```ts
describe('snapshots', () => {
  it('creates a snapshot holding a full copy of the score', async () => {
    const project = await createProjectViaApi();
    const res = await app.request(`/api/projects/${project.id}/snapshots`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Version 1' }),
    });
    expect(res.status).toBe(201);
    const snapshot = (await res.json()).data;
    expect(snapshot.score).toEqual(project.score);
    expect(snapshot.parentId).toBeNull();
  });

  it('re-parents the live project to the snapshot just created', async () => {
    // So the *next* snapshot attaches in the right place.
    const project = await createProjectViaApi();
    const first = await createSnapshotViaApi(project.id, 'Version 1');
    const reread = await getProjectViaApi(project.id);
    expect(reread.parentSnapshotId).toBe(first.id);
  });

  it('makes the next snapshot a child of the previous one', async () => {
    const project = await createProjectViaApi();
    const first = await createSnapshotViaApi(project.id, 'Version 1');
    const second = await createSnapshotViaApi(project.id, 'Version 2');
    expect(second.parentId).toBe(first.id);
  });

  it('does not change a snapshot when the project changes afterwards', async () => {
    // The whole promise.
    const project = await createProjectViaApi();
    const snapshot = await createSnapshotViaApi(project.id, 'Version 1');
    await updateProjectViaApi(project.id, { name: 'Renamed' });

    const reread = await getSnapshotViaApi(snapshot.id);
    expect(reread.score).toEqual(snapshot.score);
    expect(reread.name).toBe('Version 1');
  });

  it('opening a snapshot replaces the project score and re-parents it', async () => {
    const project = await createProjectViaApi();
    const first = await createSnapshotViaApi(project.id, 'Version 1');
    await updateProjectViaApi(project.id, { score: someOtherScore });

    const res = await app.request(`/api/snapshots/${first.id}/open`, {
      method: 'POST',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    const reread = await getProjectViaApi(project.id);
    expect(reread.score).toEqual(first.score);
    expect(reread.parentSnapshotId).toBe(first.id);
  });

  it('opening an old snapshot leaves the newer one intact — the tree is real', async () => {
    const project = await createProjectViaApi();
    const v1 = await createSnapshotViaApi(project.id, 'Version 1');
    const v2 = await createSnapshotViaApi(project.id, 'Version 2');

    await app.request(`/api/snapshots/${v1.id}/open`, { method: 'POST', headers: authHeaders() });
    const v3 = await createSnapshotViaApi(project.id, 'Version 3');

    expect((await getSnapshotViaApi(v2.id)).id).toBe(v2.id); // still there
    expect(v3.parentId).toBe(v1.id); // branched off v1, not v2
  });

  it('lists a project s snapshots without their scores', async () => {
    const project = await createProjectViaApi();
    await createSnapshotViaApi(project.id, 'Version 1');
    const res = await app.request(`/api/projects/${project.id}/snapshots`, {
      headers: authHeaders(),
    });
    const list = (await res.json()).data;
    expect(list).toHaveLength(1);
    expect('score' in list[0]).toBe(false);
  });

  it('refuses another user s snapshots', async () => {
    const project = await createProjectViaApi();
    const snapshot = await createSnapshotViaApi(project.id, 'Version 1');
    const res = await app.request(`/api/snapshots/${snapshot.id}`, {
      headers: authHeaders('someone-else'),
    });
    expect(res.status).toBe(404);
  });

  it('has no route that edits a snapshot', async () => {
    // Immutability enforced by absence, not by a check that can be forgotten.
    const project = await createProjectViaApi();
    const snapshot = await createSnapshotViaApi(project.id, 'Version 1');
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const res = await app.request(`/api/snapshots/${snapshot.id}`, {
        method,
        headers: authHeaders(),
        body: JSON.stringify({ name: 'nope' }),
      });
      expect(res.status).toBe(404);
    }
  });
});
```

Write `createProjectViaApi`, `createSnapshotViaApi`, `getProjectViaApi`,
`getSnapshotViaApi`, `updateProjectViaApi` and `authHeaders` as local helpers in
the file, matching how `projects.integration.test.ts` already builds requests —
read it first and reuse its exact bootstrap so both suites share one style.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_api && bun run test snapshots`
Expected: FAIL — the routes 404.

- [x] **Step 3: Add the table**

In `~/projects/music_api/src/db/index.ts`, inside `initDatabase`, after the
projects index:

```ts
await sql`
    CREATE TABLE IF NOT EXISTS snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      parent_id UUID REFERENCES snapshots(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      score JSONB NOT NULL,
      ui_prefs JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
await sql`CREATE INDEX IF NOT EXISTS snapshots_project_id_idx ON snapshots (project_id)`;
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_snapshot_id UUID`;
```

`ON DELETE SET NULL` on the parent, not CASCADE: deleting a project takes its
snapshots with it, but nothing else may quietly remove one.

In `~/projects/music_api/src/db/schema.ts`, mirror it:

```ts
export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    userId: text('user_id').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    score: jsonb('score').$type<Score>().notNull(),
    uiPrefs: jsonb('ui_prefs').$type<ProjectUiPrefs | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('snapshots_project_id_idx').on(table.projectId)],
);
```

and add `parentSnapshotId: uuid('parent_snapshot_id')` to `projects`.

- [x] **Step 4: Add the service**

Create `~/projects/music_api/src/services/snapshots.ts`:

```ts
/**
 * Snapshots: a project pinned at a moment, which never changes again.
 *
 * There is deliberately no update and no delete. Immutability is enforced by
 * the absence of a route rather than by a check somebody can forget.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { ProjectRecord, Snapshot, SnapshotSummary } from '@sudobility/music_types';
import { projects, snapshots } from '../db/schema.js';
import type { Db } from '../db/index.js';

/** Rows carry Dates and nulls; the wire type carries ISO strings and optionals. */
function toSnapshot(row: typeof snapshots.$inferSelect): Snapshot {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    name: row.name,
    score: row.score,
    ...(row.uiPrefs ? { uiPrefs: row.uiPrefs } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

function toSummary(row: typeof snapshots.$inferSelect): SnapshotSummary {
  const { score: _score, uiPrefs: _uiPrefs, ...rest } = toSnapshot(row);
  return rest;
}

export async function listSnapshots(
  db: Db,
  userId: string,
  projectId: string,
): Promise<SnapshotSummary[]> {
  const rows = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.userId, userId), eq(snapshots.projectId, projectId)))
    .orderBy(desc(snapshots.createdAt));
  return rows.map(toSummary);
}

export async function getSnapshot(db: Db, userId: string, id: string): Promise<Snapshot | null> {
  const rows = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.userId, userId), eq(snapshots.id, id)));
  return rows[0] ? toSnapshot(rows[0]) : null;
}

/**
 * Pins the project's current score, then points the live project at the new
 * snapshot so the *next* one attaches as its child.
 */
export async function createSnapshot(
  db: Db,
  userId: string,
  projectId: string,
  name: string,
): Promise<Snapshot | null> {
  const found = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.id, projectId)));
  const project = found[0];
  if (!project) return null;

  const inserted = await db
    .insert(snapshots)
    .values({
      projectId,
      userId,
      parentId: project.parentSnapshotId ?? null,
      name,
      score: project.score,
      uiPrefs: project.uiPrefs ?? null,
    })
    .returning();

  const snapshot = toSnapshot(inserted[0]);
  await db
    .update(projects)
    .set({ parentSnapshotId: snapshot.id, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return snapshot;
}

/**
 * Replaces the live project's score with the snapshot's and re-parents it.
 *
 * Destructive to the live project and to nothing else: every snapshot,
 * including any on the branch being left behind, is untouched.
 */
export async function openSnapshot(
  db: Db,
  userId: string,
  id: string,
): Promise<ProjectRecord | null> {
  const snapshot = await getSnapshot(db, userId, id);
  if (!snapshot) return null;

  const updated = await db
    .update(projects)
    .set({
      score: snapshot.score,
      uiPrefs: snapshot.uiPrefs ?? null,
      parentSnapshotId: snapshot.id,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.userId, userId), eq(projects.id, snapshot.projectId)))
    .returning();
  if (!updated[0]) return null;

  const row = updated[0];
  return {
    id: row.id,
    name: row.name,
    score: row.score,
    ...(row.uiPrefs ? { uiPrefs: row.uiPrefs } : {}),
    parentSnapshotId: row.parentSnapshotId ?? null,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as ProjectRecord;
}
```

`services/projects.ts` already has a private `toRecord(row)` (line 34) building
exactly this shape. Export it and use it here instead of the inline object
above — one mapper, not two that can drift.

- [x] **Step 5: Add the routes**

Create `~/projects/music_api/src/routes/snapshots.ts`, matching
`routes/projects.ts`'s style exactly (same router construction, same
`successResponse`/`errorResponse` envelope, same 404 handling):

```ts
router.get('/projects/:projectId/snapshots', async (c) =>
  c.json(
    successResponse(
      await service.listSnapshots(getDb(), c.get('userId'), c.req.param('projectId')),
    ),
  ),
);

router.post(
  '/projects/:projectId/snapshots',
  zValidator('json', snapshotCreateRequestSchema),
  async (c) => {
    const snapshot = await service.createSnapshot(
      getDb(),
      c.get('userId'),
      c.req.param('projectId'),
      c.req.valid('json').name,
    );
    if (!snapshot) return c.json(errorResponse('Project not found'), 404);
    return c.json(successResponse(snapshot), 201);
  },
);

router.get('/snapshots/:id', async (c) => {
  const snapshot = await service.getSnapshot(getDb(), c.get('userId'), c.req.param('id'));
  if (!snapshot) return c.json(errorResponse('Snapshot not found'), 404);
  return c.json(successResponse(snapshot));
});

router.post('/snapshots/:id/open', async (c) => {
  const project = await service.openSnapshot(getDb(), c.get('userId'), c.req.param('id'));
  if (!project) return c.json(errorResponse('Snapshot not found'), 404);
  return c.json(successResponse(project));
});
```

Deliberately no PATCH, PUT or DELETE. Mount it in `src/routes/index.ts` beside
the projects router, behind the same auth middleware.

- [x] **Step 6: Run the tests to verify they pass**

Run: `cd ~/projects/music_api && bun run test snapshots`
Expected: PASS. Needs the local Postgres `music_test` DB, as the other
integration suites do.

- [x] **Step 7: Verify**

Run: `cd ~/projects/music_api && bun run verify`
Expected: PASS.

---

### Task 3: Client hooks

**Files:**

- Create: `~/projects/music_client/src/hooks/use-snapshots.ts`
- Modify: `~/projects/music_client/src/index.ts`, and the `MusicClient` network surface
- Test: `~/projects/music_client/src/hooks/use-snapshots.test.ts`

**Interfaces:**

- Produces: `useSnapshots(ctx, projectId)`, `useCreateSnapshot(ctx)`, `useOpenSnapshot(ctx)`.

- [ ] **Step 1: Write the failing test**

Mirror `use-projects.test.ts` exactly — same fake network client, same
`QueryClientProvider` wrapper. Assert:

```ts
it('lists a project s snapshots', async () => {
  /* GET /projects/:id/snapshots */
});

it('invalidates the snapshot list after creating one', async () => {
  // Otherwise the picker shows a stale tree the moment you snapshot.
});

it('invalidates the project after opening a snapshot', async () => {
  // The live score changed underneath; a stale cache would show the old work.
});
```

Read `use-projects.test.ts` first and copy its harness verbatim rather than
inventing a second one.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_client && bun run test use-snapshots`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the hooks**

Create `~/projects/music_client/src/hooks/use-snapshots.ts` following
`use-projects.ts`'s structure: one `queryKey` factory, `useQuery` for reads,
`useMutation` + `invalidateQueries` for writes.

```ts
export const snapshotKeys = {
  list: (projectId: string) => ['snapshots', projectId] as const,
};

export function useSnapshots(ctx: MusicHookContext, projectId: string | null) {
  return useQuery({
    queryKey: snapshotKeys.list(projectId ?? ''),
    queryFn: () => ctx.client.listSnapshots(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useCreateSnapshot(ctx: MusicHookContext) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { projectId: string; name: string }) =>
      ctx.client.createSnapshot(vars.projectId, vars.name),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: snapshotKeys.list(vars.projectId) });
      // The project's parentSnapshotId moved, so its cache entry is stale too.
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(vars.projectId) });
    },
  });
}

export function useOpenSnapshot(ctx: MusicHookContext) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { snapshotId: string; projectId: string }) =>
      ctx.client.openSnapshot(vars.snapshotId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(vars.projectId) });
      void queryClient.invalidateQueries({ queryKey: snapshotKeys.list(vars.projectId) });
    },
  });
}
```

Use whatever `projectKeys` factory `use-projects.ts` already exports; if its keys
are inline rather than factored out, factor them out in the same commit so both
hook files share one source of query keys.

Add the four calls to `MusicClient` in `src/network/`, matching the existing
project methods' shape and error handling.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_client && bun run verify`
Expected: PASS.

- [ ] **Step 5: Publish and consume**

```bash
cd ~/projects/music_client && npm publish   # after bumping the minor by hand
cd ~/projects/music_app && bun update @sudobility/music_client @sudobility/music_types
```

---

### Task 4: Laying out the tree

**Files:**

- Create: `~/projects/music_app/src/features/snapshots/snapshot-tree.ts`
- Create: `~/projects/music_app/src/features/snapshots/snapshot-tree.test.ts`

**Interfaces:**

- Produces:

```ts
export type TreeNode = {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  /** Generations from the root. */
  depth: number;
  /** Row within that generation, so siblings do not overlap. */
  lane: number;
  /** True for the synthetic node standing for uncommitted work. */
  isLive: boolean;
};
export function snapshotTree(
  snapshots: readonly SnapshotSummary[],
  liveParentId: string | null,
): TreeNode[];
```

- [x] **Step 1: Write the failing test**

Create `~/projects/music_app/src/features/snapshots/snapshot-tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { snapshotTree } from '@/features/snapshots/snapshot-tree';
import type { SnapshotSummary } from '@sudobility/music_types';

/** `[id, parentId]` pairs, oldest first. */
function summaries(pairs: Array<[string, string | null]>): SnapshotSummary[] {
  return pairs.map(([id, parentId], i) => ({
    id,
    projectId: 'p',
    parentId,
    name: `Version ${i + 1}`,
    createdAt: new Date(2026, 0, i + 1).toISOString(),
  }));
}

describe('snapshotTree', () => {
  it('puts each snapshot one generation below its parent', () => {
    const nodes = snapshotTree(
      summaries([
        ['a', null],
        ['b', 'a'],
        ['c', 'b'],
      ]),
      'c',
    );
    expect(nodes.find((n) => n.id === 'a')!.depth).toBe(0);
    expect(nodes.find((n) => n.id === 'b')!.depth).toBe(1);
    expect(nodes.find((n) => n.id === 'c')!.depth).toBe(2);
  });

  it('gives siblings different lanes so a branch is visible', () => {
    // a ── b
    //  └── c
    const nodes = snapshotTree(
      summaries([
        ['a', null],
        ['b', 'a'],
        ['c', 'a'],
      ]),
      'c',
    );
    const b = nodes.find((n) => n.id === 'b')!;
    const c = nodes.find((n) => n.id === 'c')!;
    expect(b.depth).toBe(c.depth);
    expect(b.lane).not.toBe(c.lane);
  });

  it('adds a live node hanging off the snapshot the work descends from', () => {
    // The question the screen exists to answer: you are here.
    const nodes = snapshotTree(
      summaries([
        ['a', null],
        ['b', 'a'],
      ]),
      'b',
    );
    const live = nodes.find((n) => n.isLive)!;
    expect(live.parentId).toBe('b');
    expect(live.depth).toBe(2);
  });

  it('roots the live node when the project has never been snapshotted', () => {
    const nodes = snapshotTree([], null);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].isLive).toBe(true);
    expect(nodes[0].depth).toBe(0);
  });

  it('keeps an orphan reachable rather than dropping it', () => {
    // A parent could be missing if data is ever partially loaded; a node that
    // vanishes from the picker is worse than one drawn at the root.
    const nodes = snapshotTree(summaries([['b', 'gone']]), 'b');
    expect(nodes.some((n) => n.id === 'b')).toBe(true);
  });

  it('places every snapshot exactly once', () => {
    const input = summaries([
      ['a', null],
      ['b', 'a'],
      ['c', 'a'],
      ['d', 'c'],
    ]);
    const nodes = snapshotTree(input, 'd').filter((n) => !n.isLive);
    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test snapshot-tree`
Expected: FAIL — the module does not exist.

- [x] **Step 3: Implement it**

Create `~/projects/music_app/src/features/snapshots/snapshot-tree.ts`:

```ts
/**
 * Laying the snapshot history out as a flowchart.
 *
 * Pure over the summaries — no React, no fetching — in the same shape as
 * `print-layout.ts`, so the structure is testable without rendering it.
 *
 * The live project appears as a synthetic node hanging off the snapshot it
 * descends from. "You are here" is the question the picker exists to answer,
 * and a tree without it is just a list of names.
 */
import type { SnapshotSummary } from '@sudobility/music_types';

export const LIVE_NODE_ID = '__live__';

export type TreeNode = {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  depth: number;
  lane: number;
  isLive: boolean;
};

export function snapshotTree(
  snapshots: readonly SnapshotSummary[],
  liveParentId: string | null,
): TreeNode[] {
  const byId = new Map(snapshots.map((s) => [s.id, s]));

  /** Generations from the root. An orphan counts as a root rather than vanishing. */
  const depthOf = (id: string, seen = new Set<string>()): number => {
    const snapshot = byId.get(id);
    if (!snapshot || snapshot.parentId === null || seen.has(id)) return 0;
    if (!byId.has(snapshot.parentId)) return 0;
    seen.add(id);
    return depthOf(snapshot.parentId, seen) + 1;
  };

  const ordered = [...snapshots].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const laneAt = new Map<number, number>();
  const nextLane = (depth: number): number => {
    const lane = laneAt.get(depth) ?? 0;
    laneAt.set(depth, lane + 1);
    return lane;
  };

  const nodes: TreeNode[] = ordered.map((snapshot) => {
    const depth = depthOf(snapshot.id);
    return {
      id: snapshot.id,
      parentId: snapshot.parentId,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      depth,
      lane: nextLane(depth),
      isLive: false,
    };
  });

  const liveDepth = liveParentId && byId.has(liveParentId) ? depthOf(liveParentId) + 1 : 0;
  nodes.push({
    id: LIVE_NODE_ID,
    parentId: liveParentId,
    name: 'Current work',
    createdAt: new Date(0).toISOString(),
    depth: liveDepth,
    lane: nextLane(liveDepth),
    isLive: true,
  });

  return nodes;
}
```

`new Date(0)` rather than `Date.now()`: the live node's timestamp is never
displayed, and a real clock would make this function untestable.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test snapshot-tree`
Expected: PASS.

- [x] **Step 5: Verify the tests are not vacuous**

Make `nextLane` always return 0 and confirm the siblings test fails. Make the
live node always root at depth 0 and confirm the "hangs off" test fails.
Restore both.

---

### Task 5: The dialogs

**Files:**

- Create: `~/projects/music_app/src/features/snapshots/SnapshotDialogs.tsx`
- Create: `~/projects/music_app/src/features/snapshots/SnapshotDialogs.test.tsx`
- Modify: `~/projects/music_app/src/components/layout/AppLayout.tsx` (the menu
  bar holding the existing `Export menu`, around line 476)

- [ ] **Step 1: Write the failing test**

```tsx
describe('CreateSnapshotDialog', () => {
  it('defaults the name to the next global version number', () => {
    // Global, not per-branch: "Version 4" off "Version 2" beats "Version 2.1.1".
    render(<CreateSnapshotDialog open snapshotCount={3} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Snapshot name')).toHaveValue('Version 4');
  });

  it('lets the name be replaced', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={onCreate} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText('Snapshot name'));
    await user.type(screen.getByLabelText('Snapshot name'), 'Before the coda');
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    expect(onCreate).toHaveBeenCalledWith('Before the coda');
  });

  it('refuses an empty name', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={onCreate} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText('Snapshot name'));
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('OpenSnapshotDialog', () => {
  it('warns that current work will be replaced', () => {
    render(
      <OpenSnapshotDialog
        open
        nodes={[]}
        onOpen={vi.fn()}
        onSnapshotFirst={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/current work will be replaced/i)).toBeVisible();
  });

  it('offers to snapshot the current work first', async () => {
    // The destructive path always has a non-destructive escape.
    const user = userEvent.setup();
    const onSnapshotFirst = vi.fn();
    render(
      <OpenSnapshotDialog
        open
        nodes={[]}
        onOpen={vi.fn()}
        onSnapshotFirst={onSnapshotFirst}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /snapshot current work first/i }));
    expect(onSnapshotFirst).toHaveBeenCalled();
  });

  it('does not offer the live node as something to open', async () => {
    // Opening "where you already are" is a no-op that destroys nothing but
    // reads as if it might.
    const nodes = snapshotTree(
      [
        {
          id: 'a',
          projectId: 'p',
          parentId: null,
          name: 'Version 1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      'a',
    );
    render(
      <OpenSnapshotDialog
        open
        nodes={nodes}
        onOpen={vi.fn()}
        onSnapshotFirst={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Version 1/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Current work/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test SnapshotDialogs`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Build the dialogs**

Create `~/projects/music_app/src/features/snapshots/SnapshotDialogs.tsx` using
`@sudobility/components`' Dialog primitives, matching the existing dialogs in
`src/components/dialogs/` for structure and class names.

`CreateSnapshotDialog` takes `{ open, snapshotCount, onCreate, onClose }` and
defaults its field to `Version ${snapshotCount + 1}`.

`OpenSnapshotDialog` takes `{ open, nodes, onOpen, onSnapshotFirst, onClose }`,
renders the warning, the "Snapshot current work first" button, and the nodes
positioned by `depth`/`lane` with a line to each parent — one button per
non-live node, the live node drawn dashed and not clickable.

- [ ] **Step 4: Wire the menu**

Add **Create snapshot…** and **Open snapshot…** to `AppLayout.tsx`'s menu bar
beside the existing `Export menu`, passing
`useSnapshots`/`useCreateSnapshot`/`useOpenSnapshot`. After a successful open,
push the returned project's score into the store via `setScore` so the editor
shows the restored work without a reload.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test SnapshotDialogs`
Expected: PASS.

---

### Task 6: End to end

**Files:**

- Create: `~/projects/music_app/e2e/snapshots.spec.ts`

- [ ] **Step 1: Write the e2e**

```ts
test('a snapshot survives later edits, and opening it restores them', async ({ page }) => {
  await gotoDashboard(page);
  await createNewProject(page, 'Snapshot Test');
  await generateWholeScore(page, { prompt: 'Create a calm study', measures: 4 });
  await waitForNotation(page);

  const before = await readScoreSummary(page);

  await page.getByRole('button', { name: 'Project menu' }).click();
  await page.getByRole('menuitem', { name: 'Create snapshot…' }).click();
  await expect(page.getByLabelText('Snapshot name')).toHaveValue('Version 1');
  await page.getByRole('button', { name: 'Create snapshot' }).click();

  // Change the music so restoring is observable.
  await page.keyboard.press('Delete');
  const afterEdit = await readScoreSummary(page);
  expect(afterEdit!.notes.length).not.toBe(before!.notes.length);

  await page.getByRole('button', { name: 'Project menu' }).click();
  await page.getByRole('menuitem', { name: 'Open snapshot…' }).click();
  await expect(page.getByText(/current work will be replaced/i)).toBeVisible();
  await page.getByRole('button', { name: /Version 1/ }).click();
  await page.getByRole('button', { name: 'Open' }).click();

  await expect
    .poll(async () => (await readScoreSummary(page))?.notes.length)
    .toBe(before!.notes.length);
});
```

Select a note before pressing Delete if the editor requires a selection — check
`select-edit-undo.spec.ts` for how it makes an edit, and reuse that.

- [ ] **Step 2: Run everything**

```bash
cd ~/projects/music_types && bun run verify
cd ~/projects/music_api && bun run verify
cd ~/projects/music_client && bun run verify
cd ~/projects/music_app && bun run verify
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e
```

- [ ] **Step 3: Try it by hand**

Snapshot, edit, snapshot again, open the first one, and check by eye: the
flowchart shows three nodes with the live one dashed off the one you opened;
the older branch is still drawn; the warning appeared; and "snapshot current
work first" produced a fourth node rather than losing the edit.

---

## Self-Review

**Spec coverage.** Tree with parent pointers → Tasks 1, 2, 4. Full copies → Task 2's create. Live pointer re-parenting on create and open → Task 2, asserted twice. Nothing deleted by opening → Task 2's "leaves the newer one intact". Immutability → Task 2's "has no route that edits a snapshot". Global default naming → Tasks 4 and 5. Flowchart with a live node → Tasks 4 and 5. Warning plus snapshot-first escape → Task 5. e2e → Task 6.

**Deliberate gaps, stated rather than hidden:**

- **Publishing is absent by design** — no `publicId`, no public routes, no Community. The second plan against this spec adds them, and the model here has room for it without a migration of existing rows.
- **`depthOf` recomputes per node** rather than memoising, so a pathological chain is O(n²). At the scale of one project's snapshots this is irrelevant; the `seen` set is there to stop a cycle hanging the picker, not for speed.
- **Lanes are assigned in creation order within a generation**, not by minimising edge crossings. Good enough for tens of nodes; a real layered graph layout is a different project.
- **Task 5 describes the dialogs' structure rather than giving their full JSX**, because they are ordinary compositions of existing `@sudobility/components` primitives and the repo's own dialogs are the better template than anything written here. The _behaviour_ is pinned by the tests in Step 1, which are complete.

**Type consistency.** `Snapshot` / `SnapshotSummary` are defined in Task 1 and consumed in Tasks 2, 3 and 4. `parentSnapshotId` is added to `ProjectRecord` in Task 1, written in Task 2's create and open, and read in Task 4 as `liveParentId`. `TreeNode` is produced in Task 4 and consumed by `OpenSnapshotDialog` in Task 5. `snapshotCreateRequestSchema` is defined in Task 1 and used by the route validator in Task 2.

---

## Execution Notes (2026-08-05) — all six tasks complete

**Complete: Tasks 1, 2, 3, 4, 5.** Task 6's e2e reaches its final assertion
and fails there — see the end of this section.

- `music_types` **0.8.0** published with `Snapshot`, `SnapshotSummary` and
  `ProjectRecord.parentSnapshotId`. 60 tests.
- `music_api`: `snapshots` table, `parent_snapshot_id` on `projects`, service
  and routes. **95 tests green against real PostgreSQL**, lint clean.
- `music_app`: `snapshot-tree.ts` with 6 tests. 554 tests green.

Every one of these was checked against a deliberately broken implementation
rather than trusted for being green:

- Forcing `parentId: null` on create fails "makes the next snapshot a child"
  and "the tree is real".
- Removing the re-parent on create fails "re-parents the live project" and the
  chain test.
- Flattening lanes fails the siblings test; rooting the live node fails the
  "hangs off" test.

**One sabotage silently did nothing the first time** — my replacement string did
not match the file's actual formatting, so the suite passed and briefly looked
like proof. Re-run against the real text, it failed the two tests it should.
A sabotage that changes no bytes proves nothing; check the edit landed.

**Two deviations from the plan, both forced by the code:**

1. Routes mount at `/projects` and `/ai`, so the project-scoped snapshot routes
   live on the **projects** router (`GET|POST /:id/snapshots`) and only
   `GET /:id` and `POST /:id/open` are on a new `/snapshots` router. The plan
   assumed a flat mount.
2. `Db` is a local type alias in `services/projects.ts`, not an export of
   `../db`. Declared the same way in `services/snapshots.ts`.

Also: `toSummary` was written with a destructure-and-discard, which the API's
eslint rejects as unused vars. Rewritten to build the object explicitly.

Not committed — `scripts/push_all.sh` owns commits.

### Second pass — Tasks 3 and 5

- `music_client` **0.3.0** published: `listSnapshots`/`createSnapshot`/
  `getSnapshot`/`openSnapshot` on `MusicClient`, plus `useSnapshots`,
  `useCreateSnapshot`, `useOpenSnapshot` and snapshot query keys. 16 tests.
  Removing the project invalidation from create fails its test.
- `music_app`: `SnapshotDialogs.tsx` (8 tests) and a **Project** menu in
  `AppLayout` with Create/Open snapshot. 562 tests green.

**Deviation: the app does not use the React Query hooks.** `DashboardPage` and
every export path in `AppLayout` reach the backend through
`getAppServices().musicClient` directly; there is no React Query provider around
that subtree to hang hooks off. The wiring follows the file's existing style
instead. The hooks are still correct, tested and exported — the Community page
in the publishing plan is their natural first consumer — but as of this pass
they are unused by `music_app`, which is worth knowing before treating them as
proven in situ.

**Also corrected during execution:** `@sudobility/components`' `Dialog` takes
`isOpen`, not `open`, and has no `title` prop. The plan's dialog sketch was
wrong; the tests caught it immediately (every one failed with an empty body).

### Task 6: complete — and it found a real bug

`e2e/snapshots.spec.ts` passes. Full suite: 34 e2e, 562 music_app,
95 music_api, 16 music_client, 60 music_types.

**The e2e caught a design bug the unit and integration tests could not.**
`createSnapshot` copies the score from the **server's** `projects` row, and the
client autosaves on a debounce — so a snapshot pinned whatever the server last
happened to receive rather than what was on screen. For a freshly generated
score that is _nothing at all_: the diagnostic showed the restored score coming
back as `[]` while the editor held `["D","E","G","C"]`.

Every layer below was correct and green. The API integration tests snapshot a
project that was created through the API, so its row is current by
construction — they could never see this. It only appears when the thing on
screen is ahead of the thing on the server, which is the normal state of an
editor with debounced autosave.

Fix: `AppLayout` pushes the live score with `updateProject` before asking for a
snapshot. Confirmed load-bearing — removing that one line fails the e2e.

**Two test bugs fixed on the way, both mine:**

1. Asserting `notes[0]` rather than tracking the edited note **by id**. Opening
   a snapshot replaces the whole score and nothing guarantees list order.
2. A dialog-overlay race: after "Create snapshot" the overlay still intercepted
   clicks, so the next canvas click silently missed and the test failed
   intermittently at `1 note(s) selected`. Now waits for the dialog to hide.

My first hypothesis — unstable ordering — was wrong. Had I "fixed" the
assertion to match the observed value instead of diagnosing, a genuinely broken
feature would have shipped with a green test.

Not committed — `scripts/push_all.sh` owns commits.

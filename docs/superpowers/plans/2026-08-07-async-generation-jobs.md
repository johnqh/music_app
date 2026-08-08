# Async Generation Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every AI generation into a persisted server-side job that survives the browser closing, and reach generation from the thing you want to change — selected notes, selected measures, or a track.

**Architecture:** A `generation_jobs` table in `music_api` holds the whole request; the server runs the provider call in-process, applies the result to the project itself, and flips a new `projects.status` flag from `generating` back to `ready`. The browser starts jobs and polls. Because the server now applies results, `music_api` gains a dependency on the platform-free `@sudobility/music_lib` for `replaceRegionCommand`. Cancellation is cooperative: it writes `ready` to the project, and the job discards its result when it sees that.

**Tech Stack:** Hono + Drizzle + PostgreSQL (`music_api`), Zod schemas (`music_types`), Zustand + React Query (`music_app`), Vitest everywhere, Playwright for e2e.

## Global Constraints

- **One candidate, always.** Every provider request pins `candidateCount: 1`. There is no candidate list, no A/B compare, no accept step.
- **`generating` means "still wanted".** A running job's project is `generating`; cancel writes `ready`. Every step boundary and the final apply check for `generating`, never for `ready`.
- **The job never re-reads the project to build its request.** The request is stored whole at submit time.
- **The API rejects `PUT /projects/:id` while the project is `generating`.**
- **Schema changes are forward-only idempotent SQL** in `initDatabase()` (`music_api/src/db/index.ts`), mirrored in `src/db/schema.ts`. Never a destructive migration.
- **Owner scoping:** a job or project id belonging to another user behaves exactly like a missing id — 404, never 403.
- **No business logic in `music_app`.** Region derivation goes in `music_lib`.
- **Every modal is `FormModal`** from `@sudobility/components`, and any dialog whose footer has a Cancel sets `closeAriaLabel="Close dialog"`.
- **Do not commit and push.** `push_all.sh` does that. Task commit steps stage and commit locally only; no `git push`.
- Repos live at `~/projects/{music_types,music_lib,music_api,music_app}`. Cross-repo work needs the dependency published (via `push_all.sh`) before the consumer can `bun update` to it — or `bun link` for local iteration.

---

## File Structure

**`music_types`** (`src/index.ts`) — job and project-status types plus Zod schemas. One file; this package is a single barrel by convention.

**`music_api`**

- `src/db/schema.ts` — `generationJobs` table, `projects.status` column.
- `src/db/index.ts` — idempotent DDL for both.
- `src/services/jobs/store.ts` — CRUD for job rows, owner-scoped. No provider calls.
- `src/services/jobs/runner.ts` — runs a job: provider call, status re-check, apply, finalise. The only place that writes a project's score from a job.
- `src/services/jobs/apply.ts` — turns a job result into a new `Score`, using `music_lib`.
- `src/services/jobs/recover.ts` — boot-time sweep of orphaned `running` jobs.
- `src/routes/jobs.ts` — `POST /jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel`.
- `src/services/projects.ts` — status in `toSummary`/`toRecord`; reject writes while generating.
- `src/services/generation/prompts.ts` — style/mood/complexity on the regenerate prompt.

**`music_lib`**

- `src/domain/generation/replacement-region.ts` — the pure per-scope region functions.
- `src/services/regeneration/controller.ts` — a range-taking entry point the selection-based one delegates to.

**`music_app`**

- `src/features/generation/ReplaceMusicDialog.tsx` — one modal, parameterised by scope.
- `src/features/generation/GenerateScoreDialog.tsx` — the dashboard modal (GenerationPanel's fields).
- `src/features/generation/useGenerationJob.ts` — start/cancel/poll.
- `src/components/layout/GeneratingOverlay.tsx` — the greyed-out editor cover.
- Deleted: `CandidateList.tsx(+test)`, `preview.ts(+test)`, `RegenerationPanel.tsx(+test)`, `GenerationPanel.tsx(+test)`.

---

## Task 1: Job and project-status types in `music_types`

**Files:**

- Modify: `~/projects/music_types/src/index.ts`
- Test: `~/projects/music_types/src/generation-schema.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `ProjectStatus`, `GenerationJobKind`, `GenerationJobStatus`, `GenerationJob`, `CreateGenerationJobRequest`, `generationJobSchema`, `createGenerationJobRequestSchema`. `ProjectSummary` gains `status: ProjectStatus`. `RegenerateRegionRequest` gains `style?`, `mood?`, `complexity?`.

- [ ] **Step 1: Write the failing tests**

Append to `src/generation-schema.test.ts`:

```ts
import {
  createGenerationJobRequestSchema,
  generationJobSchema,
  regenerateRegionRequestSchema,
} from './index';

describe('createGenerationJobRequestSchema', () => {
  const valid = () => ({
    projectId: '11111111-1111-1111-1111-111111111111',
    kind: 'replace-notes' as const,
    request: { anything: true },
  });

  it('accepts each of the five kinds', () => {
    for (const kind of [
      'generate-score',
      'generate-track',
      'replace-notes',
      'replace-measures',
      'replace-track',
    ] as const) {
      expect(createGenerationJobRequestSchema.safeParse({ ...valid(), kind }).success).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    expect(
      createGenerationJobRequestSchema.safeParse({ ...valid(), kind: 'transcribe' }).success,
    ).toBe(false);
  });

  it('requires a projectId, since every job now owns one', () => {
    const { projectId: _omitted, ...rest } = valid();
    expect(createGenerationJobRequestSchema.safeParse(rest).success).toBe(false);
  });
});

describe('generationJobSchema', () => {
  const valid = () => ({
    id: '22222222-2222-2222-2222-222222222222',
    projectId: '11111111-1111-1111-1111-111111111111',
    kind: 'generate-track' as const,
    status: 'running' as const,
    createdAt: '2026-08-07T00:00:00.000Z',
    finishedAt: null,
    error: null,
  });

  it('accepts a running job with no finish time or error', () => {
    expect(generationJobSchema.safeParse(valid()).success).toBe(true);
  });

  it('accepts every terminal status', () => {
    for (const status of ['done', 'failed', 'cancelled'] as const) {
      expect(
        generationJobSchema.safeParse({
          ...valid(),
          status,
          finishedAt: '2026-08-07T00:01:00.000Z',
        }).success,
      ).toBe(true);
    }
  });

  it('rejects a status outside the four', () => {
    expect(generationJobSchema.safeParse({ ...valid(), status: 'queued' }).success).toBe(false);
  });
});

describe('regenerateRegionRequestSchema style/mood/complexity', () => {
  it('accepts the three new optional fields', () => {
    const req = {
      ...validRegenerateRequest(),
      style: 'baroque',
      mood: 'melancholy',
      complexity: 'complex' as const,
    };
    expect(regenerateRegionRequestSchema.safeParse(req).success).toBe(true);
  });

  it('still accepts a request without them, so existing callers are unaffected', () => {
    expect(regenerateRegionRequestSchema.safeParse(validRegenerateRequest()).success).toBe(true);
  });

  it('rejects a complexity outside the enum', () => {
    const req = { ...validRegenerateRequest(), complexity: 'extreme' };
    expect(regenerateRegionRequestSchema.safeParse(req).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/music_types && bunx vitest run src/generation-schema.test.ts`
Expected: FAIL — `createGenerationJobRequestSchema` and `generationJobSchema` are not exported.

- [ ] **Step 3: Add the types and schemas**

In `src/index.ts`, after `regenerateRegionResultSchema` (around line 480):

```ts
/** Whether a project can be edited right now. Two states, because that is the only question the editor asks. */
export type ProjectStatus = 'ready' | 'generating';

export const projectStatusSchema = z.enum(['ready', 'generating']);

/** Which of the five generation entry points produced a job. */
export type GenerationJobKind =
  'generate-score' | 'generate-track' | 'replace-notes' | 'replace-measures' | 'replace-track';

export const generationJobKindSchema = z.enum([
  'generate-score',
  'generate-track',
  'replace-notes',
  'replace-measures',
  'replace-track',
]);

/**
 * A job's own lifecycle, which is richer than its project's: `cancelled`
 * records that a result was produced and thrown away, which `ready` on the
 * project cannot express.
 */
export type GenerationJobStatus = 'running' | 'done' | 'failed' | 'cancelled';

export const generationJobStatusSchema = z.enum(['running', 'done', 'failed', 'cancelled']);

/** A job as reported to the client. The stored `request`/`result` payloads are deliberately not included — they are large and the client never needs them. */
export type GenerationJob = {
  id: UUID;
  projectId: UUID;
  kind: GenerationJobKind;
  status: GenerationJobStatus;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
};

export const generationJobSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: generationJobKindSchema,
  status: generationJobStatusSchema,
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});

/** `request` is the whole provider request, stored verbatim so the job never re-reads the project. Shape varies by `kind`, so it is unknown here and narrowed by the runner. */
export type CreateGenerationJobRequest = {
  projectId: UUID;
  kind: GenerationJobKind;
  request: unknown;
};

export const createGenerationJobRequestSchema = z.object({
  projectId: z.string().min(1),
  kind: generationJobKindSchema,
  request: z.unknown(),
});
```

Add the three optional fields to `regenerateRegionRequestSchema` (line 464), after `candidateCount`:

```ts
  style: z.string().optional(),
  mood: z.string().optional(),
  complexity: z.enum(['simple', 'moderate', 'complex']).optional(),
```

Add the matching fields to the `RegenerateRegionRequest` type, after `candidateCount: number;`:

```ts
    style?: string;
    mood?: string;
    complexity?: 'simple' | 'moderate' | 'complex';
```

Add `status` to `ProjectSummary` (line 531):

```ts
status: ProjectStatus;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_types && bunx vitest run src/generation-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the whole package**

Run: `cd ~/projects/music_types && bun run verify`
Expected: typecheck, lint, tests, build all pass. `ProjectSummary` gaining a required field may break `api.test.ts` fixtures — add `status: 'ready'` to them rather than making the field optional. A project always has a status.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/music_types
git add src/index.ts src/generation-schema.test.ts src/api.test.ts
git commit -m "feat(types): generation job types and project status"
```

---

## Task 2: Database schema for jobs and project status

**Files:**

- Modify: `~/projects/music_api/src/db/schema.ts`
- Modify: `~/projects/music_api/src/db/index.ts`
- Test: `~/projects/music_api/src/db/integration.test.ts`

**Interfaces:**

- Consumes: Task 1's `GenerationJobKind`, `GenerationJobStatus`, `ProjectStatus`.
- Produces: `generationJobs` Drizzle table; `projects.status` column.

- [ ] **Step 1: Write the failing test**

Append to `src/db/integration.test.ts`:

```ts
import { generationJobs, projects } from './schema';
import { eq } from 'drizzle-orm';

describe('generation_jobs table', () => {
  it('stores a job and reads it back with its request payload intact', async () => {
    const db = getDb();
    const [project] = await db
      .insert(projects)
      .values({ userId: 'u1', name: 'P', score: emptyScore() })
      .returning();

    const [job] = await db
      .insert(generationJobs)
      .values({
        userId: 'u1',
        projectId: project.id,
        kind: 'replace-notes',
        request: { instruction: 'brighter' },
      })
      .returning();

    expect(job.status).toBe('running');
    expect(job.request).toEqual({ instruction: 'brighter' });
    expect(job.result).toBeNull();
    expect(job.finishedAt).toBeNull();
  });

  it('defaults a project to ready', async () => {
    const db = getDb();
    const [project] = await db
      .insert(projects)
      .values({ userId: 'u1', name: 'P', score: emptyScore() })
      .returning();
    expect(project.status).toBe('ready');
  });

  it('deletes a project taking its jobs with it', async () => {
    const db = getDb();
    const [project] = await db
      .insert(projects)
      .values({ userId: 'u1', name: 'P', score: emptyScore() })
      .returning();
    await db
      .insert(generationJobs)
      .values({ userId: 'u1', projectId: project.id, kind: 'generate-track', request: {} });

    await db.delete(projects).where(eq(projects.id, project.id));

    const left = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.projectId, project.id));
    expect(left).toHaveLength(0);
  });
});
```

`emptyScore()` and `getDb()` already exist in that file — reuse them exactly as the surrounding tests do rather than defining new helpers.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/projects/music_api && bunx vitest run src/db/integration.test.ts`
Expected: FAIL — `generationJobs` is not exported from `./schema`.

- [ ] **Step 3: Add the table and column**

In `src/db/schema.ts`, add `status` to the `projects` table after `schemaVersion`:

```ts
    status: text('status').$type<ProjectStatus>().notNull().default('ready'),
```

and import the type: `import type { ProjectStatus, ProjectUiPrefs, Score } from '@sudobility/music_types';`

Then append the new table:

```ts
/**
 * One AI generation, owned by the project it will write into.
 *
 * `request` is the entire provider request, stored at submit time: the runner
 * never re-reads the project to rebuild it, so the result is always defined
 * against a known input.
 *
 * ON DELETE CASCADE, unlike `snapshots.parent_id`: a job has no meaning once
 * its project is gone, and an orphan would be swept into `failed` forever by
 * the boot recovery.
 */
export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    projectId: uuid('project_id').notNull(),
    kind: text('kind').$type<GenerationJobKind>().notNull(),
    status: text('status').$type<GenerationJobStatus>().notNull().default('running'),
    request: jsonb('request').$type<unknown>().notNull(),
    result: jsonb('result').$type<unknown>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('generation_jobs_project_id_idx').on(table.projectId),
    index('generation_jobs_status_idx').on(table.status),
  ],
);
```

In `src/db/index.ts`, inside `initDatabase()`, after the existing `ALTER TABLE` lines:

```ts
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'`;

await sql`
    CREATE TABLE IF NOT EXISTS generation_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      request JSONB NOT NULL,
      result JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )
  `;
await sql`CREATE INDEX IF NOT EXISTS generation_jobs_project_id_idx ON generation_jobs(project_id)`;
await sql`CREATE INDEX IF NOT EXISTS generation_jobs_status_idx ON generation_jobs(status)`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_api && bunx vitest run src/db/integration.test.ts`
Expected: PASS. Needs a local Postgres `music_test` database, as the other integration tests do.

- [ ] **Step 5: Update the e2e truncation**

`music_app/e2e/global-setup.ts` truncates `projects, ai_usage CASCADE`. `generation_jobs` references `projects`, so CASCADE already covers it — but add it explicitly so a future non-cascading change fails loudly rather than leaking rows between runs:

```ts
await sql`TRUNCATE projects, ai_usage, generation_jobs CASCADE`;
```

- [ ] **Step 6: Commit**

```bash
cd ~/projects/music_api
git add src/db/schema.ts src/db/index.ts src/db/integration.test.ts
git commit -m "feat(api): generation_jobs table and projects.status"
cd ~/projects/music_app
git add e2e/global-setup.ts
git commit -m "test(e2e): truncate generation_jobs"
```

---

## Task 3: Job store (owner-scoped CRUD, no provider calls)

**Files:**

- Create: `~/projects/music_api/src/services/jobs/store.ts`
- Create: `~/projects/music_api/src/services/jobs/store.integration.test.ts`

**Interfaces:**

- Consumes: Task 2's `generationJobs`, `projects`.
- Produces:
  - `createJob(db, userId, req: CreateGenerationJobRequest): Promise<GenerationJob>` — inserts the job **and** sets the project `generating`, in one transaction.
  - `getJob(db, userId, id): Promise<GenerationJob | null>`
  - `getJobRequest(db, id): Promise<unknown>` — the stored payload, for the runner.
  - `finishJob(db, id, outcome: {status: GenerationJobStatus; result?: unknown; error?: string}): Promise<void>`
  - `projectStatus(db, projectId): Promise<ProjectStatus | null>`
  - `setProjectStatus(db, projectId, status: ProjectStatus): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/services/jobs/store.integration.test.ts`. Follow the existing integration-test bootstrap in `src/routes/projects.integration.test.ts` verbatim for db setup/teardown.

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { createJob, finishJob, getJob, projectStatus, setProjectStatus } from './store';

describe('job store', () => {
  it('creating a job puts its project into generating', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'replace-notes',
      request: { instruction: 'x' },
    });

    expect(job.status).toBe('running');
    expect(await projectStatus(db, project.id)).toBe('generating');
  });

  it('hides another user’s job exactly like a missing one', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'generate-track',
      request: {},
    });

    expect(await getJob(db, 'u2', job.id)).toBeNull();
    expect(await getJob(db, 'u1', job.id)).not.toBeNull();
  });

  it('refuses to start a second job on an already-generating project', async () => {
    const project = await seedProject('u1');
    await createJob(db, 'u1', { projectId: project.id, kind: 'generate-track', request: {} });

    await expect(
      createJob(db, 'u1', { projectId: project.id, kind: 'replace-track', request: {} }),
    ).rejects.toThrow(/already generating/i);
  });

  it('finishing a job records status, error and a finish time', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'generate-track',
      request: {},
    });

    await finishJob(db, job.id, { status: 'failed', error: 'provider exploded' });

    const after = await getJob(db, 'u1', job.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toBe('provider exploded');
    expect(after?.finishedAt).not.toBeNull();
  });

  it('does not expose the stored request payload on the client-facing job', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'replace-notes',
      request: { secret: 'large payload' },
    });
    expect(job).not.toHaveProperty('request');
    expect(job).not.toHaveProperty('result');
  });

  it('setProjectStatus round-trips', async () => {
    const project = await seedProject('u1');
    await setProjectStatus(db, project.id, 'generating');
    expect(await projectStatus(db, project.id)).toBe('generating');
    await setProjectStatus(db, project.id, 'ready');
    expect(await projectStatus(db, project.id)).toBe('ready');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/projects/music_api && bunx vitest run src/services/jobs/store.integration.test.ts`
Expected: FAIL — `./store` does not exist.

- [ ] **Step 3: Implement the store**

Create `src/services/jobs/store.ts`:

```ts
/**
 * Job row persistence. Owner-scoped like every other service here: a job id
 * from another user reads as missing, never as forbidden.
 *
 * This module performs no provider calls and applies nothing to a score — it
 * only moves rows. The runner owns everything that takes time.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CreateGenerationJobRequest,
  GenerationJob,
  GenerationJobStatus,
  ProjectStatus,
} from '@sudobility/music_types';
import * as schema from '../../db/schema';
import { generationJobs, projects } from '../../db/schema';

type Db = PostgresJsDatabase<typeof schema>;
type JobRow = typeof generationJobs.$inferSelect;

/** The client-facing shape: deliberately without `request`/`result`, which are large and never needed there. */
function toJob(row: JobRow): GenerationJob {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.error ?? null,
  };
}

export class ProjectBusyError extends Error {
  constructor() {
    super('Project is already generating');
    this.name = 'ProjectBusyError';
  }
}

/**
 * Inserts the job and marks the project `generating` atomically.
 *
 * One transaction because a job whose project is still `ready` would be
 * discarded by its own completion check — the two writes are one fact.
 */
export async function createJob(
  db: Db,
  userId: string,
  req: CreateGenerationJobRequest,
): Promise<GenerationJob> {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, req.projectId), eq(projects.userId, userId)));
    if (!project) throw new Error('Project not found');
    if (project.status === 'generating') throw new ProjectBusyError();

    await tx.update(projects).set({ status: 'generating' }).where(eq(projects.id, req.projectId));

    const [row] = await tx
      .insert(generationJobs)
      .values({
        userId,
        projectId: req.projectId,
        kind: req.kind,
        request: req.request,
      })
      .returning();
    return toJob(row);
  });
}

export async function getJob(db: Db, userId: string, id: string): Promise<GenerationJob | null> {
  const [row] = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.id, id), eq(generationJobs.userId, userId)));
  return row ? toJob(row) : null;
}

/** The stored provider request. Not owner-scoped: only the runner calls this, with an id it already authorised. */
export async function getJobRequest(db: Db, id: string): Promise<unknown> {
  const [row] = await db.select().from(generationJobs).where(eq(generationJobs.id, id));
  return row?.request ?? null;
}

export async function finishJob(
  db: Db,
  id: string,
  outcome: { status: GenerationJobStatus; result?: unknown; error?: string },
): Promise<void> {
  await db
    .update(generationJobs)
    .set({
      status: outcome.status,
      result: outcome.result ?? null,
      error: outcome.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(generationJobs.id, id));
}

export async function projectStatus(db: Db, projectId: string): Promise<ProjectStatus | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  return row?.status ?? null;
}

export async function setProjectStatus(
  db: Db,
  projectId: string,
  status: ProjectStatus,
): Promise<void> {
  await db.update(projects).set({ status }).where(eq(projects.id, projectId));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_api && bunx vitest run src/services/jobs/store.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Sabotage-check the owner scoping**

Temporarily drop `eq(generationJobs.userId, userId)` from `getJob`'s where clause. Confirm the file changed (`grep -c "generationJobs.userId" src/services/jobs/store.ts` → 0), re-run, and confirm the "hides another user's job" test fails. Restore, re-run, confirm green.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/music_api
git add src/services/jobs/store.ts src/services/jobs/store.integration.test.ts
git commit -m "feat(api): owner-scoped generation job store"
```

---

## Task 4: Applying a job result to a score

**Files:**

- Create: `~/projects/music_api/src/services/jobs/apply.ts`
- Create: `~/projects/music_api/src/services/jobs/apply.test.ts`
- Modify: `~/projects/music_api/package.json`

**Interfaces:**

- Consumes: `@sudobility/music_lib`'s `applyCandidate` and `appendTrackCommand`, and `music_types`' `Score`/`ScoreFragment`. A `ScoreCommand` is `{id, label, timestamp, execute(score): Score, undo(score): Score}` — `execute` is pure, so applying one server-side is just calling it. No store, no helper.
- Produces: `applyJobResult(score: Score, kind: GenerationJobKind, result: unknown): Score`.

This is the task that adds the `music_api` → `music_lib` dependency edge the spec calls for.

- [ ] **Step 1: Add the dependency**

```bash
cd ~/projects/music_api
bun add @sudobility/music_lib
```

`music_lib` is platform-free, so this pulls no browser or audio code. Confirm the server still boots: `bun run typecheck`.

- [ ] **Step 2: Write the failing test**

Create `src/services/jobs/apply.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '@sudobility/music_lib';
import { applyJobResult } from './apply';

describe('applyJobResult', () => {
  it('replaces the whole score for a generate-score job', () => {
    const before = createEmptyScore({
      title: 'Old',
      measures: 2,
      tracks: [{ name: 'A', instrumentName: 'Piano', clef: 'treble' }],
    });
    const generated = createEmptyScore({
      title: 'New',
      measures: 4,
      tracks: [{ name: 'B', instrumentName: 'Piano', clef: 'treble' }],
    });

    const after = applyJobResult(before, 'generate-score', { score: generated, warnings: [] });

    expect(after.metadata.title).toBe('New');
    expect(after.tracks[0].measures).toHaveLength(4);
  });

  it('appends a track for a generate-track job, leaving existing tracks alone', () => {
    const before = createEmptyScore({
      title: 'S',
      measures: 2,
      tracks: [{ name: 'Keys', instrumentName: 'Piano', clef: 'treble' }],
    });
    const generated = createEmptyScore({
      title: 'G',
      measures: 2,
      tracks: [{ name: 'Bass', instrumentName: 'Acoustic Bass', clef: 'bass' }],
    });

    const after = applyJobResult(before, 'generate-track', { score: generated, warnings: [] });

    expect(after.tracks).toHaveLength(2);
    expect(after.tracks[0].name).toBe('Keys');
    expect(after.tracks[1].name).toBe('Bass');
  });

  it('splices the single candidate fragment in for a replace job', () => {
    const before = createEmptyScore({
      title: 'S',
      measures: 4,
      tracks: [{ name: 'Keys', instrumentName: 'Piano', clef: 'treble' }],
    });
    const trackId = before.tracks[0].id;
    const result = {
      candidates: [
        {
          id: 'c1',
          label: 'Candidate 1',
          fragment: fragmentCoveringMeasure(before, trackId, 1),
        },
      ],
      warnings: [],
    };

    const after = applyJobResult(before, 'replace-measures', result);

    expect(after).not.toBe(before);
    expect(after.tracks[0].measures).toHaveLength(4);
  });

  it('throws when a replace job produced no candidate, rather than silently no-oping', () => {
    const before = createEmptyScore({
      title: 'S',
      measures: 2,
      tracks: [{ name: 'K', instrumentName: 'Piano', clef: 'treble' }],
    });
    expect(() => applyJobResult(before, 'replace-notes', { candidates: [], warnings: [] })).toThrow(
      /no candidate/i,
    );
  });
});
```

Write `fragmentCoveringMeasure(score, trackId, index)` as a local helper at the top of the test file, building a `ScoreFragment` from the score's own measure at `index` — copy the shape from `music_lib`'s existing regeneration tests (`src/services/regeneration/controller.test.ts`) rather than inventing one.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd ~/projects/music_api && bunx vitest run src/services/jobs/apply.test.ts`
Expected: FAIL — `./apply` does not exist.

- [ ] **Step 4: Implement**

Create `src/services/jobs/apply.ts`:

```ts
/**
 * Turning a finished job's result into the project's next score.
 *
 * This is the reason `music_api` depends on `@sudobility/music_lib`: applying
 * a fragment is command logic, it already exists there, and it is
 * platform-free. Reimplementing it server-side would be a second definition
 * of what a regeneration means.
 */
import { appendTrackCommand, applyCandidate } from '@sudobility/music_lib';
import type { GenerationJobKind, RegenerateRegionResult, Score } from '@sudobility/music_types';
import type { GenerateScoreResult } from '@sudobility/music_types';

export function applyJobResult(score: Score, kind: GenerationJobKind, result: unknown): Score {
  if (kind === 'generate-score') {
    return (result as GenerateScoreResult).score;
  }

  if (kind === 'generate-track') {
    // The generated score is a carrier for exactly one track; re-home it onto
    // this score's own grid and ids, which is what appendTrackCommand does.
    const generated = (result as GenerateScoreResult).score;
    const track = generated.tracks[0];
    if (!track) throw new Error('Generation produced no track');
    return appendTrackCommand(track).execute(score);
  }

  const { candidates } = result as RegenerateRegionResult;
  const candidate = candidates[0];
  // One candidate is the contract; none means the provider returned nothing
  // usable, which must fail the job rather than quietly leave the score as-is
  // and report success.
  if (!candidate) throw new Error('Regeneration produced no candidate');
  return applyCandidate(score, candidate).execute(score);
}
```

`ScoreCommand.execute` is a pure `(Score) => Score`, so a command applies outside a store with no helper — that is precisely what lets the server reuse the command definitions the browser uses. Confirm both builder names exist before writing: `grep -n "appendTrackCommand\|applyCandidate" ~/projects/music_app/node_modules/@sudobility/music_lib/dist/index.d.ts`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ~/projects/music_api && bunx vitest run src/services/jobs/apply.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/music_api
git add package.json bun.lock src/services/jobs/apply.ts src/services/jobs/apply.test.ts
git commit -m "feat(api): apply job results via music_lib commands"
```

---

## Task 5: The job runner, with cancellation checks

**Files:**

- Create: `~/projects/music_api/src/services/jobs/runner.ts`
- Create: `~/projects/music_api/src/services/jobs/runner.integration.test.ts`

**Interfaces:**

- Consumes: Task 3's store functions, Task 4's `applyJobResult`.
- Produces: `runJob(db, jobId, deps): Promise<void>` where `deps = { generate, regenerate }` — both injectable so tests never call OpenAI. Also `stillWanted(db, projectId): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `src/services/jobs/runner.integration.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createJob, getJob, projectStatus, setProjectStatus } from './store';
import { runJob } from './runner';

describe('runJob', () => {
  it('applies the result and releases the project when it is still generating', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'generate-track',
      request: {},
    });

    await runJob(db, job.id, {
      generate: async () => generatedTrackResult(),
      regenerate: notCalled,
    });

    expect(await projectStatus(db, project.id)).toBe('ready');
    expect((await getJob(db, 'u1', job.id))?.status).toBe('done');
    expect((await loadScore(db, project.id)).tracks).toHaveLength(2);
  });

  it('discards the result when the project was cancelled mid-flight', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'generate-track',
      request: {},
    });
    const before = await loadScore(db, project.id);

    await runJob(db, job.id, {
      // The cancel lands while the provider is working.
      generate: async () => {
        await setProjectStatus(db, project.id, 'ready');
        return generatedTrackResult();
      },
      regenerate: notCalled,
    });

    expect((await getJob(db, 'u1', job.id))?.status).toBe('cancelled');
    expect(await loadScore(db, project.id)).toEqual(before);
  });

  it('fails the job and releases the project when the provider throws', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'generate-track',
      request: {},
    });

    await runJob(db, job.id, {
      generate: async () => {
        throw new Error('provider exploded');
      },
      regenerate: notCalled,
    });

    const after = await getJob(db, 'u1', job.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/provider exploded/);
    // Released, or the project is stranded forever.
    expect(await projectStatus(db, project.id)).toBe('ready');
  });

  it('does not call the provider at all if the project was cancelled before it started', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'generate-track',
      request: {},
    });
    await setProjectStatus(db, project.id, 'ready');

    const generate = vi.fn();
    await runJob(db, job.id, { generate, regenerate: notCalled });

    expect(generate).not.toHaveBeenCalled();
    expect((await getJob(db, 'u1', job.id))?.status).toBe('cancelled');
  });
});
```

`notCalled` is `() => { throw new Error('should not be called'); }`. `loadScore(db, projectId)` selects the project row and returns `row.score`. `generatedTrackResult()` returns `{ score: createEmptyScore({ title: 'G', measures: 2, tracks: [{ name: 'Bass', instrumentName: 'Acoustic Bass', clef: 'bass' }] }), warnings: [] }`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/projects/music_api && bunx vitest run src/services/jobs/runner.integration.test.ts`
Expected: FAIL — `./runner` does not exist.

- [ ] **Step 3: Implement the runner**

Create `src/services/jobs/runner.ts`:

```ts
/**
 * Running one generation job to completion.
 *
 * Cancellation is cooperative and reads exactly one thing: the project's
 * status. `generating` means the result is still wanted; anything else means
 * somebody cancelled while the provider was working, and the result is thrown
 * away. That check happens before the provider call, after it, and — for
 * chunked work — between steps.
 *
 * A failure always releases the project. A job that dies holding `generating`
 * strands the project with no way back except the boot sweep.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GenerateScoreResult, RegenerateRegionResult } from '@sudobility/music_types';
import * as schema from '../../db/schema';
import { generationJobs, projects } from '../../db/schema';
import { applyJobResult } from './apply';
import { finishJob, projectStatus, setProjectStatus } from './store';

type Db = PostgresJsDatabase<typeof schema>;

export type RunnerDeps = {
  generate: (request: unknown) => Promise<GenerateScoreResult>;
  regenerate: (
    request: unknown,
    stillWanted: () => Promise<boolean>,
  ) => Promise<RegenerateRegionResult>;
};

/** Whether the job's result is still wanted. The single cancellation predicate. */
export async function stillWanted(db: Db, projectId: string): Promise<boolean> {
  return (await projectStatus(db, projectId)) === 'generating';
}

export async function runJob(db: Db, jobId: string, deps: RunnerDeps): Promise<void> {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
  if (!job) return;

  const wanted = () => stillWanted(db, job.projectId);

  try {
    if (!(await wanted())) {
      await finishJob(db, jobId, { status: 'cancelled' });
      return;
    }

    const result =
      job.kind === 'generate-score' || job.kind === 'generate-track'
        ? await deps.generate(job.request)
        : await deps.regenerate(job.request, wanted);

    if (!(await wanted())) {
      await finishJob(db, jobId, { status: 'cancelled', result });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId));
    if (!project) {
      await finishJob(db, jobId, { status: 'failed', error: 'Project no longer exists' });
      return;
    }

    const next = applyJobResult(project.score, job.kind, result);
    await db
      .update(projects)
      .set({ score: next, status: 'ready', updatedAt: new Date() })
      .where(eq(projects.id, job.projectId));
    await finishJob(db, jobId, { status: 'done', result });
  } catch (err) {
    await finishJob(db, jobId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    await setProjectStatus(db, job.projectId, 'ready');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_api && bunx vitest run src/services/jobs/runner.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Sabotage-check the cancellation**

Change the post-provider `if (!(await wanted()))` to `if (false)`. Confirm the edit landed. Re-run: the "discards the result when the project was cancelled mid-flight" test must fail. Restore and confirm green. This is the feature; a test that passes without it is worthless.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/music_api
git add src/services/jobs/runner.ts src/services/jobs/runner.integration.test.ts
git commit -m "feat(api): job runner with cooperative cancellation"
```

---

## Task 6: Between-step cancellation for chunked regeneration

**Files:**

- Modify: `~/projects/music_api/src/services/generation/chunked-regenerate.ts`
- Test: `~/projects/music_api/src/services/generation/chunked-regenerate.test.ts`

**Interfaces:**

- Consumes: Task 5's `stillWanted`-shaped predicate.
- Produces: `regenerateChunked` gains an optional third-argument option `stillWanted?: () => Promise<boolean>`, checked between chunks.

- [ ] **Step 1: Write the failing test**

Append to the existing `chunked-regenerate.test.ts` (create it if absent, following the existing test style in that directory):

```ts
it('stops between chunks when the work is no longer wanted', async () => {
  const request = requestSpanningManyChunks(); // >= 3 chunks at the test budget
  let calls = 0;
  const complete = vi.fn(async () => {
    calls += 1;
    return chunkResponseFor(request);
  });

  await regenerateChunked(request, { complete }, SMALL_BUDGET, {
    // Wanted for the first chunk only.
    stillWanted: async () => calls < 1,
  });

  expect(calls).toBe(1);
});

it('runs every chunk when the work stays wanted', async () => {
  const request = requestSpanningManyChunks();
  const complete = vi.fn(async () => chunkResponseFor(request));

  await regenerateChunked(request, { complete }, SMALL_BUDGET, { stillWanted: async () => true });

  expect(complete.mock.calls.length).toBeGreaterThan(1);
});
```

Build `requestSpanningManyChunks()` and `chunkResponseFor()` from the fixtures already used by this file's existing tests; do not invent a new fragment builder.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/projects/music_api && bunx vitest run src/services/generation/chunked-regenerate.test.ts`
Expected: FAIL — `regenerateChunked` takes no options argument, so both chunks run and `calls` is greater than 1.

- [ ] **Step 3: Implement**

Add a fourth parameter to `regenerateChunked`:

```ts
export type ChunkedOptions = {
  /**
   * Checked before each chunk after the first. Returning false stops the run
   * and returns what has been produced so far — the caller (the job runner)
   * discards it, so the point is to stop paying the provider, not to salvage
   * a partial result.
   */
  stillWanted?: () => Promise<boolean>;
};
```

and inside the sequential chunk loop, before each iteration after the first:

```ts
if (index > 0 && options?.stillWanted && !(await options.stillWanted())) break;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_api && bunx vitest run src/services/generation/chunked-regenerate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_api
git add src/services/generation/chunked-regenerate.ts src/services/generation/chunked-regenerate.test.ts
git commit -m "feat(api): stop chunked regeneration when cancelled"
```

---

## Task 7: Boot recovery for orphaned jobs

**Files:**

- Create: `~/projects/music_api/src/services/jobs/recover.ts`
- Create: `~/projects/music_api/src/services/jobs/recover.integration.test.ts`
- Modify: `~/projects/music_api/src/index.ts`

**Interfaces:**

- Consumes: Task 2's tables.
- Produces: `recoverOrphanedJobs(db): Promise<number>` — returns how many were swept.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { recoverOrphanedJobs } from './recover';
import { createJob, getJob, projectStatus } from './store';

describe('recoverOrphanedJobs', () => {
  it('fails a running job and releases its project', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'generate-track',
      request: {},
    });

    const swept = await recoverOrphanedJobs(db);

    expect(swept).toBe(1);
    expect((await getJob(db, 'u1', job.id))?.status).toBe('failed');
    expect((await getJob(db, 'u1', job.id))?.error).toMatch(/restart/i);
    expect(await projectStatus(db, project.id)).toBe('ready');
  });

  it('leaves finished jobs and their projects alone', async () => {
    const project = await seedProject('u1');
    const job = await createJob(db, 'u1', {
      projectId: project.id,
      kind: 'generate-track',
      request: {},
    });
    await finishJob(db, job.id, { status: 'done' });
    await setProjectStatus(db, project.id, 'ready');

    expect(await recoverOrphanedJobs(db)).toBe(0);
    expect((await getJob(db, 'u1', job.id))?.status).toBe('done');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/projects/music_api && bunx vitest run src/services/jobs/recover.integration.test.ts`
Expected: FAIL — `./recover` does not exist.

- [ ] **Step 3: Implement**

```ts
/**
 * Boot-time sweep.
 *
 * A provider call cannot be resumed across a restart, so a job left `running`
 * is dead by definition. Failing it and releasing its project is the only way
 * back — otherwise the project sits `generating` with nothing alive to finish
 * it and no way for its owner to edit it again.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema';
import { generationJobs, projects } from '../../db/schema';

type Db = PostgresJsDatabase<typeof schema>;

const MESSAGE = 'Generation was interrupted by a server restart.';

export async function recoverOrphanedJobs(db: Db): Promise<number> {
  const orphans = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.status, 'running'));

  for (const job of orphans) {
    await db
      .update(generationJobs)
      .set({ status: 'failed', error: MESSAGE, finishedAt: new Date() })
      .where(eq(generationJobs.id, job.id));
    await db.update(projects).set({ status: 'ready' }).where(eq(projects.id, job.projectId));
  }
  return orphans.length;
}
```

In `src/index.ts`, call it once after `initDatabase()`:

```ts
const swept = await recoverOrphanedJobs(getDb());
if (swept > 0) console.warn(`[jobs] released ${swept} job(s) orphaned by a restart`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_api && bunx vitest run src/services/jobs/recover.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_api
git add src/services/jobs/recover.ts src/services/jobs/recover.integration.test.ts src/index.ts
git commit -m "feat(api): release jobs orphaned by a restart"
```

---

## Task 8: Job routes, and rejecting writes to a generating project

**Files:**

- Create: `~/projects/music_api/src/routes/jobs.ts`
- Create: `~/projects/music_api/src/routes/jobs.integration.test.ts`
- Modify: `~/projects/music_api/src/routes/index.ts`
- Modify: `~/projects/music_api/src/services/projects.ts`
- Modify: `~/projects/music_api/src/routes/projects.integration.test.ts`

**Interfaces:**

- Consumes: Tasks 3, 5, 6.
- Produces: `POST /api/v1/jobs`, `GET /api/v1/jobs/:id`, `POST /api/v1/jobs/:id/cancel`. `updateProject` throws `ProjectGeneratingError` when the project is `generating`.

- [ ] **Step 1: Write the failing tests**

Create `src/routes/jobs.integration.test.ts`, following `projects.integration.test.ts`'s app bootstrap exactly:

```ts
describe('POST /api/v1/jobs', () => {
  it('creates a job and marks the project generating', async () => {
    const project = await createProjectViaApi('My Song');
    const res = await app.request('/api/v1/jobs', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectId: project.id, kind: 'generate-track', request: {} }),
    });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe('running');

    const after = await getProjectViaApi(project.id);
    expect(after.status).toBe('generating');
  });

  it('rejects a second job on a busy project with 409', async () => {
    const project = await createProjectViaApi('My Song');
    await startJob(project.id);
    const res = await app.request('/api/v1/jobs', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectId: project.id, kind: 'replace-track', request: {} }),
    });
    expect(res.status).toBe(409);
  });

  it('404s for another user’s project', async () => {
    const project = await createProjectViaApi('My Song');
    const res = await app.request('/api/v1/jobs', {
      method: 'POST',
      headers: authHeaders('other-user'),
      body: JSON.stringify({ projectId: project.id, kind: 'generate-track', request: {} }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/jobs/:id/cancel', () => {
  it('releases the project immediately, without waiting for the job', async () => {
    const project = await createProjectViaApi('My Song');
    const job = await startJob(project.id);

    const res = await app.request(`/api/v1/jobs/${job.id}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect((await getProjectViaApi(project.id)).status).toBe('ready');
  });

  it('404s for another user’s job', async () => {
    const project = await createProjectViaApi('My Song');
    const job = await startJob(project.id);
    const res = await app.request(`/api/v1/jobs/${job.id}/cancel`, {
      method: 'POST',
      headers: authHeaders('other-user'),
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/projects/:id while generating', () => {
  it('is rejected with 409, so a job’s input cannot move under it', async () => {
    const project = await createProjectViaApi('My Song');
    await startJob(project.id);

    const res = await app.request(`/api/v1/projects/${project.id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Renamed', score: project.score }),
    });

    expect(res.status).toBe(409);
  });

  it('is allowed again once the job is cancelled', async () => {
    const project = await createProjectViaApi('My Song');
    const job = await startJob(project.id);
    await app.request(`/api/v1/jobs/${job.id}/cancel`, { method: 'POST', headers: authHeaders() });

    const res = await app.request(`/api/v1/projects/${project.id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Renamed', score: project.score }),
    });

    expect(res.status).toBe(200);
  });
});
```

`startJob(projectId)` POSTs a job and returns the parsed body. Because these tests must not call OpenAI, the route must take its runner dependencies from a module-level injection point (see Step 3) that the test overrides with a stub that never resolves — the job stays `running`, which is exactly the state under test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/music_api && bunx vitest run src/routes/jobs.integration.test.ts`
Expected: FAIL — no `/api/v1/jobs` route.

- [ ] **Step 3: Implement the routes**

Create `src/routes/jobs.ts`:

```ts
/**
 * Generation jobs.
 *
 * POST returns as soon as the row exists; the work runs detached. That is the
 * whole point — the client must never hold a connection open for minutes.
 *
 * The runner is injected rather than imported directly so integration tests
 * can substitute a provider that never resolves, leaving a job legitimately
 * `running` for the duration of a test.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createGenerationJobRequestSchema } from '@sudobility/music_types';
import { getDb } from '../db';
import { errorToResponse, successResponse } from '../lib/responses';
import { ProjectBusyError, createJob, getJob, setProjectStatus } from '../services/jobs/store';
import { runJob, type RunnerDeps } from '../services/jobs/runner';
import { defaultRunnerDeps } from '../services/jobs/deps';

let runnerDeps: RunnerDeps = defaultRunnerDeps();

/** Test seam: swap the provider without touching the routes. */
export function setRunnerDeps(deps: RunnerDeps): void {
  runnerDeps = deps;
}

const router = new Hono();

router.post('/', zValidator('json', createGenerationJobRequestSchema), async (c) => {
  const req = c.req.valid('json');
  try {
    const job = await createJob(getDb(), c.get('userId'), req);
    // Detached on purpose: the response must not wait for the provider.
    // Failures are recorded on the job row, so nothing is lost by not awaiting.
    void runJob(getDb(), job.id, runnerDeps);
    return c.json(successResponse(job));
  } catch (err) {
    if (err instanceof ProjectBusyError) return c.json({ error: err.message }, 409);
    return errorToResponse(c, err);
  }
});

router.get('/:id', async (c) => {
  const job = await getJob(getDb(), c.get('userId'), c.req.param('id'));
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json(successResponse(job));
});

router.post('/:id/cancel', async (c) => {
  const job = await getJob(getDb(), c.get('userId'), c.req.param('id'));
  if (!job) return c.json({ error: 'Not found' }, 404);
  // Releasing the project is the cancel. The running job reads this and
  // discards its result; the editor unlocks now rather than minutes from now.
  await setProjectStatus(getDb(), job.projectId, 'ready');
  return c.json(successResponse({ ok: true }));
});

export default router;
```

Create `src/services/jobs/deps.ts` holding `defaultRunnerDeps()`, which wires the real transport — the same `buildGeneratePrompt`/`buildRegeneratePrompt` + `getTransport()` + decode pipeline that `src/routes/ai.ts` uses today, with `regenerateChunked` passed the `stillWanted` predicate from Task 6. Extract that pipeline out of `ai.ts` into `deps.ts` and have `ai.ts` call the same functions, so there is one definition of "run a generation", not two.

Mount in `src/routes/index.ts`:

```ts
routes.route('/jobs', jobsRouter);
```

In `src/services/projects.ts`, add to `updateProject` before it writes:

```ts
export class ProjectGeneratingError extends Error {
  constructor() {
    super('Project is generating and cannot be edited');
    this.name = 'ProjectGeneratingError';
  }
}
```

and inside `updateProject`, after loading the row and before the update: `if (row.status === 'generating') throw new ProjectGeneratingError();`. Map it to 409 in the projects route's catch.

Add `status: row.status` to `toSummary` in the same file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_api && bunx vitest run src/routes/`
Expected: PASS, including the pre-existing project route tests.

- [ ] **Step 5: Sabotage-check the immutability guard**

Remove the `if (row.status === 'generating') throw` line. Confirm the edit landed. Re-run: the "rejected with 409" test must fail. Restore, confirm green.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/music_api
git add src/routes/jobs.ts src/routes/jobs.integration.test.ts src/routes/index.ts src/services/jobs/deps.ts src/services/projects.ts src/routes/projects.ts src/routes/projects.integration.test.ts src/routes/ai.ts
git commit -m "feat(api): job routes and generating-project immutability"
```

---

## Task 9: Client methods and hooks for jobs

**Files:**

- Modify: `~/projects/music_client/src/network/music-client.ts`
- Modify: `~/projects/music_client/src/hooks/use-generation.ts`
- Modify: `~/projects/music_client/src/hooks/query-keys.ts`
- Test: `~/projects/music_client/src/network/music-client.test.ts`

**Interfaces:**

- Consumes: Task 1's `GenerationJob`, `CreateGenerationJobRequest`.
- Produces:
  - `MusicClient.createJob(req, token): Promise<GenerationJob>`
  - `MusicClient.getJob(id, token): Promise<GenerationJob>`
  - `MusicClient.cancelJob(id, token): Promise<void>`
  - `musicQueryKeys.jobs.detail(id)`
  - `useGenerationJob(ctx, id | null)` — polls every 3s while the job is `running`, stops otherwise.

- [ ] **Step 1: Write the failing test**

Follow the existing `music-client.test.ts` fake-network pattern exactly.

```ts
describe('job endpoints', () => {
  it('POSTs a job to /api/v1/jobs', async () => {
    const net = fakeNetwork({ data: runningJob() });
    const client = new MusicClient(net, 'http://api');

    await client.createJob(
      { projectId: 'p1', kind: 'replace-notes', request: { instruction: 'x' } },
      'tok',
    );

    expect(net.lastCall.url).toBe('http://api/api/v1/jobs');
    expect(net.lastCall.method).toBe('POST');
    expect(net.lastCall.body).toMatchObject({ projectId: 'p1', kind: 'replace-notes' });
  });

  it('cancels via POST to the cancel sub-route', async () => {
    const net = fakeNetwork({ data: { ok: true } });
    const client = new MusicClient(net, 'http://api');

    await client.cancelJob('j1', 'tok');

    expect(net.lastCall.url).toBe('http://api/api/v1/jobs/j1/cancel');
    expect(net.lastCall.method).toBe('POST');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/projects/music_client && bunx vitest run src/network/music-client.test.ts`
Expected: FAIL — `createJob` is not a function.

- [ ] **Step 3: Implement**

Add the three methods to `MusicClient`, matching the shape of the existing `createProject`/`getProject`/`deleteProject` exactly (same auth header helper, same `successResponse` unwrapping).

Add to `query-keys.ts`:

```ts
  readonly jobs: {
    readonly all: readonly ['music', 'jobs'];
    readonly detail: (id: string) => readonly ['music', 'jobs', 'detail', string];
  };
```

Add to `use-generation.ts`:

```ts
/** Polls a job while it is running. `refetchInterval` returning false is what stops it — a finished job must not keep a timer alive. */
export function useGenerationJob(ctx: MusicHookContext, id: string | null) {
  const client = useMusicClient(ctx.networkClient, ctx.baseUrl);
  return useQuery({
    queryKey: musicQueryKeys.jobs.detail(id ?? ''),
    enabled: id !== null && ctx.token !== null,
    queryFn: () => client.getJob(id!, ctx.token!),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 3000 : false),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_client && bun run verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_client
git add src/
git commit -m "feat(client): generation job endpoints and polling hook"
```

---

## Task 10: Region derivation in `music_lib`

**Files:**

- Create: `~/projects/music_lib/src/domain/generation/replacement-region.ts`
- Create: `~/projects/music_lib/src/domain/generation/replacement-region.test.ts`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**

- Consumes: `Score`, `ScoreSelection`, `ScoreRange` from `music_types`.
- Produces:

```ts
export type ReplaceScope = 'notes' | 'measures' | 'track';

export type ReplacementRegion = {
  range: ScoreRange;
  /** Whether `range` falls on measure boundaries. False only for `notes`. */
  measureAligned: boolean;
  /** How many notes fall inside `range` on `range.trackIds`. */
  noteCount: number;
  /** How many of those were not selected — what the modal warns about. */
  unselectedNoteCount: number;
};

export function replacementRegion(
  score: Score,
  selection: ScoreSelection,
  activeTrackId: string | null,
  scope: ReplaceScope,
): ReplacementRegion | null;
```

Returns `null` when the scope has nothing to work on.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '../score/create.js';
import { replacementRegion } from './replacement-region.js';

/** A 4/4, 4-measure, 2-track score with one quarter note on each beat of track 0. */
function scoreWithNotes() {
  /* build with the same helpers the sibling tests use */
}

describe('replacementRegion — notes', () => {
  it('spans exactly the selected notes, without snapping to the measure', () => {
    const score = scoreWithNotes();
    const ppq = score.ppq;
    const notes = notesOfTrack(score, 0);
    const selection = { eventIds: [notes[1].id, notes[2].id], measureIds: [], trackIds: [] };

    const region = replacementRegion(score, selection, null, 'notes');

    expect(region).not.toBeNull();
    expect(region!.range.startTick).toBe(notes[1].startTick);
    expect(region!.range.endTick).toBe(notes[2].startTick + notes[2].durationTicks);
    expect(region!.measureAligned).toBe(false);
    expect(region!.range.trackIds).toEqual([score.tracks[0].id]);
  });

  it('covers the gap in a non-contiguous selection and reports the notes it will take', () => {
    const score = scoreWithNotes();
    const notes = notesOfTrack(score, 0);
    // Beats 1 and 4; beats 2 and 3 are not selected but fall inside the span.
    const selection = { eventIds: [notes[0].id, notes[3].id], measureIds: [], trackIds: [] };

    const region = replacementRegion(score, selection, null, 'notes')!;

    expect(region.range.startTick).toBe(notes[0].startTick);
    expect(region.range.endTick).toBe(notes[3].startTick + notes[3].durationTicks);
    expect(region.noteCount).toBe(4);
    expect(region.unselectedNoteCount).toBe(2);
  });

  it('covers every track the selected notes live on', () => {
    const score = scoreWithNotes();
    const a = notesOfTrack(score, 0)[0];
    const b = notesOfTrack(score, 1)[0];
    const selection = { eventIds: [a.id, b.id], measureIds: [], trackIds: [] };

    const region = replacementRegion(score, selection, null, 'notes')!;

    expect(region.range.trackIds.sort()).toEqual([score.tracks[0].id, score.tracks[1].id].sort());
  });

  it('is null with no notes selected', () => {
    const score = scoreWithNotes();
    expect(replacementRegion(score, emptySelection(), null, 'notes')).toBeNull();
  });
});

describe('replacementRegion — measures', () => {
  it('spans the selected measures and is measure-aligned', () => {
    const score = scoreWithNotes();
    const m = score.tracks[0].measures;
    const selection = { eventIds: [], measureIds: [m[1].id, m[2].id], trackIds: [] };

    const region = replacementRegion(score, selection, null, 'measures')!;

    expect(region.range.startTick).toBe(m[1].startTick);
    expect(region.range.endTick).toBe(m[2].startTick + m[2].durationTicks);
    expect(region.measureAligned).toBe(true);
  });

  it('takes its tracks from the selected measure ids, so a cross-track selection covers both', () => {
    const score = scoreWithNotes();
    const selection = {
      eventIds: [],
      measureIds: [score.tracks[0].measures[0].id, score.tracks[1].measures[0].id],
      trackIds: [],
    };

    const region = replacementRegion(score, selection, null, 'measures')!;

    expect(region.range.trackIds.sort()).toEqual([score.tracks[0].id, score.tracks[1].id].sort());
  });

  it('reports every note in range as unselected, since measures select no notes', () => {
    const score = scoreWithNotes();
    const selection = { eventIds: [], measureIds: [score.tracks[0].measures[0].id], trackIds: [] };
    const region = replacementRegion(score, selection, null, 'measures')!;
    expect(region.unselectedNoteCount).toBe(region.noteCount);
  });

  it('is null with no measures selected', () => {
    const score = scoreWithNotes();
    expect(replacementRegion(score, emptySelection(), null, 'measures')).toBeNull();
  });
});

describe('replacementRegion — track', () => {
  it('spans the whole score on the active track alone', () => {
    const score = scoreWithNotes();
    const region = replacementRegion(score, emptySelection(), score.tracks[1].id, 'track')!;

    expect(region.range.startTick).toBe(0);
    const last = score.tracks[1].measures.at(-1)!;
    expect(region.range.endTick).toBe(last.startTick + last.durationTicks);
    expect(region.range.trackIds).toEqual([score.tracks[1].id]);
    expect(region.measureAligned).toBe(true);
  });

  it('ignores the selection entirely', () => {
    const score = scoreWithNotes();
    const notes = notesOfTrack(score, 0);
    const withSelection = { eventIds: [notes[0].id], measureIds: [], trackIds: [] };

    const a = replacementRegion(score, withSelection, score.tracks[0].id, 'track');
    const b = replacementRegion(score, emptySelection(), score.tracks[0].id, 'track');

    expect(a).toEqual(b);
  });

  it('is null when there is no active track', () => {
    const score = scoreWithNotes();
    expect(replacementRegion(score, emptySelection(), null, 'track')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/music_lib && bunx vitest run src/domain/generation/replacement-region.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

```ts
/**
 * What a Replace action will overwrite.
 *
 * Three scopes, one shape. The important one is `notes`: its range is the
 * selected notes' exact tick span and is deliberately NOT snapped out to
 * measure boundaries, which is what every other regeneration path does. A
 * caller that snaps this has changed the feature.
 *
 * A non-contiguous selection is reported as its bounding span, so notes the
 * user did not select can fall inside it — `unselectedNoteCount` exists so the
 * UI can say so before anything is replaced.
 */
import type { Score, ScoreRange, ScoreSelection } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { findEvent, findMeasure, findTrack } from '../score/lookup.js';

export type ReplaceScope = 'notes' | 'measures' | 'track';

export type ReplacementRegion = {
  range: ScoreRange;
  measureAligned: boolean;
  noteCount: number;
  unselectedNoteCount: number;
};

function notesInRange(score: Score, range: ScoreRange): string[] {
  const ids: string[] = [];
  for (const trackId of range.trackIds) {
    const track = findTrack(score, trackId);
    if (!track) continue;
    for (const measure of track.measures)
      for (const voice of measure.voices)
        for (const event of voice.events)
          if (
            isNoteEvent(event) &&
            event.startTick < range.endTick &&
            event.startTick + event.durationTicks > range.startTick
          )
            ids.push(event.id);
  }
  return ids;
}

function withCounts(
  score: Score,
  range: ScoreRange,
  measureAligned: boolean,
  selectedIds: Set<string>,
): ReplacementRegion {
  const inRange = notesInRange(score, range);
  return {
    range,
    measureAligned,
    noteCount: inRange.length,
    unselectedNoteCount: inRange.filter((id) => !selectedIds.has(id)).length,
  };
}

export function replacementRegion(
  score: Score,
  selection: ScoreSelection,
  activeTrackId: string | null,
  scope: ReplaceScope,
): ReplacementRegion | null {
  if (scope === 'track') {
    const track = activeTrackId ? findTrack(score, activeTrackId) : null;
    if (!track) return null;
    const last = track.measures.at(-1);
    if (!last) return null;
    return withCounts(
      score,
      { startTick: 0, endTick: last.startTick + last.durationTicks, trackIds: [track.id] },
      true,
      new Set(),
    );
  }

  if (scope === 'measures') {
    const measures = selection.measureIds
      .map((id) => findMeasure(score, id))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (measures.length === 0) return null;
    const trackIds = [
      ...new Set(
        selection.measureIds
          .map((id) => score.tracks.find((t) => t.measures.some((m) => m.id === id))?.id)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    return withCounts(
      score,
      {
        startTick: Math.min(...measures.map((m) => m.startTick)),
        endTick: Math.max(...measures.map((m) => m.startTick + m.durationTicks)),
        trackIds,
      },
      true,
      new Set(),
    );
  }

  const notes = selection.eventIds
    .map((id) => findEvent(score, id))
    .filter((e) => e !== null && isNoteEvent(e));
  if (notes.length === 0) return null;

  return withCounts(
    score,
    {
      startTick: Math.min(...notes.map((n) => n.startTick)),
      endTick: Math.max(...notes.map((n) => n.startTick + n.durationTicks)),
      trackIds: [...new Set(notes.map((n) => n.trackId))],
    },
    false,
    new Set(notes.map((n) => n.id)),
  );
}
```

Export from `src/index.ts`: `export * from './domain/generation/replacement-region.js';`

Verify `findEvent`/`findMeasure`/`findTrack` are exported from `../score/lookup.js` — if they live elsewhere in this repo, import from the real path rather than creating a new one.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bunx vitest run src/domain/generation/replacement-region.test.ts`
Expected: PASS.

- [ ] **Step 5: Sabotage-check the no-snapping rule**

Change the `notes` branch's `startTick` to snap down to its measure start. Confirm the edit landed. Re-run: "spans exactly the selected notes, without snapping to the measure" must fail. Restore, confirm green. This is the single behaviour that distinguishes Replace Notes from Replace Measures.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/music_lib
git add src/domain/generation/replacement-region.ts src/domain/generation/replacement-region.test.ts src/index.ts
git commit -m "feat(lib): per-scope replacement region derivation"
```

---

## Task 11: A range-taking regeneration request builder

**Files:**

- Modify: `~/projects/music_lib/src/services/regeneration/controller.ts`
- Modify: `~/projects/music_lib/src/services/regeneration/controller.test.ts`

**Interfaces:**

- Consumes: Task 10's `ReplacementRegion`.
- Produces: `prepareRegenerationRequestForRange(score, range, instruction, options)`. The existing `prepareRegenerationRequest(score, selection, instruction, options)` delegates to it. `PrepareRegenerationOptions` gains `style?`, `mood?`, `complexity?`, and `measureAligned?: boolean` (default `true`).

- [ ] **Step 1: Write the failing test**

```ts
describe('prepareRegenerationRequestForRange', () => {
  it('uses the range verbatim, without expanding to measures', () => {
    const score = fourMeasureScore();
    const ppq = score.ppq;
    const range = { startTick: ppq, endTick: ppq * 3, trackIds: [score.tracks[0].id] };

    const req = prepareRegenerationRequestForRange(score, range, 'brighter', {
      measureAligned: false,
    });

    expect(req.range.startTick).toBe(ppq);
    expect(req.range.endTick).toBe(ppq * 3);
    expect(req.expandedToFullMeasures).toBe(false);
  });

  it('drops preserveMeasureCount for a region that is not measure-aligned', () => {
    const score = fourMeasureScore();
    const ppq = score.ppq;
    const range = { startTick: ppq, endTick: ppq * 3, trackIds: [score.tracks[0].id] };

    const req = prepareRegenerationRequestForRange(score, range, 'x', { measureAligned: false });

    expect(req.constraints.preserveMeasureCount).toBeUndefined();
  });

  it('keeps preserveMeasureCount for a measure-aligned region', () => {
    const score = fourMeasureScore();
    const m = score.tracks[0].measures;
    const range = {
      startTick: m[0].startTick,
      endTick: m[1].startTick + m[1].durationTicks,
      trackIds: [score.tracks[0].id],
    };

    const req = prepareRegenerationRequestForRange(score, range, 'x', { measureAligned: true });

    expect(req.constraints.preserveMeasureCount).toBe(true);
  });

  it('carries style, mood and complexity onto the request', () => {
    const score = fourMeasureScore();
    const m = score.tracks[0].measures;
    const range = { startTick: 0, endTick: m[0].durationTicks, trackIds: [score.tracks[0].id] };

    const req = prepareRegenerationRequestForRange(score, range, 'x', {
      style: 'baroque',
      mood: 'melancholy',
      complexity: 'complex',
    });

    expect(req.style).toBe('baroque');
    expect(req.mood).toBe('melancholy');
    expect(req.complexity).toBe('complex');
  });

  it('always asks for exactly one candidate', () => {
    const score = fourMeasureScore();
    const m = score.tracks[0].measures;
    const range = { startTick: 0, endTick: m[0].durationTicks, trackIds: [score.tracks[0].id] };

    expect(prepareRegenerationRequestForRange(score, range, 'x', {}).candidateCount).toBe(1);
  });
});

describe('prepareRegenerationRequest still snaps', () => {
  it('expands a partial-measure selection, as it always has', () => {
    const score = fourMeasureScore();
    const notes = notesOfTrack(score, 0);
    const selection = { eventIds: [notes[1].id], measureIds: [], trackIds: [] };

    const req = prepareRegenerationRequest(score, selection, 'x');

    expect(req.expandedToFullMeasures).toBe(true);
    expect(req.range.startTick).toBe(0);
  });
});
```

`RegenerationConstraints` currently types the three `preserve*` fields as `z.literal(true)` / `true`. Relax `preserveMeasureCount` to `boolean | undefined` in `music_types` as part of this task (schema: `z.literal(true).optional()`), and update the schema test there. Leave `preserveTimeSignatures` and `preserveTempoEvents` as they are — a regeneration never changes those regardless of alignment.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/music_lib && bunx vitest run src/services/regeneration/controller.test.ts`
Expected: FAIL — `prepareRegenerationRequestForRange` is not exported.

- [ ] **Step 3: Implement**

Split the existing `prepareRegenerationRequest` so the selection→range step is the only part that stays in it:

```ts
export type PrepareRegenerationOptions = {
  constraints?: Partial<
    Omit<RegenerationConstraints, 'preserveTimeSignatures' | 'preserveTempoEvents'>
  >;
  style?: string;
  mood?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  /**
   * Whether `range` sits on measure boundaries. Drives `preserveMeasureCount`,
   * which is meaningless for a sub-measure span and only muddies the prompt.
   * Defaults true because every caller except Replace Notes is aligned.
   */
  measureAligned?: boolean;
};

/**
 * Builds a request for an explicit tick range, used verbatim.
 *
 * This is the entry point Replace Notes needs: `prepareRegenerationRequest`
 * snaps its selection out to whole measures, which is exactly what "replace
 * only these notes" forbids. The snapping policy lives in that function alone
 * so it cannot be half-applied here.
 */
export function prepareRegenerationRequestForRange(
  score: Score,
  range: ScoreRange,
  instruction: string,
  options: PrepareRegenerationOptions = {},
): PreparedRegenerationRequest {
  /* extract the existing context/fragment body, unchanged */
}
```

`prepareRegenerationRequest` becomes: compute the range via `selectionToRange`, note whether that changed anything, then delegate, overriding `expandedToFullMeasures`.

`candidateCount` is hardcoded to `1` in the builder and removed from the options type.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_lib && bun run verify`
Expected: PASS. The generation slice's `regenerate(instruction, options)` will need its `candidateCount` option removed too.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_lib
git add src/services/regeneration/ src/store/slices/generation-slice.ts
git commit -m "feat(lib): range-taking regeneration builder, one candidate"
cd ~/projects/music_types
git add src/index.ts src/generation-schema.test.ts
git commit -m "feat(types): preserveMeasureCount is optional"
```

---

## Task 12: Style, mood and complexity in the regenerate prompt

**Files:**

- Modify: `~/projects/music_api/src/services/generation/prompts.ts`
- Test: `~/projects/music_api/src/services/generation/prompts.test.ts`

**Interfaces:**

- Consumes: Task 1's new request fields.
- Produces: `buildRegeneratePrompt` emits `Style:`, `Mood:`, `Complexity:` lines and states an exact tick span for a non-measure-aligned region.

- [ ] **Step 1: Write the failing test**

```ts
describe('buildRegeneratePrompt', () => {
  it('includes style and mood when given', () => {
    const prompt = buildRegeneratePrompt({
      ...validRequest(),
      style: 'baroque',
      mood: 'melancholy',
    });
    const text = JSON.stringify(prompt);
    expect(text).toContain('Style: baroque');
    expect(text).toContain('Mood: melancholy');
  });

  it('omits them entirely when absent, rather than emitting empty lines', () => {
    const text = JSON.stringify(buildRegeneratePrompt(validRequest()));
    expect(text).not.toContain('Style:');
    expect(text).not.toContain('Mood:');
  });

  it('defaults complexity to moderate, matching whole-score generation', () => {
    const text = JSON.stringify(buildRegeneratePrompt(validRequest()));
    expect(text).toContain('Complexity: moderate');
  });

  it('states the exact tick span to fill when the region is not measure-aligned', () => {
    const req = { ...validRequest(), constraints: { ...validRequest().constraints } };
    delete (req.constraints as Record<string, unknown>).preserveMeasureCount;
    req.range = { startTick: 480, endTick: 1440, trackIds: req.range.trackIds };

    const text = JSON.stringify(buildRegeneratePrompt(req));
    expect(text).toMatch(/exactly 960 ticks/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/projects/music_api && bunx vitest run src/services/generation/prompts.test.ts`
Expected: FAIL — no Style/Mood/Complexity lines in the regenerate prompt.

- [ ] **Step 3: Implement**

In `buildRegeneratePrompt`, beside the existing `Instruction: ${req.instruction}` line (line 111), add the same three lines `buildGeneratePrompt` uses at lines 61–71:

```ts
    req.style ? `Style: ${req.style}` : null,
    req.mood ? `Mood: ${req.mood}` : null,
    `Complexity: ${req.complexity ?? 'moderate'}.`,
```

and, when `req.constraints.preserveMeasureCount` is not `true`:

```ts
    `This region does not begin or end on a barline. Fill exactly ${req.range.endTick - req.range.startTick} ticks, starting at tick ${req.range.startTick}. Do not add or remove time.`,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_api && bunx vitest run src/services/generation/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_api
git add src/services/generation/prompts.ts src/services/generation/prompts.test.ts
git commit -m "feat(api): style/mood/complexity and exact-span regenerate prompt"
```

---

## Task 13: Publish the library changes

Tasks 14+ consume `music_types`, `music_lib` and `music_client` from npm. Nothing in `music_app` can compile against them until they are published.

- [ ] **Step 1: Run the chain**

```bash
cd ~/projects/building_blocks && ./scripts/push_all.sh
```

This commits and publishes every changed repo in dependency order. Do not `git push` by hand.

- [ ] **Step 2: Verify the versions landed**

```bash
npm view @sudobility/music_types version
npm view @sudobility/music_lib version
npm view @sudobility/music_client version
```

- [ ] **Step 3: Update the app**

```bash
cd ~/projects/music_app
bun update @sudobility/music_types @sudobility/music_lib @sudobility/music_client
bun run build
```

If `bun update` resolves an older version, the publish has not propagated — wait and retry rather than editing `package.json` by hand.

Note: `music_api` also needs `bun update @sudobility/music_types @sudobility/music_lib`.

---

## Task 14: The job hook in the app

**Files:**

- Create: `~/projects/music_app/src/features/generation/useGenerationJob.ts`
- Create: `~/projects/music_app/src/features/generation/useGenerationJob.test.ts`

**Interfaces:**

- Consumes: Task 9's client methods.
- Produces: `useProjectGeneration(projectId)` returning `{ generating, jobId, error, start(kind, request), cancel() }`.

- [ ] **Step 1: Write the failing test**

```ts
describe('useProjectGeneration', () => {
  it('reports generating once a job has been started', async () => {
    const client = fakeClient({ createJob: async () => runningJob('j1') });
    const { result } = renderHook(() => useProjectGeneration('p1'), {
      wrapper: wrapperWith(client),
    });

    await act(() => result.current.start('replace-notes', { instruction: 'x' }));

    expect(result.current.generating).toBe(true);
    expect(result.current.jobId).toBe('j1');
  });

  it('stops reporting generating once the job is done', async () => {
    const client = fakeClient({
      createJob: async () => runningJob('j1'),
      getJob: async () => ({ ...runningJob('j1'), status: 'done' as const }),
    });
    const { result } = renderHook(() => useProjectGeneration('p1'), {
      wrapper: wrapperWith(client),
    });

    await act(() => result.current.start('replace-notes', {}));
    await waitFor(() => expect(result.current.generating).toBe(false));
  });

  it('surfaces a failed job’s error rather than silently going idle', async () => {
    const client = fakeClient({
      createJob: async () => runningJob('j1'),
      getJob: async () => ({
        ...runningJob('j1'),
        status: 'failed' as const,
        error: 'provider exploded',
      }),
    });
    const { result } = renderHook(() => useProjectGeneration('p1'), {
      wrapper: wrapperWith(client),
    });

    await act(() => result.current.start('replace-notes', {}));
    await waitFor(() => expect(result.current.error).toBe('provider exploded'));
  });

  it('cancel calls the endpoint and clears local generating state immediately', async () => {
    const cancelJob = vi.fn(async () => undefined);
    const client = fakeClient({ createJob: async () => runningJob('j1'), cancelJob });
    const { result } = renderHook(() => useProjectGeneration('p1'), {
      wrapper: wrapperWith(client),
    });

    await act(() => result.current.start('replace-notes', {}));
    await act(() => result.current.cancel());

    expect(cancelJob).toHaveBeenCalledWith('j1', expect.anything());
    expect(result.current.generating).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/projects/music_app && bunx vitest run src/features/generation/useGenerationJob.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

The hook wraps `useGenerationJob` from `music_client` plus a `createJob` mutation, holds the started job id in local state, and invalidates `musicQueryKeys.projects.detail(projectId)` when the job leaves `running` so the freshly-applied score is refetched. Cancel clears local state before the request resolves — the editor must unlock instantly, not after a round trip.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_app && bunx vitest run src/features/generation/useGenerationJob.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_app
git add src/features/generation/useGenerationJob.ts src/features/generation/useGenerationJob.test.ts
git commit -m "feat(app): project generation job hook"
```

---

## Task 15: The generating overlay

**Files:**

- Create: `~/projects/music_app/src/components/layout/GeneratingOverlay.tsx`
- Create: `~/projects/music_app/src/components/layout/GeneratingOverlay.test.tsx`
- Modify: `~/projects/music_app/src/components/layout/AppLayout.tsx`

**Interfaces:**

- Consumes: Task 14's hook.
- Produces: `<GeneratingOverlay onCancel={() => void} />`.

- [ ] **Step 1: Write the failing test**

```ts
describe('GeneratingOverlay', () => {
  it('says what is happening', () => {
    render(<GeneratingOverlay onCancel={vi.fn()} />);
    expect(screen.getByText('Generating notes…')).toBeVisible();
  });

  it('offers Cancel and calls it', async () => {
    const onCancel = vi.fn();
    render(<GeneratingOverlay onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('blocks the editor beneath it from being reached', () => {
    render(
      <div>
        <button>Underneath</button>
        <GeneratingOverlay onCancel={vi.fn()} />
      </div>
    );
    // aria-hidden alone is not enough — the overlay must actually cover.
    expect(screen.getByTestId('generating-overlay')).toHaveClass('absolute', 'inset-0');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/projects/music_app && bunx vitest run src/components/layout/GeneratingOverlay.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

An `absolute inset-0` panel with a translucent backdrop, a spinner, the text, and a Cancel `Button`. Render it in `AppLayout` around the editor column when `generating`. Autosave must be suppressed while generating — find the autosave effect in `AppLayout` and add `generating` to its guard, or every debounce tick fires a request the API now rejects with 409.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/projects/music_app && bunx vitest run src/components/layout/GeneratingOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_app
git add src/components/layout/GeneratingOverlay.tsx src/components/layout/GeneratingOverlay.test.tsx src/components/layout/AppLayout.tsx
git commit -m "feat(app): generating overlay and autosave suppression"
```

---

## Task 16: The Replace modal and the three buttons

**Files:**

- Create: `~/projects/music_app/src/features/generation/ReplaceMusicDialog.tsx`
- Create: `~/projects/music_app/src/features/generation/ReplaceMusicDialog.test.tsx`
- Modify: `~/projects/music_app/src/components/inspector/InspectorPanel.tsx`
- Modify: `~/projects/music_app/src/components/inspector/InspectorPanel.test.tsx`

**Interfaces:**

- Consumes: Task 10's `replacementRegion`, Task 11's builder, Task 14's hook.
- Produces: `<ReplaceMusicDialog open scope onClose onSubmit />`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('ReplaceMusicDialog', () => {
  it('is titled for its scope', () => {
    render(<ReplaceMusicDialog open scope="notes" region={region()} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Replace Notes' })).toBeInTheDocument();
  });

  it('states exactly what will be replaced', () => {
    render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={{ ...region(), noteCount: 4, unselectedNoteCount: 2 }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/4 notes/)).toBeVisible();
    expect(screen.getByText(/2 not selected/)).toBeVisible();
  });

  it('says nothing about unselected notes when there are none', () => {
    render(
      <ReplaceMusicDialog
        open
        scope="measures"
        region={{ ...region(), noteCount: 4, unselectedNoteCount: 0 }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByText(/not selected/)).not.toBeInTheDocument();
  });

  it('submits the instruction plus style, mood and complexity', async () => {
    const onSubmit = vi.fn();
    render(<ReplaceMusicDialog open scope="track" region={region()} onClose={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Instruction'), 'make it swing');
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ instruction: 'make it swing' }));
  });

  it('offers no candidate-count field', () => {
    render(<ReplaceMusicDialog open scope="notes" region={region()} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText(/candidate/i)).not.toBeInTheDocument();
  });
});

describe('InspectorPanel replace buttons', () => {
  it('offers Replace Notes on the Note tab when notes are selected', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<InspectorPanel store={store} />);

    expect(screen.getByRole('button', { name: 'Replace Notes' })).toBeEnabled();
  });

  it('disables Replace Notes with nothing selected', () => {
    const store = makeStore();
    render(<InspectorPanel store={store} />);

    expect(screen.getByRole('button', { name: 'Replace Notes' })).toBeDisabled();
  });

  it('offers Replace Measures on the Measure tab', async () => {
    const store = makeStore();
    const measure = store.getState().score!.tracks[0].measures[0];
    store.getState().setSelection({ eventIds: [], measureIds: [measure.id], trackIds: [] });
    render(<InspectorPanel store={store} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Measure' }));
    expect(screen.getByRole('button', { name: 'Replace Measures' })).toBeEnabled();
  });

  it('offers Replace Track on the Track tab, which always has an active track', async () => {
    // selectActiveTrackId falls back to the first track, so this is enabled
    // even with an empty selection -- unlike the other two.
    const store = makeStore(twoTrackScore());
    render(<InspectorPanel store={store} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Track' }));
    expect(screen.getByRole('button', { name: 'Replace Track' })).toBeEnabled();
  });

  it('opens the modal titled for the scope it was launched from', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<InspectorPanel store={store} />);

    await userEvent.click(screen.getByRole('button', { name: 'Replace Notes' }));
    expect(screen.getByRole('dialog', { name: 'Replace Notes' })).toBeInTheDocument();
  });
});

describe('AppLayout sidebar', () => {
  it('offers no generation panel any more', () => {
    // The whole-score panel moved to the dashboard; the sidebar is the
    // Inspector alone.
    renderAppLayout();
    expect(screen.queryByText('Generate a new score')).not.toBeInTheDocument();
  });
});
```

`makeStore`, `twinkleScore`, `twoTrackScore` and `allNotes` are already imported by `InspectorPanel.test.tsx`; reuse them rather than adding fixtures. `renderAppLayout` comes from `AppLayout.test.tsx` and needs `installTestAppServices()`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/music_app && bunx vitest run src/features/generation/ReplaceMusicDialog.test.tsx src/components/inspector/InspectorPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ReplaceMusicDialog` is a `FormModal` with `title` from `{notes: 'Replace Notes', measures: 'Replace Measures', track: 'Replace Track'}[scope]`, `closeAriaLabel="Close dialog"`, and `actions={[{label:'Cancel',…,variant:'ghost'},{label:'Replace',…,variant:'primary'}]}`.

Body: the region summary sentence, then instruction + preset menu (lift `PRESET_INSTRUCTIONS` out of `RegenerationPanel` before deleting it), style, mood, complexity, and the four preservation checkboxes.

Each inspector tab gets a button at the bottom, disabled when `replacementRegion(...)` returns null.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bunx vitest run src/features/generation src/components/inspector`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_app
git add src/features/generation/ReplaceMusicDialog.tsx src/features/generation/ReplaceMusicDialog.test.tsx src/components/inspector/
git commit -m "feat(app): Replace Notes/Measures/Track"
```

---

## Task 17: Delete the candidate machinery

**Files:**

- Delete: `CandidateList.tsx`, `CandidateList.test.tsx`, `preview.ts`, `preview.test.ts`, `RegenerationPanel.tsx`, `RegenerationPanel.test.tsx` (all under `src/features/generation/`)
- Modify: `src/features/score-editor/ScoreEditorView.tsx`, `src/components/layout/AppLayout.tsx`, `src/components/transport/TransportBar.tsx`

- [ ] **Step 1: Delete the files**

```bash
cd ~/projects/music_app/src/features/generation
git rm CandidateList.tsx CandidateList.test.tsx preview.ts preview.test.ts RegenerationPanel.tsx RegenerationPanel.test.tsx
```

- [ ] **Step 2: Remove `previewFragment` from the editor**

`ScoreEditorView.tsx` reads it at line 367 and branches on it at roughly lines 523, 568, 591, 905, 1029, 1061, 1080, 1217, 1238. Every one of those guards exists only to suppress editing while a preview overlay is up; with no preview they are dead. Remove the subscription and simplify each branch to its non-preview path. `displayScore` no longer needs `scoreWithCandidate`.

Check whether `NoteColorRole`'s `regenerated` role still has a producer. If nothing sets it, remove it from `buildNoteColors` and both render themes; if something does, leave it and note what.

- [ ] **Step 3: Remove the sidebar panels**

In `AppLayout.tsx` (lines 885–891), delete the `generationMode` branch and both panels. The sidebar becomes the Inspector alone.

- [ ] **Step 4: Run the full suite**

Run: `cd ~/projects/music_app && bun run test`
Expected: PASS. Tests that only covered deleted components go with them; a test covering behaviour that still exists must be kept and repointed.

- [ ] **Step 5: Verify by build and eye**

Run `bun run build`, then `bun run dev` and confirm the editor still renders, selection still works, and the sidebar shows only the Inspector.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/music_app
git add -A src/
git commit -m "refactor(app): delete candidate preview machinery"
```

---

## Task 18: Dashboard Generate Score

**Files:**

- Create: `~/projects/music_app/src/features/generation/GenerateScoreDialog.tsx`
- Create: `~/projects/music_app/src/features/generation/GenerateScoreDialog.test.tsx`
- Modify: `~/projects/music_app/src/features/projects/DashboardPage.tsx`
- Delete: `src/features/generation/GenerationPanel.tsx`, `GenerationPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
describe('GenerateScoreDialog', () => {
  it('is titled Generate a new score', () => {
    render(<GenerateScoreDialog open onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Generate a new score' })).toBeInTheDocument();
  });

  it('requires a prompt before it will submit', async () => {
    render(<GenerateScoreDialog open onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('submits prompt, measures and instrumentation', async () => {
    const onSubmit = vi.fn();
    render(<GenerateScoreDialog open onClose={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Prompt'), 'a waltz');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'a waltz', durationMeasures: expect.any(Number) })
    );
  });
});

describe('DashboardPage', () => {
  it('offers Generate Score', () => {
    renderDashboard();
    expect(screen.getByRole('button', { name: 'Generate Score' })).toBeVisible();
  });

  it('marks a generating project in the list', () => {
    renderDashboard({ projects: [{ ...summary('My Song'), status: 'generating' }] });
    expect(screen.getByText('Generating…')).toBeVisible();
  });

  it('offers Cancel on a generating project, so a job can be abandoned without opening it', () => {
    renderDashboard({ projects: [{ ...summary('My Song'), status: 'generating' }] });
    expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeVisible();
  });

  it('shows no badge on a ready project', () => {
    renderDashboard({ projects: [{ ...summary('My Song'), status: 'ready' }] });
    expect(screen.queryByText('Generating…')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/music_app && bunx vitest run src/features/generation/GenerateScoreDialog.test.tsx src/features/projects/`
Expected: FAIL.

- [ ] **Step 3: Implement**

`GenerateScoreDialog` carries `GenerationPanel`'s exact field set (prompt + presets, style, mood, complexity, instrumentation checklist, measures, tempo, key, time signature) in a `FormModal`. Lift the field markup out of `GenerationPanel` before deleting it.

Submitting: `createProject({name, score: emptyScoreMatching(request)})`, then `createJob({projectId, kind: 'generate-score', request})`, then navigate to the project. The project exists and is `generating` from the first second.

The projects list badge reads `status` off `ProjectSummary`. Poll the list while any row is `generating`: `refetchInterval: (q) => q.state.data?.some(p => p.status === 'generating') ? 3000 : false`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_app
git add -A src/
git commit -m "feat(app): dashboard Generate Score and project status badges"
```

---

## Task 19: End-to-end

**Files:**

- Create: `~/projects/music_app/e2e/generation-jobs.spec.ts`

- [ ] **Step 1: Write the specs**

```ts
test('a generation locks the editor, survives navigation, and lands', async ({ page }) => {
  await openProjectWithScore(page);
  await startReplaceTrack(page, 'make it swing');

  await expect(page.getByText('Generating notes…')).toBeVisible();

  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByText('Generating…')).toBeVisible();

  // Another project is fully editable meanwhile.
  await openOtherProject(page);
  await expect(page.getByText('Generating notes…')).toBeHidden();

  await returnToFirstProject(page);
  await expect(page.getByText('Generating notes…')).toBeHidden({ timeout: 60_000 });
  await expect(await noteCount(page)).toBeGreaterThan(0);
});

test('cancelling unlocks the editor and leaves the score untouched', async ({ page }) => {
  await openProjectWithScore(page);
  const before = await noteCount(page);

  await startReplaceTrack(page, 'make it swing');
  await expect(page.getByText('Generating notes…')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByText('Generating notes…')).toBeHidden();
  expect(await noteCount(page)).toBe(before);
});
```

`music_api` runs under `AI_TEST_MODE=1` for e2e, so generation returns a canned result quickly. Confirm that mode still works through the job path — the runner calls the same transport.

- [ ] **Step 2: Run**

Run: `cd ~/projects/music_app && bun run test:e2e`
Expected: PASS. Kill anything on 5039/8032 first.

- [ ] **Step 3: Commit**

```bash
cd ~/projects/music_app
git add e2e/generation-jobs.spec.ts
git commit -m "test(e2e): async generation jobs"
```

---

## Task 20: Documentation and release

- [ ] **Step 1: Update `music_app/CLAUDE.md`**

Add a Gotchas entry covering: generation is a server-side job, `generating` means "still wanted" and is the cancellation signal, the API rejects writes to a generating project (and why auto-apply depends on that), `music_api` now depends on `music_lib` for `replaceRegionCommand`, and Replace Notes is the one region deliberately not snapped to measures.

- [ ] **Step 2: Update `music_api/CLAUDE.md`**

Cover the jobs table, the detached runner, boot recovery, and the new `music_lib` dependency.

- [ ] **Step 3: Update `docs/architecture.md`**

The six-repo diagram gains a `music_api → music_lib` edge. Add the job request flow beside the existing ones.

- [ ] **Step 4: Full verify**

```bash
cd ~/projects/music_types && bun run verify
cd ~/projects/music_lib && bun run verify
cd ~/projects/music_client && bun run verify
cd ~/projects/music_api && bun run verify
cd ~/projects/music_app && bun run verify
```

- [ ] **Step 5: Commit and release**

```bash
cd ~/projects/music_app && git add -A docs/ CLAUDE.md && git commit -m "docs: async generation jobs"
cd ~/projects/music_api && git add -A CLAUDE.md && git commit -m "docs: async generation jobs"
cd ~/projects/building_blocks && ./scripts/push_all.sh
```

---

## Self-review notes

**Spec coverage.** Job object → Task 2/3. Project status flag → Tasks 1/2. Status transitions → Task 5. Grey-out + Cancel → Task 15. Projects-view indication → Task 18. Apply-if-still-wanted → Task 5. Between-step checks → Task 6. One candidate → Tasks 11/16/17. Region derivation → Task 10. Tick-exact notes → Tasks 10/11. Non-contiguous span disclosure → Tasks 10/16. Immutability → Task 8. Crash recovery → Task 7. `music_api` → `music_lib` → Task 4. Style/mood/complexity → Tasks 1/11/12. Dashboard Generate Score → Task 18. Deletions → Task 17.

**Risk checked and closed.** Task 4 originally assumed `music_lib` exported a pure command applier. It does not need one: `ScoreCommand` is `{id, label, timestamp, execute(score): Score, undo(score): Score}`, so `command.execute(score)` applies it outside any store. Verified against `music_lib/dist/domain/commands/types.d.ts` before the plan was finalised.

**Remaining risk.** Task 8 extracts the generation pipeline out of `routes/ai.ts` into `services/jobs/deps.ts` so the route and the runner share one definition. That file is the busiest in `music_api` and the extraction is the only step in this plan that refactors working code rather than adding to it — do it as a pure move, with the existing `ai.integration.test.ts` green before and after.

**Deliberate ordering.** Task 13 is a hard publish gate: nothing in `music_app` compiles against the new library types before it.

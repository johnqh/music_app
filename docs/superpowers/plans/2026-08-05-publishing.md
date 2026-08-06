# Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** share a snapshot by URL with anyone, listed on a public Community page, viewable and playable without an account.

**Architecture:** Two nullable columns on `snapshots` and a pair of **unauthenticated** routes mounted outside the auth middleware. `music_app` moves its router above the auth gate so two routes can render signed-out, and the published view reuses the print renderer — read-only by construction, because it has no editing surface at all.

**Tech Stack:** TypeScript (strict), Hono + Drizzle + PostgreSQL, React 19, React Router, Vitest, Playwright, Bun.

**Second plan against `docs/superpowers/specs/2026-08-05-snapshots-and-publishing-design.md`.** Snapshots shipped in `2026-08-05-snapshots.md`.

## Global Constraints

- **Publishing is metadata, never content.** No route touches a published snapshot's `score` or `name`. That is what keeps "a snapshot never changes once saved" true while publish state moves.
- **Publish and unpublish work on any snapshot, at any time.** The checkbox at creation is a shortcut, not the only route.
- **Unpublishing 404s the URL and removes it from Community.**
- **`publicId` is an unguessable random id**, not a name-derived slug. No collisions, no squatting, no renaming breaking links.
- **The public payload never carries `userId` or the account email.** It is the only identity the backend holds, and a public page is the wrong place for it.
- **Public routes mount outside `authMiddleware`**, and the authenticated ones keep rejecting without a token.
- **A visitor may view and play. Nothing else** — no edit, print, export or copy affordance anywhere on the page.
- **Do not commit or push.** `scripts/push_all.sh` does that.
- Publish order: `music_types` → `music_client` → `music_app`; `music_api` consumes `music_types` directly. Use `bun update`, not `bun add`, after publishing — `bun add` cannot resolve a just-published version for minutes.

---

## File Structure

| File                                                 | Responsibility                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `music_types/src/index.ts`                           | `publicId`/`publisherName`, `PublishedSnapshot`, `CommunityItem`, publish request. |
| `music_api/src/db/index.ts`, `schema.ts`             | Two columns and a unique index.                                                    |
| `music_api/src/services/snapshots.ts`                | publish / unpublish / public reads / last publisher name.                          |
| `music_api/src/routes/snapshots.ts`                  | Authenticated publish + unpublish.                                                 |
| `music_api/src/routes/public.ts`                     | **New.** Unauthenticated reads.                                                    |
| `music_api/src/index.ts`                             | Mount `/api/v1/public` **outside** the auth middleware.                            |
| `music_client/src/network/music-client.ts`           | Four calls, two of them token-free.                                                |
| `music_app/src/app/App.tsx`, `router.tsx`            | Router above the auth gate; two public routes.                                     |
| `music_app/src/features/community/CommunityPage.tsx` | **New.** The public list.                                                          |
| `music_app/src/features/community/PublishedView.tsx` | **New.** Read-only score + transport + Share.                                      |

---

### Task 1: The model

**Files:**

- Modify: `~/projects/music_types/src/index.ts`
- Test: `~/projects/music_types/src/api.test.ts`

**Interfaces:**

- Produces:

```ts
export type Snapshot = { /* …existing… */ publicId?: string; publisherName?: string };

/** What an anonymous visitor receives. Deliberately carries no owner identity. */
export type PublishedSnapshot = {
  publicId: string;
  name: string;
  publisherName: string;
  score: Score;
  createdAt: string;
};

/** One row of the Community list. No score — the list would be enormous. */
export type CommunityItem = Omit<PublishedSnapshot, 'score'>;

export const publishedSnapshotSchema: z.ZodType<PublishedSnapshot>;
export const communityItemSchema: z.ZodType<CommunityItem>;
export const publishRequestSchema: z.ZodType<{ publisherName: string }>;
```

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_types/src/api.test.ts`:

```ts
describe('publishing schemas', () => {
  const score = createEmptyScore({ title: 'P', measures: 1, tracks: [{ name: 'Piano' }] });
  const published = {
    publicId: 'pub_abc123',
    name: 'Version 1',
    publisherName: 'Jane',
    score,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts a published snapshot', () => {
    expect(publishedSnapshotSchema.parse(published).publicId).toBe('pub_abc123');
  });

  it('rejects a published snapshot with no publisher name', () => {
    // The Community list would show an anonymous row it cannot attribute.
    expect(() => publishedSnapshotSchema.parse({ ...published, publisherName: '' })).toThrow();
  });

  it('strips anything not on the public shape', () => {
    // The guard that matters: no userId, no email, ever reaches a public page.
    const parsed = publishedSnapshotSchema.parse({
      ...published,
      userId: 'uid-1',
      email: 'a@b.c',
    }) as Record<string, unknown>;
    expect(parsed.userId).toBeUndefined();
    expect(parsed.email).toBeUndefined();
  });

  it('lists a community item without its score', () => {
    const item = communityItemSchema.parse({ ...published, score: undefined });
    expect('score' in item).toBe(false);
  });

  it('accepts a publish request carrying a publisher name', () => {
    expect(publishRequestSchema.parse({ publisherName: 'Jane' }).publisherName).toBe('Jane');
  });

  it('accepts a snapshot that is published, and one that is not', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      parentId: null,
      name: 'Version 1',
      score,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(snapshotSchema.parse(base).publicId).toBeUndefined();
    expect(
      snapshotSchema.parse({ ...base, publicId: 'pub_x', publisherName: 'Jane' }).publicId,
    ).toBe('pub_x');
  });
});
```

Add the three new schema names to the file's `./index` import.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_types && bun run test`
Expected: FAIL — the schemas do not exist.

- [x] **Step 3: Add the types and schemas**

In `~/projects/music_types/src/index.ts`, extend `Snapshot`:

```ts
  /**
   * Set when published; the public URL is /p/<publicId>. Absent when not.
   *
   * Publishing is metadata about *sharing*, not part of the music — which is
   * why it may change on a snapshot that otherwise never does.
   */
  publicId?: string;
  /** Shown on the Community list. Never the account email. */
  publisherName?: string;
```

and beside the snapshot schemas:

```ts
/** What an anonymous visitor receives. Carries no owner identity, by construction. */
export const publishedSnapshotSchema = z.object({
  publicId: z.string().min(1),
  name: z.string().min(1),
  publisherName: z.string().min(1),
  score: scoreSchema,
  createdAt: z.string().min(1),
});

/** One row of the Community list. No score — the list would be enormous. */
export const communityItemSchema = publishedSnapshotSchema.omit({ score: true });

export const publishRequestSchema = z.object({
  publisherName: z.string().min(1).max(80),
});
```

Extend `snapshotSchema` with `publicId: z.string().min(1).optional()` and
`publisherName: z.string().min(1).optional()`, and mirror both onto the
`Snapshot` type. Declare `PublishedSnapshot` and `CommunityItem` as
`z.infer<typeof …>` or as hand-written types matching the schemas — whichever
the file already does for `ProjectRecord`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_types && bun run verify`
Expected: PASS.

- [x] **Step 5: Publish and consume**

Bump the minor by hand, `npm publish`, then in `music_api`:
`bun update @sudobility/music_types && bun run typecheck`.

---

### Task 2: Storage, publish, and the public routes

**Files:**

- Modify: `~/projects/music_api/src/db/index.ts`, `src/db/schema.ts`
- Modify: `~/projects/music_api/src/services/snapshots.ts`
- Modify: `~/projects/music_api/src/routes/snapshots.ts`
- Create: `~/projects/music_api/src/routes/public.ts`
- Modify: `~/projects/music_api/src/index.ts`
- Create: `~/projects/music_api/src/routes/public.integration.test.ts`

**Interfaces:**

- Produces:

```ts
export async function publishSnapshot(
  db: Db,
  userId: string,
  id: string,
  publisherName: string,
): Promise<Snapshot | null>;
export async function unpublishSnapshot(
  db: Db,
  userId: string,
  id: string,
): Promise<Snapshot | null>;
export async function getPublished(db: Db, publicId: string): Promise<PublishedSnapshot | null>;
export async function listCommunity(db: Db, limit?: number): Promise<CommunityItem[]>;
export async function lastPublisherName(db: Db, userId: string): Promise<string | null>;
```

- [x] **Step 1: Write the failing test**

Create `~/projects/music_api/src/routes/public.integration.test.ts`, copying the
bootstrap from `snapshots.integration.test.ts` verbatim (same `.env.test`
gating, same `authed` helper, same `testScore`), and adding an **unauthenticated**
request helper:

```ts
/** No Authorization header at all — the whole point of these routes. */
const anon = (path: string) => app.request(path);

it('publishes a snapshot and serves it to nobody in particular', async () => {
  const p = await newProject('Publish');
  const s = await snapshot(p.id, 'Version 1');

  const res = await authed(`/api/v1/snapshots/${s.id}/publish`, {
    method: 'POST',
    body: JSON.stringify({ publisherName: 'Jane' }),
  });
  expect(res.status).toBe(200);
  const publicId = ((await res.json()) as Env<Snapshot>).data!.publicId!;
  expect(publicId).toBeTruthy();

  const view = await anon(`/api/v1/public/snapshots/${publicId}`);
  expect(view.status).toBe(200);
  const body = ((await view.json()) as Env<PublishedSnapshot>).data!;
  expect(body.name).toBe('Version 1');
  expect(body.publisherName).toBe('Jane');
  expect(body.score).toEqual(s.score);
});

it('never exposes the owner', async () => {
  // The one thing a public page must not leak.
  const p = await newProject('No owner');
  const s = await snapshot(p.id, 'Version 1');
  const publicId = await publish(s.id, 'Jane');

  const raw = await (await anon(`/api/v1/public/snapshots/${publicId}`)).text();
  expect(raw).not.toContain('user_id');
  expect(raw).not.toContain('userId');
  expect(raw).not.toContain('@');
});

it('lists published snapshots on Community, without scores', async () => {
  const p = await newProject('Community');
  const s = await snapshot(p.id, 'Version 1');
  await publish(s.id, 'Jane');

  const res = await anon('/api/v1/public/community');
  expect(res.status).toBe(200);
  const list = ((await res.json()) as Env<CommunityItem[]>).data!;
  expect(list.length).toBeGreaterThan(0);
  expect('score' in list[0]).toBe(false);
  expect(list[0].publisherName).toBe('Jane');
});

it('unpublishing 404s the URL and drops it from Community', async () => {
  const p = await newProject('Unpublish');
  const s = await snapshot(p.id, 'Version 1');
  const publicId = await publish(s.id, 'Jane');

  expect((await anon(`/api/v1/public/snapshots/${publicId}`)).status).toBe(200);
  expect((await authed(`/api/v1/snapshots/${s.id}/unpublish`, { method: 'POST' })).status).toBe(
    200,
  );
  expect((await anon(`/api/v1/public/snapshots/${publicId}`)).status).toBe(404);

  const list = ((await (await anon('/api/v1/public/community')).json()) as Env<CommunityItem[]>)
    .data!;
  expect(list.some((i) => i.publicId === publicId)).toBe(false);
});

it('publishing does not change the music', async () => {
  // Metadata, never content.
  const p = await newProject('Unchanged');
  const s = await snapshot(p.id, 'Version 1');
  await publish(s.id, 'Jane');
  const reread = await snapshotById(s.id);
  expect(reread.score).toEqual(s.score);
  expect(reread.name).toBe('Version 1');
});

it('gives each publication its own unguessable id', async () => {
  const p = await newProject('Ids');
  const a = await publish((await snapshot(p.id, 'Version 1')).id, 'Jane');
  const b = await publish((await snapshot(p.id, 'Version 2')).id, 'Jane');
  expect(a).not.toBe(b);
  expect(a.length).toBeGreaterThanOrEqual(16);
});

it('still requires a token for the authenticated routes', async () => {
  const p = await newProject('Guarded');
  const s = await snapshot(p.id, 'Version 1');
  expect((await anon(`/api/v1/snapshots/${s.id}`)).status).toBe(401);
});

it('remembers the last publisher name for pre-filling', async () => {
  const p = await newProject('Remember');
  await publish((await snapshot(p.id, 'Version 1')).id, 'Jane');
  const res = await authed('/api/v1/snapshots/publisher-name');
  expect(((await res.json()) as Env<{ publisherName: string | null }>).data!.publisherName).toBe(
    'Jane',
  );
});
```

with a local helper:

```ts
async function publish(id: string, publisherName: string): Promise<string> {
  const res = await authed(`/api/v1/snapshots/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({ publisherName }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as Env<Snapshot>).data!.publicId!;
}
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_api && bun run test public`
Expected: FAIL — the routes 404 (and the public ones 401, since nothing is
mounted outside the auth middleware yet).

- [x] **Step 3: Add the columns**

In `~/projects/music_api/src/db/index.ts`, after the snapshots index:

```ts
await sql`ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS public_id TEXT`;
await sql`ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS publisher_name TEXT`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS snapshots_public_id_idx ON snapshots (public_id)`;
```

A **unique** index, so two publications can never collide on an id; nullable, so
unpublished rows are simply absent from it.

In `src/db/schema.ts`, add to the `snapshots` table:

```ts
    publicId: text('public_id'),
    publisherName: text('publisher_name'),
```

- [x] **Step 4: Add the service functions**

Append to `~/projects/music_api/src/services/snapshots.ts`:

```ts
/**
 * A URL-safe, unguessable publication id.
 *
 * Random rather than derived from the name: no collisions, nobody squatting on
 * a title, and renaming a project cannot break a link somebody already has.
 */
function newPublicId(): string {
  return `pub_${randomUUID().replace(/-/g, '')}`;
}

export async function publishSnapshot(
  db: Db,
  userId: string,
  id: string,
  publisherName: string,
): Promise<Snapshot | null> {
  const existing = await getSnapshot(db, userId, id);
  if (!existing) return null;

  // Publishing twice keeps the first id, so a link already shared stays valid.
  const publicId = existing.publicId ?? newPublicId();
  const updated = await db
    .update(snapshots)
    .set({ publicId, publisherName })
    .where(and(eq(snapshots.userId, userId), eq(snapshots.id, id)))
    .returning();
  return updated[0] ? toSnapshot(updated[0]) : null;
}

export async function unpublishSnapshot(
  db: Db,
  userId: string,
  id: string,
): Promise<Snapshot | null> {
  const updated = await db
    .update(snapshots)
    .set({ publicId: null, publisherName: null })
    .where(and(eq(snapshots.userId, userId), eq(snapshots.id, id)))
    .returning();
  return updated[0] ? toSnapshot(updated[0]) : null;
}

/** Built field by field, so no column added later can leak into a public payload. */
function toPublished(row: SnapshotRow): PublishedSnapshot {
  return {
    publicId: row.publicId as string,
    name: row.name,
    publisherName: row.publisherName ?? 'Anonymous',
    score: row.score,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getPublished(db: Db, publicId: string): Promise<PublishedSnapshot | null> {
  const rows = await db.select().from(snapshots).where(eq(snapshots.publicId, publicId));
  return rows[0] ? toPublished(rows[0]) : null;
}

export async function listCommunity(db: Db, limit = 100): Promise<CommunityItem[]> {
  const rows = await db
    .select()
    .from(snapshots)
    .where(isNotNull(snapshots.publicId))
    .orderBy(desc(snapshots.createdAt))
    .limit(limit);
  return rows.map((row) => {
    const { score: _score, ...rest } = toPublished(row);
    return rest;
  });
}

/** The name this user last published under, for pre-filling the dialog. */
export async function lastPublisherName(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.userId, userId), isNotNull(snapshots.publisherName)))
    .orderBy(desc(snapshots.createdAt))
    .limit(1);
  return rows[0]?.publisherName ?? null;
}
```

Add `randomUUID` from `node:crypto` and `isNotNull` to the `drizzle-orm`
import. The eslint config rejects unused destructured bindings — if
`const { score: _score, ...rest }` trips it, build the object explicitly as
`toSummary` already does in this file.

- [x] **Step 5: Add the routes**

To `~/projects/music_api/src/routes/snapshots.ts`:

```ts
router.get('/publisher-name', async (c) =>
  c.json(
    successResponse({ publisherName: await service.lastPublisherName(getDb(), c.get('userId')) }),
  ),
);

router.post('/:id/publish', zValidator('json', publishRequestSchema), async (c) => {
  const snapshot = await service.publishSnapshot(
    getDb(),
    c.get('userId'),
    c.req.param('id'),
    c.req.valid('json').publisherName,
  );
  if (!snapshot) return c.json(errorResponse('Snapshot not found'), 404);
  return c.json(successResponse(snapshot));
});

router.post('/:id/unpublish', async (c) => {
  const snapshot = await service.unpublishSnapshot(getDb(), c.get('userId'), c.req.param('id'));
  if (!snapshot) return c.json(errorResponse('Snapshot not found'), 404);
  return c.json(successResponse(snapshot));
});
```

`/publisher-name` must be declared **before** `/:id`, or Hono matches it as an
id.

Create `~/projects/music_api/src/routes/public.ts`:

```ts
/**
 * Unauthenticated reads of published snapshots.
 *
 * Mounted **outside** `authMiddleware` in src/index.ts — that placement is the
 * feature, not an oversight. Everything served here is deliberately public and
 * carries no owner identity.
 */
import { Hono } from 'hono';
import { errorResponse, successResponse } from '@sudobility/music_types';
import { getDb } from '../db';
import * as service from '../services/snapshots';

const router = new Hono();

router.get('/community', async (c) =>
  c.json(successResponse(await service.listCommunity(getDb()))),
);

router.get('/snapshots/:publicId', async (c) => {
  const published = await service.getPublished(getDb(), c.req.param('publicId'));
  if (!published) return c.json(errorResponse('Not found'), 404);
  return c.json(successResponse(published));
});

export default router;
```

In `~/projects/music_api/src/index.ts`, mount it beside the public health route
and **before** the authenticated `/api/v1` router, so the auth middleware never
sees it. Find how health is registered and follow that exactly.

- [x] **Step 6: Run the tests to verify they pass**

Run: `cd ~/projects/music_api && bun run test public snapshots`
Expected: PASS, including the existing snapshot suite.

- [x] **Step 7: Verify the tests are not vacuous**

Make `unpublishSnapshot` a no-op and confirm the unpublish test fails. Make
`toPublished` spread the whole row and confirm "never exposes the owner" fails.
Restore both, checking each edit actually landed before trusting the result — a
sabotage that changes no bytes proves nothing.

- [x] **Step 8: Verify**

Run: `cd ~/projects/music_api && bun run verify`

---

### Task 3: The client

**Files:**

- Modify: `~/projects/music_client/src/network/music-client.ts`
- Modify: `~/projects/music_client/src/hooks/use-snapshots.ts`, `src/index.ts`
- Test: `~/projects/music_client/src/network/music-client.test.ts`

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_client/src/network/music-client.test.ts`, matching how
its existing cases assert on the fake network client's recorded call:

```ts
it('reads a published snapshot without sending a token', async () => {
  // The whole point of the public routes: a visitor has no token to send.
  const { client, calls } = fakeClient();
  await new MusicClient(client, BASE).getPublishedSnapshot('pub_x');
  expect(calls[0].url).toBe(`${BASE}/public/snapshots/pub_x`);
  expect(calls[0].headers?.Authorization).toBeUndefined();
});

it('reads the community list without a token', async () => {
  const { client, calls } = fakeClient();
  await new MusicClient(client, BASE).listCommunity();
  expect(calls[0].url).toBe(`${BASE}/public/community`);
  expect(calls[0].headers?.Authorization).toBeUndefined();
});

it('publishes with a token', async () => {
  const { client, calls } = fakeClient();
  await new MusicClient(client, BASE).publishSnapshot('s1', 'Jane', 'tok');
  expect(calls[0].url).toBe(`${BASE}/snapshots/s1/publish`);
  expect(calls[0].headers?.Authorization).toBe('Bearer tok');
});
```

Read the file's existing `fakeClient`/recording helper first and use it rather
than inventing one; if the helper records something other than `calls[].url`,
assert on whatever it does record.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_client && bun run test music-client`
Expected: FAIL — the methods do not exist.

- [x] **Step 3: Add the methods**

In `music-client.ts`, beside the other snapshot calls. The two public ones take
**no token**, which is what makes them usable signed-out:

```ts
  publishSnapshot(id: string, publisherName: string, token: string): Promise<Snapshot> {
    return this.request<Snapshot>(`/snapshots/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: { publisherName },
      token,
    });
  }

  unpublishSnapshot(id: string, token: string): Promise<Snapshot> {
    return this.request<Snapshot>(`/snapshots/${encodeURIComponent(id)}/unpublish`, {
      method: 'POST',
      token,
    });
  }

  lastPublisherName(token: string): Promise<{ publisherName: string | null }> {
    return this.request<{ publisherName: string | null }>('/snapshots/publisher-name', { token });
  }

  /** No token: a visitor has none. */
  getPublishedSnapshot(publicId: string): Promise<PublishedSnapshot> {
    return this.request<PublishedSnapshot>(
      `/public/snapshots/${encodeURIComponent(publicId)}`,
      {}
    );
  }

  /** No token. */
  listCommunity(): Promise<CommunityItem[]> {
    return this.request<CommunityItem[]>('/public/community', {});
  }
```

Check `request`'s options type treats an absent `token` as "send no
Authorization header" rather than sending `Bearer undefined`; if it does not,
make it skip the header when `token` is undefined, and add a test for that.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_client && bun run verify`

- [x] **Step 5: Publish and consume**

Bump, publish, then `cd ~/projects/music_app && bun update @sudobility/music_client @sudobility/music_types`.

---

### Task 4: Two routes that render signed-out

**Files:**

- Modify: `~/projects/music_app/src/app/App.tsx`, `src/app/router.tsx`
- Test: `~/projects/music_app/src/app/App.test.tsx`

The auth gate currently wraps the entire router, so no route can render without
a user. The router moves **above** the gate, and the gate becomes the element of
a catch-all route.

- [x] **Step 1: Write the failing test**

Add to `~/projects/music_app/src/app/App.test.tsx`:

```tsx
describe('public routes', () => {
  it('renders Community with no signed-in user', async () => {
    // The whole point: a stranger with no account can browse.
    window.history.pushState({}, '', '/en/community');
    renderAppSignedOut();
    expect(await screen.findByRole('heading', { name: /community/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('still gates the editor when signed out', async () => {
    window.history.pushState({}, '', '/en/projects');
    renderAppSignedOut();
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
```

`renderAppSignedOut` renders `<App store={...} />` with the auth context's
`user` as null — copy whatever `App.test.tsx` already does to control auth
state, rather than adding a second mechanism.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test App`
Expected: FAIL — `/en/community` renders the sign-in screen.

- [x] **Step 3: Move the router above the gate**

In `~/projects/music_app/src/app/router.tsx`, split the route table out of
`BrowserRouter` so it can be composed:

```tsx
/**
 * The signed-in route table. Rendered behind the auth gate.
 *
 * Public routes are declared in `PublicRoutes` and matched *before* this, so
 * the gate never sees them.
 */
export function AppRoutes({ store = useAppStore }: AppRouterProps) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/en" replace />} />
      <Route path="/:lang" element={<LanguageValidator />}>
        <Route element={<ScreenContainerLayout />}>
          <Route index element={<HomePage />} />
          <Route path="projects" element={<DashboardRoute store={store} />} />
          <Route path="settings" element={<SettingsRoute store={store} />} />
        </Route>
        <Route path="project/:id" element={<ProjectRoute store={store} />} />
        <Route path="project/:id/print" element={<PrintRoute store={store} />} />
      </Route>
      <Route path="*" element={<Navigate to="/en" replace />} />
    </Routes>
  );
}
```

and keep `AppRouter` as `<BrowserRouter><AppRoutes … /></BrowserRouter>` so any
existing caller and test still works.

In `~/projects/music_app/src/app/App.tsx`, wrap the gate in the router rather
than the other way round:

```tsx
<BrowserRouter>
  <Routes>
    {/* No auth gate on these two: that is the feature. */}
    <Route path="/:lang/community" element={<CommunityPage />} />
    <Route path="/:lang/p/:publicId" element={<PublishedView />} />
    <Route path="*" element={<AuthGate store={store} />} />
  </Routes>
</BrowserRouter>
```

and change `AuthGate` to render `<AppRoutes store={store} />` instead of
`<AppRouter store={store} />`, since the `BrowserRouter` is now outside it.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test App router`
Expected: PASS, including the existing routing tests.

---

### Task 5: The public pages and the Publish checkbox

**Files:**

- Create: `~/projects/music_app/src/features/community/CommunityPage.tsx`
- Create: `~/projects/music_app/src/features/community/PublishedView.tsx`
- Create: `~/projects/music_app/src/features/community/Community.test.tsx`
- Modify: `~/projects/music_app/src/features/snapshots/SnapshotDialogs.tsx`
- Modify: `~/projects/music_app/src/components/layout/AppLayout.tsx`

- [x] **Step 1: Write the failing test**

```tsx
describe('CreateSnapshotDialog publishing', () => {
  it('offers a Publish checkbox, off by default', () => {
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /publish/i })).not.toBeChecked();
  });

  it('asks for a publisher name only when publishing', async () => {
    const user = userEvent.setup();
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Publisher name')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /publish/i }));
    expect(screen.getByLabelText('Publisher name')).toBeVisible();
  });

  it('reports the publisher name alongside the snapshot name', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <CreateSnapshotDialog
        open
        snapshotCount={0}
        defaultPublisherName="Jane"
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /publish/i }));
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    expect(onCreate).toHaveBeenCalledWith('Version 1', 'Jane');
  });

  it('will not publish without a publisher name', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={onCreate} onClose={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: /publish/i }));
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('PublishedView', () => {
  it('offers no way to edit', () => {
    // The rule the page exists to keep. Asserted by absence of every affordance.
    renderPublished();
    for (const name of [/print/i, /export/i, /save/i, /undo/i, /delete/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('shows a Share button carrying the URL', async () => {
    const user = userEvent.setup();
    renderPublished();
    await user.click(screen.getByRole('button', { name: /share/i }));
    expect(screen.getByText(/\/p\/pub_x/)).toBeVisible();
  });

  it('can play', () => {
    renderPublished();
    expect(screen.getByRole('button', { name: /play/i })).toBeVisible();
  });
});
```

`renderPublished` renders `<PublishedView />` with the client stubbed to return
a fixed `PublishedSnapshot` — stub `getAppServices().musicClient` the way
`installTestAppServices` already lets tests stub services.

- [x] **Step 2: Run it to verify it fails**

Run: `cd ~/projects/music_app && bun run test Community SnapshotDialogs`
Expected: FAIL — no checkbox, no view.

- [x] **Step 3: Extend the create dialog**

Add `defaultPublisherName?: string` to `CreateSnapshotDialogProps`, a `publish`
checkbox, a publisher-name field shown only when it is checked, and change
`onCreate` to `(name: string, publisherName?: string) => void`. Guard: when
publish is checked and the publisher name is blank, do not call `onCreate` —
the same shape as the existing blank-name guard.

- [x] **Step 4: Build the two pages**

`CommunityPage` fetches `listCommunity()` on mount (no token), renders an
`<h1>Community</h1>` and a list of items linking to `/en/p/<publicId>`, each
showing the name, the publisher and the date.

`PublishedView` reads `:publicId`, fetches `getPublishedSnapshot()` (no token),
and renders the score **read-only by reusing the print renderer** — `computeLayout`
plus `PrintSystem` per system, which has no interaction surface at all. Add a
transport with play/pause driven by `playbackController`, and a **Share** button
revealing `window.location.href`.

There is deliberately no editing store wired in: the page cannot edit because
there is nothing on it that could.

- [x] **Step 5: Wire publishing into AppLayout**

`createSnapshot(name, publisherName?)` publishes after creating when a name is
given, and surfaces the resulting URL in a toast with the link. Load
`lastPublisherName()` when the menu opens and pass it as `defaultPublisherName`.

- [x] **Step 6: Run the tests to verify they pass**

Run: `cd ~/projects/music_app && bun run test Community SnapshotDialogs AppLayout`

---

### Task 6: End to end

- [x] **Step 1: Write the e2e**

Add `~/projects/music_app/e2e/publishing.spec.ts`: create a project, snapshot it
with **Publish** checked, read the URL from the toast, then open that URL **in a
fresh context with no storage state** — the only way to prove the page really is
public — and assert the score renders, a Play button exists, and no edit
affordance does.

```ts
const anon = await browser.newContext(); // no storage state = signed out
const page2 = await anon.newPage();
await page2.goto(publishedUrl);
await expect(page2.getByRole('button', { name: /play/i })).toBeVisible();
expect(await page2.getByRole('button', { name: /export/i }).count()).toBe(0);
```

Wait for the create dialog to be **hidden** before touching the canvas —
the overlay intercepts clicks, which cost the snapshots e2e two debugging
rounds.

- [x] **Step 2: Run everything**

```bash
cd ~/projects/music_types && bun run verify
cd ~/projects/music_api && bun run verify
cd ~/projects/music_client && bun run verify
cd ~/projects/music_app && bun run verify
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null
rm -rf node_modules/.vite
bun run test:e2e
```

- [x] **Step 3: Try it by hand**

Publish a snapshot, copy the URL, open it in a private window. Check by eye: it
loads with no sign-in, plays, shows the publisher's name, and offers nothing
that could change it. Then unpublish and confirm the same URL 404s.

---

## Self-Review

**Spec coverage.** Publish checkbox at creation → Task 5. Publish/unpublish any snapshot any time → Task 2. Unpublish 404s and delists → Task 2, asserted. Unguessable id → Task 2, asserted distinct and long. No email or owner in the public payload → Task 1 (schema strips) and Task 2 (asserted on the raw response body). Community public and signed-out → Tasks 2 and 4. View and play only → Task 5, asserted by absence. Share button → Task 5. Publisher name remembered → Task 2's `lastPublisherName`, Task 5's `defaultPublisherName`. e2e in a real signed-out context → Task 6.

**Deliberate gaps, stated rather than hidden:**

- **`toPublished` builds its object field by field** rather than deleting keys from a row. Slower to write, but a column added to `snapshots` later cannot leak into a public payload by default — which is the failure mode that matters here.
- **Community is unpaginated beyond `limit = 100`.** Fine at this scale; a cursor is a separate job, and the spec already puts curation out of scope.
- **Publishing twice keeps the first `publicId`**, so a link already shared stays valid. Unpublishing then republishing deliberately mints a _new_ id — taking something down should mean the old link stays dead.
- **`'Anonymous'` is the fallback** when `publisherName` is somehow null on a published row. It cannot happen through the routes, since publish requires a name; it exists so a bad row degrades to a harmless label rather than a crash on a public page.
- **Task 5 describes the two pages' structure rather than their full JSX.** Their behaviour is pinned by the tests in Step 1; the markup is ordinary composition of primitives already in the repo, and `PrintSystem` is the template for the read-only score.

**Type consistency.** `PublishedSnapshot` and `CommunityItem` are defined in Task 1 and consumed in Tasks 2, 3 and 5. `publishRequestSchema` validates the route added in Task 2. `Snapshot.publicId` is added in Task 1, set in Task 2, and read in Task 5's toast. `AppRoutes` is extracted in Task 4 and rendered by `AuthGate`; `AppRouter` keeps its old shape so existing callers and tests are unaffected.

---

## Execution Notes (2026-08-05) — complete

All six tasks done. `music_types` **0.9.0** and `music_client` **0.4.0**
published. Suites: music_types 66, music_api 103 (real PostgreSQL),
music_client 20, music_app 572, e2e 35.

The e2e proves the claim properly: it publishes, then opens the URL in a
**fresh browser context with no storage state** — the only way to show the page
really is public rather than merely reachable while signed in. It asserts play
and Share are present, that export/import/print are absent, and that Community
lists the item signed-out too.

Sabotage checks, each confirmed to have actually landed before trusting it:
leaving `publicId` set on unpublish fails the unpublish test; making
`toPublished` spread the whole row fails "never exposes the owner"; sending a
token on `listCommunity` fails the token-free test.

**Deviations and corrections:**

- **One existing test failed correctly** when `onCreate` gained a second
  argument. Updated rather than worked around — the signature genuinely
  changed.
- `music_api`'s eslint rejects unused destructured bindings, so `listCommunity`
  builds its rows explicitly instead of `const { score, ...rest }`. Same reason
  `toSummary` was rewritten in the snapshots plan.
- An unused `ProjectRecord` helper in the copied integration harness had to go,
  but the _type_ import stayed — `typecheck` caught both halves in turn.

**A test bug worth recording.** The final Community assertion failed with
`toBeVisible()`, which reads like the element is missing. It was not: the shared
test database accumulates published rows, so `getByText('by Jane')` matched
many elements and tripped Playwright's strict mode. The page was correct all
along. `.first()` and a comment saying _why_ now make the intent — "at least
one" — explicit.

Not committed — `scripts/push_all.sh` owns commits.

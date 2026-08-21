# Music Family Re-Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Moosiac into the five-repo Sudobility family (music_types/api/client/lib/app), replace mock AI with OpenAI proxied through music_api, replace IndexedDB with server-side persistence, and rebuild the UI on @sudobility — with the app green at every phase boundary.

**Architecture:** Approach B three-phase strangler per the approved spec. Phase 1 extracts types+lib (app unchanged in behavior). Phase 2 adds api+client and swaps persistence/generation under the store. Phase 3 rebuilds the UI per sudobility/docs/APP.md.

**Tech Stack:** Bun everywhere; TS strict; Hono + Drizzle/PostgreSQL + firebase-admin + openai (api); NetworkClient DI + React Query (client); Zustand + existing domain/adapters (lib); React 19 + Vite + Tailwind + @sudobility/building_blocks|components|design (app).

**The authoritative requirements document is `docs/superpowers/specs/2026-07-25-music-family-rearchitecture-design.md` in the music_app repo.** Every task cites the spec sections it implements; read them before implementing. The pre-split codebase lives in music_app @ commit `95ebaeb` — the code being moved is THERE, complete with tests; moving means `git`-copying files and adjusting imports, not rewriting.

## Global Constraints

- All five repos: work directly on `main`, push to `github.com/johnqh/<repo>` when the task's verify gate is green. New repos are created private with `gh repo create johnqh/<name> --private --source=. --push` after the first commit.
- CI/CD: every repo gets `.github/workflows/ci-cd.yml` calling `johnqh/workflows/.github/workflows/unified-cicd.yml@main` with `secrets: inherit` (copy sudojo_types' file verbatim; set `npm-access: "public"` ONLY for music_types; `"restricted"` for music_client/music_lib; omit npm publishing inputs for music_api/music_app — copy the corresponding sudojo repo's ci-cd.yml as the template in each case).
- `NPM_TOKEN` secret per new repo: `gh secret set NPM_TOKEN -R johnqh/<repo> --body "$(grep -o 'npm_[A-Za-z0-9]*' ~/.npmrc | head -1)"`. Never echo the token.
- Publish-first flow: a consumer task MUST verify its dependency is on npm before starting (`npm view @sudobility/music_types version`); after pushing a published package, poll `npm view` (30s interval, ≤10min) until the new version appears; if it doesn't, inspect `gh run list -R johnqh/<repo>` and fix CI before proceeding. Registry semver `^` ranges only — never `file:`/`workspace:`.
- Package manager: Bun (`bun install`, `bun run <script>`, `bun.lock` committed). Every repo defines scripts `verify` (typecheck+lint+test+build), `build`, `test`, `lint`, `typecheck`. music_app keeps its e2e script.
- Published packages: license `BUSL-1.1`, `main`/`types` → `dist/index.js`/`dist/index.d.ts`, `prepublishOnly` runs verify+build, ESM.
- TS strict, zero errors, everywhere. Conventional commits; commit at every green test cycle; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Each repo gets CLAUDE.md (AI-focused: stack, structure, commands, patterns, gotchas, related projects) and README.md (human-focused) per the workspace doc standards — written in the task that creates the repo, updated in tasks that change its architecture.
- API contracts preserved verbatim (spec Decisions): `GenerateScoreRequest`→`GenerateScoreResult{score,warnings}`, `RegenerateRegionRequest`→`RegenerateRegionResult{candidates:[{id,label,fragment}],warnings}`.
- Response envelope everywhere in music_api: `{success, data?, error?}` via `successResponse`/`errorResponse` from music_types.
- `OPENAI_API_KEY` server-side only; model from `OPENAI_MODEL` env — never hardcoded in source.
- Phase exit gates (spec "Migration phases") are binding; do not start a phase before the previous gate is met.

## Cross-Task Contracts (binding names and shapes)

- npm packages: `@sudobility/music_types` (public), `@sudobility/music_client` (restricted), `@sudobility/music_lib` (restricted). Private: `music_api`, `music_app`.
- music_types exports (single sectioned `src/index.ts`): every Score-tree type currently in music_app `src/domain/score/types.ts` + `isNoteEvent`/`isRestEvent`; `ScoreFragment` (from `src/domain/score/fragment.ts` — type only), `ScoreRange`/`ScoreSelection` (from `src/domain/selection/types.ts` — types only, `emptySelection` stays in lib); all Zod schemas from `src/domain/score/schema.ts` (`scoreSchema`, `measureSchema`, `noteEventSchema`, …, `parseScore`); generation contracts from `src/services/generation/types.ts` and their Zod schemas from `src/services/generation/schema.ts`; NEW project API types: `ProjectSummary { id; name; createdAt; updatedAt; schemaVersion }`, `ProjectRecord = ProjectSummary & { score: Score; uiPrefs?: { view: "notation"|"piano-roll"; zoom: number } }`, `ProjectCreateRequest { name; score; uiPrefs? }`, `ProjectUpdateRequest { name?; score?; uiPrefs? }`, `ProjectListQuery { search?; sort?: "updatedAt"|"name" }`; envelope: `ApiResponse<T> = { success: boolean; data?: T; error?: string }`, `successResponse<T>(data): ApiResponse<T>`, `errorResponse(message, code?): ApiResponse<never> & { code? }`; error codes const object `API_ERROR_CODES = { QUOTA_EXCEEDED, AI_GENERATION_FAILED, AI_OUTPUT_INVALID, PROJECT_NOT_FOUND, UNAUTHORIZED }`.
- music_api: base path `/api/v1`; routes exactly `GET /health` (public), `POST /ai/generate`, `POST /ai/regenerate`, `GET /projects`, `POST /projects`, `GET /projects/:id`, `PUT /projects/:id`, `DELETE /projects/:id` (all authed); port default 8022; Drizzle tables `projects(id uuid pk, user_id text idx, name text, score jsonb, ui_prefs jsonb null, schema_version int, created_at, updated_at)` and `ai_usage(user_id text, date text, generate_count int, regenerate_count int, pk(user_id,date))`; env `DATABASE_URL, PORT, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_TIMEOUT_MS, AI_DAILY_LIMIT, AI_TEST_MODE, TEST_AUTH_BYPASS_TOKEN`.
- music_client: `class MusicClient { constructor(networkClient: NetworkClient, baseUrl: string); generateScore(req: GenerateScoreRequest, token: string, signal?: AbortSignal): Promise<GenerateScoreResult>; regenerateRegion(req: RegenerateRegionRequest, token: string, signal?: AbortSignal): Promise<RegenerateRegionResult>; listProjects(token: string, query?: ProjectListQuery): Promise<ProjectSummary[]>; getProject(id: string, token: string): Promise<ProjectRecord>; createProject(req: ProjectCreateRequest, token: string): Promise<ProjectRecord>; updateProject(id: string, req: ProjectUpdateRequest, token: string): Promise<ProjectRecord>; deleteProject(id: string, token: string): Promise<void>; health(): Promise<boolean> }`; errors `QuotaExceededError`, `AiGenerationError`, `AiOutputInvalidError`, `ProjectNotFoundError`; hooks `useProjects`, `useProject`, `useCreateProject`, `useUpdateProject`, `useDeleteProject`, `useGenerateScore`, `useRegenerateRegion` each taking `{ networkClient, baseUrl, token }` + hook-specific args; query keys factory `musicQueryKeys.projects.list(query?)` / `.detail(id)`.
- music_lib store creation: `createAppStore(opts: { context: StoreContext; historyLimit?: number })` where `StoreContext = { client: MusicClient; getToken: () => Promise<string | null> }`; module hook `useAppStore` initialized by app via `initializeAppStore(context)`.
- music_lib keeps exporting (unchanged names) everything music_app imports in Phase 1 — the Phase 1 music_app task lists the import map.

---

## Phase 1 — Extract (app behavior unchanged; exit gate: all repos verify-green, app unit+e2e pass)

### Task 1: Create music_types

**Spec:** "music_types" section. **Repo:** new `~/projects/music_types`.

- [ ] Scaffold from sudojo_types' pattern (read `~/projects/sudojo_types/package.json`, `tsconfig.esm.json`, eslint config, `.github/workflows/ci-cd.yml`): package `@sudobility/music_types` v0.1.0, peerDep `@sudobility/types`, dep `zod` ^4 (schemas are runtime exports — regular dep, matching how music_app ships zod today), Bun, vitest, BUSL-1.1.
- [ ] Move from music_app@95ebaeb into a sectioned `src/index.ts` (sections: re-exports → score types → guards → selection/fragment types → zod schemas → generation contracts → project API types → envelope + error codes): contents per Cross-Task Contracts. Copy the type/schema source bodies verbatim; do NOT redesign. Move the corresponding tests (`types.test.ts`, `schema.test.ts`, generation `schema.test.ts`) into `src/index.test.ts` (or split test files), adjusting imports.
- [ ] Write NEW tests for the new project API types + envelope helpers (`successResponse({x:1})` shape; `errorResponse` with/without code) and Zod schemas for `ProjectCreateRequest`/`ProjectUpdateRequest`/`ProjectListQuery` (export as `projectCreateRequestSchema` etc.).
- [ ] CLAUDE.md + README.md. `bun run verify` green.
- [ ] `git init -b main`, initial commit, `gh repo create johnqh/music_types --private --source=. --push`, set NPM_TOKEN secret (Global Constraints command), push. Poll `npm view @sudobility/music_types version` until published; fix CI if not.

### Task 2: Create music_lib — domain + time/pitch

**Spec:** "music_lib" section (domain part). **Repo:** new `~/projects/music_lib`. Requires music_types on npm.

- [ ] Scaffold like sudojo_lib's packaging (read `~/projects/sudojo_lib/package.json`): `@sudobility/music_lib` v0.1.0 restricted; deps `@sudobility/music_types` ^0.1.0, `immer`; peers `react ≥18`, `zustand ≥5`, `@tanstack/react-query ≥5` (used from Task 9 on; declared now); regular deps `vexflow ^4.2.5`, `tone`, `@tonejs/midi`, `dexie` (dexie is TEMPORARY — removed in Task 9). Vitest + jsdom config copied from music_app's vite/vitest setup incl. `src/test/setup.ts` (getBBox stub).
- [ ] Copy from music_app@95ebaeb WITH their test files, preserving relative structure under `src/`: `domain/**` (commands, pitch, quantization, score, selection, time, validation, voicing), `test/fixtures.ts` + `fixtures.test.ts`. Rewrite imports of score types/schemas/generation types to `@sudobility/music_types` (the moved `score/types.ts`, `score/schema.ts`, `selection/types.ts` type-only parts, `score/fragment.ts` type are DELETED here in favor of re-exports from music_types; runtime functions — `extractFragment`, `replaceFragment`, `emptySelection`, `createId`, factories — stay in lib files).
- [ ] Export surface: `src/index.ts` re-exporting every domain module (subpath-style named exports; consumers import from the package root — build the export list from music_app's actual `@/domain/...` import statements: `grep -rhoE "from '@/domain/[^']+'" ~/projects/music_app/src --include='*.ts*' | sort -u`).
- [ ] `bun run verify` green (this lands the ~500 domain tests). Commit.

### Task 3: music_lib — adapters, services, store, playback; publish

**Spec:** "music_lib" section (rest). Same repo as Task 2.

- [ ] Copy with tests from music_app@95ebaeb: `adapters/**` (vexflow, tone, midi, musicxml), `workers/**` (midi-import, quantize), `services/**` — including TEMPORARILY `services/generation/**` (mock provider et al. — deleted in Task 9) and `services/persistence/**` (Dexie — deleted in Task 9) — `services/playback/**`, `services/import-export/**`, `services/quantization/**`, `services/errors.ts`, `services/perf/benchmark.ts`, `store/**` (all slices, selectors, useAppStore). Fix imports to music_types/relative paths. `fake-indexeddb` devDep for the persistence tests.
- [ ] Store stays behaviorally IDENTICAL this phase (still Dexie + mock registry). Keep `createAppStore({db?})`'s current signature for now — the Task-9 contract signature replaces it later.
- [ ] Extend `src/index.ts` exports to cover every `@/adapters/...`, `@/services/...`, `@/store/...` import music_app makes (same grep technique). Workers: ship `src/workers/*.ts` in the package `files` and export their paths; the non-worker fallbacks in midi-service/quantize-service must keep working when `Worker` is undefined (they already do).
- [ ] CLAUDE.md + README.md. `bun run verify` green (~900 tests total in lib now).
- [ ] `git init -b main`, commit, `gh repo create johnqh/music_lib --private --source=. --push`, NPM_TOKEN secret, push, poll npm until published.

### Task 4: music_app — consume published packages, switch to Bun

**Spec:** Phase 1 step 3. **Repo:** existing `~/projects/music_app` on `main`.

- [ ] Verify `@sudobility/music_types` and `@sudobility/music_lib` resolve on npm. Add both as deps; create `.npmrc` with `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` + `legacy-peer-deps=true` (sudojo_app pattern) — commit `.npmrc` with the env-var form only.
- [ ] Mechanical import rewrite across `src/` and `e2e/`: `@/domain/...` → `@sudobility/music_lib` (or `@sudobility/music_types` for pure types/schemas), `@/adapters/...`, `@/services/...`, `@/store/...` → `@sudobility/music_lib`. Delete the moved source directories AND their test files (they now live+pass in lib): `src/domain`, `src/adapters`, `src/services` (all but nothing app-specific remains), `src/store`, `src/workers`, `src/test/fixtures*`. Keep `src/test/setup.ts`, feature components, pages, app shell.
- [ ] Switch to Bun: `bun install` (bun.lock committed), scripts unchanged in name (`dev/build/preview/lint/typecheck/test/test:watch/test:e2e/format` + add `verify`), CI file added (music_app previously had none): copy sudojo_app's `ci-cd.yml`; set NPM_TOKEN secret on johnqh/music_app (repo already exists). Remove `package-lock.json`.
- [ ] Vite: keep worker handling functional — vitest/jsdom fallbacks already cover tests; confirm `npm→bun run build` bundles workers from the lib package (if `new Worker(new URL(...))` inside node_modules breaks the build, re-export worker URLs from thin app-local worker files that import the lib worker modules — decide by testing the build).
- [ ] `bun run verify` green; component/unit suite passes at pre-split count minus relocated tests; `bun run test:e2e` 10/10 green. Commit, push to main.
- [ ] **Phase 1 exit gate:** all three repos verify-green; app e2e 10/10.

## Phase 2 — Backend swap (exit gate: full flow vs local test-mode API; manual OpenAI smoke)

### Task 5: music_api — scaffold, auth, DB, health

**Spec:** "music_api" section. **Repo:** new `~/projects/music_api`. Requires music_types on npm.

- [ ] Scaffold from sudojo_api's pattern (read `~/projects/sudojo_api/package.json`, `src/index.ts`, `src/middleware/firebaseAuth.ts`, `src/db/*`, Dockerfile): private `music_api`, Bun runtime, Hono ^4, drizzle-orm + postgres, zod ^4 + @hono/zod-validator, firebase-admin ^13, `@sudobility/music_types`. Port default **8022**. Base path `/api/v1`.
- [ ] `src/db/schema.ts`: `projects` + `ai_usage` tables per Cross-Task Contracts; `src/db/index.ts` (connection from `DATABASE_URL`), `src/db/init.ts` (create tables).
- [ ] `src/middleware/auth.ts`: Firebase bearer-token verification setting `userId`/`userEmail` on context (copy sudojo_api's firebaseAuth middleware, trimmed); when `AI_TEST_MODE=1` AND header token equals `TEST_AUTH_BYPASS_TOKEN`, set `userId='test-user'` instead (document: test mode only, never set in prod env).
- [ ] `GET /api/v1/health` public returning `successResponse({status:'ok'})`. App entry wires middleware + routes; envelope helpers from music_types everywhere.
- [ ] Tests: unit tests for auth middleware (mock firebase-admin verifyIdToken; bypass path); integration test gated on `.env.test` presence (sudojo_api pattern — refuses to run without it) covering db init + health.
- [ ] Dockerfile (multi-stage oven/bun:1, copy sudojo_api's). CLAUDE.md + README (document all env vars + `bun run db:init`). `bun run verify` green.
- [ ] `git init -b main`, commit, `gh repo create johnqh/music_api --private --source=. --push`, NPM_TOKEN secret, push.

### Task 6: music_api — project CRUD

**Spec:** "music_api" routes table. Same repo.

- [ ] `src/routes/projects.ts` (default-export Hono router, thin handlers → `src/services/projects.ts`): the five project routes per Cross-Task Contracts, all owner-scoped by `userId`; request bodies validated with `projectCreateRequestSchema`/`projectUpdateRequestSchema` via zod-validator; embedded scores validated with `scoreSchema` — invalid → 400 `errorResponse`; missing/foreign id → 404 `PROJECT_NOT_FOUND`; `PUT` bumps `updated_at`; `GET /projects` supports `search` (ILIKE name) + `sort` (`updatedAt` desc default | `name` asc), returns `ProjectSummary[]` (no score payload).
- [ ] Integration tests (`.env.test` DB): create→list→get→update→delete happy path; ownership isolation (user A cannot read/update/delete user B's project — bypass auth with two test user ids); invalid score rejected; 404s. Unit tests for the service layer with a test db.
- [ ] `bun run verify` green. Commit, push.

### Task 7: music_api — OpenAI generation + quota + test mode

**Spec:** "music_api" OpenAI integration + quota + test mode. Same repo.

- [ ] `src/services/generation/transport.ts`: `interface AiTransport { complete(req: { system: string; user: string; jsonSchema: object; signal: AbortSignal }): Promise<string> }` with `OpenAiTransport` (openai SDK, `OPENAI_API_KEY`/`OPENAI_MODEL`, JSON-schema response_format, `OPENAI_TIMEOUT_MS` AbortController — model the timeout handling on sudojo_api's solver-proxy) and `FixtureTransport` (deterministic: derives output from request via bundled fixture scores — used when `AI_TEST_MODE=1`).
- [ ] `src/services/generation/prompts.ts`: prompt builders `buildGeneratePrompt(req: GenerateScoreRequest)` and `buildRegeneratePrompt(req: RegenerateRegionRequest)` returning `{system, user, jsonSchema}` — system prompt encodes the score JSON rules (480 PPQ, absolute startTick, voice sums = measure duration, velocity 0-127, id fields as opaque strings); JSON schema generated from music_types zod schemas via `z.toJSONSchema` (zod 4 built-in).
- [ ] Relocate (copy from music_lib@Task-3 state, originally music_app `src/services/generation/validate-response.ts`) `sanitizeGeneratedScore` + `validateRegenerateRegionResult` into `src/services/generation/validate.ts` with their tests — imports from music_types + a minimal local copy of the tick helpers they need (`measureDurationTicks` — copy the function, cite origin in a comment; music_api must not depend on music_lib).
- [ ] `src/services/quota.ts`: `checkAndIncrement(db, userId, kind: 'generate'|'regenerate')` upserting `ai_usage` for today (UTC date string), throwing typed quota error when count ≥ `AI_DAILY_LIMIT` (default 50). Route maps it to 429 `errorResponse(..., 'QUOTA_EXCEEDED')`.
- [ ] `src/routes/ai.ts`: `POST /ai/generate` and `POST /ai/regenerate` per contracts — validate body with music_types schemas → quota → transport → parse/sanitize/validate output (reject → 502 `AI_OUTPUT_INVALID` with details in error string) → envelope. Regenerate validates EVERY candidate; drops invalid ones with warnings, errors only if none survive.
- [ ] Tests: prompt builders (snapshot the JSON schema shape + assert key constraint text present); validate.ts relocated tests pass; quota unit tests (limit boundary, per-day reset, both kinds); route tests with FixtureTransport (generate returns schema-valid score; regenerate returns N validated candidates; quota 429 after limit; malformed transport output → 502). Integration test with `.env.test` DB + FixtureTransport end-to-end.
- [ ] `bun run verify` green. Commit, push. Manual smoke (documented in README, not CI): with a real `OPENAI_API_KEY`, `curl` one generate call and eyeball the validated result.

### Task 8: Create music_client

**Spec:** "music_client" section. **Repo:** new `~/projects/music_client`. Requires music_types on npm.

- [ ] Scaffold from sudojo_client's pattern (read `~/projects/sudojo_client/package.json`, `src/network/sudojo-client.ts`, one hooks file, `query-keys.ts`): `@sudobility/music_client` v0.1.0 restricted; dep `@sudobility/music_types`; peers `@sudobility/di`, `@sudobility/types`, `@tanstack/react-query ≥5`, `react ≥18`.
- [ ] `src/network/music-client.ts`: `MusicClient` exactly per Cross-Task Contracts — single private `request<T>()` delegating to `networkClient.request`, bearer token per call, envelope unwrapping, error mapping (429→`QuotaExceededError`, 404 on projects→`ProjectNotFoundError`, 502 AI codes→`AiOutputInvalidError`/`AiGenerationError`).
- [ ] `src/errors.ts` (the four error classes), `src/hooks/query-keys.ts` (`musicQueryKeys` factory), `src/hooks/use-projects.ts` (5 project hooks with invalidation on mutations: list ~2min staleTime, detail 0), `src/hooks/use-generation.ts` (`useGenerateScore`, `useRegenerateRegion` as mutations passing AbortSignal through).
- [ ] Tests: MusicClient against a fake `NetworkClient` (assert URL/method/headers/body per endpoint; envelope unwrap; each error mapping); hooks smoke tests with QueryClientProvider + fake client (mutation invalidates list key).
- [ ] CLAUDE.md + README. `bun run verify` green. `git init -b main`, commit, `gh repo create johnqh/music_client --private --source=. --push`, NPM_TOKEN secret, push, poll npm.

### Task 9: music_lib — rewire to client; delete mock + Dexie

**Spec:** "music_lib" store rewires + deletions + templates. Repo `~/projects/music_lib`. Requires music_client on npm.

- [ ] Add dep `@sudobility/music_client` ^0.1.0. New `src/store/context.ts`: `StoreContext = { client: MusicClient; getToken: () => Promise<string | null> }`; `createAppStore(opts: { context: StoreContext; historyLimit?: number })`; `initializeAppStore(context)` + `useAppStore` module wiring (store created lazily on first init; tests keep constructing isolated stores via `createAppStore`).
- [ ] project-slice rewrite: `newProject`/`openProject`/`saveNow`/autosave against `context.client` (`createProject`/`getProject`/`updateProject`) with token from `context.getToken()`; keep debounce (2000ms), flush-on-switch, pagehide-flush semantics and dirty/saveState transitions; delete Dexie usage. `listProjects`/`deleteProject`/`duplicateProject` move to thin wrappers used by the app via client hooks — duplicate = `getProject` + `createProject` with `(copy)` name suffix.
- [ ] generation-slice rewrite: `generate(params)`/`regenerate(instruction, options)` call `context.client.generateScore/regenerateRegion` (token + existing AbortController/token-guard discipline unchanged); client-boundary re-parse with music_types schemas stays; `acceptCandidate` selection-remap logic unchanged; delete registry/`DEFAULT_MOCK_SEED` (fixed seed concept gone).
- [ ] DELETE: `services/generation/` mock stack (mock-provider, mock-transforms, prng, music-theory, patterns/, prompt-parse, registry) + their tests; `services/persistence/` (db, projects, samples, migrations) + tests; `dexie`/`fake-indexeddb` deps. KEEP `services/generation/validate-response.ts` client-boundary parse helpers only if the slice still imports them; sanitize logic now lives in music_api (delete the server-relocated parts here).
- [ ] Device prefs: new `src/services/prefs.ts` persisting theme/view/zoom/snapGrid/devSettings via `@sudobility/di` storage service (peer dep added); ui-slice reads/writes through it; autosave of prefs is synchronous local.
- [ ] Templates: `src/templates/index.ts` exporting three deterministic `Score` fixtures (reuse `twinkleScore`-style builders; name them "Gentle Piano Melody", "Pop Arrangement", "Orchestral Passage" matching the old samples) + `templateSummaries`.
- [ ] Regeneration controller (`prepareRegenerationRequest`/`applyCandidate`) unchanged. Playback controller unchanged except store-context plumbing if it referenced deleted modules.
- [ ] Tests: rewritten slice tests use a stub `MusicClient` (typed fake, not network); port the meaningful persistence-behavior tests (autosave debounce/flush semantics) onto the new client-backed path; delete tests of deleted modules. `bun run verify` green. Bump minor version, commit, push, poll npm.

### Task 10: music_app — auth + store wiring + e2e vs test-mode API

**Spec:** Phase 2 step 7. Repo `~/projects/music_app`. Requires updated music_lib on npm.

- [ ] Bump `@sudobility/music_lib` + add `@sudobility/music_client`, `firebase` (^12), `@sudobility/di`/`di_web` per sudojo_app's DI bootstrap (`src/config/initialize.ts` pattern: `initializeNetworkService`, `initializeStorageService`, `initializeFirebaseService`).
- [ ] `src/config/initialize.ts`: build `NetworkClient` from di, `MusicClient(networkClient, VITE_API_URL)`, Firebase auth init; `initializeAppStore({ client, getToken })` where `getToken` returns the current Firebase user's ID token (null when signed out).
- [ ] Interim auth gate (MUI, replaced in Phase 3): app requires sign-in — minimal email/password + Google sign-in screen using the firebase SDK directly; signed-out users see only the sign-in screen. Dashboard switches to `useProjects`/`useDeleteProject`/create-from-template (music_lib `templates`); remove Dexie-era code paths (sample installer calls, export/import Project JSON now uses client get/create).
- [ ] Generation/regeneration panels: wire quota/AI errors to toasts (`QuotaExceededError` → "Daily AI limit reached", others → retryable error toast). Delete dev-settings seed control (mock gone); keep other dev settings.
- [ ] Unit/component tests: stub MusicClient + fake auth (token getter returns 'test'); suites green.
- [ ] e2e rework: Playwright `webServer` array starts BOTH vite dev AND `music_api` in test mode (`AI_TEST_MODE=1`, `TEST_AUTH_BYPASS_TOKEN=e2e-token`, `.env.test` DB; document `docker compose up db` or local postgres prerequisite in README); app in e2e mode (`VITE_E2E=1`) signs in automatically with the bypass token path (test-only auth shim in initialize.ts, DEV-gated). Rewrite the 10 specs: seed-param determinism replaced by FixtureTransport determinism; persistence spec now proves server round-trip (reload → project still there); regeneration spec asserts candidate flow via fixtures.
- [ ] `bun run verify` + `bun run test:e2e` green. Commit, push.
- [ ] **Phase 2 exit gate:** end-to-end flow (sign in → create from template → edit → generate → regenerate/accept → save → reload → reopen) green locally against test-mode API; one manual real-OpenAI smoke documented in the task report.

## Phase 3 — UI rebuild (exit gate: parity checklist, e2e green, all repos verify-green)

### Task 11: music_app — @sudobility shell, routing, i18n

**Spec:** "music_app" section; APP.md (read `~/projects/sudobility/docs/APP.md` FULLY). Repo `~/projects/music_app`.

- [ ] Add deps (mirror sudojo_app's versions): `@sudobility/building_blocks`, `components`, `design`, `auth-components`, `auth_lib`, `seo_lib`, `di_web`, `tailwindcss` ^3.4 + config scanning `@sudobility/design` tokens, `react-router-dom` ^7, `i18next` + `react-i18next` + `i18next-http-backend`. Keep MUI installed until Task 13 removes it (both coexist during rebuild).
- [ ] `src/App.tsx`: `SudobilityAppWithFirebaseAuth` wrapper → routes under `/:lang` (en only, `supportedLanguages=['en']`) → `ScreenContainerLayout` layout route (ScreenContainer + Suspense + Outlet, per APP.md verbatim) → lazy pages: Home, Dashboard, `project/:id` Editor, Settings. Replace the interim Task-10 auth gate with `@sudobility/auth-components` sign-in flow; route guard redirects signed-out users to sign-in.
- [ ] i18n: single `landing`-style namespace `app`; `public/locales/en/app.json`; externalize strings for the NEW shell pages as you build them (editor internals externalized in Task 13).
- [ ] Home page: Section-based hero + features (content describing Moosiac), full footer. Dashboard page rebuilt on @sudobility components (project grid/list, search/sort via `useProjects`, create/from-template/delete with confirm) using `Section`; Settings page via `useSetPageConfig` master-detail pattern (theme via `@sudobility/components` ThemeProvider — replaces the MUI theme mode; keep dev settings section).
- [ ] SEO: `src/config/seo.ts` + per-route SEO via `@sudobility/seo_lib` (sudojo_app pattern), en only.
- [ ] Tests: shell/routing tests (signed-out redirect; lang route renders; dashboard lists via stub client). `bun run verify` green. Commit, push.

### Task 12: music_app — editor workspace re-skin

**Spec:** "music_app" editor re-skin. Repo `~/projects/music_app`.

- [ ] Editor page (`/en/project/:id`): `useSetPageConfig({ scrollable:false, contentPadding:'sm', maxWidth:'full' })`; three-pane workspace rebuilt with Tailwind + `@sudobility/components` primitives (panels, buttons, selects, sliders, toggles, tooltips, dialog primitives — inventory what `@sudobility/components` exports and map each MUI usage; where no equivalent exists, build small local Tailwind components in `src/components/ui/`).
- [ ] Re-skin in place, preserving behavior + accessible names (aria-labels stay IDENTICAL so component tests and e2e selectors survive): EditorToolbar, PianoRollToolbar, TransportBar, TrackPanel, InspectorPanel, status bar/issues popover, ScoreEditorView/PianoRollView containers (visual chrome only — hit-testing/render logic is in lib and untouched).
- [ ] GenerationPanel/RegenerationPanel/CandidateList re-skinned; dialogs (MidiImportWizard, MusicXmlImportDialog, ShortcutHelp, DeveloperSettings, Confirm) rebuilt on @sudobility/local dialog primitives with focus trap + restore preserved; Toasts on the design-system toast/snackbar equivalent.
- [ ] Component tests re-targeted only where markup semantics changed (role/label assertions should mostly survive); i18n-externalize editor strings. `bun run verify` green. Commit, push.

### Task 13: music_app — remove MUI, a11y/parity pass, e2e, docs

**Spec:** Phase 3 exit gate; "Testing". Repo `~/projects/music_app` (+ touched repos' docs).

- [ ] Delete `@mui/*`, `@emotion/*` deps and any remaining imports; delete dead MUI-era components. `bun run build` — bundle must not contain MUI.
- [ ] A11y re-verification: keyboard shortcuts, focus outlines, reduced-motion, aria labels across rebuilt chrome (re-run the a11y smoke tests; fix regressions).
- [ ] Full e2e suite re-run + parity checklist vs pre-split app, checked item by item in the task report: notation editing, piano roll incl. velocity lane + drag ops, playback/transport incl. loop/metronome, undo/redo, validation issues popover, MIDI import wizard + export, MusicXML import/export, generation + regeneration preview/accept, project CRUD + autosave + reload, templates, settings/theme, shortcut help.
- [ ] Docs: rewrite music_app `docs/architecture.md` for the five-repo architecture (layer diagram, request flows, links to sibling repos; move outdated single-repo content); update README (dev setup: postgres + music_api + env vars); update CLAUDE.md files in all five repos (related-projects cross-links per doc standards); update the workspace memory's project map is OUT of repo scope (controller handles it).
- [ ] `bun run verify` green in all five repos (run each). Commit, push all.
- [ ] **Phase 3 / final exit gate:** parity checklist complete; e2e green; five repos verify-green on `main` with CI passing (`gh run list` per repo shows green latest run).

---

## Self-Review Notes

- Spec coverage: Decisions table → constraints/tasks (OpenAI T7; mock deletion T9; UI T11-13; auth T5/T10/T11; persistence T6/T9/T10; domain split T1-3; packaging/global constraints; contracts in music_types T1 + preserved shapes T7/T8; quota T7; parity T13; i18n T11; repos handling T1/T4; CI/secrets global).
- Type consistency: MusicClient signatures identical in T8 (definition) and T9/T10 (consumption); StoreContext defined T9, consumed T10; project types defined T1, consumed T6/T8/T9.
- Known deferred decisions from spec resolved here: stale times (T8: list 2min/detail 0), worker packaging (T4 decides by build test with fallback strategy), test auth (bypass token, T5/T10).

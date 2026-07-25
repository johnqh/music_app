# Music Family Re-Architecture — Design

**Date:** 2026-07-25
**Status:** Approved by John (johnqh) after section-by-section review
**Supersedes:** the single-repo architecture in `docs/architecture.md` (which remains accurate for the pre-split app)

## Goal

Replace ScoreSmith's in-browser mock AI generation with real AI (OpenAI) proxied through a backend, by splitting the single `music_app` repo into the five-package Sudobility template family (copying the architecture of `sudojo_types` / `sudojo_api` / `sudojo_client` / `sudojo_lib` / `sudojo_app`), and rebuilding the UI on the `@sudobility` design system per `sudobility/docs/APP.md`.

## Decisions (locked)

| Topic | Decision |
|---|---|
| AI provider | OpenAI, server-side only. Model via `OPENAI_MODEL` env — never hardcoded. |
| Mock provider | **Deleted completely** (prng, music-theory, patterns, mock-provider, mock-transforms, prompt-parse, registry). Tests stub the network layer instead. |
| UI | **Full replacement**: MUI/Emotion removed; Tailwind + `@sudobility/building_blocks` / `components` / `design` per APP.md. |
| Auth | **Required everywhere** (full SaaS). Firebase auth via `SudobilityAppWithFirebaseAuth`; every `music_api` route (except `/health`) behind `firebaseAuthMiddleware`. |
| Persistence | **Server-side only.** PostgreSQL/Drizzle project storage in `music_api`. Dexie/IndexedDB, samples installer, and migrations deleted. Local storage shrinks to device prefs. |
| Domain code | Score types + API contracts → `music_types`. All non-UI code (domain, VexFlow/Tone/MIDI/MusicXML adapters, store slices, playback controller) → `music_lib`. `music_app` = UI/UX/routing only. |
| Packaging | Sudojo conventions exactly: `@sudobility/music_types` npm-public, `@sudobility/music_client` and `@sudobility/music_lib` npm-restricted (matching sudojo_types/client/lib), BUSL-1.1; `music_api`/`music_app` private unscoped; **Bun everywhere**; publish-first dependency flow (registry semver, no file:/workspace links). |
| AI contracts | **Preserved verbatim**: `GenerateScoreRequest` → one Score; `RegenerateRegionRequest` → N candidate fragments; preview/accept workflow unchanged. Server validates/sanitizes all model output before returning. |
| Entitlements | Auth-only this phase + per-user daily generation quota in `music_api` (env-configurable, `ai_usage` table, HTTP 429 typed error). RevenueCat later. |
| Feature scope | **Full parity** with current app minus mock + IndexedDB: notation editor, piano roll, playback/transport, MIDI + MusicXML import/export, undo/redo, validation, a11y, e2e coverage. |
| i18n | English-only this phase, with i18next scaffolding in place (keys externalized, single `en` locale). |
| Repos | `music_app` gutted in place (history preserved). `music_types`/`music_api`/`music_client`/`music_lib` created fresh. |
| Git/CI | All repos: `github.com/johnqh/<name>`, work directly on `main`, push on completion. `ci-cd.yml` calls `johnqh/workflows/.github/workflows/unified-cicd.yml@main` (with `npm-access: "public"` for published packages). `NPM_TOKEN` repo secret set from `~/.npmrc`. |
| Migration strategy | **Approach B — three-phase strangler**; app green at every phase boundary. |

## Package architecture

```
music_types  @sudobility/music_types   npm (public)      deps: none (peer: @sudobility/types)
music_api    music_api (private)       Bun runtime       deps: music_types, hono, drizzle-orm, postgres, zod, @hono/zod-validator, firebase-admin, openai
music_client @sudobility/music_client  npm (restricted)  deps: music_types (peers: @sudobility/di, @sudobility/types, @tanstack/react-query ≥5, react ≥18)
music_lib    @sudobility/music_lib     npm (restricted)  deps: music_types, music_client (peers: react-query, react, zustand ≥5, + vexflow/tone/@tonejs/midi as regular deps)
music_app    music_app (private)       Vite web app  deps: music_types, music_client, music_lib, @sudobility UI packages, firebase, react-router-dom v7, i18next
```

Build/publish order: types → api → client → lib → app.

### music_types

Sudojo_types-style single sectioned `src/index.ts`; plain interfaces plus Zod schemas; tests co-located.

Contents:
- Full Score tree moved from ScoreSmith: `UUID`, `Fraction`, `Pitch`, `TimeSignature`, `KeySignature`, `TempoEvent`, `NoteEvent`, `RestEvent`, `MusicalEvent`, `Voice`, `Measure`, `Track`, `ScoreMetadata`, `Score`, `Clef`, `Articulation`, guards, `ScoreFragment`, `ScoreRange`, `ScoreSelection`.
- Zod schemas: `scoreSchema` tree, `parseScore`, plus schemas for every request/response below (the API validates with them; clients parse with them).
- Generation contracts (verbatim from today): `GenerateScoreRequest`, `RegenerateRegionRequest`, `GenerateScoreResult { score, warnings }`, `RegenerateRegionResult { candidates: [{id,label,fragment}], warnings }`, `RegenerationConstraints`.
- Project API types: `ProjectRecord { id, name, createdAt, updatedAt, schemaVersion, score, uiPrefs? }`, `ProjectSummary` (list item without score), `ProjectCreateRequest`, `ProjectUpdateRequest`, `ProjectListQuery` (search/sort).
- Response envelope: `ApiResponse<T> = { success, data?, error? }` with `successResponse()` / `errorResponse()` helpers (sudojo pattern).
- Typed error codes: `QUOTA_EXCEEDED`, `AI_GENERATION_FAILED`, `AI_OUTPUT_INVALID`, `PROJECT_NOT_FOUND`, `UNAUTHORIZED`.
- No domain logic (no tick math, no factories) — that stays in `music_lib`.

### music_api

Structural clone of sudojo_api: Hono, base path `/api/v1`, thin routes + `services/`, Zod validation via `@hono/zod-validator`, Drizzle/PostgreSQL, `firebaseAuthMiddleware` (verifies bearer token, sets `userId`/`userEmail`), Docker multi-stage on `oven/bun:1`. Port **8022** (workspace convention).

Routes (all authed unless noted):
| Route | Behavior |
|---|---|
| `GET /health` | public liveness |
| `POST /ai/generate` | body: `GenerateScoreRequest` → prompt construction → OpenAI structured output → sanitize/repair (relocated `sanitizeGeneratedScore`) → `GenerateScoreResult`. Counts against quota. |
| `POST /ai/regenerate` | body: `RegenerateRegionRequest` → OpenAI → per-candidate validation (relocated `validateRegenerateRegionResult`: schema parse, ppq match, voice-sum checks) → `RegenerateRegionResult`. Counts against quota. |
| `GET /projects` | list caller's projects (`ProjectSummary[]`, search/sort) |
| `POST /projects` | create (validates embedded score with `scoreSchema`) |
| `GET /projects/:id` | full `ProjectRecord` (owner-scoped) |
| `PUT /projects/:id` | update score/name/uiPrefs (validated; bumps `updatedAt`) |
| `DELETE /projects/:id` | delete (owner-scoped) |

DB schema (Drizzle):
- `projects`: `id` (uuid pk), `userId` (Firebase uid, indexed), `name`, `score` (jsonb), `uiPrefs` (jsonb, nullable), `schemaVersion` (int), `createdAt`, `updatedAt`.
- `ai_usage`: `userId`, `date`, `generateCount`, `regenerateCount` — quota check per request; limit via `AI_DAILY_LIMIT` env; exceeding returns 429 `QUOTA_EXCEEDED`.

OpenAI integration (`services/generation/`):
- `openai` SDK, key from `OPENAI_API_KEY` (server only), model from `OPENAI_MODEL`, timeout `OPENAI_TIMEOUT_MS` with AbortController (sudojo solver-proxy pattern).
- Structured output: JSON-schema response format derived from the music_types Zod schemas.
- Prompt construction service: musical brief (key/tempo/meter/style/mood/instrumentation, or region context + instruction + preservation constraints for regenerate). The deleted client-side `prompt-parse` semantics inform the prompt template, not a parser.
- All model output is untrusted: sanitize/repair or reject with `AI_OUTPUT_INVALID`; never store or return unvalidated scores.
- **Test mode**: `AI_TEST_MODE=1` swaps the OpenAI transport for a deterministic in-process stub (fixture-backed) so integration tests and app e2e never call OpenAI. Auth in test mode accepts a `TEST_AUTH_BYPASS_TOKEN` (exact mechanism decided in the plan: Firebase emulator preferred, env-token bypass acceptable).

Env: `DATABASE_URL`, `PORT` (8022), `FIREBASE_*` (admin credentials), `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_MS`, `AI_DAILY_LIMIT`, `AI_TEST_MODE`.

### music_client

`SudojoClient` pattern:
- `class MusicClient { constructor(networkClient: NetworkClient, baseUrl: string) }` — all HTTP via the injected `@sudobility/types` `NetworkClient`; zero direct fetch. One private `request<T>()` funnel; token passed per call (`Authorization: Bearer`), never stored.
- Typed methods: `generateScore`, `regenerateRegion`, `listProjects`, `getProject`, `createProject`, `updateProject`, `deleteProject`, `health`.
- React Query hooks per resource: `useProjects`, `useProject`, `useCreateProject`, `useUpdateProject`, `useDeleteProject`, `useGenerateScore`, `useRegenerateRegion` — hooks take `networkClient`, `baseUrl`, `token` explicitly (sudojo signature).
- Hierarchical query-key factory + invalidation helpers; stale-time tiers (projects list ≈2min; project detail 0 while editing — final values set in the plan).
- Typed errors: `QuotaExceededError` (429), `AiGenerationError`, `AiOutputInvalidError`; envelope unwrapping in one place.

### music_lib

Everything non-UI, moved with its tests:
- `domain/` — unchanged: score model/factories/queries/ties/fragment/schema-reexports, commands + HistoryManager + reflow, validation, quantization, voicing, selection, time/pitch. (Types/schemas now imported from `@sudobility/music_types`.)
- `adapters/` — VexFlow (renderer/convert/layout/id-map), Tone (engine/instruments/schedule), MIDI (analyze/import/export/measures/key-detection), MusicXML (import/export/duration-map). Workers move too; worker wiring stays functional under Vite consumers (worker files shipped in the package; the quantize/midi services keep their non-worker fallbacks, and the app re-exports worker entry points if bundler constraints require it — resolved in the plan).
- `store/` — Zustand slices with two rewires:
  - **project-slice**: Dexie calls → `MusicClient` project endpoints (autosave debounce retained; `save()` now PUTs; flush-on-switch and pagehide-flush behaviors retained).
  - **generation-slice**: provider registry → `MusicClient.generateScore/regenerateRegion` (token/abort discipline unchanged; candidate validation now trusted from the server but still schema-parsed at the boundary by the client).
  - Store creation takes injected context: `createAppStore({ networkClient, baseUrl, getToken })`.
- `playback/` — controller singleton unchanged.
- **Local storage charter**: device prefs only (theme, view, zoom, snapGrid, developer settings) via `@sudobility/di` storage service. No Dexie anywhere.
- Sample projects become **templates baked into music_lib** (`templates/` with three deterministic fixture scores) surfaced as "New from template" — no server seeding needed.
- Deleted from the codebase entirely: `services/generation/*` (mock, prng, music-theory, patterns, prompt-parse, mock-transforms, registry), `services/persistence/*` (db, projects, samples, migrations, autosave† — †autosave logic itself survives inside project-slice against the API), benchmark keeps working against lib code.

### music_app

UI/UX/routing only, per APP.md:
- Shell: `SudobilityAppWithFirebaseAuth` → `ScreenContainerLayout` (route-level, provides PageConfigProvider) → lazy pages. react-router-dom v7 with `/:lang` prefix (en only).
- Pages: Home (Section-based, full footer), Dashboard (project grid via `useProjects`, New/New-from-template/import), Editor `/project/:id` (`useSetPageConfig({ scrollable:false, contentPadding:'sm', maxWidth:'full' })`; notation/piano-roll workspace, transport, inspector, generation panels), Settings (GlobalSettingsPage pattern), auth pages from `@sudobility/auth-components`.
- Editor components re-skinned: MUI → Tailwind + `@sudobility/components` primitives; behavior and component tests preserved (assertions re-targeted to accessible roles/labels, which mostly survive the re-skin).
- Auth: sign-in required; token from Firebase auth feeds store creation and client hooks.
- Env: `VITE_API_URL`, `VITE_FIREBASE_*`. `.npmrc` with `NPM_TOKEN` for restricted `@sudobility` packages (sudojo_app pattern).
- Explicitly absent: fetch calls, domain logic, storage logic, shared types.

## Migration phases (Approach B — app green at each boundary)

**Phase 1 — Extract.**
1. `music_types`: move types/schemas/contracts; publish.
2. `music_lib`: move domain, adapters, store, playback, fixtures — including (temporarily) the Dexie persistence and mock provider so behavior is unchanged; publish.
3. `music_app`: swap internal imports for the published packages; switch to Bun; delete moved sources.
Exit gate: all repos `verify` green; app test+e2e counts match pre-split (minus relocated tests, which pass in lib).

**Phase 2 — Backend swap.**
4. `music_api`: scaffold, auth middleware, Drizzle schema, project CRUD, OpenAI generate/regenerate + sanitize + quota, test mode, Docker, integration tests (`.env.test`-gated).
5. `music_client`: MusicClient + hooks + errors; tests with fake NetworkClient.
6. `music_lib`: rewire project/generation slices to the client; delete mock + Dexie stacks; prefs → DI storage; republish.
7. `music_app`: Firebase auth wiring, store context injection, delete Dexie/mock remnants; e2e reworked against local `music_api` in test mode.
Exit gate: end-to-end flow (sign in → create → edit → AI generate/regenerate → save → reopen) works against local API; one manual smoke against real OpenAI.

**Phase 3 — UI rebuild.**
8. `music_app`: @sudobility shell + pages per APP.md; re-skin editor components; remove MUI/Emotion; i18n (en); SEO via `@sudobility/seo_lib`.
Exit gate: feature-parity checklist vs pre-split app; full e2e green; `bun run verify` green in all five repos.

Every phase ends with commits pushed to `main` in publish order (types → api → client → lib → app), waiting for CI publish before bumping consumers (push_all.sh discipline).

## Testing

- Unit/component tests travel with their code. Lib inherits the domain/adapter/store suites (~900 tests); client gets fake-NetworkClient tests; api gets vitest unit + `.env.test`-gated integration tests with the OpenAI transport injected/stubbed; app keeps component tests (re-targeted in Phase 3) and the Playwright suite.
- e2e determinism: the `?seed=` mechanism dies with the mock. Playwright runs against local `music_api` with `AI_TEST_MODE=1` (deterministic fixtures) and test auth.
- Real-OpenAI verification is manual smoke only — never in CI.

## Known risks

- **Publish-first friction**: consumers can't build until dependencies publish; CI wait steps between repo pushes (mitigation: bun link for local iteration, as sudojo_app supports).
- **Re-skin regression surface**: Phase 3 touches every component; mitigated by keeping behavior tests and the e2e suite as the parity gate.
- **Worker packaging**: web workers shipped from a library package need bundler care under Vite; both workers already have non-worker fallbacks as a safety net.
- **AI output quality**: real-model scores will fail validation more often than the mock; the sanitize/repair + reject pipeline and per-candidate validation are the safety boundary; UX shows typed errors with retry.
- **Auth-everywhere** removes anonymous use; acceptable per decision (full SaaS).

## Out of scope (this phase)

RevenueCat/subscriptions; additional locales; server-side MIDI/MusicXML processing; collaborative editing; RN app; streaming generation; conversational refinement.

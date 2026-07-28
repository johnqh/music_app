# music_app (ScoreSmith)

The ScoreSmith web app: routing, pages, and UI only. One of five repos in the ScoreSmith family — see [Related Projects](#related-projects). All business logic (score model, commands, rendering/audio adapters, Zustand store) lives in `@sudobility/music_lib`; all networking goes through `@sudobility/music_client`; the backend (OpenAI proxy + project persistence) is the sibling `music_api` repo. See [docs/architecture.md](docs/architecture.md) for the full five-repo picture and request flows.

## Tech Stack

- React 19, TypeScript (strict), Vite, React Router
- **Tailwind CSS** (`@sudobility/design`'s preset, `darkMode: 'class'`) — **no MUI/Emotion** (removed in T13; see Gotchas)
- `@sudobility/components` / `@sudobility/building_blocks` / `@sudobility/auth-components` for shared UI primitives (buttons, dialogs, spinners, sign-in forms)
- Zustand app store, VexFlow rendering (windowed **canvas** via `CanvasScoreRenderer`, one canvas, no per-glyph DOM), Tone.js playback — all via `@sudobility/music_lib`, never imported directly here
- `@tanstack/react-query` for server-state (dashboard project list) via `@sudobility/music_client`'s hooks
- Firebase Auth (real backend) / an in-process e2e shim (`VITE_E2E=1`)
- Bun for scripts; Vitest + Testing Library + jsdom for unit/component tests; Playwright for e2e

## Commands

- `bun install` — install dependencies
- `bun run dev` — Vite dev server, port 5173
- `bun run verify` — typecheck + lint + test + build (run before any push)
- `bun run test` / `bun run test:watch` — Vitest
- `bun run test:e2e` — Playwright (`e2e/*.spec.ts`); boots `music_api` from `../music_api` (`AI_TEST_MODE=1`, no real OpenAI) and the dev server (`VITE_E2E=1`) itself — needs a local Postgres `music_test` DB and `../music_api`'s deps already installed. Kill anything on 5173/8023 first (`reuseExistingServer` will otherwise silently attach to whatever's already there).
- `bun run build` — `tsc -b && vite build`

## Structure

- `src/app/` — `App.tsx` (composition root: auth gate, React Query provider, router, error boundary, theme application), `theme.ts` (`resolveColorScheme`/`applyDocumentTheme`/`prefersReducedMotion` — no MUI theme object anymore), `router.tsx`, `AuthContext.tsx`, `SignInScreen.tsx`
- `src/config/initialize.ts` — the composition root's actual construction: `FetchNetworkClient` (the one `fetch()` call site in the app), `MusicClient`, Firebase/e2e `AuthBackend`, `PrefsStorage`, and `music_lib`'s `StoreContext` — see [docs/architecture.md](docs/architecture.md#the-store-context-injection-pattern)
- `src/components/` — `layout/` (AppLayout, TrackPanel, Toasts), `transport/` (TransportBar), `inspector/`, `dialogs/` (MidiImportWizard, MusicXmlImportDialog, ShortcutHelpDialog, DeveloperSettingsDialog), `shell/`
- `src/features/` — `score-editor/` (ScoreEditorView, EditorToolbar, useEditorShortcuts, hit-test, render-theme), `piano-keyboard/` (PianoKeyboardView, keyboard-geometry, playing-pitches), `generation/` (GenerationPanel, RegenerationPanel, CandidateList, preview), `projects/` (DashboardPage)
- `src/stubs/` — stand-ins for `@sudobility/building_blocks`' optional peer deps this app doesn't install (`subscription-components`, `devops-components`, `subscription_lib`), aliased in `vite.config.ts`. This is the sudobility "stubs system" pattern — see that package's own CLAUDE.md; every stub module is a no-op/empty-state implementation, never partially wired.
- `src/test/` — `app-services.ts` (`installTestAppServices`/`resetTestAppServices`: wires `music_lib`'s `testStoreContext()` fakes into `getAppServices()` so components under test never hit real Firebase/network), `setup.ts`
- `e2e/` — Playwright specs + `helpers.ts` + `global-setup.ts` (truncates the `music_test` DB)
- `docs/` — `architecture.md` (five-repo architecture, request flows, store-context pattern), `parity-checklist.md` (feature → test mapping), `spec.md` (product spec)

## Gotchas

- **No MUI/Emotion anywhere** (T13) — dark mode is a Tailwind `dark` class on `<html>`, toggled by `applyDocumentTheme()` from an effect in `App.tsx` that also listens for OS `prefers-color-scheme` changes when `themeMode === 'system'`. `ScoreEditorView`'s VexFlow render-theme colors are still literal hex strings (`LIGHT_RENDER_THEME`/`DARK_RENDER_THEME`) — VexFlow draws straight to the canvas context, not CSS, so this is deliberate, not a leftover.
- `VITE_E2E=1` swaps Firebase Auth for a fixed-identity in-process shim (`e2eBackend()` in `config/initialize.ts`) — never enable it outside Playwright/dev.
- No business logic belongs in this repo. If you're about to write score math, a new command, an adapter, or a store slice, it almost certainly belongs in `music_lib` instead.
- **Canvas notation view**: `ScoreEditorView` draws through music_lib's `CanvasScoreRenderer` into a single viewport-pinned canvas over a full-height interaction/spacer div; drawing only the visible systems per scroll/resize frame IS the virtualization (O(visible), unbounded score sizes). All interactions are geometric (`hit-test.ts` over the drawn window's bbox maps) — there are no `vf-*` DOM elements. jsdom tests stub `HTMLCanvasElement.getContext` with music_lib's `createMock2DContext` (`src/test/setup.ts`); e2e resolves note/measure ids to click coordinates via the dev/e2e-only `window.__scoresmith` handle (`e2e/helpers.ts`).
- **Note state is color, not rectangles**: there is no highlight overlay (it and `paintHighlights` were deleted). `buildNoteColors` builds an `eventId -> NoteColorRole` map (`normal`/`selected`/`regenerated`/`playing`) that the renderer applies with VexFlow `setStyle` per note; stave lines use `staveActive`/`staveInactive` by active track. Colors live in `LIGHT_RENDER_THEME`/`DARK_RENDER_THEME` in `ScoreEditorView.tsx` — literal hex, since VexFlow draws to canvas and never resolves CSS vars — and `PianoRollView` imports the same pair so a note means the same thing in both. A selection change therefore redraws notation, which is cheap: `computeLayout` is cached and not invalidated by color.
- **Caret-anchored interaction**: the red caret IS `playback-slice.positionTick` (no separate state), which is why "play from the caret" needs no plumbing. Click = caret + active track + clear selection; note click also selects it; shift-click toggles additively; cmd-click selects caret→click on the active track, cmd-shift-click across all. Measure selection lives only in the measure-number gutter above each system (`measureIndexAtGutterPoint`). `PlaybackController.togglePlay` clears the selection on the →playing transition only.
- **Active track**: `ui-slice.activeTrackId`, read through `selectActiveTrackId`, which falls back to the first track when unset or stale — so "one track is always active" and "the active track was deleted" need no reconciliation effect. Deliberately not persisted (a track id means nothing across projects). It drives stave coloring, which track the piano roll shows, and the piano-roll keyboard highlight.
- **Notation and a piano keyboard are shown together**, not switched between (there is no `view` mode). The keyboard is a full-width collapsible panel above the transport in `AppLayout`: 88 keys in true physical layout (`keyboard-geometry.ts` — whites tile, blacks straddle the boundary between them, whites emitted first so blacks draw on top), lighting the active track's sounding pitches via `playingPitchesForTrack`. It is read-only; the notation is the editor. The DAW-style piano-roll timeline it replaced is gone, and with it mouse note-dragging and voice reassignment — see `docs/superpowers/specs/2026-07-27-piano-keyboard-view-design.md`.
- **Playback must not touch the main thread more than it has to.** A notation redraw rebuilds and re-formats every VexFlow object in the window (~5ms), and Tone.js schedules on that same thread, so colour repaints are coalesced to one animation frame and skipped when nothing *visible* changed. `positionTick` (30Hz) is read only inside `PlaybackCaret`, never at `ScoreEditorView`'s top level. Both have regression tests; don't undo either without re-measuring.
- **The caret interpolates; it is not driven straight off `positionTick`.** The engine samples position through Tone's lookahead scheduling loop, so its 30Hz reports arrive in clumps — driving the caret off them left it stalled on 65% of frames and jumping ~7.7px when it did move (measured). `PlaybackCaret` dead-reckons forward from the last report using elapsed real time and the score's `TempoMap`, repainting every frame, and writes a `transform` directly to the DOM (never `left`/`top`, which would force layout per frame). Measured after: 0 stalled frames, even ~2.7px steps.
- **Nothing high-frequency may be read at a large component's top level.** `positionTick` arrives 30x/sec and `selectCurrentMeasureBeat` returns a fresh object each time, so reading either high up re-renders that whole subtree 30x/sec — profiling playback showed `AppLayout` (and through it the notation and keyboard) plus the whole `TransportBar` of forwardRef controls doing exactly that, 124 renders in 4s. Each position-driven readout is now its own subscriber component: `StatusPosition`, `MeasureBeatReadout`, `PositionScrubber`, `Timecode`, `PlaybackCaret`. Same rule for `activeNoteIds`. Keep new readouts isolated.
- `vite.config.ts` sets `resolve.dedupe: ['react','react-dom','zustand']`. Normally redundant, but a local `bun link` of music_lib during cross-repo work exposes its dev-installed copies and two React instances break every hook — don't remove it.
- `vite.config.ts` excludes `@sudobility/music_lib` from dev-mode dep pre-bundling (esbuild's prebundler doesn't handle the lib's `new Worker(new URL(...))` calls) — don't "fix" that exclusion without checking the MIDI-import/quantize workers still resolve in dev.

## Related Projects

- `music_types` — shared types/schemas (`@sudobility/music_types`)
- `music_client` — typed network client + React Query hooks (`@sudobility/music_client`)
- `music_lib` — domain model, commands, adapters, Zustand store (`@sudobility/music_lib`)
- `music_api` — backend: Hono + Drizzle + PostgreSQL, OpenAI proxy, Firebase auth (private, not published)

# Moosiac

Moosiac is a browser-based, AI-assisted sheet-music composition app. It renders real, readable notation (not a MIDI piano-roll pretending to be notation), plays scores back through a real synthesizer, and lets you generate or regenerate music with an AI provider.

This repo (`music_app`) is the web app: routing, pages, and Tailwind-styled UI. It's one of five repos that make up Moosiac — see [Architecture](#architecture) below for how they fit together. The score model, commands, rendering/audio adapters, and Zustand store live in `@sudobility/music_lib`; the backend (OpenAI proxy + project persistence) lives in the sibling `music_api` repo.

> Screenshots: _add a screenshot of the dashboard and the editor (notation + piano roll) here._

## Features

- **Score editor** — click/shift-click/drag-box note selection, note/rest insertion, duration/accidental/articulation editing, tie toggling, quantization, undo/redo, page and continuous layout, zoom.
- **Piano roll** — a fully synchronized alternate view of the same score: drag notes to change pitch/time, resize for duration, per-note velocity lane, voice-lane reassignment, independent horizontal/vertical zoom.
- **Playback** — Tone.js-driven transport with play/pause/stop, loop, metronome, per-track mute/solo, tempo and speed control, master volume, a scrubbable position slider, and synchronized note highlighting during playback.
- **AI generation** — generate a whole score from a text prompt (style, mood, complexity, instrumentation, key/time signature, tempo), or select a passage and regenerate just that region with up to three previewable alternatives you can accept, reject, or retry. Generation is proxied through `music_api` to OpenAI — the API key never reaches the browser.
- **Import / export** — MIDI import (with a preview wizard: quantization, triplet detection, sustain-pedal handling, piano staff-split, key detection) and export; basic MusicXML import/export; full project JSON import/export.
- **Persistence** — projects are saved server-side (per signed-in user, via `music_api` + PostgreSQL) with autosave and a dashboard of your projects, search/sort, duplicate/delete, and starter templates.
- **Accessibility** — every interactive control is keyboard-reachable and carries an accessible name; see the [keyboard shortcuts](docs/architecture.md#keyboard-shortcuts) table.

## Dev setup

Requires [Bun](https://bun.sh) and a local PostgreSQL instance. Moosiac needs the sibling `music_api` repo running too — projects and AI generation are entirely server-backed, there is no offline/local-only mode.

```bash
# 1. Install this repo's dependencies
bun install

# 2. Set up and start music_api (sibling checkout, e.g. ../music_api)
cd ../music_api
bun install
cp .env.example .env   # fill in DATABASE_URL, Firebase service-account creds, and ShapeShyft settings
# Configure generate-score-claude, plan-arrangement-claude, and regenerate-region-claude in ShapeShyft to enable Claude.
bun run db:init
bun run dev             # http://localhost:8022

# 3. Back in music_app: point at music_api and your Firebase web app config
cd ../music_app
# Set VITE_API_URL (defaults to http://localhost:8022) and the VITE_FIREBASE_*
# variables (see src/config/initialize.ts) in a .env.local file.
bun run dev              # http://localhost:5173
```

Sign-in is required app-wide (Firebase Auth) — there is no anonymous/local mode, so a real Firebase project (or the e2e auth shim, see below) is required to reach anything past the sign-in screen.

## Commands

| Command              | What it does                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun install`        | Install dependencies.                                                                                                                                                                                                                                                                                                                                                          |
| `bun run dev`        | Start the Vite dev server.                                                                                                                                                                                                                                                                                                                                                     |
| `bun run build`      | Type-check (`tsc -b`) and produce a production build in `dist/`.                                                                                                                                                                                                                                                                                                               |
| `bun run preview`    | Serve the production build locally.                                                                                                                                                                                                                                                                                                                                            |
| `bun run lint`       | Run ESLint over the whole project.                                                                                                                                                                                                                                                                                                                                             |
| `bun run typecheck`  | Run the TypeScript compiler in `--noEmit` mode.                                                                                                                                                                                                                                                                                                                                |
| `bun run test`       | Run the unit/component test suite (Vitest + Testing Library + jsdom).                                                                                                                                                                                                                                                                                                          |
| `bun run test:watch` | Same, in watch mode.                                                                                                                                                                                                                                                                                                                                                           |
| `bun run test:e2e`   | Run the Playwright end-to-end suite (`e2e/`) against a real Chromium browser and a real `music_api` + local Postgres. Boots both `music_api` (from `../music_api`, `AI_TEST_MODE=1` — no real OpenAI calls) and the Vite dev server (`VITE_E2E=1`) automatically. Run `bunx playwright install chromium` first if you haven't already; make sure ports `5173`/`8023` are free. |
| `bun run format`     | Format the codebase with Prettier.                                                                                                                                                                                                                                                                                                                                             |
| `bun run verify`     | `typecheck && lint && test && build` — run before any push.                                                                                                                                                                                                                                                                                                                    |

**Testing at a glance**: the component-test suite (313 tests as of this writing) in this repo covers every interactive component in isolation — toolbars, transport, track list, inspector, generation panel, import dialogs, selection behavior, regeneration preview, error dialogs, dashboard — plus an accessible-name smoke test per dialog/panel. `music_lib` carries the much larger domain/unit-test suite (score model, commands, validation, MIDI/MusicXML, quantization, etc.). A Playwright suite in `e2e/` then drives the whole app in a real browser through the spec §30 scenarios — creating a project, generating and playing a score, selecting/editing/undoing, regenerating a passage and accepting an alternative, MIDI/MusicXML round-trips, saving and reopening a project, and switching between the notation and piano-roll views — plus one end-to-end run of the full [acceptance scenario](docs/spec.md#39-acceptance-criteria) (`e2e/acceptance.spec.ts`). See [docs/parity-checklist.md](docs/parity-checklist.md) for the full feature → test mapping.

## Architecture

Moosiac is split across five repos: shared types (`music_types`), a typed network client (`music_client`), the domain/store layer (`music_lib`), the backend (`music_api`), and this web app (`music_app`). See **[docs/architecture.md](docs/architecture.md)** for:

- The repo table and a Mermaid diagram of how they connect
- Request flows (auth token → `MusicClient` → `music_api` → OpenAI; project CRUD; e2e test mode)
- The store-context injection pattern
- The internal score model, rendering pipeline, playback scheduling, MIDI import pipeline, and the regeneration workflow's fragment/replace semantics
- Known limitations, keyboard shortcuts, and troubleshooting

## Tech stack

React 19, TypeScript (strict), Vite, Tailwind CSS (`@sudobility/design` preset, `darkMode: 'class'`), `@sudobility/components`/`building_blocks`/`auth-components`, Zustand (+ Immer, via `music_lib`), VexFlow, Tone.js, `@tonejs/midi` (via `music_lib`), Zod, React Router, `@tanstack/react-query`, Firebase Auth, Vitest + Testing Library, Playwright.

## License

BUSL-1.1.

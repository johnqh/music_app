# ScoreSmith

ScoreSmith is a browser-based, AI-assisted sheet-music composition app. It renders real, readable notation (not a MIDI piano-roll pretending to be notation), plays scores back through a real synthesizer, and lets you generate or regenerate music with an AI provider — all client-side, no server, no account.

Everything runs entirely in the browser: a canonical score model is the single source of truth, notation is rendered with VexFlow, playback runs on Tone.js/Web Audio, and projects are saved to IndexedDB. Music generation is pluggable behind a small provider interface; ScoreSmith ships with a deterministic, seeded mock provider so every feature — generation, regeneration, MIDI/MusicXML import/export, playback — works fully offline, with no API keys and no network calls.

> Screenshots: _add a screenshot of the dashboard and the editor (notation + piano roll) here._

## Features

- **Score editor** — click/shift-click/drag-box note selection, note/rest insertion, duration/accidental/articulation editing, tie toggling, quantization, undo/redo, page and continuous layout, zoom.
- **Piano roll** — a fully synchronized alternate view of the same score: drag notes to change pitch/time, resize for duration, per-note velocity lane, voice-lane reassignment, independent horizontal/vertical zoom.
- **Playback** — Tone.js-driven transport with play/pause/stop, loop, metronome, per-track mute/solo, tempo and speed control, master volume, a scrubbable position slider, and synchronized note highlighting during playback.
- **AI generation** — generate a whole score from a text prompt (style, mood, complexity, instrumentation, key/time signature, tempo), or select a passage and regenerate just that region with up to three previewable alternatives you can accept, reject, or retry. Ships with a seeded mock provider (musically-aware: scales, chord progressions, arpeggios, cadences) so generation works fully offline; see [Adding a real AI provider](docs/architecture.md#adding-a-real-ai-provider) to wire in a real model.
- **Import / export** — MIDI import (with a preview wizard: quantization, triplet detection, sustain-pedal handling, piano staff-split, key detection) and export; basic MusicXML import/export; full project JSON import/export.
- **Persistence** — autosaving IndexedDB-backed projects, a dashboard with sample projects, search/sort, duplicate/delete.
- **Accessibility** — every interactive control is keyboard-reachable and carries an ARIA label; see the [keyboard shortcuts](docs/architecture.md#keyboard-shortcuts) table.

## Quick start

Requires Node.js and npm.

```bash
npm install
npm run dev
```

Then open the printed local URL (Vite's default is `http://localhost:5173`).

To run the end-to-end test suite, Playwright needs its own browser binary once:

```bash
npx playwright install chromium
```

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check (`tsc -b`) and produce a production build in `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run lint` | Run ESLint over the whole project. |
| `npm run typecheck` | Run the TypeScript compiler in `--noEmit` mode. |
| `npm run test` | Run the unit/component test suite (Vitest + Testing Library + jsdom). |
| `npm run test:watch` | Same, in watch mode. |
| `npm run test:e2e` | Run the Playwright end-to-end suite (`e2e/`) against a real Chromium browser — starts `npm run dev` automatically. Run `npx playwright install chromium` first if you haven't already. |
| `npm run format` | Format the codebase with Prettier. |

**Testing at a glance**: 1300+ unit and component tests cover every domain module (fractions/ticks/pitch/duration math, score model, validation, quantization, voice allocation, commands/undo, MIDI/MusicXML import-export, persistence migrations) and every interactive component (toolbars, transport, track list, inspector, generation panel, import dialogs, selection, regeneration preview, error dialogs) in isolation. A Playwright suite in `e2e/` then drives the whole app in a real browser through the 15 scenarios in [spec §30](docs/spec.md) — creating a project, generating and playing a score, selecting/editing/undoing, regenerating a passage and accepting an alternative, MIDI/MusicXML round-trips, saving and reopening a project, and switching between the notation and piano-roll views — plus one end-to-end run of the full [acceptance scenario](docs/spec.md#39-acceptance-criteria) (`e2e/acceptance.spec.ts`). Every e2e run uses a `?seed=` URL param for deterministic generation output; see [Testing](docs/architecture.md#testing) for details.

## Architecture

ScoreSmith is layered domain-out: a UI-framework-free canonical score model and command/undo system at the core, pure adapters translating that model to/from VexFlow, Tone.js, MIDI, and MusicXML, a Zustand store gluing it all together, and a React/MUI UI on top. See **[docs/architecture.md](docs/architecture.md)** for:

- A layer diagram and the internal score model
- The rendering pipeline (score → layout → VexFlow SVG) and playback scheduling (score → Tone.js Part)
- The MIDI import pipeline and the regeneration workflow's fragment/replace semantics
- How to add a real AI provider (with an example `OpenAiProvider` sketch)
- Known limitations, keyboard shortcuts, and troubleshooting

## Tech stack

React 19, TypeScript (strict), Vite, MUI, Zustand (+ Immer), VexFlow, Tone.js, `@tonejs/midi`, Dexie (IndexedDB), Zod, React Router, Vitest + Testing Library, Playwright.

## License

BUSL-1.1.

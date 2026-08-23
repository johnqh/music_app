# music_player (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract everything that makes sound into a new `@sudobility/music_player` package, so playback stops being spread across three repos.

**Architecture:** `music_player` owns the engines (web fluidsynth, RN samples), plan building, offline rendering, the playback bus, and an `IMusicPlayer` transport singleton reached by DI. `MusicPosition` moves to `music_types` and `music_player` becomes its only writer. `music_lib` keeps an adapter that binds the Zustand store to the player; `music_io` loses playback entirely.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Bun, Prettier, ESLint, `js-synthesizer` (web, optional peer), `react-native-audio-api` (RN, optional peer).

**Spec:** `docs/superpowers/specs/2026-08-23-music-player-and-file-io-design.md`

**Phase B (the `music_io` file layer) gets its own plan** once this is green. The spec orders it that way on purpose: Phase A _removes_ from `music_io`, so Phase B should be designed against `music_io`'s final contents rather than a shape about to lose half of itself.

## Global Constraints

- **`music_player` must import no `music_lib`, no `music_io`, no `vexflow`.** A contract test enforces it (Task 1). Its only dependency is `@sudobility/music_types`.
- **`music_io` must import no `music_lib` and no `music_player`.** Its existing `no-music-lib.test.ts` is extended in Task 7.
- **`music_player` is the only writer of `MusicPosition`.** Everything else reads through `getMusicPosition()`. Pinned in Task 2.
- **The engine interface still takes a `PlaybackPlan`, never a `Score`.** Only the _public_ `IMusicPlayer.load()` takes a `Score`, and it builds the plan internally. The old rule survives where it was actually about: the synth does no score maths.
- **`applyMix(tracks)` must not rebuild the note queue.** Mixing is exempt from the score-is-immutable-while-playing lock; a gain change mid-playback is the point.
- **`stop()` before adopting a foreign score.** A generation result or opened snapshot replaces the score without going through `dispatchCommand`, so the edit lock never sees it. Without the stop, the player keeps sounding the old score out of its queue. Pinned by `AppLayout.test.tsx`.
- **Prettier** is enforced in `music_player`, `music_codecs` and `music_lib` (`format:check` inside `verify`). `music_io` and `music_types` have no Prettier config — moved files need reformatting when they land in a Prettier repo, and must NOT be reformatted when they land in one without it.
- **Never auto-commit or auto-push.** Commit steps are written out; run them only when the user asks in that turn.
- **Cross-repo builds:** after building a `@sudobility/*` package for local use, `bun run clean && bun run build`, `rsync` into the consumer's `node_modules`, and delete the consumer's `node_modules/.vite`. **A `bun install` in any consumer reinstalls from the registry and silently discards every rsynced package** — re-sync after one.
- **Publish order** gains `music_player` after `music_types`: `music_types` → `music_codecs` → `music_player` → `music_drawing` → `music_api` → `music_client` → `music_io` → `music_lib` → `music_app`.

---

## File Structure

**`music_player` (new)** — `~/projects/music_player`

- `src/shared/` — platform-free: `plan.ts` (`playbackPlan`, `playbackTracks`, `resolveVoice`), `render-events.ts`, `bus.ts`, `midi.ts`, `mix.ts`, `note-queue.ts`, `pump-window.ts`, `sounding-set.ts`, `test-plan.ts`
- `src/types.ts` — the player-only types (Task 9) and `IMusicPlayer`
- `src/player.ts` — `MusicPlayer implements IMusicPlayer`, the transport, built from `controller.ts` minus its store
- `src/singleton.ts` — `initializeMusicPlayer` / `getMusicPlayer` / `resetMusicPlayer`
- `src/web/` — `index.ts`, `playback/*`, `audio/{offline-synth,soundfont-render,synth-types}.ts`
- `src/rn/` — `index.ts`, `playback/*`, `audio/offline-render.ts`
- `src/mocks/index.ts` — a `MockMusicPlayer` for downstream tests
- `src/contract/no-domain-imports.test.ts` — the guard

**`music_types`** — gains `src/position/{music-position,singleton}.ts`; `src/platform/playback.ts` splits in Task 9.

**`music_lib`** — `src/services/playback/adapter.ts` replaces `controller.ts`; `bus.ts`, `plan.ts`, `types.ts` and `services/export/render-events.ts` are deleted (moved).

**`music_io`** — deletions only, plus `shared/types.ts`, the three entries, the contract test and `package.json`.

**`music_app`** — `src/config/initialize.ts` calls `initializeMusicPlayer`; playback call sites move from `music_lib`'s controller to the adapter.

---

### Task 1: Scaffold music_player

**Repo:** `~/projects/music_player` (new)

**Files:**

- Create: `package.json`, `tsconfig.json`, `tsconfig.esm.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `src/index.ts`, `src/contract/no-domain-imports.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: an installable, buildable, empty package with its guard in place.

- [ ] **Step 1: Create the repo and copy the toolchain from music_io**

`music_io` is the closest sibling — same ESM/strict setup, same web/rn export conditions.

```bash
mkdir -p ~/projects/music_player/src/contract
cd ~/projects/music_player
git init -q
cp ~/projects/music_io/tsconfig.json ~/projects/music_io/tsconfig.build.json ~/projects/music_io/eslint.config.js .
cp ~/projects/music_codecs/.prettierrc .
mv tsconfig.build.json tsconfig.esm.json
printf 'node_modules\ndist\n' > .gitignore
```

- [ ] **Step 2: Write `package.json`**

Mirrors `music_io`'s export-condition layout, since the same web/RN split applies. `js-synthesizer` and `react-native-audio-api` are **optional peers** so a fresh install fails loudly rather than shipping the wrong platform's audio.

```json
{
  "name": "@sudobility/music_player",
  "version": "0.1.0",
  "description": "Playback for ScoreSmith: transport, synth engines and offline rendering, for web and React Native",
  "author": "Sudobility",
  "license": "BUSL-1.1",
  "type": "module",
  "exports": {
    ".": {
      "react-native": { "types": "./dist/rn/index.d.ts", "import": "./dist/rn/index.js" },
      "default": { "types": "./dist/web/index.d.ts", "import": "./dist/web/index.js" }
    },
    "./web": { "types": "./dist/web/index.d.ts", "import": "./dist/web/index.js" },
    "./rn": { "types": "./dist/rn/index.d.ts", "import": "./dist/rn/index.js" },
    "./mocks": { "types": "./dist/mocks/index.d.ts", "import": "./dist/mocks/index.js" }
  },
  "files": ["dist/**/*", "CLAUDE.md"],
  "scripts": {
    "build": "tsc -p tsconfig.esm.json",
    "clean": "rimraf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src",
    "format": "prettier --write src/**/*.ts",
    "format:check": "prettier --check src/**/*.ts",
    "typecheck": "tsc --noEmit",
    "verify": "bun run format:check && bun run typecheck && bun run lint && bun run test && bun run build",
    "prepublishOnly": "bun run clean && bun run verify"
  },
  "peerDependencies": {
    "@sudobility/music_types": "^0.12.1",
    "js-synthesizer": "^1.13.0",
    "react-native-audio-api": ">=0.13.0"
  },
  "peerDependenciesMeta": {
    "js-synthesizer": { "optional": true },
    "react-native-audio-api": { "optional": true }
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@sudobility/music_types": "^0.12.1",
    "@typescript-eslint/eslint-plugin": "^8.65.0",
    "@typescript-eslint/parser": "^8.65.0",
    "eslint": "^9.38.0",
    "globals": "^17.8.0",
    "js-synthesizer": "^1.13.0",
    "prettier": "^3.6.2",
    "rimraf": "^6.1.3",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.65.0",
    "vitest": "^4.1.10"
  },
  "publishConfig": { "access": "restricted" },
  "dependencies": {}
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

/**
 * Node, not jsdom. Nothing here needs a DOM: the web engine's `AudioWorklet`
 * and `AudioContext` are stubbed per-suite, because jsdom does not implement
 * Web Audio and pretending otherwise only hides which calls are being faked.
 */
export default defineConfig({
  test: { environment: 'node', globals: false },
});
```

- [ ] **Step 4: Write the guard test**

`src/contract/no-domain-imports.test.ts`:

```ts
/**
 * music_player makes sound. It must not reach into the domain or the platform
 * package beside it.
 *
 * `music_io`'s own guard records what this costs when it is merely remembered:
 * live playback took a `Score`, the engine then needed tempo maths and the GM
 * tables, and by the end the two packages were mutually dependent and neither
 * could be type-checked until the other had published.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = ['@sudobility/music_lib', '@sudobility/music_io', 'vexflow'];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('package boundaries', () => {
  it('imports neither the domain nor the sibling platform package', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      for (const banned of FORBIDDEN) {
        if (text.includes(`from '${banned}`) || text.includes(`from "${banned}`)) {
          offenders.push(`${file}: ${banned}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('takes music_types as its only peer, and no runtime dependency', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.peerDependencies ?? {}).sort()).toEqual([
      '@sudobility/music_types',
      'js-synthesizer',
      'react-native-audio-api',
    ]);
  });
});
```

- [ ] **Step 5: Placeholder index so the build has something to emit**

`src/index.ts`:

```ts
/**
 * @sudobility/music_player — everything that makes sound.
 *
 * The transport, the two synth engines (fluidsynth on the web, sample packs on
 * React Native), plan building, and offline rendering. It takes a `Score` and
 * produces audio; it knows nothing about editing, files or the store.
 */
export {};
```

- [ ] **Step 6: Install and verify the empty package**

```bash
cd ~/projects/music_player
bun install
bun run verify
```

Expected: format:check, typecheck, lint, tests (2 passing) and build all succeed.

- [ ] **Step 7: Commit** (only if asked)

```bash
git add -A && git commit -m "chore: scaffold music_player"
```

---

### Task 2: Move MusicPosition into music_types

**Repo:** `~/projects/music_types`, then `~/projects/music_lib`

`MusicPosition` passes all four rules music_types keeps — works on both sides, no dependencies, no hooks, no async (verified: one type-only import, 156 lines with its singleton). It will be **the first stateful singleton service** in that package; the spec records that as a deliberate precedent, and the doc comment must say so.

**Files:**

- Create: `music_types/src/position/{music-position.ts,singleton.ts,index.ts}`
- Move tests: `music_types/src/position/{music-position,single-source,drift}.test.ts`
- Modify: `music_types/src/index.ts`; `music_lib` imports

**Interfaces:**

- Consumes: `IMusicPosition`, `IMusicPositionSource`, `UnsubscribePosition` (already in `music_types`).
- Produces: `MusicPosition`, `initializeMusicPosition(override?)`, `getMusicPosition()`, `getMusicPositionSource()`, `resetMusicPosition()` — all from `@sudobility/music_types`.

- [ ] **Step 1: Move the files**

```bash
cd ~/projects/music_types && mkdir -p src/position
cp ~/projects/music_lib/src/services/position/music-position.ts src/position/
cp ~/projects/music_lib/src/services/position/singleton.ts src/position/
cp ~/projects/music_lib/src/services/position/music-position.test.ts src/position/
cp ~/projects/music_lib/src/services/position/single-source.test.ts src/position/
cp ~/projects/music_lib/src/services/position/drift.test.ts src/position/
```

- [ ] **Step 2: Rewrite the imports to be local**

Both files import the interfaces from `@sudobility/music_types`; inside that package they are relative.

```bash
cd ~/projects/music_types
sed -i '' "s#from '@sudobility/music_types'#from '../platform/xml.js'#" /dev/null   # no-op guard; see below
grep -rn "@sudobility/music_types" src/position/
```

Replace each `from '@sudobility/music_types'` in `src/position/*.ts` with the real declaring module — the position interfaces live in `src/platform/position.ts` if present, otherwise find them with:

```bash
grep -rln "IMusicPositionSource" ~/projects/music_types/src --include='*.ts' | grep -v position/
```

and import from that path with a `.js` extension.

- [ ] **Step 3: Record the precedent in the doc comment**

Prepend to `src/position/music-position.ts`'s existing header:

```ts
/**
 * The one place that knows where playback is.
 *
 * **The first stateful singleton service in music_types, and deliberately so.**
 * This package is otherwise model and primitives. The playhead earns the
 * exception because it has exactly one writer (`music_player`) and readers in
 * every other package — the caret, note highlighting, the piano keyboard — so
 * any other home creates a dependency edge that exists only to reach it. It
 * still obeys the four rules: it works on both sides, adds no dependency,
 * contains no hooks and contains no async code.
 */
```

- [ ] **Step 4: Barrel and export**

`src/position/index.ts`:

```ts
export * from './music-position.js';
export * from './singleton.js';
```

In `src/index.ts`, beside the other section exports:

```ts
// ---------------------------------------------------------------------------
// Playhead (the one stateful service here; see position/music-position.ts)
// ---------------------------------------------------------------------------
export * from './position/index.js';
```

- [ ] **Step 5: Verify music_types**

```bash
cd ~/projects/music_types && bun run verify
```

Expected: all green, with the three moved position suites now running here.

- [ ] **Step 6: Point music_lib at the new home and delete its copy**

```bash
cd ~/projects/music_lib
git rm -r src/services/position
grep -rln "services/position/singleton.js\|services/position/music-position.js" src/
```

For each file the grep names, replace the relative import with `@sudobility/music_types`. Then sync and verify:

```bash
cd ~/projects/music_types && bun run clean && bun run build
rsync -a --delete dist/ ~/projects/music_lib/node_modules/@sudobility/music_types/dist/
cp package.json ~/projects/music_lib/node_modules/@sudobility/music_types/package.json
cd ~/projects/music_lib && bun run verify
```

- [ ] **Step 7: Commit** (only if asked)

```bash
cd ~/projects/music_types && git add -A && git commit -m "feat: own the playhead; MusicPosition moves in from music_lib"
cd ~/projects/music_lib && git add -A && git commit -m "refactor: take MusicPosition from music_types"
```

---

### Task 3: Move the engines from music_io into music_player

**Repo:** `~/projects/music_player`

A **pure move**: these files import only `@sudobility/music_types` and each other. If a moved test needs an edit beyond an import path, stop and report — except for the one environment difference in Step 4.

**Files:**

- Create in `music_player`: `src/shared/{midi,mix,note-queue,pump-window,sounding-set,test-plan}.ts`, `src/web/playback/*`, `src/web/audio/{offline-synth,soundfont-render,synth-types}.ts`, `src/rn/playback/*`, `src/rn/audio/offline-render.ts`, `src/rn/{base64,types.d}.ts` — plus every matching `*.test.ts`

**Interfaces:**

- Consumes: Task 1's package; the playback types still in `music_types`.
- Produces (internal, not yet exported from the index): `SoundfontPlaybackEngine`, `SynthHost`, `loadSoundfont`, `openSoundfontCache`, `createSoundfontRenderer`, `RNSamplePlaybackEngine`, `createRNSoundfontRenderer`, `allocateChannels`, `headroomTrimFor`, `limitPeaks`.

- [ ] **Step 1: Copy the platform-free half**

```bash
cd ~/projects/music_player && mkdir -p src/shared
cp ~/projects/music_io/src/shared/playback/*.ts src/shared/
ls src/shared
```

- [ ] **Step 2: Copy the web half**

```bash
cd ~/projects/music_player && mkdir -p src/web/playback src/web/audio
cp ~/projects/music_io/src/web/playback/*.ts src/web/playback/
cp ~/projects/music_io/src/web/audio/offline-synth.ts src/web/audio/
cp ~/projects/music_io/src/web/audio/offline-synth.test.ts src/web/audio/
cp ~/projects/music_io/src/web/audio/soundfont-render.ts src/web/audio/
cp ~/projects/music_io/src/web/audio/soundfont-render.test.ts src/web/audio/
cp ~/projects/music_io/src/web/audio/synth-types.ts src/web/audio/
```

- [ ] **Step 3: Copy the React Native half**

```bash
cd ~/projects/music_player && mkdir -p src/rn/playback src/rn/audio
cp ~/projects/music_io/src/rn/playback/*.ts src/rn/playback/
cp ~/projects/music_io/src/rn/audio/offline-render.ts src/rn/audio/
cp ~/projects/music_io/src/rn/audio/offline-render.test.ts src/rn/audio/
cp ~/projects/music_io/src/rn/base64.ts ~/projects/music_io/src/rn/base64.test.ts src/rn/
cp ~/projects/music_io/src/rn/types.d.ts src/rn/
```

`base64.ts` comes too: `sample-pack.ts` decodes packs with it, and leaving it behind would make `music_io` a dependency of the RN engine.

- [ ] **Step 4: Fix the import paths**

The moved files reached siblings as `../../shared/playback/mix.js`; `shared/` is now one level up from `web/`/`rn/`.

```bash
cd ~/projects/music_player
sed -i '' "s#from '\.\./\.\./shared/playback/#from '../../shared/#g" src/web/**/*.ts src/rn/**/*.ts
sed -i '' "s#from '\.\./shared/playback/#from '../shared/#g" src/web/*.ts src/rn/*.ts 2>/dev/null || true
grep -rn "shared/playback/" src/ || echo "no stale shared/playback paths"
```

- [ ] **Step 5: Run the moved suites**

```bash
cd ~/projects/music_player && bun run test
```

Expected: every moved suite passes. If a suite fails on a missing DOM global, that is the one legitimate edit: add `// @vitest-environment jsdom` as a leading docblock to that file and say which, in the commit message. Any other failure means the move was not clean — stop and report.

- [ ] **Step 6: Apply Prettier**

`music_io` has no Prettier config and `music_player` does, so the moved files need one formatting-only pass.

```bash
cd ~/projects/music_player && bun run format && bun run test
```

- [ ] **Step 7: Verify**

```bash
cd ~/projects/music_player && bun run verify
```

The guard test must still pass — nothing moved imports `music_lib` or `music_io`.

- [ ] **Step 8: Commit** (only if asked)

```bash
git add -A && git commit -m "feat: move the synth engines in from music_io"
```

---

### Task 4: Move plan building and offline event building into music_player

**Repo:** `~/projects/music_player`

Both are pure: `plan.ts` imports only `@sudobility/music_types`, and `render-events.ts` imports music_types plus `resolveVoice` from `plan.ts`. Nothing about them was ever `music_lib`-specific — they lived there because the controller did.

**Files:**

- Create: `src/shared/{plan.ts,render-events.ts,bus.ts}` + their tests, from `music_lib/src/services/playback/{plan,bus}.ts` and `music_lib/src/services/export/render-events.ts`

**Interfaces:**

- Consumes: Task 3's `src/shared/*`.
- Produces: `playbackPlan(score, opts?)`, `playbackTracks(score)`, `resolveVoice(track)`, `renderEvents(score)`, `class PlaybackBus`.

- [ ] **Step 1: Copy the three modules and their tests**

```bash
cd ~/projects/music_player
cp ~/projects/music_lib/src/services/playback/plan.ts src/shared/
cp ~/projects/music_lib/src/services/playback/plan.test.ts src/shared/ 2>/dev/null || true
cp ~/projects/music_lib/src/services/playback/bus.ts src/shared/
cp ~/projects/music_lib/src/services/playback/bus.test.ts src/shared/ 2>/dev/null || true
cp ~/projects/music_lib/src/services/export/render-events.ts src/shared/
cp ~/projects/music_lib/src/services/export/render-events.test.ts src/shared/ 2>/dev/null || true
ls src/shared
```

- [ ] **Step 2: Repoint their imports**

`render-events.ts` reached `resolveVoice` as `../playback/plan.js`; both are now siblings. `bus.ts` imported the position singleton from `../position/singleton.js`; that is `@sudobility/music_types` since Task 2.

```bash
cd ~/projects/music_player
sed -i '' "s#from '\.\./playback/plan\.js'#from './plan.js'#g" src/shared/*.ts
sed -i '' "s#from '\.\./position/singleton\.js'#from '@sudobility/music_types'#g" src/shared/*.ts
grep -rn "\.\./" src/shared/*.ts || echo "no parent-relative imports left in shared/"
```

- [ ] **Step 3: Run the moved suites, then format and verify**

```bash
cd ~/projects/music_player && bun run test && bun run format && bun run verify
```

Expected: all pass. The guard test confirms none of this imports `music_lib`.

- [ ] **Step 4: Commit** (only if asked)

```bash
git add -A && git commit -m "feat: move plan building, render events and the playback bus in from music_lib"
```

---

### Task 5: `IMusicPlayer`, the implementation, and the singleton

**Repo:** `~/projects/music_player`

This is the one task that writes new code rather than moving it. `MusicPlayer` is `PlaybackController` (438 lines) **minus every store touchpoint** — roughly 25 of them. The rule: a method that reads or writes the Zustand store does not come here; a method that talks to the engine or does score maths does.

**A refinement on the spec, deliberate.** The spec listed `togglePlay`,
`seekToMeasure`, `goToStart`, `previousMeasure` and `nextMeasure` on
`IMusicPlayer`. None of them are here, and neither are `setLoopFromSelection`,
`clearLoop` or `toggleLoop`. Two reasons, one per group:

- **The four caret methods** read the caret and write the caret, and the caret
  is store state. Putting them in the player would mean the player remembering a
  caret of its own — a second thing that can disagree with the first, which is
  exactly the class of bug `MusicPosition` was built to remove. Verified safe to
  leave behind: every caret move in the app already routes through
  `playbackController.seek()`, and there is not one direct `setCaretTick` call
  site.
- **`togglePlay` and the three loop methods** read the store for the current
  transport state, the selection and the loop range, and `togglePlay` clears the
  selection on the →playing transition only. That is selection semantics, which
  is editing.

All eight live in the adapter (Task 6) and call `player.play()`/`pause()`/
`seek()`/`setLoop()`. `IMusicPlayer` keeps the primitives; the adapter keeps the
score- and selection-aware compositions of them.

**Files:**

- Create: `src/types.ts`, `src/player.ts`, `src/singleton.ts`, `src/player.test.ts`, `src/mocks/index.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: Task 3's engines, Task 4's `playbackPlan`/`playbackTracks`/`PlaybackBus`.
- Produces: `IMusicPlayer`, `MusicPlayer`, `initializeMusicPlayer(player)`, `getMusicPlayer()`, `resetMusicPlayer()`, `MockMusicPlayer`.

- [ ] **Step 1: Write the interface**

`src/types.ts`:

```ts
import type {
  AuditionVoice,
  PlaybackTrack,
  Score,
  ScoreRange,
  SoundingNote,
  TransportPlaybackState,
} from '@sudobility/music_types';

export type Unsubscribe = () => void;

/**
 * The transport.
 *
 * Takes a `Score`, not a plan: this package owns `playbackPlan`, so making the
 * caller build one first would be a two-step dance whose second step is here.
 * The *engine* interface underneath still takes a `PlaybackPlan` and does no
 * score maths — which is where `music_io`'s "handed a plan, never a score" rule
 * was always actually about.
 *
 * Deliberately has no caret. Where the reader is looking is store state in
 * music_lib, and a second copy here is a second thing that can disagree with
 * it — see `MusicPosition` for what that cost last time.
 */
export interface IMusicPlayer {
  load(score: Score, opts?: { visibleTrackIds?: readonly string[] }): Promise<void>;

  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(scoreTick: number): void;

  setLoop(range: ScoreRange | null): void;
  setTempoMultiplier(multiplier: number): void;
  setMetronome(enabled: boolean): void;
  setMasterVolume(volume: number): void;

  /** Live, without rebuilding the note queue: mixing is not editing. */
  applyMix(tracks: readonly PlaybackTrack[]): void;

  /** Audition. Touches no transport state — no caret move, no play/pause change. */
  noteOn(midi: number, voice: AuditionVoice): void;
  noteOff(midi: number): void;

  onPosition(fn: (scoreTick: number) => void): Unsubscribe;
  onSounding(fn: (notes: readonly SoundingNote[]) => void): Unsubscribe;
  onTransport(fn: (state: TransportPlaybackState) => void): Unsubscribe;

  dispose(): void;
}
```

- [ ] **Step 2: Write the failing test**

`src/player.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { MusicPlayer } from './player.js';
import { twinkleScore } from './shared/test-plan.js';

/** A recording stand-in for the platform engine. */
function fakeEngine() {
  const calls: string[] = [];
  return {
    calls,
    engine: {
      initialize: vi.fn(async () => {}),
      load: vi.fn(async () => {
        calls.push('load');
      }),
      play: vi.fn(async () => {
        calls.push('play');
      }),
      pause: vi.fn(() => {
        calls.push('pause');
      }),
      stop: vi.fn(() => {
        calls.push('stop');
      }),
      seek: vi.fn((t: number) => {
        calls.push(`seek(${t})`);
      }),
      applyMix: vi.fn(() => {
        calls.push('applyMix');
      }),
      setTempoMultiplier: vi.fn(),
      setLoop: vi.fn(),
      setMetronome: vi.fn(),
      setMasterVolume: vi.fn(),
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      setObserver: vi.fn(),
      dispose: vi.fn(),
    },
  };
}

describe('MusicPlayer', () => {
  it('builds a plan from the score and hands the engine the plan, not the score', async () => {
    const { engine } = fakeEngine();
    const player = new MusicPlayer({ engine: engine as never });
    await player.load(twinkleScore());

    expect(engine.load).toHaveBeenCalledTimes(1);
    const handed = engine.load.mock.calls[0][0] as { notes?: unknown[] };
    // A plan has resolved notes; a Score has tracks of measures.
    expect(handed).toHaveProperty('notes');
    expect(handed).not.toHaveProperty('tracks.0.measures');
  });

  it('changes the mix without reloading', async () => {
    const { engine, calls } = fakeEngine();
    const player = new MusicPlayer({ engine: engine as never });
    await player.load(twinkleScore());
    calls.length = 0;

    player.applyMix([]);
    expect(calls).toEqual(['applyMix']);
    expect(engine.load).toHaveBeenCalledTimes(1);
  });

  it('translates a score tick to the first performance of that tick when seeking', async () => {
    const { engine } = fakeEngine();
    const player = new MusicPlayer({ engine: engine as never });
    await player.load(twinkleScore());

    player.seek(480);
    // No repeats in the fixture, so the timeline is the identity and the
    // engine sees the same number. The point is that it goes through the
    // translation at all: with repeats it would not.
    expect(engine.seek).toHaveBeenCalledWith(480);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

```bash
cd ~/projects/music_player && bun run test -- src/player.test.ts
```

Expected: FAIL — `Failed to resolve import "./player.js"`.

- [ ] **Step 4: Write `src/player.ts`**

Port `music_lib/src/services/playback/controller.ts` with these edits, and **keep every explanatory comment that still applies**:

1. Delete the `store` constructor parameter, the `useAppStore`/`selectVisibleTrackIds` imports, and the `store.subscribe(...)` block in the constructor. Loading is now driven by the caller through `load()`.
2. Delete `togglePlay`, `seekToMeasure`, `goToStart`, `previousMeasure`, `nextMeasure`, `setLoopFromSelection`, `clearLoop`, `toggleLoop`. Their logic goes to the adapter in Task 6.
3. Keep `play`, `pause`, `stop`, `seek`, `setTempoMultiplier`, `setMetronome`, `setMasterVolume`, `noteOn`, `noteOff`, `dispose`, and the private timeline/plan handling.
4. `load(score, opts)` replaces `handleScoreChange`, keeping its two branches verbatim — **while playing, a score change is a mix change only** (`applyMix(playbackTracks(score))`), because rebuilding every note to change a gain would undo the reason that branch exists.
5. Replace every `this.store.getState().setX(...)` with an emit on the bus or a `MusicPosition` report; the adapter subscribes and does the store write.
6. `reportError` becomes an injected `onError?: (message: string, error: unknown) => void` — `libraryMessage` lives in music_lib and must not come along.

- [ ] **Step 5: Write the singleton**

`src/singleton.ts`, matching `initializeMusicPosition` exactly:

```ts
/**
 * The player singleton.
 *
 * Same shape as the rest of the family's services: initialise once at start-up,
 * read it everywhere, reset it in tests. A singleton because there is one
 * transport — one piece of music is playing — and two would be two playheads,
 * which is the disagreement `MusicPosition` exists to prevent.
 */
import type { IMusicPlayer } from './types.js';

let instance: IMusicPlayer | null = null;

export class MusicPlayerNotInitializedError extends Error {
  constructor() {
    super(
      'The music player has not been initialized. Call initializeMusicPlayer() from your app composition root before using playback.',
    );
    this.name = 'MusicPlayerNotInitializedError';
  }
}

/** Idempotent, so a re-mounting composition root does not swap the transport out from under its subscribers. */
export function initializeMusicPlayer(player: IMusicPlayer): IMusicPlayer {
  if (!instance) instance = player;
  return instance;
}

export function getMusicPlayer(): IMusicPlayer {
  if (!instance) throw new MusicPlayerNotInitializedError();
  return instance;
}

/** Test-only: clears the singleton so suites cannot leak into each other. */
export function resetMusicPlayer(): void {
  instance = null;
}
```

- [ ] **Step 6: Write the mocks entry**

`src/mocks/index.ts` — a `MockMusicPlayer` recording calls, shaped like `music_io`'s `MockPlaybackEngine`, so `music_lib` and `music_app` tests use the same double this package's own suite does.

- [ ] **Step 7: Export from the platform entries**

Create `src/web/index.ts` and `src/rn/index.ts`, each exporting `createMusicPlayer(...)` returning a `MusicPlayer` wired to that platform's engine, plus `renderEvents` and that platform's `renderSamples`. Re-export `IMusicPlayer`, the singleton functions and the types from both.

- [ ] **Step 8: Verify**

```bash
cd ~/projects/music_player && bun run format && bun run verify
```

- [ ] **Step 9: Commit** (only if asked)

```bash
git add -A && git commit -m "feat: add the IMusicPlayer transport and its singleton"
```

---

### Task 6: Replace PlaybackController with a store adapter in music_lib

**Repo:** `~/projects/music_lib`

**Files:**

- Create: `src/services/playback/adapter.ts`, `src/services/playback/adapter.test.ts`
- Delete: `src/services/playback/{controller,bus,plan,types}.ts`, `src/services/export/render-events.ts` and their tests
- Modify: `src/index.ts`, `src/platform/registry.ts`

**Interfaces:**

- Consumes: `getMusicPlayer()`, `IMusicPlayer` from `@sudobility/music_player`.
- Produces: `playbackAdapter` (the module-level proxy the app imports, keeping the name `playbackController` as an alias for one release so app call sites can move separately), and `createPlaybackAdapter(store, player)`.

**Size, corrected.** The spec called this "a thin adapter — roughly 60 lines". It is closer to **150-200**. The store _writes_ stay here too — `setPlaybackState`, `setCaretTick`, `setSynthLoad`, `clearSelection`, `setLoopRange`, `setTempoMultiplier` — as do the four caret-navigation methods moved out of the player in Task 5, and the score/visible-track subscription. Plan for that rather than discovering it.

- [ ] **Step 1: Write the failing test**

`src/services/playback/adapter.test.ts`, pinning the two behaviours that are easy to lose:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../store/useAppStore.js';
import { testStoreContext } from '../../test/context.js';
import { createPlaybackAdapter } from './adapter.js';
import { twinkleScore } from '../../test/fixtures.js';

function fakePlayer() {
  return {
    load: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    setTempoMultiplier: vi.fn(),
    setMetronome: vi.fn(),
    setMasterVolume: vi.fn(),
    applyMix: vi.fn(),
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    onPosition: vi.fn(() => () => {}),
    onSounding: vi.fn(() => () => {}),
    onTransport: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

describe('playback adapter', () => {
  it('loads the player when the store adopts a new score', async () => {
    const store = createAppStore({ context: testStoreContext() });
    const player = fakePlayer();
    createPlaybackAdapter(store, player as never);

    store.getState().setScore(twinkleScore());
    await vi.waitFor(() => expect(player.load).toHaveBeenCalled());
  });

  it('changes the mix rather than reloading when a score arrives mid-playback', async () => {
    const store = createAppStore({ context: testStoreContext() });
    const player = fakePlayer();
    createPlaybackAdapter(store, player as never);
    store.getState().setScore(twinkleScore());
    await vi.waitFor(() => expect(player.load).toHaveBeenCalledTimes(1));

    store.getState().setPlaybackState('playing');
    store.getState().setScore(twinkleScore());

    // Rebuilding every note to change a gain would undo the reason this
    // branch exists — and is why AppLayout must stop() before adopting a
    // score that arrived from outside.
    await vi.waitFor(() => expect(player.applyMix).toHaveBeenCalled());
    expect(player.load).toHaveBeenCalledTimes(1);
  });

  it('moves the caret and the transport together on seek', () => {
    const store = createAppStore({ context: testStoreContext() });
    const player = fakePlayer();
    const adapter = createPlaybackAdapter(store, player as never);
    store.getState().setScore(twinkleScore());

    adapter.seek(480);
    expect(store.getState().caretTick).toBe(480);
    expect(player.seek).toHaveBeenCalledWith(480);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd ~/projects/music_lib && bun run test -- src/services/playback/adapter.test.ts
```

Expected: FAIL — `Failed to resolve import "./adapter.js"`.

- [ ] **Step 3: Write the adapter**

`src/services/playback/adapter.ts` keeps, from the old controller: the store subscription (score → `player.load`, visibleTrackIds → `player.applyMix`), the store writes driven by player events, `togglePlay` (including `clearSelection` on the →playing transition only), `seek`, `seekToMeasure`, `goToStart`, `previousMeasure`, `nextMeasure`, `setLoopFromSelection`, `clearLoop`, `toggleLoop`, and `reportError` via `libraryMessage`. Every other method forwards to the player.

- [ ] **Step 4: Delete the moved modules**

```bash
cd ~/projects/music_lib
git rm src/services/playback/controller.ts src/services/playback/bus.ts \
       src/services/playback/plan.ts src/services/playback/types.ts \
       src/services/export/render-events.ts
git rm -f src/services/playback/*.test.ts 2>/dev/null || true
grep -rn "services/playback/plan\|services/export/render-events\|PlaybackController" src/ || echo "no stale references"
```

- [ ] **Step 5: Retire the platform registry**

`src/platform/registry.ts` exists only to hold the playback engine, which now belongs to `music_player`'s own singleton. Delete it and its `initializeMusicPlatform`/`getMusicPlatform`/`resetMusicPlatform` exports, and remove them from `src/index.ts`.

- [ ] **Step 6: Verify**

```bash
cd ~/projects/music_player && bun run clean && bun run build
rsync -a --delete dist/ ~/projects/music_lib/node_modules/@sudobility/music_player/dist/
cp package.json ~/projects/music_lib/node_modules/@sudobility/music_player/package.json
cd ~/projects/music_lib && bun run verify
```

- [ ] **Step 7: Commit** (only if asked)

```bash
git add -A && git commit -m "refactor: bind the store to music_player through an adapter"
```

---

### Task 7: Strip playback from music_io

**Repo:** `~/projects/music_io`

**Files:**

- Delete: `src/shared/playback/`, `src/web/playback/`, `src/web/audio/{offline-synth,soundfont-render,synth-types}.ts`, `src/rn/playback/`, `src/rn/audio/offline-render.ts`, `src/rn/base64.ts`
- Modify: `src/shared/types.ts`, `src/web/index.ts`, `src/rn/index.ts`, `src/mocks/index.ts`, `src/contract/{platform-contract.ts,no-music-lib.test.ts}`, `package.json`, `CLAUDE.md`

**Interfaces:**

- Produces: a `MusicIo` of exactly `xmlParser`, `audioCodec`, `fileExporter`, `midiInput`. `playback` and `audioRenderer` are gone.

- [ ] **Step 1: Confirm the move, then delete**

```bash
cd ~/projects/music_io
for f in $(ls src/web/playback src/rn/playback src/shared/playback); do
  find ~/projects/music_player/src -name "$f" -print -quit | grep -q . || echo "MISSING IN PLAYER: $f"
done
echo "(silence = every file has a counterpart)"
git rm -r src/shared/playback src/web/playback src/rn/playback
git rm src/web/audio/offline-synth.ts src/web/audio/soundfont-render.ts src/web/audio/synth-types.ts
git rm src/rn/audio/offline-render.ts src/rn/base64.ts
git rm -f src/web/audio/*.test.ts src/rn/audio/*.test.ts src/rn/base64.test.ts 2>/dev/null || true
```

- [ ] **Step 2: Shrink `MusicIo`**

In `src/shared/types.ts`, remove `playback` and `audioRenderer` and their type imports, and extend the doc comment:

```ts
 * Playback is deliberately absent too, as of the music_player split. Making
 * sound needs a platform, but it is a large enough job to be its own package —
 * and it was previously split across three, with the engines here and the
 * transport in music_lib reading the store. What is left here is bytes: audio
 * encoding, file access, XML parsing, and MIDI *input*, which is a device
 * rather than a file.
```

- [ ] **Step 3: Update the three entries and the contract**

Remove `playback:` and `audioRenderer:` from the objects returned by `web/index.ts`, `rn/index.ts` and `mocks/index.ts`, along with their imports and re-exports. Delete the playback and audio-render assertions from `contract/platform-contract.ts`, and `MockPlaybackEngine` from the mocks.

- [ ] **Step 4: Extend the guard**

In `src/contract/no-music-lib.test.ts`, add `@sudobility/music_player` to the forbidden list, with the reason: the two platform packages must not depend on each other, and audio export is orchestrated by the caller precisely so this one never holds a reference to a running synth.

- [ ] **Step 5: Drop the engine peers**

Remove `js-synthesizer` and `react-native-audio-api` from `peerDependencies` and `peerDependenciesMeta` in `package.json` — they belong to `music_player` now. Then `bun install`, and **re-sync `music_types` afterwards**, because the install discards rsynced packages.

- [ ] **Step 6: Verify**

```bash
cd ~/projects/music_io
grep -rn "playback\|PlaybackEngine\|AudioRenderer" src/ --include='*.ts' | grep -v "midi-input\|no-music-lib" || echo "clean"
bun run verify
```

- [ ] **Step 7: Commit** (only if asked)

```bash
git add -A && git commit -m "feat!: playback moves to music_player; music_io keeps files and audio bytes"
```

---

### Task 8: Wire music_app to the player

**Repo:** `~/projects/music_app`

**Files:**

- Modify: `src/config/initialize.ts`, `src/components/layout/AppLayout.tsx`, `src/features/score-editor/{ScoreEditorView.tsx,editing.ts,usePlayback.ts}`, `src/components/transport/TransportBar.tsx`, `src/test/app-services.ts`, `package.json`

- [ ] **Step 1: Add the dependency and install the engine here**

`music_player` declares `js-synthesizer` an optional peer; the app is what installs it. Move it from wherever `music_io` left it and add `@sudobility/music_player`.

- [ ] **Step 2: Initialise the player in the composition root**

In `src/config/initialize.ts`, replace `initializeMusicPlatform({ playback: io.playback })` with `initializeMusicPlayer(createMusicPlayer({ soundfont: {...} }))`, moving the `SoundfontAssets` argument off `createMusicIo` and onto the player. **Order matters and must be commented**: the player is initialised before anything resolves playback, exactly as the old registry comment said.

- [ ] **Step 3: Move the audio export handler**

`AppLayout`'s audio export becomes `renderEvents` + `renderSamples` from `@sudobility/music_player`, then `io.audioCodec` to encode and `io.fileExporter` to save — the app orchestrates, and `music_io` never sees the player. (Phase B collapses the last two into `io.saveAudio`.)

- [ ] **Step 4: Repoint the playback call sites**

`playbackController` → the adapter export from `@sudobility/music_lib`. If Task 6 kept the alias, this step is import-only.

- [ ] **Step 5: Verify and run the e2e**

```bash
cd ~/projects/music_app
bun run verify
lsof -ti:5039,8023 | xargs kill -9 2>/dev/null || true
bun run test:e2e
```

Playback, audio export and the piano keyboard's audition all cross this boundary; the e2e is the only place they run against a real browser. It was 51/51 green before this work started.

- [ ] **Step 6: Commit** (only if asked)

---

### Task 9: Migrate the player-only types

**Repo:** `~/projects/music_types`, `~/projects/music_player`

Left until last on purpose: doing it earlier would break every package at once, whereas by now the only consumers of these types are `music_player` itself and a handful of app components.

**The rule:** a type moves to `music_player` if nothing outside `music_player` references it, and stays in `music_types` otherwise. Decide by grep, not by list.

- [ ] **Step 1: Classify every type in `music_types/src/platform/playback.ts`**

```bash
cd ~/projects
for t in $(grep -oE "^export (type|interface) [A-Za-z]+" music_types/src/platform/playback.ts | awk '{print $3}'); do
  n=$(grep -rl "\b$t\b" music_lib/src music_app/src music_api/src music_io/src music_types/src \
        --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v "platform/playback.ts" | wc -l | tr -d ' ')
  printf "%-26s referenced outside music_player in %s files\n" "$t" "$n"
done
```

Zero → move. Non-zero → stays.

**Known to stay regardless:** `TransportPlaybackState` and `SoundingNote` (app UI and the store read them), and `PerformanceTimeline` / `TimelineSegment` / `TempoConversion`, which are _produced_ by `performanceTimeline()` and `repeatPlayOrder()` in music_types — moving the types alone would make music_types import from music_player, and moving the producers too would pull repeat expansion out of the score model that `music_api` reads.

- [ ] **Step 2: Move the qualifying types into `music_player/src/types.ts`**, delete them from `music_types/src/platform/playback.ts`, and update imports in `music_player`.

- [ ] **Step 3: Verify the whole chain**

```bash
for p in music_types music_player music_io music_lib music_app; do
  (cd ~/projects/$p && bun run verify > /tmp/v_$p.log 2>&1 && echo "OK $p" || echo "FAILED $p")
done
```

- [ ] **Step 4: Commit** (only if asked)

---

### Task 10: Documentation, final verification, publish

- [ ] **Step 1: Write `music_player/CLAUDE.md`**

Its `package.json` already ships one. Cover: the rule (this package makes sound), the engine-takes-a-plan invariant, the live/offline shared-voicing rule and why they must not be split, `applyMix` not rebuilding the queue, and the fact that the caret lives elsewhere on purpose.

- [ ] **Step 2: Update the other CLAUDE.md files**

`music_io`'s charter loses playback; `music_lib`'s gains the adapter and loses the controller; `music_app`'s playback gotchas repoint at `music_player`; `music_types` records the position singleton precedent.

- [ ] **Step 3: Full sweep**

```bash
cd ~/projects && for p in music_types music_codecs music_player music_drawing music_client music_io music_lib music_api music_app; do
  printf "%-14s " "$p"; (cd $p && bun run verify >/dev/null 2>&1 && echo OK || echo FAILED)
done
```

- [ ] **Step 4: Publish** (only when the user explicitly asks)

`scripts/push_all.sh` already carries `music_player` at position 3. Confirm each publish landed with `npm view @sudobility/<pkg> version` rather than trusting the log.

---

## Notes for the executor

- **Tasks 1 and the repo setup are already done.** `music_player` exists at `~/projects/music_player`, is public at `github.com/johnqh/music_player`, has `NPM_TOKEN` and the shared CI workflow, is in `music.code-workspace`, and is in `push_all.sh`. Start at Task 2.
- **Moves must stay moves.** If a moved test needs an edit beyond an import path, a Prettier pass, or a `@vitest-environment` docblock, stop and report — that means the move was not clean.
- **Never `bun install` in a consumer mid-task** without re-syncing afterwards: it reinstalls from the registry and silently discards every rsynced `@sudobility/*` build.
- **The two invariants most easily lost here** are `stop()` before adopting a foreign score (pinned in `AppLayout.test.tsx`) and live/offline sharing one voicing path. Both have tests; if either goes red, the split is wrong, not the test.
- **Never commit or push unless the user asks in that turn.**

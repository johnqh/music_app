# Platform DI via `music_io` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `music_lib` platform-free by moving every platform-bound capability behind an interface in `music_types`, with implementations in a new `@sudobility/music_io` package that serves web and React Native from one import specifier.

**Architecture:** Interfaces (type-only) live in `music_types/src/platform/`. `music_io` implements them twice — `src/web/` and `src/rn/` — and a `react-native` export condition picks the right one at bundle time, exactly as `@sudobility/di` does. `music_lib` holds a registry for the one long-lived singleton (playback) and takes the stateless services as explicit function parameters.

**Tech Stack:** TypeScript (strict, ESM), Bun, Vitest, `tone` (web audio), `react-native-audio-api` (RN audio), `@tonejs/midi` (SMF codec), `fast-xml-parser` (RN XML).

**Spec:** `docs/superpowers/specs/2026-07-31-music-io-platform-di-design.md`

## Global Constraints

- `music_io` has **zero** runtime `dependencies`. Every platform library is an optional `peerDependency`.
- `music_types` stays type-only for these interfaces — it gains no runtime dependency.
- `music_lib`'s final runtime dependencies are exactly: `immer`, `zod`, `vexflow`.
- `music_app` behaviour must be **identical** at the end: 353 unit tests and 13 e2e tests green, no visible change.
- ESM only (`"type": "module"`). Prefer ESM dependencies; `@tonejs/midi` is the one accepted CommonJS exception.
- Every repo has `bun run verify` (typecheck + lint + test + build). It must pass before any commit.
- Do not publish any package until Task 11 confirms web parity. Use `bun link` for cross-repo work, and remove the links before publishing.
- Node/Bun test environment for `music_io`: the `rn` entry is tested with native modules faked. No device or simulator is required by this plan.

---

## File Structure

**`music_types`** (interfaces only)
- Create `src/platform/playback.ts` — `PlaybackEngine`, `PlaybackObserver`, `TransportPlaybackState`
- Create `src/platform/xml.ts` — `XmlElement`, `XmlParser`, `XmlParseError`
- Create `src/platform/file.ts` — `FileExporter`
- Create `src/platform/midi.ts` — `MidiFile` and friends, `MidiCodec`
- Create `src/platform/index.ts` — barrel
- Modify `src/index.ts` — re-export the barrel

**`music_io`** (new package)
- `src/web/index.ts`, `src/rn/index.ts`, `src/mocks/index.ts` — three entries
- `src/web/playback/tone-engine.ts`, `src/web/playback/instruments.ts` — moved from music_lib
- `src/web/xml/xml.web.ts`, `src/web/file/file.web.ts`, `src/shared/midi/codec.tonejs.ts`
- `src/rn/playback/playback.rn.ts`, `src/rn/xml/xml.rn.ts`, `src/rn/file/file.rn.ts`
- `src/contract/platform-contract.ts` — the shared suite every implementation is held to

**`music_lib`**
- Create `src/platform/registry.ts`
- Modify `src/services/playback/controller.ts`, the four adapters, two services, `src/index.ts`, `package.json`
- Delete `src/adapters/tone/`, `src/services/import-export/download.ts`

**`music_app`**
- Modify `src/config/initialize.ts`, `src/components/layout/AppLayout.tsx`, `src/components/dialogs/DeveloperSettingsDialog.tsx`, the two import dialogs

---

## Task 1: Spike — does Tone.js run on `react-native-audio-api`?

This runs first because it is the plan's only genuine unknown. It produces a written answer, not shipped code.

**Files:**
- Create: `~/projects/music_io/spikes/tone-on-rn-audio-api.md`

- [ ] **Step 1: Create the package directory and install the two libraries**

```bash
mkdir -p ~/projects/music_io/spikes && cd ~/projects/music_io
bun init -y
bun add -d tone@^15 react-native-audio-api@latest
```

- [ ] **Step 2: Write a probe that swaps Tone's context for the RN one**

Create `~/projects/music_io/spikes/probe.mjs`:

```js
// Tone.setContext accepts any BaseAudioContext-shaped object. If
// react-native-audio-api's AudioContext satisfies Tone, a PolySynth built on
// it should schedule and render without throwing.
import * as Tone from 'tone';
import { AudioContext } from 'react-native-audio-api';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`OK    ${name}`); }
  catch (e) { results.push(`BREAK ${name} -> ${e.constructor.name}: ${e.message}`); }
};

const ctx = new AudioContext();
check('Tone.setContext(rn ctx)', () => Tone.setContext(ctx));
check('new Tone.PolySynth(Tone.Synth)', () => new Tone.PolySynth(Tone.Synth));
check('new Tone.Gain().toDestination()', () => new Tone.Gain(0.5).toDestination());
check('new Tone.Panner(0)', () => new Tone.Panner(0));
check('new Tone.Filter(800, "lowpass")', () => new Tone.Filter(800, 'lowpass'));
check('Transport.scheduleRepeat', () => Tone.getTransport().scheduleRepeat(() => {}, 0.03));
console.log(results.join('\n'));
```

- [ ] **Step 3: Run it and record the output verbatim**

```bash
cd ~/projects/music_io && bun spikes/probe.mjs 2>&1 | tee spikes/probe-output.txt
```

Expected: a list of `OK`/`BREAK` lines. `react-native-audio-api` may fail to import outside a native runtime — if so, that is itself the finding; record it and move to Step 4's fallback.

- [ ] **Step 4: Write the finding**

Create `spikes/tone-on-rn-audio-api.md` with three sections: **What ran** (the command and verbatim output), **Verdict** (one of: Tone works unchanged / Tone works with adaptation X / Tone cannot run here), and **Consequence for Task 12** (either "Task 12 reuses `TonePlaybackEngine` with a swapped context" or "Task 12 implements `PlaybackEngine` directly against `react-native-audio-api`'s nodes").

If `react-native-audio-api` cannot be imported outside a native runtime, the verdict is **"unproven outside a device"**, and Task 12 must implement `PlaybackEngine` directly rather than betting on Tone — the safer branch.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/music_io && git init && git add -A
git commit -m "spike: whether Tone.js runs on react-native-audio-api"
```

---

## Task 2: Platform interfaces in `music_types`

**Files:**
- Create: `~/projects/music_types/src/platform/playback.ts`, `xml.ts`, `file.ts`, `midi.ts`, `index.ts`
- Create: `~/projects/music_types/src/platform/platform.test.ts`
- Modify: `~/projects/music_types/src/index.ts`

**Interfaces:**
- Consumes: `Score`, `ScoreRange` (already exported from `music_types`).
- Produces: everything below, imported by every later task.

- [ ] **Step 1: Write the failing test**

Create `src/platform/platform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MidiFile, PlaybackEngine, XmlElement } from './index.js';
import { XmlParseError } from './index.js';

describe('platform interfaces', () => {
  it('XmlParseError is a real Error subclass, so callers can catch it by type', () => {
    const error = new XmlParseError('bad');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('XmlParseError');
  });

  it('a real DOM Element structurally satisfies XmlElement', () => {
    // The whole reason the interface is only five members: the web parser
    // returns real DOM Elements and must need no adapter.
    const doc = new DOMParser().parseFromString('<a b="c">d</a>', 'application/xml');
    const element: XmlElement = doc.documentElement;
    expect(element.tagName).toBe('a');
    expect(element.getAttribute('b')).toBe('c');
    expect(element.textContent).toBe('d');
  });

  it('MidiFile keys controlChanges by CC number, as importers look them up', () => {
    const file: MidiFile = {
      header: { ppq: 480, tempos: [], timeSignatures: [] },
      tracks: [
        {
          name: 'T', channel: 0, instrument: { number: 0 },
          notes: [], controlChanges: { 7: [{ number: 7, ticks: 0, value: 1 }] },
          durationTicks: 0, durationSeconds: 0,
        },
      ],
      duration: 0,
    };
    expect(file.tracks[0].controlChanges[7]?.[0].value).toBe(1);
  });

  it('PlaybackEngine is implementable with no platform imports', () => {
    const engine: Partial<PlaybackEngine> = { pause: () => {}, stop: () => {} };
    expect(typeof engine.stop).toBe('function');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/projects/music_types && bunx vitest run src/platform/platform.test.ts
```
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Write `src/platform/playback.ts`**

Move the contents of `music_lib/src/services/playback/types.ts` verbatim, changing only the `ScoreRange` import to come from the local package root:

```ts
/**
 * Playback engine contract. Lives here rather than in music_lib because the
 * implementations live in music_io and both sides need the type without
 * either depending on the other.
 */
import type { Score, ScoreRange } from '../index.js';

export type TransportPlaybackState = 'stopped' | 'playing' | 'paused';

export type PlaybackObserver = {
  onPositionTick(tick: number): void;
  onActiveNotes(noteIds: string[]): void;
  onStateChange(state: TransportPlaybackState): void;
};

export interface PlaybackEngine {
  initialize(): Promise<void>;
  loadScore(score: Score): Promise<void>;
  play(fromTick?: number): Promise<void>;
  pause(): void;
  stop(): void;
  seek(tick: number): void;
  setTempoMultiplier(multiplier: number): void;
  setLoop(range: ScoreRange | null): void;
  setTrackMute(trackId: string, muted: boolean): void;
  setTrackSolo(trackId: string, solo: boolean): void;
  setMetronome(enabled: boolean): void;
  setMasterVolume(volume: number): void;
  setObserver(observer: PlaybackObserver | null): void;
  dispose(): void;
}
```

- [ ] **Step 4: Write `src/platform/xml.ts`**

```ts
/**
 * The XML surface the MusicXML importer actually uses — five members, chosen
 * so a real DOM `Element` satisfies it structurally and the web parser needs
 * no adapter at all.
 */
export interface XmlElement {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly children: ArrayLike<XmlElement>;
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): ArrayLike<XmlElement>;
}

/** Thrown for input that is not well-formed XML. */
export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlParseError';
  }
}

export interface XmlParser {
  /** Parses a document and returns its root element. Throws `XmlParseError` on malformed input. */
  parse(text: string): XmlElement;
}
```

- [ ] **Step 5: Write `src/platform/file.ts`**

```ts
/**
 * Saving a generated file. Takes bytes or text, never a `Blob` — `Blob` is a
 * web concept and would leak into the React Native signature.
 */
export interface FileExporter {
  save(name: string, data: Uint8Array | string, mimeType: string): Promise<void>;
}
```

- [ ] **Step 6: Write `src/platform/midi.ts`**

```ts
/**
 * A neutral Standard MIDI File model, shaped by exactly what the three MIDI
 * adapters read and write.
 */
export type MidiNote = { midi: number; ticks: number; durationTicks: number; velocity: number };
export type MidiControlChange = { number: number; ticks: number; value: number };
export type MidiTempoEvent = { ticks: number; bpm: number };
export type MidiTimeSignatureEvent = { ticks: number; timeSignature: [number, number] };

export type MidiTrackData = {
  name: string;
  channel: number;
  instrument: { number: number; name?: string };
  notes: MidiNote[];
  /**
   * Keyed by CC number, not a flat list: the importer looks up sustain (64),
   * volume (7) and pan (10) directly, and a flat array would force every
   * consumer to re-group them.
   */
  controlChanges: Record<number, MidiControlChange[]>;
  durationTicks: number;
  durationSeconds: number;
};

export type MidiFile = {
  header: { ppq: number; name?: string; tempos: MidiTempoEvent[]; timeSignatures: MidiTimeSignatureEvent[] };
  tracks: MidiTrackData[];
  /** Longest track duration in seconds; `analyzeMidi` reports it. */
  duration: number;
};

export interface MidiCodec {
  decode(data: ArrayBuffer): MidiFile;
  encode(file: MidiFile): Uint8Array;
}
```

- [ ] **Step 7: Write `src/platform/index.ts` and re-export from the package root**

```ts
// src/platform/index.ts
export * from './playback.js';
export * from './xml.js';
export * from './file.js';
export * from './midi.js';
```

Append to `src/index.ts`:

```ts
// ---------------------------------------------------------------------------
// 10. Platform interfaces (implementations live in @sudobility/music_io)
// ---------------------------------------------------------------------------
export * from './platform/index.js';
```

- [ ] **Step 8: Run the test and the full verify**

```bash
cd ~/projects/music_types && bunx vitest run src/platform/platform.test.ts && bun run verify
```
Expected: PASS, then verify clean. The DOM test needs jsdom — if `vitest.config.ts` has no `environment: 'jsdom'`, add `// @vitest-environment jsdom` as the first line of `platform.test.ts`.

- [ ] **Step 9: Bump, commit, publish**

```bash
cd ~/projects/music_types && npm version minor --no-git-tag-version
git add -A && git commit -m "feat: platform interfaces for playback, XML, file export and MIDI

Implementations live in @sudobility/music_io; these are the contracts both
sides share. The XML surface is deliberately five members, so a real DOM
Element satisfies it structurally and the web parser needs no adapter."
npm publish && git push
```

---

## Task 3: Scaffold the `music_io` package

**Files:**
- Create: `~/projects/music_io/{package.json,tsconfig.json,tsconfig.build.json,eslint.config.js,vitest.config.ts,.gitignore,CLAUDE.md}`
- Create: `~/projects/music_io/src/{web,rn,mocks,shared,contract}/index.ts`

**Interfaces:**
- Consumes: `@sudobility/music_types` platform interfaces from Task 2.
- Produces: `MusicIo` type and the three entry points every later task fills in.

- [ ] **Step 1: Write `package.json`**

```jsonc
{
  "name": "@sudobility/music_io",
  "version": "0.1.0",
  "description": "Platform implementations for ScoreSmith: playback, XML parsing, file export and MIDI codecs, for web and React Native",
  "type": "module",
  "exports": {
    ".":       { "react-native": { "import": "./dist/rn/index.js",  "types": "./dist/rn/index.d.ts" },
                 "default":      { "import": "./dist/web/index.js", "types": "./dist/web/index.d.ts" } },
    "./web":   { "import": "./dist/web/index.js",   "types": "./dist/web/index.d.ts" },
    "./rn":    { "import": "./dist/rn/index.js",    "types": "./dist/rn/index.d.ts" },
    "./mocks": { "import": "./dist/mocks/index.js", "types": "./dist/mocks/index.d.ts" }
  },
  "files": ["dist/**/*", "CLAUDE.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "rimraf dist",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "verify": "bun run typecheck && bun run lint && bun run test && bun run build",
    "prepublishOnly": "bun run clean && bun run verify"
  },
  "license": "BUSL-1.1",
  "dependencies": {},
  "peerDependencies": {
    "@sudobility/music_types": "^0.2.0",
    "@tonejs/midi": "^2.0.28",
    "fast-xml-parser": "^5.10.1",
    "react-native-audio-api": ">=0.13.0",
    "tone": "^15.0.0"
  },
  "peerDependenciesMeta": {
    "fast-xml-parser":        { "optional": true },
    "react-native-audio-api": { "optional": true },
    "tone":                   { "optional": true }
  }
}
```

Set `@sudobility/music_types` to whatever version Task 2 published.

- [ ] **Step 2: Copy the tooling config from `music_types`**

```bash
cd ~/projects/music_io
cp ~/projects/music_types/tsconfig.json ~/projects/music_types/eslint.config.js ~/projects/music_types/vitest.config.ts .
cp ~/projects/music_types/tsconfig.esm.json tsconfig.build.json 2>/dev/null || true
printf 'node_modules\ndist\n' > .gitignore
bun add -d typescript vitest eslint rimraf @sudobility/music_types tone @tonejs/midi fast-xml-parser
```

Edit `tsconfig.build.json` so `include` is `["src"]`, `exclude` covers `**/*.test.ts`, and `outDir` is `dist`.

- [ ] **Step 3: Write the shared bundle type at `src/shared/types.ts`**

```ts
import type { FileExporter, MidiCodec, PlaybackEngine, XmlParser } from '@sudobility/music_types';

/** Everything a platform provides. `createMusicIo()` returns one of these from each entry. */
export type MusicIo = {
  playback: PlaybackEngine;
  xmlParser: XmlParser;
  midiCodec: MidiCodec;
  fileExporter: FileExporter;
};
```

- [ ] **Step 4: Write placeholder entries that fail loudly**

`src/web/index.ts`, `src/rn/index.ts` and `src/mocks/index.ts` each:

```ts
export type { MusicIo } from '../shared/types.js';
export function createMusicIo(): never {
  throw new Error('createMusicIo: not implemented yet');
}
```

- [ ] **Step 5: Write the failing test that proves the export map resolves**

Create `src/entries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('entry points', () => {
  it('every entry exports createMusicIo', async () => {
    for (const entry of ['./web/index.js', './rn/index.js', './mocks/index.js']) {
      const mod = await import(entry);
      expect(typeof mod.createMusicIo, entry).toBe('function');
    }
  });
});
```

- [ ] **Step 6: Run verify**

```bash
cd ~/projects/music_io && bun run verify
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: scaffold music_io with web, rn and mocks entries

One package, three entries, and a react-native export condition so Metro and
Vite each resolve their own implementation from the same import specifier."
```

---

## Task 4: Web playback — move `TonePlaybackEngine` into `music_io`

**Files:**
- Create: `~/projects/music_io/src/web/playback/tone-engine.ts`, `instruments.ts`, `schedule.ts`, `midi.ts` (moved from music_lib)
- Create: `~/projects/music_io/src/web/playback/tone-engine.test.ts` etc. (moved test files)
- Modify: `~/projects/music_io/src/web/index.ts`

**Interfaces:**
- Consumes: `PlaybackEngine` from Task 2, `MusicIo` from Task 3.
- Produces: `class TonePlaybackEngine implements PlaybackEngine`, exported from `@sudobility/music_io/web`.

- [ ] **Step 1: Copy the four adapter files and their tests across**

```bash
cd ~/projects/music_io && mkdir -p src/web/playback
cp ~/projects/music_lib/src/adapters/tone/{tone-engine,instruments,schedule,midi}.ts src/web/playback/
cp ~/projects/music_lib/src/adapters/tone/{tone-engine,instruments,schedule,midi}.test.ts src/web/playback/
```

- [ ] **Step 2: Fix the imports**

In every copied file, replace imports that reached into `music_lib`'s tree with package imports. The mechanical rules:
- `from '../../domain/...'` and `from '../../services/playback/types.js'` → `from '@sudobility/music_types'`
- Relative imports between the four copied files keep their `./name.js` form.

Run `bunx tsc --noEmit` and fix each reported path until clean. Anything that cannot be satisfied from `@sudobility/music_types` is domain logic that must **stay** in `music_lib` — do not copy it; import it from `@sudobility/music_lib` instead and add that as an optional peer dependency.

- [ ] **Step 3: Export it from the web entry**

`src/web/index.ts`:

```ts
import { TonePlaybackEngine } from './playback/tone-engine.js';
import type { MusicIo } from '../shared/types.js';

export { TonePlaybackEngine };
export type { MusicIo };

export function createMusicIo(): MusicIo {
  throw new Error('createMusicIo: web entry incomplete until Tasks 5 and 6');
}
```

- [ ] **Step 4: Run the moved tests**

```bash
cd ~/projects/music_io && bunx vitest run src/web/playback
```
Expected: PASS, with the same counts these files had in `music_lib`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: move the Tone playback engine into music_io/web

It is the only thing in the family that imports Tone.js, so it is the main
reason music_lib could not be used from React Native."
```

---

## Task 5: Web XML parser and file exporter

**Files:**
- Create: `~/projects/music_io/src/web/xml/xml.web.ts`, `src/web/xml/xml.web.test.ts`
- Create: `~/projects/music_io/src/web/file/file.web.ts`, `src/web/file/file.web.test.ts`
- Modify: `~/projects/music_io/src/web/index.ts`

**Interfaces:**
- Consumes: `XmlParser`, `XmlElement`, `XmlParseError`, `FileExporter` from Task 2.
- Produces: `class WebXmlParser implements XmlParser`, `class WebFileExporter implements FileExporter`.

- [ ] **Step 1: Write the failing tests**

`src/web/xml/xml.web.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { XmlParseError } from '@sudobility/music_types';
import { WebXmlParser } from './xml.web.js';

describe('WebXmlParser', () => {
  it('returns the root element', () => {
    const root = new WebXmlParser().parse('<score-partwise version="4.0"><part id="P1"/></score-partwise>');
    expect(root.tagName).toBe('score-partwise');
    expect(root.getAttribute('version')).toBe('4.0');
    expect(root.children.length).toBe(1);
  });

  it('throws XmlParseError on malformed input rather than returning a parsererror document', () => {
    // DOMParser reports failure by *returning* a <parsererror> document rather
    // than throwing, so a naive wrapper hands back a bogus root.
    expect(() => new WebXmlParser().parse('<a><b></a>')).toThrow(XmlParseError);
  });
});
```

`src/web/file/file.web.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { WebFileExporter } from './file.web.js';

describe('WebFileExporter', () => {
  it('downloads via an object URL and cleans it up', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await new WebFileExporter().save('score.mid', new Uint8Array([1, 2]), 'audio/midi');

    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(document.querySelector('a')).toBeNull(); // anchor removed again
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd ~/projects/music_io && bunx vitest run src/web/xml src/web/file
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/web/xml/xml.web.ts`**

```ts
import { XmlParseError } from '@sudobility/music_types';
import type { XmlElement, XmlParser } from '@sudobility/music_types';

/**
 * `DOMParser` returns real DOM `Element`s, which satisfy `XmlElement`
 * structurally — so there is no adapter here, only the error handling
 * `DOMParser` does not do for us.
 */
export class WebXmlParser implements XmlParser {
  parse(text: string): XmlElement {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    // DOMParser signals failure by returning a <parsererror> document rather
    // than throwing, so this check is the only thing standing between a
    // malformed file and a confusing downstream failure.
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new XmlParseError('The input is not well-formed XML.');
    }
    if (!doc.documentElement) throw new XmlParseError('The XML document has no root element.');
    return doc.documentElement;
  }
}
```

- [ ] **Step 4: Write `src/web/file/file.web.ts`**

```ts
import type { FileExporter } from '@sudobility/music_types';

/** Object URL + synthetic anchor click — the standard browser download dance. */
export class WebFileExporter implements FileExporter {
  async save(name: string, data: Uint8Array | string, mimeType: string): Promise<void> {
    const blob = new Blob([data as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
```

- [ ] **Step 5: Run the tests**

```bash
cd ~/projects/music_io && bunx vitest run src/web/xml src/web/file
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: web XML parser and file exporter

DOMParser reports malformed input by returning a <parsererror> document
rather than throwing, so the parser turns that into an XmlParseError."
```

---

## Task 6: The `@tonejs/midi` codec, shared by both platforms

**Files:**
- Create: `~/projects/music_io/src/shared/midi/codec.tonejs.ts`, `codec.tonejs.test.ts`
- Modify: `~/projects/music_io/src/web/index.ts`

**Interfaces:**
- Consumes: `MidiCodec`, `MidiFile`, `MidiTrackData` from Task 2.
- Produces: `class ToneJsMidiCodec implements MidiCodec`, and a complete `createMusicIo()` for web.

- [ ] **Step 1: Write the failing round-trip test**

`src/shared/midi/codec.tonejs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MidiFile } from '@sudobility/music_types';
import { ToneJsMidiCodec } from './codec.tonejs.js';

const file: MidiFile = {
  header: { ppq: 480, name: 'T', tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }] },
  tracks: [{
    name: 'Piano', channel: 0, instrument: { number: 0 },
    notes: [{ midi: 60, ticks: 0, durationTicks: 480, velocity: 0.8 }],
    controlChanges: { 7: [{ number: 7, ticks: 0, value: 1 }], 10: [{ number: 10, ticks: 0, value: 0.5 }] },
    durationTicks: 480, durationSeconds: 0.5,
  }],
  duration: 0.5,
};

describe('ToneJsMidiCodec', () => {
  it('round-trips a file through encode and decode', () => {
    const codec = new ToneJsMidiCodec();
    const decoded = codec.decode(codec.encode(file).buffer as ArrayBuffer);

    expect(decoded.header.ppq).toBe(480);
    expect(decoded.header.tempos[0].bpm).toBeCloseTo(120, 1);
    expect(decoded.tracks[0].notes[0].midi).toBe(60);
    expect(decoded.tracks[0].notes[0].durationTicks).toBe(480);
  });

  it('preserves control changes keyed by CC number', () => {
    // The importer looks up sustain (64), volume (7) and pan (10) directly by
    // number; flattening them would silently break volume and pan on import.
    const decoded = new ToneJsMidiCodec().decode(new ToneJsMidiCodec().encode(file).buffer as ArrayBuffer);
    expect(decoded.tracks[0].controlChanges[7]?.[0].value).toBeCloseTo(1, 2);
    expect(decoded.tracks[0].controlChanges[10]?.[0].value).toBeCloseTo(0.5, 2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/projects/music_io && bunx vitest run src/shared/midi
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/shared/midi/codec.tonejs.ts`**

```ts
import { Midi } from '@tonejs/midi';
import type { MidiCodec, MidiControlChange, MidiFile, MidiTrackData } from '@sudobility/music_types';

/**
 * `@tonejs/midi` behind the neutral model.
 *
 * Shared by both platform entries on purpose: SMF encoding is byte
 * manipulation with no platform APIs, and this library already works under
 * Metro. The seam exists so music_lib carries no MIDI dependency and a future
 * ESM codec can replace this without music_lib changing.
 */
export class ToneJsMidiCodec implements MidiCodec {
  decode(data: ArrayBuffer): MidiFile {
    const midi = new Midi(data);
    return {
      header: {
        ppq: midi.header.ppq,
        name: midi.header.name,
        tempos: midi.header.tempos.map((t) => ({ ticks: t.ticks, bpm: t.bpm })),
        timeSignatures: midi.header.timeSignatures.map((t) => ({
          ticks: t.ticks,
          timeSignature: [t.timeSignature[0], t.timeSignature[1]] as [number, number],
        })),
      },
      tracks: midi.tracks.map((track): MidiTrackData => ({
        name: track.name,
        channel: track.channel,
        instrument: { number: track.instrument.number, name: track.instrument.name },
        notes: track.notes.map((n) => ({
          midi: n.midi, ticks: n.ticks, durationTicks: n.durationTicks, velocity: n.velocity,
        })),
        controlChanges: Object.fromEntries(
          Object.entries(track.controlChanges).map(([number, events]) => [
            Number(number),
            (events ?? []).map((cc): MidiControlChange => ({ number: cc.number, ticks: cc.ticks, value: cc.value })),
          ]),
        ),
        durationTicks: track.durationTicks,
        durationSeconds: track.duration,
      })),
      duration: midi.duration,
    };
  }

  encode(file: MidiFile): Uint8Array {
    const midi = new Midi();
    midi.header.fromJSON({
      name: file.header.name ?? '',
      ppq: file.header.ppq,
      meta: [],
      tempos: file.header.tempos.map((t) => ({ ticks: t.ticks, bpm: t.bpm })),
      timeSignatures: file.header.timeSignatures.map((t) => ({ ticks: t.ticks, timeSignature: t.timeSignature })),
      keySignatures: [],
    });

    for (const track of file.tracks) {
      const midiTrack = midi.addTrack();
      midiTrack.name = track.name;
      midiTrack.channel = track.channel;
      midiTrack.instrument.number = track.instrument.number;
      for (const events of Object.values(track.controlChanges)) {
        for (const cc of events) midiTrack.addCC({ number: cc.number, ticks: cc.ticks, value: cc.value });
      }
      for (const note of track.notes) {
        midiTrack.addNote({ midi: note.midi, ticks: note.ticks, durationTicks: note.durationTicks, velocity: note.velocity });
      }
    }
    return midi.toArray();
  }
}
```

- [ ] **Step 4: Complete the web entry**

`src/web/index.ts`:

```ts
import { TonePlaybackEngine } from './playback/tone-engine.js';
import { WebXmlParser } from './xml/xml.web.js';
import { WebFileExporter } from './file/file.web.js';
import { ToneJsMidiCodec } from '../shared/midi/codec.tonejs.js';
import type { MusicIo } from '../shared/types.js';

export { TonePlaybackEngine, WebXmlParser, WebFileExporter, ToneJsMidiCodec };
export type { MusicIo };

export function createMusicIo(): MusicIo {
  return {
    playback: new TonePlaybackEngine(),
    xmlParser: new WebXmlParser(),
    midiCodec: new ToneJsMidiCodec(),
    fileExporter: new WebFileExporter(),
  };
}
```

- [ ] **Step 5: Run verify**

```bash
cd ~/projects/music_io && bun run verify
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: MIDI codec behind the neutral model, completing the web entry

controlChanges stay keyed by CC number because the importer looks up sustain,
volume and pan directly by number."
```

---

## Task 7: Mocks entry and the shared contract suite

**Files:**
- Create: `~/projects/music_io/src/mocks/{playback.mock.ts,xml.mock.ts,file.mock.ts,midi.mock.ts,index.ts}`
- Create: `~/projects/music_io/src/contract/platform-contract.ts`, `src/contract/web.contract.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `createMusicIo()` from `@sudobility/music_io/mocks`; `runPlatformContract(name, factory)` used by web, rn and mocks.

- [ ] **Step 1: Write the contract suite**

`src/contract/platform-contract.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MusicIo } from '../shared/types.js';

/**
 * One suite every implementation is held to, so web, rn and mocks cannot
 * drift into being tested differently.
 */
export function runPlatformContract(name: string, createIo: () => MusicIo): void {
  describe(`${name}: platform contract`, () => {
    it('provides all four services', () => {
      const io = createIo();
      expect(io.playback).toBeDefined();
      expect(io.xmlParser).toBeDefined();
      expect(io.midiCodec).toBeDefined();
      expect(io.fileExporter).toBeDefined();
    });

    it('parses XML and exposes the root element', () => {
      const root = createIo().xmlParser.parse('<score-partwise version="4.0"><part id="P1"/></score-partwise>');
      expect(root.tagName).toBe('score-partwise');
      expect(root.getAttribute('version')).toBe('4.0');
      expect(Array.from(root.children)[0].tagName).toBe('part');
    });

    it('rejects malformed XML rather than returning a broken root', () => {
      expect(() => createIo().xmlParser.parse('<a><b></a>')).toThrow();
    });

    it('round-trips MIDI through the codec', () => {
      const io = createIo();
      const encoded = io.midiCodec.encode({
        header: { ppq: 480, tempos: [{ ticks: 0, bpm: 120 }], timeSignatures: [{ ticks: 0, timeSignature: [4, 4] }] },
        tracks: [{
          name: 'T', channel: 0, instrument: { number: 0 },
          notes: [{ midi: 60, ticks: 0, durationTicks: 480, velocity: 0.8 }],
          controlChanges: {}, durationTicks: 480, durationSeconds: 0.5,
        }],
        duration: 0.5,
      });
      expect(io.midiCodec.decode(encoded.buffer as ArrayBuffer).tracks[0].notes[0].midi).toBe(60);
    });

    it('implements the whole PlaybackEngine interface', () => {
      const engine = createIo().playback;
      for (const method of [
        'initialize', 'loadScore', 'play', 'pause', 'stop', 'seek', 'setTempoMultiplier',
        'setLoop', 'setTrackMute', 'setTrackSolo', 'setMetronome', 'setMasterVolume',
        'setObserver', 'dispose',
      ]) {
        expect(typeof (engine as unknown as Record<string, unknown>)[method], method).toBe('function');
      }
    });
  });
}
```

- [ ] **Step 2: Write the mocks**

`src/mocks/index.ts`:

```ts
import { XmlParseError } from '@sudobility/music_types';
import type { FileExporter, MidiFile, PlaybackEngine, PlaybackObserver, XmlElement, XmlParser, MidiCodec } from '@sudobility/music_types';
import { ToneJsMidiCodec } from '../shared/midi/codec.tonejs.js';
import type { MusicIo } from '../shared/types.js';

/** Records calls; does nothing. What music_lib's tests inject. */
export class MockPlaybackEngine implements PlaybackEngine {
  readonly calls: string[] = [];
  observer: PlaybackObserver | null = null;
  private record(name: string): void { this.calls.push(name); }
  async initialize(): Promise<void> { this.record('initialize'); }
  async loadScore(): Promise<void> { this.record('loadScore'); }
  async play(): Promise<void> { this.record('play'); }
  pause(): void { this.record('pause'); }
  stop(): void { this.record('stop'); }
  seek(): void { this.record('seek'); }
  setTempoMultiplier(): void { this.record('setTempoMultiplier'); }
  setLoop(): void { this.record('setLoop'); }
  setTrackMute(): void { this.record('setTrackMute'); }
  setTrackSolo(): void { this.record('setTrackSolo'); }
  setMetronome(): void { this.record('setMetronome'); }
  setMasterVolume(): void { this.record('setMasterVolume'); }
  setObserver(observer: PlaybackObserver | null): void { this.observer = observer; this.record('setObserver'); }
  dispose(): void { this.record('dispose'); }
}

/** Minimal XmlElement over a tiny hand-rolled parse, so mocks need no DOM. */
export class MockXmlParser implements XmlParser {
  parse(text: string): XmlElement {
    if (!/^\s*<[^>]+>/.test(text) || !isBalanced(text)) throw new XmlParseError('malformed');
    return buildElement(text);
  }
}

export class MockFileExporter implements FileExporter {
  readonly saved: Array<{ name: string; mimeType: string }> = [];
  async save(name: string, _data: Uint8Array | string, mimeType: string): Promise<void> {
    this.saved.push({ name, mimeType });
  }
}

export function createMusicIo(): MusicIo {
  return {
    playback: new MockPlaybackEngine(),
    xmlParser: new MockXmlParser(),
    midiCodec: new ToneJsMidiCodec() as MidiCodec,
    fileExporter: new MockFileExporter(),
  };
}
export type { MusicIo, MidiFile };
```

Implement `isBalanced` and `buildElement` in `src/mocks/xml.mock.ts` as a ~40-line recursive-descent reader supporting elements, attributes and text — enough for the contract suite's two fixtures. It does not need to be a general XML parser and must not be exported outside `mocks`.

- [ ] **Step 3: Run the contract against web and mocks**

`src/contract/web.contract.test.ts`:

```ts
// @vitest-environment jsdom
import { createMusicIo as createWebIo } from '../web/index.js';
import { createMusicIo as createMockIo } from '../mocks/index.js';
import { runPlatformContract } from './platform-contract.js';

runPlatformContract('web', createWebIo);
runPlatformContract('mocks', createMockIo);
```

```bash
cd ~/projects/music_io && bunx vitest run src/contract
```
Expected: PASS for both.

- [ ] **Step 4: Verify, commit and publish**

```bash
cd ~/projects/music_io && bun run verify
git add -A && git commit -m "feat: mocks entry and a shared platform contract suite

One suite every implementation is held to, so web, rn and mocks cannot drift
into being tested differently."
npm publish
```

---

## Task 8: `music_lib` — the platform registry

**Files:**
- Create: `~/projects/music_lib/src/platform/registry.ts`, `src/platform/registry.test.ts`
- Modify: `~/projects/music_lib/src/services/playback/controller.ts:395-400`
- Modify: `~/projects/music_lib/src/index.ts`

**Interfaces:**
- Consumes: `PlaybackEngine` from `@sudobility/music_types`.
- Produces: `initializeMusicPlatform(platform: MusicPlatform): void`, `getMusicPlatform(): MusicPlatform`, `resetMusicPlatform(): void`, `type MusicPlatform = { playback: PlaybackEngine }`, and `class PlatformNotInitializedError extends Error`.

- [ ] **Step 1: Write the failing test**

`src/platform/registry.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { MockPlaybackEngine } from '@sudobility/music_io/mocks';
import { PlatformNotInitializedError, getMusicPlatform, initializeMusicPlatform, resetMusicPlatform } from './registry.js';

afterEach(() => resetMusicPlatform());

describe('music platform registry', () => {
  it('returns what was registered', () => {
    const playback = new MockPlaybackEngine();
    initializeMusicPlatform({ playback });
    expect(getMusicPlatform().playback).toBe(playback);
  });

  it('names itself when nothing is registered, rather than failing later with a null', () => {
    expect(() => getMusicPlatform()).toThrow(PlatformNotInitializedError);
    expect(() => getMusicPlatform()).toThrow(/initializeMusicPlatform/);
  });

  it('lets a test replace the platform', () => {
    initializeMusicPlatform({ playback: new MockPlaybackEngine() });
    const replacement = new MockPlaybackEngine();
    initializeMusicPlatform({ playback: replacement });
    expect(getMusicPlatform().playback).toBe(replacement);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/projects/music_lib && bunx vitest run src/platform/registry.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/platform/registry.ts`**

```ts
/**
 * The one platform service music_lib holds globally.
 *
 * Only playback is here, because only playback is a long-lived singleton. The
 * stateless services (XML parsing, MIDI codec) are passed to the pure adapter
 * functions that need them, which keeps those functions testable without any
 * global setup.
 */
import type { PlaybackEngine } from '@sudobility/music_types';

export type MusicPlatform = { playback: PlaybackEngine };

export class PlatformNotInitializedError extends Error {
  constructor() {
    super('The music platform has not been initialized. Call initializeMusicPlatform() from your app composition root before using playback.');
    this.name = 'PlatformNotInitializedError';
  }
}

let platform: MusicPlatform | null = null;

export function initializeMusicPlatform(next: MusicPlatform): void {
  platform = next;
}

export function getMusicPlatform(): MusicPlatform {
  if (!platform) throw new PlatformNotInitializedError();
  return platform;
}

/** Test-only: clears the registry so suites do not leak into each other. */
export function resetMusicPlatform(): void {
  platform = null;
}
```

- [ ] **Step 4: Rewire the controller singleton**

In `src/services/playback/controller.ts`, delete the `TonePlaybackEngine` import and change `realController()`:

```ts
function realController(): PlaybackController {
  if (!singleton) {
    // The engine comes from the registry rather than being constructed here:
    // this file must not know which platform it is running on.
    singleton = createPlaybackController(getMusicPlatform().playback, useAppStore);
  }
  return singleton;
}
```

Add `import { getMusicPlatform } from '../../platform/registry.js';`. The lazy `Proxy` around `singleton` stays exactly as it is — that is what keeps every existing `playbackController.*` call site working untouched.

- [ ] **Step 5: Export the registry**

Add to `src/index.ts`, beside the other service exports:

```ts
// platform
export * from './platform/registry.js';
```

- [ ] **Step 6: Link music_io and run the tests**

```bash
cd ~/projects/music_io && bun link
cd ~/projects/music_lib && bun link @sudobility/music_io
bunx vitest run src/platform src/services/playback
```
Expected: PASS. Playback controller tests that previously got a real Tone engine now need `initializeMusicPlatform({ playback: new MockPlaybackEngine() })` in a `beforeEach` — add it where they fail.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: platform registry, so the controller stops constructing Tone

The lazy Proxy singleton is unchanged, which is what keeps every existing
playbackController call site working without an edit."
```

---

## Task 9: `music_lib` — MusicXML import takes an `XmlParser`

**Files:**
- Modify: `~/projects/music_lib/src/adapters/musicxml/import.ts` (13 internal signatures + the entry point)
- Modify: `~/projects/music_lib/src/adapters/musicxml/import.test.ts`
- Modify: `~/projects/music_lib/src/services/import-export/musicxml-service.ts`

**Interfaces:**
- Consumes: `XmlParser`, `XmlElement` from `@sudobility/music_types`; `MockXmlParser` from `@sudobility/music_io/mocks`.
- Produces: `importMusicXml(xmlText: string, parser: XmlParser): MusicXmlImportResult`.

- [ ] **Step 1: Update the test to pass a parser**

In `src/adapters/musicxml/import.test.ts`, add at the top:

```ts
import { WebXmlParser } from '@sudobility/music_io/web';
const parser = new WebXmlParser();
```

and change every `importMusicXml(xml)` call to `importMusicXml(xml, parser)`. Add one new test:

```ts
it('rejects malformed XML through the injected parser', () => {
  expect(() => importMusicXml('<score-partwise><part></score-partwise>', parser)).toThrow();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/projects/music_lib && bunx vitest run src/adapters/musicxml
```
Expected: FAIL — `importMusicXml` takes one argument.

- [ ] **Step 3: Change the entry point**

```ts
export function importMusicXml(xmlText: string, parser: XmlParser): MusicXmlImportResult {
  const root = parser.parse(xmlText);
  if (root.tagName !== 'score-partwise') {
    throw new Error(
      `importMusicXml: expected a <score-partwise> root element, found <${root.tagName}>. score-timewise documents are not supported.`,
    );
  }

  const warnings = new WarningCollector();
  const partMeta = parsePartList(root);
  // ...unchanged from here, with `doc.documentElement` replaced by `root`
```

The `parsererror` check is gone — that is now the web parser's job, and it throws `XmlParseError`.

- [ ] **Step 4: Retype the 13 internal helpers**

Replace `Element` with `XmlElement` and `Document` with `XmlElement` throughout `import.ts`. The affected signatures are at lines 57, 64, 68, 73, 98, 133, 161, 246, 277, 303, 347, 474 and 589. `parsePartList(doc: Document)` becomes `parsePartList(root: XmlElement)`; inside it, replace `doc.getElementsByTagName(...)` with `root.getElementsByTagName(...)`.

`directChildren` returns `Element[]`; change it to `XmlElement[]` and make the body `Array.from(el.children).filter((c) => c.tagName === tagName)`.

Add the import: `import type { XmlElement, XmlParser } from '@sudobility/music_types';`

- [ ] **Step 5: Thread it through the service**

In `src/services/import-export/musicxml-service.ts`, add a `parser: XmlParser` parameter to the import function and pass it to `importMusicXml`.

- [ ] **Step 6: Run the tests**

```bash
cd ~/projects/music_lib && bunx vitest run src/adapters/musicxml src/services/import-export
```
Expected: PASS, same counts as before plus the new malformed-input test.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: MusicXML import takes an XmlParser instead of reaching for DOMParser

The importer only ever used five DOM members, so XmlElement covers it and a
real DOM Element satisfies the interface with no adapter."
```

---

## Task 10: `music_lib` — MIDI adapters take a `MidiCodec`

**Files:**
- Modify: `~/projects/music_lib/src/adapters/midi/{import,export,analyze}.ts` and their tests
- Modify: `~/projects/music_lib/src/services/import-export/midi-service.ts`
- Modify: `~/projects/music_lib/src/workers/midi-import.worker.ts`

**Interfaces:**
- Consumes: `MidiCodec`, `MidiFile`, `MidiTrackData` from `@sudobility/music_types`; `ToneJsMidiCodec` from `@sudobility/music_io/web`.
- Produces: `exportMidi(score, codec)`, `importMidi(data, options, codec)`, `analyzeMidi(data, codec)`.

- [ ] **Step 1: Update the tests to pass a codec**

In each of the three test files add:

```ts
import { ToneJsMidiCodec } from '@sudobility/music_io/web';
const codec = new ToneJsMidiCodec();
```

and pass `codec` as the new final argument at every call site.

- [ ] **Step 2: Run and watch them fail**

```bash
cd ~/projects/music_lib && bunx vitest run src/adapters/midi
```
Expected: FAIL — wrong argument counts.

- [ ] **Step 3: Rewrite `exportMidi` against the neutral model**

```ts
export function exportMidi(score: Score, codec: MidiCodec): Uint8Array {
  const file: MidiFile = {
    header: {
      name: score.metadata.title,
      ppq: score.ppq,
      tempos: score.tempoMap.map((t) => ({ ticks: t.tick, bpm: t.bpm })),
      timeSignatures: collectTimeSignatureChanges(score),
    },
    tracks: score.tracks.map((track): MidiTrackData => ({
      name: track.name,
      channel: track.clef === 'percussion' ? PERCUSSION_CHANNEL : track.midiChannel,
      instrument: { number: track.midiProgram },
      notes: collectTrackNotes(track).map((note) => ({
        midi: pitchToMidi(note.pitch),
        ticks: note.startTick,
        durationTicks: Math.max(1, note.durationTicks),
        velocity: clamp01(note.velocity / MIDI_VELOCITY_MAX),
      })),
      controlChanges: {
        [CC_VOLUME]: [{ number: CC_VOLUME, ticks: 0, value: clamp01(track.volume) }],
        [CC_PAN]: [{ number: CC_PAN, ticks: 0, value: panToNormalized(track.pan) }],
      },
      durationTicks: 0,
      durationSeconds: 0,
    })),
    duration: 0,
  };
  return codec.encode(file);
}
```

`durationTicks`/`durationSeconds`/`duration` are outputs of decoding, not inputs to encoding; zero is correct here and the codec ignores them.

- [ ] **Step 4: Rewrite `analyzeMidi` and `importMidi` against the model**

`analyzeMidi(data: ArrayBuffer, codec: MidiCodec)`: replace `new Midi(data)` with `codec.decode(data)`; `summarizeTrack` takes `MidiTrackData` instead of `Midi['tracks'][number]`, and `track.duration` becomes `track.durationSeconds`.

`importMidi(data, options, codec)`: replace `new Midi(data)` with `codec.decode(data)`, and change `SourceMidiTrack` to `MidiTrackData`. `sourceTrack.controlChanges[7]`, `[10]` and `[SUSTAIN_CC_NUMBER]` keep working unchanged, which is precisely why the model keys them by number.

- [ ] **Step 5: Thread it through the service and worker**

`midi-service.ts` gains a `codec: MidiCodec` parameter, passed to `importMidi` on the main-thread fallback path. `src/workers/midi-import.worker.ts` constructs `new ToneJsMidiCodec()` directly — a worker only ever runs on web.

- [ ] **Step 6: Run the tests**

```bash
cd ~/projects/music_lib && bunx vitest run src/adapters/midi src/services/import-export src/workers
```
Expected: PASS, same counts as before.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: MIDI adapters take a MidiCodec instead of importing @tonejs/midi

The neutral model keys controlChanges by CC number because the importer looks
up sustain, volume and pan directly by number."
```

---

## Task 11: `music_lib` — drop the platform dependencies

**Files:**
- Delete: `~/projects/music_lib/src/adapters/tone/` (4 modules + 4 tests), `src/services/import-export/download.ts` and its test
- Modify: `~/projects/music_lib/src/index.ts`, `src/services/playback/types.ts`, `package.json`

- [ ] **Step 1: Delete the moved code**

```bash
cd ~/projects/music_lib
rm -rf src/adapters/tone src/services/import-export/download.ts src/services/import-export/download.test.ts
```

- [ ] **Step 2: Re-export the playback types from their new home**

Replace the body of `src/services/playback/types.ts` with:

```ts
/**
 * Playback contracts now live in @sudobility/music_types, so music_io can
 * implement them without depending on music_lib. Re-exported here so existing
 * importers keep one import site.
 */
export type { PlaybackEngine, PlaybackObserver, TransportPlaybackState } from '@sudobility/music_types';
```

- [ ] **Step 3: Drop the dead exports and dependencies**

In `src/index.ts`, delete the four `adapters/tone/*` export lines and the `download.js` export.

In `package.json`, delete `tone`, `@tonejs/midi` and `dexie` from `dependencies`. `dexie` has no importer at all — confirm with `grep -rn "from 'dexie'" src` returning nothing. The remaining dependencies must be exactly `immer`, `zod`, `vexflow`.

```bash
bun remove tone @tonejs/midi dexie
```

- [ ] **Step 4: Prove music_lib is platform-free**

Create `src/platform/no-platform-imports.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('music_lib is platform-free', () => {
  it('imports neither tone nor @tonejs/midi anywhere', () => {
    // This is the whole point of the refactor: one stray import puts Web Audio
    // back into a React Native bundle.
    const offenders = sourceFiles('src').filter((path) => {
      const text = readFileSync(path, 'utf8');
      return /from '(tone|@tonejs\/midi)'/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('touches no DOM global outside the canvas renderer, which receives its context', () => {
    const offenders = sourceFiles('src')
      .filter((path) => !path.includes('adapters/vexflow'))
      .filter((path) => /\b(document|DOMParser|localStorage)\b/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the full verify**

```bash
cd ~/projects/music_lib && bun run verify
```
Expected: PASS. All previously-passing tests still pass; the two new guard tests pass.

- [ ] **Step 6: Bump, commit, publish**

```bash
npm version major --no-git-tag-version
git add -A && git commit -m "feat!: music_lib no longer depends on tone, @tonejs/midi or dexie

Platform implementations moved to @sudobility/music_io. dexie had no importer
at all and is simply deleted. Two guard tests now fail the build if a platform
import or a DOM global creeps back in.

BREAKING CHANGE: TonePlaybackEngine and downloadBlob move to
@sudobility/music_io; importMusicXml, importMidi, exportMidi and analyzeMidi
take their platform service as a final argument; playback requires
initializeMusicPlatform() before first use."
npm publish && git push
```

---

## Task 12: `music_app` — wire it up and prove parity

**Files:**
- Modify: `~/projects/music_app/src/config/initialize.ts`
- Modify: `~/projects/music_app/src/components/layout/AppLayout.tsx:234,248,269`
- Modify: `~/projects/music_app/src/components/dialogs/DeveloperSettingsDialog.tsx:133`
- Modify: the MIDI and MusicXML import dialogs
- Modify: `~/projects/music_app/src/test/app-services.ts`

**Interfaces:**
- Consumes: `createMusicIo()` from `@sudobility/music_io`; `initializeMusicPlatform` from `@sudobility/music_lib`.

- [ ] **Step 1: Install and wire the composition root**

```bash
cd ~/projects/music_app && bun add @sudobility/music_io @sudobility/music_lib@latest @sudobility/music_types@latest
```

In `src/config/initialize.ts`, inside `initializeApp()`, before the store context is built:

```ts
import { createMusicIo } from '@sudobility/music_io';
import { initializeMusicPlatform } from '@sudobility/music_lib';

const io = createMusicIo();
initializeMusicPlatform({ playback: io.playback });
```

Add `io` to the returned `AppServices` so components can reach `io.xmlParser`, `io.midiCodec` and `io.fileExporter`.

- [ ] **Step 2: Move the four download call sites**

Replace `import { downloadBlob } from '@sudobility/music_lib'` with the app services' exporter, and each call:

```ts
// before: downloadBlob(name, new Blob([bytes], { type: 'audio/midi' }))
await getAppServices().io.fileExporter.save(name, bytes, 'audio/midi');
```

- [ ] **Step 3: Pass the platform services into the import dialogs**

Wherever the dialogs call `importMusicXml`, `importMidi` or `analyzeMidi`, pass `getAppServices().io.xmlParser` / `io.midiCodec` as the new final argument.

- [ ] **Step 4: Give the test harness a platform**

In `src/test/app-services.ts`, `installTestAppServices()` must also call `initializeMusicPlatform({ playback: new MockPlaybackEngine() })` from `@sudobility/music_io/mocks`, and `resetTestAppServices()` must call `resetMusicPlatform()`. Without this, any component test that touches playback throws `PlatformNotInitializedError`.

- [ ] **Step 5: Run the full verification — this is the regression gate**

```bash
cd ~/projects/music_app && bun run verify
```
Expected: **353 tests pass**, 0 errors, clean build.

```bash
lsof -ti:5173,8023 | xargs kill -9 2>/dev/null; bun run test:e2e
```
Expected: **13 passed**.

If either count differs, the refactor changed behaviour — stop and fix before committing rather than updating the expectation.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: wire the app to music_io's platform implementations

The composition root builds the platform bundle and registers playback with
music_lib; the four download call sites and the import dialogs take their
service from it. Web behaviour is unchanged: 353 unit tests and 13 e2e green."
git push
```

---

## Task 13: React Native implementations

**Files:**
- Create: `~/projects/music_io/src/rn/playback/playback.rn.ts`, `src/rn/xml/xml.rn.ts`, `src/rn/file/file.rn.ts`
- Create: `~/projects/music_io/src/rn/rn.contract.test.ts`
- Modify: `~/projects/music_io/src/rn/index.ts`

**Interfaces:**
- Consumes: `runPlatformContract` from Task 7; the verdict recorded in Task 1.
- Produces: `createMusicIo()` from `@sudobility/music_io/rn`.

- [ ] **Step 1: Write the RN XML parser**

`src/rn/xml/xml.rn.ts` — `fast-xml-parser` returns an object tree, so this adapts it to `XmlElement`:

```ts
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { XmlParseError } from '@sudobility/music_types';
import type { XmlElement, XmlParser } from '@sudobility/music_types';

const ATTR_PREFIX = '@_';
const TEXT_KEY = '#text';

class FxpElement implements XmlElement {
  constructor(
    readonly tagName: string,
    private readonly node: Record<string, unknown>,
  ) {}

  get textContent(): string | null {
    const text = this.node[TEXT_KEY];
    return text == null ? null : String(text);
  }

  get children(): ArrayLike<XmlElement> {
    const out: XmlElement[] = [];
    for (const [key, value] of Object.entries(this.node)) {
      if (key.startsWith(ATTR_PREFIX) || key === TEXT_KEY) continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        out.push(new FxpElement(key, (child ?? {}) as Record<string, unknown>));
      }
    }
    return out;
  }

  getAttribute(name: string): string | null {
    const value = this.node[`${ATTR_PREFIX}${name}`];
    return value == null ? null : String(value);
  }

  getElementsByTagName(name: string): ArrayLike<XmlElement> {
    const out: XmlElement[] = [];
    const walk = (element: XmlElement): void => {
      for (const child of Array.from(element.children)) {
        if (child.tagName === name) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

export class RNXmlParser implements XmlParser {
  parse(text: string): XmlElement {
    const valid = XMLValidator.validate(text);
    if (valid !== true) throw new XmlParseError(valid.err.msg);

    const parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ATTR_PREFIX,
      textNodeName: TEXT_KEY,
      // Elements that can repeat must always be arrays, or a single <part>
      // parses to an object and a second one silently changes the shape.
      isArray: () => true,
    }).parse(text) as Record<string, unknown>;

    const rootName = Object.keys(parsed).find((key) => !key.startsWith(ATTR_PREFIX) && key !== TEXT_KEY);
    if (!rootName) throw new XmlParseError('The XML document has no root element.');
    const rootNode = (parsed[rootName] as unknown[])[0] as Record<string, unknown>;
    return new FxpElement(rootName, rootNode ?? {});
  }
}
```

- [ ] **Step 2: Write the RN file exporter**

`src/rn/file/file.rn.ts` — writes to the cache directory, then opens the share sheet:

```ts
import type { FileExporter } from '@sudobility/music_types';

/**
 * `react-native-fs` and `react-native-share` are resolved lazily so that
 * importing this module on a machine without them (the test runner) does not
 * throw — only calling `save()` does.
 */
export class RNFileExporter implements FileExporter {
  async save(name: string, data: Uint8Array | string, mimeType: string): Promise<void> {
    const [{ default: fs }, { default: Share }] = await Promise.all([
      import('react-native-fs'),
      import('react-native-share'),
    ]);
    const path = `${fs.CachesDirectoryPath}/${name}`;
    const contents = typeof data === 'string' ? data : Buffer.from(data).toString('base64');
    await fs.writeFile(path, contents, typeof data === 'string' ? 'utf8' : 'base64');
    await Share.open({ url: `file://${path}`, type: mimeType, failOnCancel: false });
  }
}
```

Add `react-native-fs` and `react-native-share` as optional peer dependencies.

- [ ] **Step 3: Write the RN playback engine per Task 1's verdict**

If Task 1's verdict was **"Tone works"**, `RNPlaybackEngine` extends the moved `TonePlaybackEngine` and only swaps the context in `initialize()`:

```ts
import { AudioContext } from 'react-native-audio-api';
import * as Tone from 'tone';
import { TonePlaybackEngine } from '../../web/playback/tone-engine.js';

export class RNPlaybackEngine extends TonePlaybackEngine {
  override async initialize(): Promise<void> {
    Tone.setContext(new AudioContext() as unknown as BaseAudioContext);
    await super.initialize();
  }
}
```

If the verdict was **"cannot run"** or **"unproven outside a device"**, implement `PlaybackEngine` directly against `react-native-audio-api`'s `OscillatorNode`/`GainNode`/`StereoPannerNode`, scheduling with `context.currentTime` offsets and driving `onPositionTick` from a `setInterval` at 30Hz. Keep the observer contract identical — the controller must not be able to tell the platforms apart.

- [ ] **Step 4: Complete the RN entry and run the contract**

`src/rn/index.ts`:

```ts
import { RNPlaybackEngine } from './playback/playback.rn.js';
import { RNXmlParser } from './xml/xml.rn.js';
import { RNFileExporter } from './file/file.rn.js';
import { ToneJsMidiCodec } from '../shared/midi/codec.tonejs.js';
import type { MusicIo } from '../shared/types.js';

export { RNPlaybackEngine, RNXmlParser, RNFileExporter, ToneJsMidiCodec };
export type { MusicIo };

export function createMusicIo(): MusicIo {
  return {
    playback: new RNPlaybackEngine(),
    xmlParser: new RNXmlParser(),
    midiCodec: new ToneJsMidiCodec(),
    fileExporter: new RNFileExporter(),
  };
}
```

`src/rn/rn.contract.test.ts`:

```ts
import { vi } from 'vitest';
import { runPlatformContract } from '../contract/platform-contract.js';

// The native module has no JS-only build; the contract exercises the XML,
// MIDI and interface-shape guarantees, which need no audio hardware.
vi.mock('react-native-audio-api', () => ({ AudioContext: class {} }));

const { createMusicIo } = await import('./index.js');
runPlatformContract('rn', createMusicIo);
```

```bash
cd ~/projects/music_io && bunx vitest run src/rn
```
Expected: PASS — the same suite web and mocks pass.

- [ ] **Step 5: Verify, commit, publish**

```bash
cd ~/projects/music_io && bun run verify
git add -A && git commit -m "feat: React Native implementations behind the react-native export condition

The XML parser adapts fast-xml-parser's object tree to XmlElement; the file
exporter writes to the cache directory and opens the share sheet. All three
implementations pass the same contract suite."
npm version minor --no-git-tag-version && npm publish && git push
```

---

## Task 14: Documentation and link cleanup

**Files:**
- Create: `~/projects/music_io/CLAUDE.md`
- Modify: `~/projects/music_lib/CLAUDE.md`, `~/projects/music_app/CLAUDE.md`, `~/projects/music_app/docs/architecture.md`, `~/projects/music_app/docs/parity-checklist.md`

- [ ] **Step 1: Write `music_io/CLAUDE.md`**

Cover: what the package is for; the three entries and the `react-native` condition (and that Metro picks it automatically, so app code never branches); the rule that runtime `dependencies` stays empty; that the MIDI codec is deliberately shared by both platforms and why; and that every implementation must pass `runPlatformContract`.

- [ ] **Step 2: Update `music_lib/CLAUDE.md`**

Record that music_lib is now platform-free, that its dependencies are exactly `immer`/`zod`/`vexflow`, that playback resolves through `getMusicPlatform()`, that the stateless services arrive as function parameters, and that two guard tests fail the build if a platform import or DOM global returns.

- [ ] **Step 3: Update the app docs**

In `music_app/CLAUDE.md`, add `@sudobility/music_io` to the Related Projects list and note that `initialize.ts` now registers the platform. In `docs/architecture.md`, add music_io to the repo picture — it is now six repos, not five. Add two rows to `docs/parity-checklist.md`:

```markdown
| Platform services are injected, not imported | music_io `src/contract/platform-contract.ts` (run against web, rn and mocks); music_lib `src/platform/registry.test.ts` |
| music_lib stays platform-free | music_lib `src/platform/no-platform-imports.test.ts` |
```

- [ ] **Step 4: Remove the dev links and verify against published packages**

```bash
cd ~/projects/music_lib && bun unlink @sudobility/music_io && bun install
cd ~/projects/music_app && bun install
bun run verify && bun run test:e2e
```
Expected: 353 unit tests, 13 e2e, clean build — against the published packages rather than links.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: record the music_io platform boundary" && git push
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| Topology / export map | 3 |
| `PlaybackEngine` interface | 2 |
| `XmlParser` / `XmlElement` | 2, 5, 13 |
| `FileExporter` | 2, 5, 13 |
| `MidiCodec` + neutral model | 2, 6 |
| Registry vs parameters | 8, 9, 10 |
| What moves (tone, DOMParser, downloadBlob, deps) | 4, 5, 11 |
| `vexflow` stays | 11 (guard test excludes `adapters/vexflow`) |
| App wiring | 12 |
| Testing / contract suite | 7, 13 |
| Sequencing (spike first) | 1 |
| Out of scope: RN app, RN notation, ESM MIDI codec | not present, by design |

**Model correction against the spec.** The spec's `MidiTrackData` had `controlChanges: MidiControlChange[]` and no per-track durations. `@tonejs/midi` keys control changes **by CC number**, and `import.ts` looks up `controlChanges[7]`, `[10]` and `[64]` directly while `analyze.ts` reads `track.duration`. This plan uses `Record<number, MidiControlChange[]>` plus `durationTicks`/`durationSeconds`; the spec must be amended to match, and Task 2 is the authority.

**Type consistency.** `createMusicIo(): MusicIo` is identical across all three entries. `MusicPlatform` (registry, playback only) stays distinct from `MusicIo` (full bundle). Adapter signatures take their service last: `importMusicXml(xmlText, parser)`, `importMidi(data, options, codec)`, `exportMidi(score, codec)`, `analyzeMidi(data, codec)`.

**Known risk.** Task 13's shape depends on Task 1's verdict, which is why the spike runs first and writes its consequence down explicitly.

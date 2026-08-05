# Platform dependency injection: `music_io`

**Status:** approved 2026-07-31
**Goal:** make `music_lib` platform-free, so the same domain logic runs on web and React Native, with every platform-bound capability behind an interface and its implementations in a new `@sudobility/music_io` package.

## Why

`music_lib` bundles six runtime dependencies, three of which are web-bound: `tone` (Web Audio), `vexflow`, and `@tonejs/midi` (CommonJS). A React Native app importing anything from the package root pulls all of them in, because Metro does not tree-shake. `@sudobility/sudojo_lib`, the house reference, has **zero** runtime dependencies for exactly this reason.

A no-DOM probe (Bun, which has no `window`/`document`/Web Audio) established what actually breaks today:

| Subsystem                                       | Result with no DOM                                |
| ----------------------------------------------- | ------------------------------------------------- |
| Package import (184 exports)                    | works — nothing touches the DOM at module load    |
| Domain model, queries, validation, quantization | works                                             |
| `computeLayout`                                 | works                                             |
| MIDI export                                     | works                                             |
| Zustand store, commands, undo                   | works                                             |
| `CanvasScoreRenderer.render`                    | **works** — 28 note bboxes, 1232 canvas ops       |
| MusicXML **import**                             | `ReferenceError: DOMParser is not defined`        |
| `downloadBlob`                                  | needs `document` + `Blob` + `URL.createObjectURL` |
| Tone playback                                   | constructs, but needs Web Audio to make sound     |

So this is mostly relocation, not redesign. Three seams already exist: `PlaybackEngine` is already an interface, the renderer already takes a context object, and the workers are already guarded by `typeof Worker` with a main-thread fallback.

## Decisions

| Decision         | Choice                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Package topology | **One** `music_io` with a `react-native` export condition, as `@sudobility/di` does. No separate `music_io_rn`. |
| RN audio backend | `react-native-audio-api`, wired in this project (not stubbed).                                                  |
| RN XML parser    | `fast-xml-parser` (ESM), not `@xmldom/xmldom` (CJS-only).                                                       |
| `@tonejs/midi`   | Behind a `MidiCodec` interface, implementation in `music_io`.                                                   |
| Scope            | Libraries only. No RN app.                                                                                      |

### Why `react-native-audio-api`

It is Software Mansion's Web Audio implementation for RN, so Tone.js — which targets Web Audio — may port largely intact. Its coverage was checked against what `music_lib` actually uses:

- Used and **implemented**: `OscillatorNode`, `GainNode`, `BiquadFilterNode`, `AudioBufferSourceNode` (for `Tone.Sampler`), `StereoPannerNode`, `PeriodicWave`, `ConstantSourceNode`, `OfflineAudioContext`.
- **Missing but unused**: `AudioWorklet` (only Tone's `BitCrusher` and `FeedbackCombFilter` need one; we use neither) and `DynamicsCompressorNode`.
- Tone's transport clock prefers a Web Worker and falls back to `setTimeout`, which is RN's situation.

`AudioContext` is documented as only partially implemented, and Tone has not actually been run on it. **This is the one real unknown and is spiked first** (see Sequencing).

## Package topology

```jsonc
// music_io/package.json
{
  "name": "@sudobility/music_io",
  "type": "module",
  "exports": {
    ".": { "react-native": "./dist/rn/index.js", "default": "./dist/web/index.js" },
    "./web": "./dist/web/index.js",
    "./rn": "./dist/rn/index.js",
    "./mocks": "./dist/mocks/index.js",
  },
  "dependencies": {},
  "peerDependencies": {
    "@sudobility/music_types": "^0.1.0",
    "tone": "^15.0.0",
    "@tonejs/midi": "^2.0.28",
    "react-native-audio-api": ">=0.13.0",
    "fast-xml-parser": "^5.10.1",
  },
  "peerDependenciesMeta": {
    "tone": { "optional": true },
    "react-native-audio-api": { "optional": true },
    "fast-xml-parser": { "optional": true },
  },
}
```

Consumers write one import specifier; Metro resolves `react-native`, Vite resolves `default`. `./web` and `./rn` stay addressable for tests and for a consumer that wants to be explicit. `./mocks` ships the fakes `music_lib`'s own tests use, so no test needs a real platform.

## Interfaces — `music_types/src/platform/`

`music_types` is type-only for these; it gains no runtime dependency.

### `PlaybackEngine`

Moves **verbatim** from `music_lib/src/services/playback/types.ts`, together with `PlaybackObserver` and `TransportPlaybackState`. It already references only `Score` and `ScoreRange`, both already canonical in `music_types`. `music_lib` re-exports the types from their new home so existing importers keep working.

### `XmlParser`

The MusicXML importer touches exactly five DOM members — `tagName`, `getAttribute`, `children`, `textContent`, `getElementsByTagName` — so the interface is small, and a real DOM `Element` satisfies it structurally, meaning the web implementation needs no adapter.

```ts
export interface XmlElement {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly children: ArrayLike<XmlElement>;
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): ArrayLike<XmlElement>;
}

export class XmlParseError extends Error {}

export interface XmlParser {
  /** Parses a document and returns its root element. Throws `XmlParseError` on malformed input. */
  parse(text: string): XmlElement;
}
```

The RN implementation uses **`fast-xml-parser` (5.10.1)**, chosen over the more obvious `@xmldom/xmldom` because xmldom ships CommonJS only (`type: commonjs`, no `exports`, no `module` field) while `fast-xml-parser` is true ESM with dual exports. Its output is an object tree rather than a DOM, which the five-member `XmlElement` interface absorbs in a thin adapter.

### `FileExporter`

Takes **bytes or text, never `Blob`** — `Blob` is a web concept and would leak into the RN signature.

```ts
export interface FileExporter {
  /** Saves `data` under `name`. Web downloads it; RN writes a file and opens the share sheet. */
  save(name: string, data: Uint8Array | string, mimeType: string): Promise<void>;
}
```

Note this is consumed by **music_app directly** (four call sites in `AppLayout.tsx` and `DeveloperSettingsDialog.tsx`), never by `music_lib` internally — so it needs no registry entry, and `downloadBlob` simply moves out of `music_lib`.

### `MidiCodec`

A neutral file model, derived from precisely the fields the three MIDI adapters read and write today.

```ts
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
   * Keyed by CC number, not a flat list: `import.ts` looks up sustain (64),
   * volume (7) and pan (10) directly by number, and flattening them would
   * silently break volume and pan on import.
   */
  controlChanges: Record<number, MidiControlChange[]>;
  durationTicks: number;
  /** `analyze.ts` reports per-track duration in the import wizard's track list. */
  durationSeconds: number;
};

export type MidiFile = {
  header: {
    ppq: number;
    name?: string;
    tempos: MidiTempoEvent[];
    timeSignatures: MidiTimeSignatureEvent[];
  };
  tracks: MidiTrackData[];
  /** Longest track duration in seconds; `analyzeMidi` reports it. */
  duration: number;
};

export interface MidiCodec {
  decode(data: ArrayBuffer): MidiFile;
  encode(file: MidiFile): Uint8Array;
}
```

**Known limitation, accepted:** `@tonejs/midi` is portable and already works under Metro, so the web and RN implementations of `MidiCodec` are initially **the same code**. The seam does not change what runs. What it buys is that `music_lib` stops depending on a CommonJS package and a future ESM codec can drop in without touching `music_lib`. It does **not**, on its own, remove CommonJS from the dependency graph — that needs an ESM codec, which is deliberately out of scope.

## How `music_lib` consumes the interfaces

**Registry for singletons, parameters for pure functions.**

```ts
// music_lib/src/platform/registry.ts
/** Only long-lived singletons live here. Pure adapters take their service as a parameter. */
export type MusicPlatform = { playback: PlaybackEngine };

export function initializeMusicPlatform(platform: MusicPlatform): void;
export function getMusicPlatform(): MusicPlatform; // throws a named error if unset
export function resetMusicPlatform(): void; // tests
```

`music_io` separately exports the full bundle it can build, of which only `playback` is registered:

```ts
// music_io — same shape from the web and rn entries
export type MusicIo = {
  playback: PlaybackEngine;
  xmlParser: XmlParser;
  midiCodec: MidiCodec;
  fileExporter: FileExporter;
};
export function createMusicIo(): MusicIo;
```

Only `PlaybackEngine` goes in the registry, because only playback is a long-lived singleton. `playbackController` keeps its lazy `Proxy` exactly as-is and resolves its engine from the registry instead of calling `new TonePlaybackEngine()`. That is the whole change at that seam, and it means **every existing `playbackController.*` call site across the app is untouched**.

The pure adapters take their service as an explicit final argument — they are pure functions, and a parameter needs no global state to test:

| Before                      | After                                         |
| --------------------------- | --------------------------------------------- |
| `importMusicXml(xmlText)`   | `importMusicXml(xmlText, parser: XmlParser)`  |
| `importMidi(data, options)` | `importMidi(data, options, codec: MidiCodec)` |
| `exportMidi(score)`         | `exportMidi(score, codec: MidiCodec)`         |
| `analyzeMidi(data)`         | `analyzeMidi(data, codec: MidiCodec)`         |

`exportMusicXml(score)` is unchanged — it is pure string building and never touched the DOM.

The worker-backed services (`midi-service.ts`, `quantize-service.ts`) already accept an injected `createWorker`; they gain a `codec` parameter and pass it through to the adapter on the main-thread fallback path. The worker entry points construct the web codec directly, since a worker only ever runs on web.

## What moves

| Thing                                | From                                    | To                                                                                   |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------ |
| `TonePlaybackEngine`                 | `music_lib/adapters/tone/`              | `music_io/src/web/playback/`                                                         |
| RN playback engine                   | —                                       | `music_io/src/rn/playback/` (new, `react-native-audio-api`)                          |
| Instrument voices (`instruments.ts`) | `music_lib/adapters/tone/`              | `music_io/src/web/playback/` — they construct Tone nodes                             |
| `DOMParser` call                     | `music_lib/adapters/musicxml/import.ts` | `music_io` web (`DOMParser`) + rn (`fast-xml-parser`, adapted to `XmlElement`)       |
| `downloadBlob`                       | `music_lib/services/import-export/`     | `music_io` web (anchor + object URL) + rn (file write + share sheet)                 |
| `@tonejs/midi` usage                 | `music_lib/adapters/midi/*`             | `music_io` — `music_lib` maps to/from the neutral `MidiFile`                         |
| `tone`, `@tonejs/midi` deps          | `music_lib`                             | `music_io` peers                                                                     |
| `dexie` dep                          | `music_lib`                             | **deleted** — nothing imports it                                                     |
| `vexflow`                            | —                                       | **stays in `music_lib`** — the renderer takes a context object and draws with no DOM |

`music_lib`'s remaining runtime dependencies: `immer`, `zod`, `vexflow`.

## Wiring in `music_app`

`src/config/initialize.ts` is already the composition root. It gains one block:

```ts
import { createMusicIo } from '@sudobility/music_io';
import { initializeMusicPlatform } from '@sudobility/music_lib';

const io = createMusicIo();
initializeMusicPlatform({ playback: io.playback });
```

and the four `downloadBlob` call sites import from `@sudobility/music_io` instead of `@sudobility/music_lib`. `MidiImportWizard` and the MusicXML import dialog pass `io.xmlParser` / `io.midiCodec` into the adapter calls.

## Testing

- **`music_types`** — type-only; covered by compilation.
- **`music_io`** — unit tests per implementation. The `rn` entry is exercised under Node with the native modules faked, so it is verified without a device.
- **Shared contract tests** — one suite runs against _any_ `MusicPlatform`, so web, rn and mocks are all held to the same behaviour rather than each being tested differently.
- **`music_lib`** — all 893 existing tests keep passing, using `music_io/mocks`.
- **`music_app`** — 353 unit tests and 13 e2e keep passing with **identical behaviour**. This is the primary regression gate: the web app must not change at all.

## Sequencing

1. **Spike Tone on `react-native-audio-api`** first — the one genuine unknown. If Tone will not run, the RN engine becomes a direct `react-native-audio-api` implementation of `PlaybackEngine` rather than a Tone reuse, which changes the size of one task but nothing else in this design.
2. Interfaces into `music_types`.
3. `music_io` scaffold, export map, web implementations, mocks.
4. Rewire `music_lib` (registry, adapter parameters, dependency removal).
5. Rewire `music_app`, prove parity.
6. RN implementations and the shared contract suite.

## Out of scope

- **An RN app.** Nothing here is proven on a device; that is a separate project.
- **Notation rendering on RN.** The renderer is already parameterised on a 2D context and proven to draw headless. An RN app would supply a Skia-backed context; no interface change is needed, so none is designed here.
- **Replacing `@tonejs/midi` with an ESM codec.** Explicitly declined; see the limitation above.
- **`music_client` / auth.** Already injected through `StoreContext`, already portable (`fetch` exists in RN).

# music_io File Layer (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `music_io` the file layer above the codecs, so the app makes one call per import or export instead of orchestrating a codec and a file exporter itself.

**Architecture:** `music_io` gains eight `open*`/`save*` methods on the `MusicIo` bundle and takes a dependency on `@sudobility/music_codecs`. Methods rather than free functions, because the save half needs `fileExporter` and the MusicXML half needs `xmlParser` — both already on the bundle. Audio stays split: the app renders through `music_player` and hands PCM to `io.saveAudio`.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Bun.

**Spec:** `docs/superpowers/specs/2026-08-23-music-player-and-file-io-design.md` (the `music_io` section)

**Phase A is complete and green** — this is designed against `music_io`'s final shape: four capabilities (`xmlParser`, `audioCodec`, `fileExporter`, `midiInput`) and 66 tests.

## Global Constraints

- **`music_io` must import no `music_lib` and no `music_player`.** Its guard test enforces both. `music_codecs` is a new, permitted dependency.
- **`open*`/`save*`, never `import*`/`export*`.** `music_codecs` already exports `importMidi`/`exportMidi`; identical names across two packages the app imports together is a collision that gets resolved wrongly under time pressure.
- **Audio stays asymmetric with the score formats, deliberately.** `music_io` orchestrates codecs (a codec is a pure function it may call) but not rendering (a live synth with platform state). `saveAudio` takes PCM.
- **`MusicIo` grows from 4 members to 12** and its doc comment says "everything a platform provides". These methods are orchestration that happens to need two capabilities. Say so in the comment rather than let the meaning blur.
- **Never auto-commit or auto-push.**
- **A `bun install` in a consumer discards rsynced `@sudobility/*` builds** — re-sync after one, and delete `node_modules/.vite`.

---

### Task 1: music_io takes the music_codecs dependency and gains the open/save layer

**Repo:** `~/projects/music_io`

**Files:**

- Create: `src/shared/score-files.ts`, `src/shared/score-files.test.ts`
- Modify: `src/shared/types.ts`, `src/web/index.ts`, `src/rn/index.ts`, `src/mocks/index.ts`, `package.json`

**Interfaces:**

- Consumes: `music_codecs`' `importMidi`, `analyzeMidi`, `exportMidi`, `decodeTracker`, `encodeTracker`, `trackerToScore`, `scoreToTracker`, `importMusicXml`, `exportMusicXml`; and `MusicIo`'s own `xmlParser` and `fileExporter`.
- Produces, on `MusicIo`:

```ts
openMidi(bytes: ArrayBuffer, options: MidiImportOptions): MidiImportResult;
analyzeMidi(bytes: ArrayBuffer): MidiSummary;
openTracker(bytes: ArrayBuffer): { module: TrackerModule; score: Score };
openMusicXml(text: string, warnings: MusicXmlWarnings): MusicXmlImportResult;
saveMidi(score: Score, filename: string): Promise<void>;
saveTracker(score: Score, format: TrackerFormat, filename: string): Promise<TrackerFitReport>;
saveMusicXml(score: Score, filename: string): Promise<void>;
saveAudio(samples: Float32Array, sampleRate: number, format: 'wav' | 'mp3', filename: string): Promise<void>;
```

- [ ] **Step 1: Add the dependency**

```bash
cd ~/projects/music_io
```

Add `"@sudobility/music_codecs": "^0.2.1"` to `dependencies` **and** `devDependencies`, then `bun install`, then re-sync `music_types` and `music_codecs` (the install discards rsynced builds).

- [ ] **Step 2: Write the failing test**

`src/shared/score-files.test.ts`, using the mocks entry so the exporter records rather than writes:

```ts
import { describe, expect, it } from 'vitest';
import { createMusicIo } from '../mocks/index.js';
import { twinkleScore } from '@sudobility/music_codecs/fixtures';

describe('score files', () => {
  it('round-trips a score through MIDI without the caller touching a codec', async () => {
    const io = createMusicIo();
    await io.saveMidi(twinkleScore(), 'Twinkle.mid');

    const saved = (io.fileExporter as unknown as { saved: { name: string; data: Uint8Array }[] })
      .saved;
    expect(saved.at(-1)?.name).toBe('Twinkle.mid');

    const back = io.openMidi(
      saved.at(-1)!.data.buffer as ArrayBuffer,
      defaultMidiImportOptions(io.analyzeMidi(saved.at(-1)!.data.buffer as ArrayBuffer)),
    );
    expect(back.score.tracks.length).toBeGreaterThan(0);
  });

  it('opens a tracker module and returns both the module and the score', () => {
    const io = createMusicIo();
    const bytes = buildMod({ title: 'Elysium' });
    const { module, score } = io.openTracker(bytes);
    expect(module.format).toBe('mod');
    expect(score.tracks.length).toBeGreaterThan(0);
  });

  it('encodes and writes audio without knowing how it was rendered', async () => {
    const io = createMusicIo();
    const samples = new Float32Array(4410);
    await io.saveAudio(samples, 44100, 'wav', 'Piece.wav');

    const saved = (io.fileExporter as unknown as { saved: { name: string }[] }).saved;
    expect(saved.at(-1)?.name).toBe('Piece.wav');
  });
});
```

Import `defaultMidiImportOptions` and `buildMod` from `@sudobility/music_codecs` and `@sudobility/music_codecs/fixtures` respectively.

- [ ] **Step 3: Run it to make sure it fails**

```bash
cd ~/projects/music_io && bun run test -- src/shared/score-files.test.ts
```

Expected: FAIL — `openMidi` does not exist on `MusicIo`.

- [ ] **Step 4: Write `src/shared/score-files.ts`**

One factory taking the two capabilities it needs and returning the eight methods, so all three entry points share one implementation:

```ts
/**
 * The file layer above the codecs.
 *
 * `music_codecs` turns bytes into a `Score` and back; this turns *files* into a
 * `Score` and back — read the bytes, call the codec, hand over a score; take a
 * score, call the codec, write the file. The app used to do that pairing itself,
 * which is why `AppLayout` had four near-identical export handlers.
 *
 * Methods on the bundle rather than free functions because the save half needs
 * `fileExporter` and the MusicXML half needs `xmlParser`, and both are already
 * here.
 *
 * `open*`/`save*`, not `import*`/`export*`: `music_codecs` already exports
 * `importMidi`/`exportMidi`, and two identically-named functions in packages the
 * app imports together is a collision resolved wrongly under time pressure.
 */
export function createScoreFiles(deps: {
  xmlParser: XmlParser;
  audioCodec: AudioCodec;
  fileExporter: FileExporter;
}): ScoreFiles {
  /* ... */
}
```

Each method is one codec call plus one `fileExporter.save`, with the MIME types the app currently passes (`audio/wav`, `audio/mpeg`, `application/octet-stream`, `application/vnd.recordare.musicxml+xml`, `audio/midi`).

- [ ] **Step 5: Widen `MusicIo` and spread the methods into all three entries**

Add `ScoreFiles` to the `MusicIo` type and extend its doc comment to say these are orchestration rather than capabilities. In `web/index.ts`, `rn/index.ts` and `mocks/index.ts`, spread `createScoreFiles({ xmlParser, audioCodec, fileExporter })` into the returned object.

- [ ] **Step 6: Verify**

```bash
cd ~/projects/music_io && bun run verify
```

The guard test must still pass: `music_codecs` is permitted; `music_lib` and `music_player` are not.

- [ ] **Step 7: Commit** (only if asked)

---

### Task 2: Collapse the app's call sites

**Repo:** `~/projects/music_app`

**Files:**

- Modify: `src/components/layout/AppLayout.tsx` (four export handlers), `src/features/projects/DashboardPage.tsx:362`, `src/components/dialogs/MidiImportWizard.tsx:146-147`, `src/components/dialogs/MusicXmlImportDialog.tsx:56`

**Interfaces:**

- Consumes: the eight methods from Task 1, through `getAppServices().io`.

- [ ] **Step 1: Sync the rebuilt music_io**

```bash
cd ~/projects/music_io && bun run clean && bun run build
rsync -a --delete dist/ ~/projects/music_app/node_modules/@sudobility/music_io/dist/
cp package.json ~/projects/music_app/node_modules/@sudobility/music_io/package.json
rm -rf ~/projects/music_app/node_modules/.vite
```

- [ ] **Step 2: The four export handlers**

Each becomes one call:

```tsx
await io.saveMidi(target, `${midiSafeFilename(target.metadata.title)}.mid`);
await io.saveMusicXml(target, `${musicXmlSafeFilename(target.metadata.title)}.musicxml`);
const report = await io.saveTracker(
  target,
  format,
  `${midiSafeFilename(target.metadata.title)}.${format}`,
);
await io.saveAudio(
  audio.samples,
  audio.sampleRate,
  format,
  `${midiSafeFilename(target.metadata.title)}.${format}`,
);
```

The tracker handler keeps its fit-report branch — `scoreToTracker` runs inside `saveTracker` now, so the report comes back from the call rather than being computed first. **Where the app shows the fit dialog before writing, it still needs `scoreToTracker` separately**; check `AppLayout`'s existing flow and keep the "compute the fit, show it, then write" order rather than writing first and reporting after.

- [ ] **Step 3: The three import sites**

```tsx
// DashboardPage
const { module, score } = getAppServices().io.openTracker(bytes);
// MidiImportWizard
analyze: async (buffer) => getAppServices().io.analyzeMidi(buffer),
import: async (buffer, options) => getAppServices().io.openMidi(buffer, options),
// MusicXmlImportDialog — no service to construct
const result = getAppServices().io.openMusicXml(text, musicXmlWarnings());
```

- [ ] **Step 4: Verify and run the e2e**

```bash
cd ~/projects/music_app && bun run verify
lsof -ti:5039,8023 | xargs kill -9 2>/dev/null || true
bun run test:e2e
```

MIDI import/export, MusicXML export, module import and XM export all cross this layer. It was 51/51 before Phase B.

- [ ] **Step 5: Update `CLAUDE.md`** — the "Every import lives on the dashboard" gotcha and the export list now go through `io.open*`/`io.save*`.

- [ ] **Step 6: Commit** (only if asked)

---

## Notes for the executor

- **Do not give `music_io` a `music_player` dependency.** Audio export is orchestrated by the app precisely so this package never holds a reference to a running synth. `saveAudio` takes PCM.
- **`MusicXmlService` may become dead in music_lib** once the dialog stops constructing one. Check before deleting — the warnings contract is wired through it.
- **Never `bun install` in a consumer without re-syncing** the local `@sudobility/*` builds afterwards.

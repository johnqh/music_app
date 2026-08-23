# music_player, and moving file IO into music_io

**Date:** 2026-08-23
**Status:** Approved design, not yet implemented
**Repos touched:** music_types, music_codecs, music_player (new), music_io, music_lib, music_api, music_app

## The shape this arrives at

Four libraries, each answering one question:

| Package        | One job                                                               | Depends on                                             |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| `music_types`  | the model, the score domain, and the primitives both sides need       | —                                                      |
| `music_codecs` | score file formats: bytes ↔ `Score`                                   | music_types                                            |
| `music_player` | **sound**: transport, engines, plan building, render → PCM            | music_types                                            |
| `music_io`     | **files**: open/save score files, encode audio, parse XML, MIDI input | music_types, music_codecs                              |
| `music_lib`    | editing: store, commands, adapters                                    | music_types, music_codecs, music_player, music_drawing |
| `music_app`    | UI                                                                    | all of the above                                       |

No cycles. The sentence that decides where anything goes: **music_player makes sound,
music_io moves bytes, music_codecs reads and writes score formats, music_lib edits.**

## Why now

Two boundaries are currently in the wrong place.

**Playback is spread across three packages.** The engines are in `music_io`, the
transport brain (`PlaybackController`) is in `music_lib` where it reads the
Zustand store, and the plan builders sit in `music_lib` too. Nothing owns
"playback"; three packages own a third of it each. `music_io`'s own
`no-music-lib.test.ts` records what that already cost once: _"live playback took
a `Score`, and an engine holding a score then needed tempo maths, tie joining and
the GM tables to do anything with it. By the end music_io imported music_lib in
eight files, the two packages were mutually dependent."_

**Reading a file takes three packages and the app to co-ordinate.** Importing a
MIDI file today is `file.arrayBuffer()` in the app, `decodeMidi`/`importMidi`
from `music_codecs`, and — for MusicXML — a `MusicXmlService` the app constructs
around `io.xmlParser`. Exporting is a codec call paired with
`io.fileExporter.save`. The orchestration lives in UI components, which is why
`AppLayout` has four near-identical export handlers.

## Decisions

Each of these was a fork; the reasoning is recorded because the alternatives
were reasonable.

### 1. music_io gains the file layer, not the codecs

`music_codecs` keeps bytes ↔ `Score`. `music_io` gains the layer above it: take
bytes, call the codec, return a `Score`; take a `Score`, call the codec, write
the file. So `music_io` depends on `music_codecs`, and the app calls one thing.

The codecs do **not** move back. `music_api` decodes MIDI server-side and cannot
depend on a platform package — that is the whole reason `music_codecs` exists.

### 2. `IMusicPlayer` is the transport, not just the engine

The player is what the app drives, not a synth host beneath something else that
does. It owns the engines _and_ the transport logic — loop, seek-to-measure,
tempo, metronome, and the performance↔score tick translation that repeats
require.

This is affordable because the coupling that looked fatal is not: `plan.ts`
imports only `@sudobility/music_types`, and `repeatPlayOrder`,
`performanceTimeline`, `flattenScoreNotes` and `fermataTempoMap` all live there.
The **only** genuine `music_lib` dependency in `PlaybackController` is the store
— score, visible tracks, selection — and that is exactly what the thin adapter
left behind will supply.

### 3. `load()` takes a `Score`; the engine still takes a plan

`music_io`'s CLAUDE.md records "the engine is handed a plan, never a score", and
that rule stays true **where it was actually about**: inside `music_player`, the
`PlaybackEngine` interface still takes a `PlaybackPlan` and does no score maths.

What changes is the public surface. The stated reason for the old rule was that
`music_io` must not depend on `music_lib` for tempo maths and tie joining;
`music_player` depends on `music_types`, where that maths now lives, so the
reason does not apply to it. `IMusicPlayer.load(score)` therefore builds the plan
internally, and callers stop performing a two-step dance whose second step the
player now owns.

`applyMix(tracks)` survives unchanged: a mix change must not rebuild every note,
which is the reason mixing is exempt from the score-is-immutable-while-playing
lock in the first place.

### 4. Offline render goes with playback; the file half stays with files

Rendering an export is the live engine with a different sink. Measured, on both
platforms:

- **Web** — live sends note-on/note-off to libfluidsynth in an `AudioWorklet`;
  offline sends the same events to fluidsynth and calls `Synthesizer.render()`
  to pull PCM. Same soundfont, same `channel-allocator`, same `mix`.
- **React Native** — live drives sample packs through `PackLibrary`/`planVoice`;
  offline drives the same `PackLibrary`/`planVoice` against an
  `OfflineAudioContext`.

`rn/audio/offline-render.ts` says why they must stay together: _"the file is
supposed to be a recording of what was heard, and two voicing paths drift apart
the first time one is tuned."_ Every import offline render makes points into the
playback folder, on both platforms. So `music_player` owns both.

The synth plumbing already differs between live and offline and always will —
that was forced by the Web Audio API (_"playback runs on a realtime
`AudioContext`, and rendering faster than realtime needs an
`OfflineAudioContext`. Nothing bridges the two."_), not chosen. What is shared is
the voicing, and that is what must not be split.

### 5. The app orchestrates audio export; music_io never sees music_player

`music_io.saveAudio(samples, sampleRate, format, filename)` encodes and writes.
The caller renders first: `player.renderEvents(score)` → `player.renderSamples(plan)`
→ `io.saveAudio(pcm, …)`.

Deliberately **asymmetric** with score formats, where `music_io` _does_
orchestrate (`openMidi` calls `music_codecs` itself). A codec is a pure function
`music_io` can call freely; the renderer is a live synth with platform-bound
state. Keeping it out means `music_io` never holds a reference to a running
synth, and the two platform packages do not depend on each other.

### 6. `MusicPosition` moves to `music_types`

`IMusicPositionSource` is already there; the implementation and its singleton
join it. It passes all four of the rules that package keeps — works on both
sides, no dependencies, no hooks, no async — verified: a single type-only
import, 156 lines including the singleton.

**It will be the first stateful singleton service in `music_types`, and that is
a deliberate precedent.** The package is otherwise model and primitives. The
justification is that the playhead has exactly one writer and many readers
across every other package, so any other home creates a dependency edge that
exists only to reach it.

`music_player` becomes its **only writer**, converting performance ticks to
score ticks at that boundary. Everything else reads. That preserves what
`music-position.ts` documents: the smoothing must live inside the single source
of truth, because when the caret did its own dead-reckoning it was smoothing a
number nobody else was smoothing.

### 7. Timeline types stay with their producers

`PerformanceTimeline`, `TimelineSegment` and `TempoConversion` are consumed only
by playback but produced by `performanceTimeline()` and `repeatPlayOrder()`,
which are score-domain functions in `music_types`. Moving the types alone would
make `music_types` import from `music_player`, inverting the dependency. Moving
the producers too would pull repeat expansion — `D.S. al Coda`, `Fine` on the
second pass — out of the score model that `music_api` also reads.

So both stay. The rule for every other playback type: **a type moves to
`music_player` if nothing outside `music_player` references it, and stays in
`music_types` otherwise.** That is decidable by grep at implementation time and
does not need an exhaustive list here.

## music_player

### Public surface

```ts
export interface IMusicPlayer {
  load(score: Score, opts?: { visibleTrackIds?: string[] }): Promise<void>;

  play(): Promise<void>;
  pause(): void;
  togglePlay(): void;
  stop(): void;

  seek(tick: number): void;
  seekToMeasure(measureIndex: number): void;
  goToStart(): void;
  previousMeasure(): void;
  nextMeasure(): void;

  setLoop(range: ScoreRange | null): void;
  setTempoMultiplier(multiplier: number): void;
  setMetronome(enabled: boolean): void;
  setMasterVolume(volume: number): void;

  /** Live, without rebuilding the note queue. Mixing is not editing. */
  applyMix(tracks: PlaybackTrack[]): void;

  /** Audition. Touches no transport state: no caret move, no play/pause change. */
  noteOn(midi: number, voice: AuditionVoice): void;
  noteOff(midi: number): void;

  onPosition(fn: (tick: number) => void): Unsubscribe;
  onSounding(fn: (notes: readonly SoundingNote[]) => void): Unsubscribe;
  onTransport(fn: (state: TransportPlaybackState) => void): Unsubscribe;

  dispose(): void;
}
```

The three existing `PlaybackBus` channels, unchanged, and three rather than one
"playback changed" event for the reason that class already documents: a
subscriber that cares about position must not wake when a note starts.

**`onPosition` and `MusicPosition` are not duplicates and both survive.** The
channel is a _change signal_ — `usePlayback.ts` subscribes to it with a bare
`() => void` for `useSyncExternalStore` — while the authoritative, smoothed value
is read from `getMusicPosition().tick`. Notification and value are deliberately
separate: the value must be dead-reckoned between reports, so a subscriber that
took the tick from the event would get the unsmoothed number that §6 exists to
stop anyone using.

**Synth load progress is not a channel.** It reports per percent and drives
ordinary React state, so it goes to the store: the player hands it to the
music_lib adapter, which calls `setSynthLoad` exactly as `PlaybackController`
does today, and `playback-slice` keeps the field.

Rendering is exported alongside, not on the interface, because it is not
transport:

```ts
export function renderEvents(score: Score): RenderPlan;
export function renderSamples(
  plan: RenderPlan,
): Promise<{ samples: Float32Array; sampleRate: number }>;
```

### DI

`initializeMusicPlayer(impl)` / `getMusicPlayer()` / `resetMusicPlayer()`,
matching `initializeMusicPosition` exactly — idempotent create, read everywhere,
reset in tests. A singleton because there is one transport: two would be two
playheads, which is the disagreement §6 exists to prevent.

Web and React Native resolve through a `react-native` export condition as
`music_io` does, with `./web`, `./rn` and `./mocks` subpaths.
`js-synthesizer` and `react-native-audio-api` stay **optional peer
dependencies** the app installs, so a fresh install fails loudly with
`Cannot find package` rather than shipping the wrong platform's audio.

### What moves in

- From `music_io`: `web/playback/*`, `web/audio/{offline-synth,soundfont-render,synth-types}`,
  `rn/playback/*`, `rn/audio/offline-render.ts`, `shared/playback/*`
- From `music_lib`: `services/playback/{controller,bus,plan,types}.ts`,
  `services/export/render-events.ts`
- From `music_types`: the player-only types, by the rule in §7

### What stays in music_lib

A thin adapter over the store — load on score change, `stop()` before adopting a
score that arrived from outside, selection → `setLoop`, visible tracks → mix.
`playback-slice` keeps the low-frequency transport state it holds today
(transport state, loop, tempo, metronome, volume, load progress), which behaves
like ordinary React state because it is.

**`stop()` before adopting a foreign score is load-bearing** and must survive the
move: a generation result or an opened snapshot replaces the score without going
through `dispatchCommand`, so the edit lock never sees it, and the controller
would otherwise treat it as a mix change and keep playing the old score out of
the engine's queue.

## music_io

### New methods on the `MusicIo` bundle

Methods rather than free functions because the save half needs `fileExporter`
and the MusicXML half needs `xmlParser`, both already on the bundle.

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

`open*`/`save*`, not `import*`/`export*`: `music_codecs` already exports
`importMidi`/`exportMidi`, and identical names across two packages the app
imports together is a collision that gets resolved wrongly under time pressure.

### What this removes from the app

- `MusicXmlImportDialog` stops constructing `new MusicXmlService(io.xmlParser, …)`
- `AppLayout`'s four export handlers stop pairing a codec call with `fileExporter.save`
- `DashboardPage` stops calling `decodeTracker` then `trackerToScore`
- `xmlParser` leaves the app's field of view — still a capability, but only
  `music_io` uses it

### A cost to state plainly

`MusicIo` goes from **6 members to 12** (four capabilities remain —
`xmlParser`, `audioCodec`, `fileExporter`, `midiInput` — after `playback` and
`audioRenderer` leave for `music_player`; eight methods arrive). Its doc comment
calls it "everything a platform provides", and these methods are not platform
capabilities — they are orchestration that happens to need two of them. That is
the right trade for "the app invokes music_io", but it softens what the type
means, so the comment must be rewritten to say so rather than leave the drift
unremarked.

## Guards

Each package gets a contract test, because every boundary here has already been
lost once by being merely remembered:

- **music_player** — imports no `music_lib`, no `music_io`, no `vexflow`. Same
  grep shape as `music_io`'s existing `no-music-lib.test.ts`.
- **music_io** — its existing no-music-lib test extends to forbid `music_player`.
- **music_codecs** — unchanged; still `dependencies: []`, still forbidding
  `music_lib`/`music_io`, and now also `music_player`.
- **music_types** — unchanged four rules; `MusicPosition` is asserted to add no
  import and no async.

## Testing

1. **The moved engine tests must pass unmodified** apart from import paths. Both
   platforms' playback suites move wholesale; any behavioural edit means the
   move was not clean.
2. **Live and offline must still agree.** The existing tests that pin
   `playbackPlan` and `renderEvents` against the same `flattenScoreNotes`
   traversal move with them and must keep passing — that agreement is the reason
   §4 refuses to split them.
3. **Position has exactly one writer.** `music_lib`'s `single-source.test.ts` and
   `drift.test.ts` move to `music_types` and keep passing; add an assertion that
   nothing outside `music_player` calls `report()`.
4. **The `stop()`-before-foreign-score behaviour** keeps its existing
   `AppLayout.test.tsx` coverage, which is the only place it is pinned.
5. `bun run verify` green in all seven repos, then `bun run test:e2e` in
   `music_app` — playback, audio export, MIDI/MusicXML/module import and export
   all cross these boundaries.

## Order of work

One spec, but the implementation lands as two independently verifiable phases.
Both touch `music_io`, and doing them in this order means it is only reorganised
once: the player **removes** from `music_io`, the file layer **adds** to it, so
the file layer is designed against `music_io`'s final contents rather than a
shape that is about to lose half of itself.

**Phase A — music_player.** Scaffold the package; move the engines from
`music_io`; move `controller`/`bus`/`plan`/`render-events` from `music_lib`;
move `MusicPosition` to `music_types`; split the playback types; write the thin
`music_lib` adapter; rewire the app. Ends with every existing playback and audio
export test green and `music_io` holding no playback code.

**Phase B — file IO.** Add the eight `open*`/`save*` methods to `music_io`, take
its dependency on `music_codecs`, and collapse the app's import/export call
sites onto them. Ends with `AppLayout`'s four export handlers and the two import
dialogs each a single call.

Verify each phase across all seven repos before starting the next, so a
regression is attributable to one of them.

## Publishing

`music_player` joins `scripts/push_all.sh` **after `music_types` and before
`music_lib`**, which consumes it. `music_io` also moves after `music_codecs`,
which it now depends on. Resulting order:

`music_types` → `music_codecs` → `music_player` → `music_drawing` →
`music_api` → `music_client` → `music_io` → `music_lib` → `music_app`

## Out of scope

- Changing what playback sounds like. This is a move, not a re-voicing.
- `midiInput` stays in `music_io`. Live MIDI keyboard input is a device, and the
  notes it produces are note _entry_, which is editing — it is neither sound
  production nor a file.
- Reworking `playback-slice` or the five isolated readout components. The
  high-frequency/low-frequency split stands; only its owner moves.
- React Native app work. `music_player` must be RN-_compatible_; wiring an RN app
  is separate.

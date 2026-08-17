# Scalable playback architecture

**Date:** 2026-08-17
**Status:** Approved design, not yet implemented
**Repos touched:** `music_io`, `music_lib`, `music_app`

## Why

Playback hesitates on complex scores and CPU reaches 100%. The cause is not the
scheduler. It is that playback colour reaches the canvas only through a full
rebuild of the visible window, on the same thread the scheduler runs on.

`CanvasScoreRenderer.render()` caches the layout plan but re-runs
`buildMeasureContent` and `new Formatter().format(...)` for every visible measure
of every visible track on every call — rebuilding every `StaveNote`, `Voice` and
`Beam` to change a fill colour on a few noteheads.

Measured in the jsdom harness with the stub 2D context, so these are the
JavaScript costs only (VexFlow construction, formatting, bbox maths) with no
rasterization at all:

| Score | ms per draw |
| --- | --- |
| 4 tracks, quarter notes, zoom 1 | 27 |
| 12 tracks, quarter notes, zoom 1 | 14 |
| 12 tracks, 16th notes, zoom 1 | 20 |
| 12 tracks, 16th notes, zoom 0.5 | 119 |

The trigger rate is ~20 Hz. `SoundfontPlaybackEngine.report()` calls
`onActiveNotes([...this.activeNoteIds])` every pump tick with a fresh array,
unconditionally, even when the sounding set is unchanged. `ScoreEditorView`'s
subscription rebuilds the colour map and a signature string each time; the
signature suppresses the *draw* only while no visible note starts or stops,
which on a dense multi-track score is almost never.

20 × 20 ms is 400 ms of work per second. 20 × 119 ms is over 2 s of work per
second. The pump is a main-thread `setInterval` with a 200 ms lookahead and a
200 ms grace window, so a draw that long pushes a tick past the lookahead: notes
dispatch late and are then dropped by `planDispatch`.

Two further limits block the stated goal of hundreds of tracks:

- **Audio.** `allocateChannels` opens a new fluidsynth instance every 16 tracks
  and `SynthHost.grow()` calls `loadSFont(soundfont)` once per instance — a
  separate copy of the 23 MB font in WASM memory each time. 200 tracks is 13
  instances: ~300 MB of heap and 13 AudioWorklet nodes.
- **Notation.** `drawSystem` culls horizontally by measure but iterates
  `plan.trackLayouts` with no vertical culling. At 200 tracks one system is
  ~24,000 px tall: ~8 staves are visible and 200 are built and formatted, every
  frame. The renderer windows by *system*; at this scale the meaningful axis is
  the *stave*.

## Goal

All N tracks sound simultaneously, at hundreds of tracks, with playback timing
immune to main-thread load and per-frame rendering cost proportional to what is
on screen rather than what is in the score.

The load-bearing principle: **no tier's per-frame cost may depend on the size of
the score, and no tier may depend on another tier's promptness.**

## Two facts that shaped the design

Both verified against the installed `js-synthesizer` (`dist/lib/*.d.ts`) rather
than assumed.

1. **`SynthesizerSettings.midiChannelCount` is `int [16-256]`, in multiples of
   16.** One fluidsynth instance addresses up to 256 channels with one soundfont
   copy and one AudioWorkletNode. The multi-instance tier works around a limit
   that does not exist. `polyphony` (`int [1-65535]`, default 256) and
   fluidsynth's overflow-priority settings (`overflowVolume`, `overflowAge`,
   `overflowReleased`) provide per-voice degradation under load — all tracks
   sound, individual quiet or old voices give way.
2. **The sequencer accepts the full MIDI vocabulary**, including a `note` event
   carrying its own `duration`. Note-offs never need to touch the main thread.
   Caveat: `WorkletSequencer.sendEventAt` is one `postMessage` per event, so
   lookahead depth carries a real — but bounded and predictable — main-thread
   cost.

## Architecture

Four tiers, each with one job and a narrow interface.

| Tier | Owns | Lives in |
| --- | --- | --- |
| Synth | channels, programs, levels, voices | `music_io/web/playback` |
| Scheduler | score to timed MIDI stream, kept a horizon ahead | `music_io/shared/playback` |
| Playback bus | transport state and per-note events, change-only | `music_lib/services/playback` |
| Render host | where notation drawing runs | `music_app` |

---

## 1. Audio tier

### 1.1 One synth, 256 channels

`Synthesizer.init(sampleRate, { midiChannelCount: 256, polyphony })`.

**The instance machinery stays; the constant changes.** `CHANNELS_PER_INSTANCE`
goes from 16 to 256, so `ensureInstances`, `grow`, the serialising `growing`
promise and the `synths[]`/`sequencers[]`/`sfontIds[]` arrays all remain — they
are what keeps track 257 audible rather than silent, which is the failure class
this design is removing, not adding. What changes is that they stop engaging at
realistic track counts: every score up to 256 tracks now runs on one instance,
one soundfont copy, one AudioWorkletNode and one master chain.

The win is not deleted code. It is that the multi-instance path becomes rare
instead of routine — reached at 257 tracks rather than at 17.

**Percussion rule:** channels where `c % 16 === 9` are reserved for percussion
and never assigned to a pitched track. Drum tracks take those first; overflow
uses the existing measured type-switch plus bank-128 program-select path. The
"never select a melodic program on channel 9" guard in `programSelect` stays,
and becomes structurally unreachable rather than defensive.

**Above 256 tracks:** the allocator opens a second instance exactly as it does
today, at the cost of a second soundfont copy. That cliff is documented and
deliberate, where today an equivalent one is crossed silently at 17 tracks.

**The offline renderer shares the allocator.** `audio/soundfont-render.ts` calls
`allocateChannels` and renders one pass per instance, and
`audio/offline-synth.ts` calls `synth.init(sampleRate)` with no settings. Both
must move to 256 channels in the same change, or export would address channels
its synth does not have. This is not scope creep: the allocator's semantics
cannot change for one caller only.

### 1.2 The sequencer owns timing

Replace the 200 ms lookahead drained by a main-thread pump with a rolling
horizon of `note` events — one event per score note, carrying its own
`duration`, so fluidsynth releases the note in the worklet.

- **Horizon bound:** two bounds, whichever is reached first —
  `HORIZON_SECONDS` of music, or `MAX_QUEUED_EVENTS` events in flight. A dense
  200-track score gets a shorter horizon in seconds but the same bounded
  per-tick cost, which is the property that matters. Starting values
  `HORIZON_SECONDS = 4` and `MAX_QUEUED_EVENTS = 8192`, both to be confirmed by
  measuring `sendEventAt`'s per-event `postMessage` cost during step 1; the
  values are tunable constants, not part of the contract.
- **The pump's job** becomes "top up the buffer by one slice" — a fixed,
  bounded cost per tick regardless of score size.
- **Seek and stop** flush with `removeAllEvents()` and refill from the new
  position, as today. Edits do not appear in that list: the edit lock (3.4)
  means content cannot change while the horizon is live, so nothing but a
  transport action ever invalidates the queue.
- **Tempo multiplier changes** flush and reschedule. This is a user action, not
  a per-frame one. Tempo *maps* are handled at schedule time, since score ticks
  are converted to seconds via `TempoMap` before scheduling.
- **Mute, solo and volume** stay immediate CC7 writes, not scheduled — they take
  effect mid-playback without rescheduling, as today.

Deleted: `pendingOffs`, `releaseDue`, `GRACE_SECONDS`, and `planDispatch`'s
skip-late rule. Note lengths stop tracking main-thread lateness, which also ends
the compounding loop where a stall holds notes long, which adds voices, which
loads the audio thread.

A 500 ms main-thread stall becomes inaudible instead of becoming dropped notes.

### 1.3 The governor stops acting on a signal that stopped meaning anything

**Amended after implementation.** This section originally had the governor drive
the `polyphony` cap from the concurrent-voice count. That is not available:
`js-synthesizer`'s `ISynthesizer` exposes `setInterpolation` and `setGain` and
**no polyphony setter**, so the ceiling can only be chosen at `init`. Changing
it at runtime would mean re-initialising the synth, which means reloading the
23MB font.

What actually ships:

- **Polyphony is set once at init, generously (2048).** A voice slot is a small
  struct and only sounding voices cost CPU. Above the ceiling fluidsynth steals
  by its own overflow priority — quietest and oldest first — which is the
  per-voice degradation this design wanted, already implemented in the synth.
- **The governor keeps measuring pump lateness and stops acting on it.** It used
  to step interpolation down after ten consecutive frames over 100ms late, on
  the reasoning that a starved pump meant a starved synth. §1.2 killed that
  reasoning: the worklet holds four seconds of queued audio, so the main thread
  can stall for a second with nothing audible happening. Degrading timbre for
  every listener because a notation redraw took 119ms is a cost with no benefit.
- **No audio-thread load signal exists to replace it with.** `AudioWorkletNode`
  exposes none, and `AudioContext` offers only latency figures that do not move
  under voice pressure. The lateness count is kept, unread, because it is free
  and because it is the shape such a signal would take.

### 1.4 Sounding notes become a cursor query

`activeNoteIds` stops being a by-product of `pendingOffs`. It becomes a
two-cursor interval query over the sorted note list: advance a "started" cursor
and an "ended" cursor by position, emit only the delta. `O(notes that changed)`,
never `O(score)`, and it emits nothing when nothing changed — fixing the 20 Hz
fresh-array-every-tick problem at its source.

---

## 2. Rendering tier

### 2.1 Cull by stave, with geometry independent of what is drawn

For each visible system, draw only the `trackLayouts` whose y-band intersects
the viewport.

Culling changes the formatter's input, and the formatter is what aligns
simultaneous notes across staves. Two things currently derive from the drawn
subset and must instead derive from the plan, or culling is a rendering bug
rather than an optimisation:

- **Begin-modifier width.** `Stave.formatBegModifiers(measureStaves)` aligns
  clef, key and time across whatever staves it is passed. That width depends
  only on clef, key signature and time signature — never on notes — so it is
  computed per measure column for *all* tracks once, stored in `LayoutPlan`, and
  read by each drawn stave.
- **Tick alignment.** Format the visible staves' voices together with one
  additional invisible voice holding the union of every onset in the column.
  `computeLayout` already computes that union to size `contentWidths`. With the
  union present, the formatter produces identical x positions for any subset, so
  scrolling cannot shift notes sideways.

Both are part of this change, not follow-ups.

### 2.2 Cache formatted measures; colour becomes a restyle

Cache keyed on `(score identity, layout key, measureIndex, trackId)` holding the
built and formatted VexFlow objects.

- **Geometry change** (score, zoom, layout mode, width, track set, or scrolling
  to an uncached measure): build, format, populate cache.
- **Colour change:** `setStyle` on cached objects, `clearRect`, redraw. No
  construction, no `Formatter`.

VexFlow objects retain their formatted positions after `format()` and apply
styles at draw time, so redrawing a cached object is well defined.

The cache is an LRU bounded to the visible window plus a margin. A full-score
cache at 200 tracks would be the memory problem this design exists to avoid.

Expected effect: a colour-only frame goes from 20–119 ms to a `clearRect` plus a
few dozen `draw()` calls.

### 2.3 The render host seam

`CanvasScoreRenderer` stays where it is and gains nothing platform-specific.
Above it:

```
RenderHost {
  setScore(score) / patchScore(patch)
  frame(options): Promise<{ idToBBox, measureIdToBBox } | null>
  resize(cssWidth, cssHeight, devicePixelRatio) / dispose()
}
```

`frame` options carry `{ viewport, zoom, layoutMode, width, trackIds,
activeTrackId, theme, colourDelta, selectedMeasureIds }`. Colour is sent as a
delta (`{ set: [[id, role]], clear: [id] }`) rather than a whole map, so its
message cost is proportional to what changed rather than to the size of the
selection. `MainThreadRenderHost` resolves the promise synchronously; the return
is a promise so that both hosts satisfy one interface.

`MainThreadRenderHost` calls the renderer directly — today's path, and React
Native's, unchanged. `WorkerRenderHost` transfers an `OffscreenCanvas` to a
worker that imports the same renderer. One renderer, two hosts.

The caret, the drag box and every pointer handler stay on the main thread. The
worker returns bbox maps **only when geometry changed**, not per frame, so
hit-testing and the dev/e2e `window.__scoresmith` handle keep working off a
main-thread copy.

### 2.4 How the worker learns about edits

The worker cannot be sent the whole score per keystroke: a 200-track score is
tens of megabytes and structured-cloning it on every edit would be worse than
the problem being solved.

Every edit goes through a `ScoreCommand` returning a new score that **shares
every branch it did not touch** — the property `project-slice` already relies on
for its identity-based autosave. So the patch channel is an identity diff: walk
tracks and measures, send only the objects whose reference changed. A one-note
edit sends one measure.

The diff is a pure function over two scores, so it unit-tests without a worker.

**Rejected alternative:** having the worker replay commands. Undo, redo,
MIDI/MusicXML import and generation all produce scores by routes that are not a
serialisable command, so it would need a second mechanism anyway.

**Divergence guard:** every patch carries a sequence number. The worker rejects
an out-of-order or unexpected-base patch and demands a full resync rather than
applying it. Silent divergence would make everything drawn wrong without any
symptom, so this failure must be loud.

### 2.5 LayoutPlan derived boxes

`LayoutPlan` materialises a box per `(track, measure)` — 40,000 objects for 200
tracks by 200 bars, rebuilt whenever zoom or width changes. Since x and width
are already shared per measure column and y is a fixed per-track offset within a
system, the plan stores those two vectors and derives a box on demand behind the
existing `boxForMeasureIndex`-style accessors. Same API, no 40k allocation.

---

## 3. State and data flow

### 3.1 The bus

Today every per-note fact travels engine → `PlaybackObserver` → store setter →
Zustand notification → every subscriber. That is why the codebase has five
separately-isolated readout components and a CLAUDE.md rule saying nothing
high-frequency may be read at a large component's top level. The rule is
correct and enforced by everyone remembering it.

`PlaybackBus` sits in `music_lib/services/playback`. `PlaybackController` keeps
its job as the one bridge, but forwards high-frequency engine callbacks to the
bus instead of into the store. Separate channels, so a subscriber that cares
about position never wakes for sounding notes:

```
onPosition(tick)            // ~20Hz while playing, nothing when stopped
onSounding(added, removed)  // only on actual change (see 1.4)
onTransport(state)          // playing / paused / stopped
```

**Sounding notes are emitted resolved, not as bare ids:**
`{ noteId, trackId, midi }`. The scheduler already knows each note's track and
pitch — it scheduled them. This deletes `findEvent` from the hot path entirely:
`playingPitchesForTrack` stops being an `O(score)` linear scan per sounding note
per report and becomes a filter over data it was handed.

The store keeps what is genuinely low-frequency: transport state, loop range,
tempo multiplier, metronome, master volume, `synthLoad`.

**The enforcement property:** high-frequency data is no longer in the store, so
the careless subscription cannot be written. The rule becomes a fact about the
types rather than a convention.

### 3.2 The caret split

Today the red caret *is* `playback-slice.positionTick` — one value serving two
purposes, which is why "play from the caret" needs no plumbing, and also why the
store takes a write 20 times a second.

- **`caretTick`** stays in the store: where the *user* is editing. Written by
  clicks, seeks, arrow keys, note entry. Low frequency.
- **Playback position** lives on the bus: where the *audio* is. Exists only
  while playing.

Play starts from `caretTick`, so "play from the caret" still needs no plumbing.
Pause, stop and seek commit the engine's final position back to `caretTick`, so
when stopped the two coincide exactly as they do now.

`resolveInsertTarget` reads `caretTick` and nothing else. Note entry during
playback — which today lands wherever the music currently is, as a consequence
of the two values being one value rather than as a decision — is refused
outright by the edit lock in 3.4.

### 3.3 What the UI does

- **Caret:** subscribes to the bus imperatively and writes `transform` to the
  DOM, as it does now — but no longer re-renders a React component to do it.
- **Key lights:** subscribe to `onSounding`, filter by active track on
  already-resolved data. No score scan, no 20 Hz React render of the key row.
- **Notation colour:** subscribes to `onSounding` deltas and applies them to the
  render host's colour state. 2.2 makes the resulting repaint a restyle.
- **Readouts** (`Timecode`, `MeasureBeatReadout`, `PositionScrubber`): each
  subscribes to `onPosition` via `useSyncExternalStore`. Still isolated, but now
  because that is the only way to reach the data.

### 3.4 The playback edit lock

**While `state === 'playing'`, the score's musical content is immutable.**

This is a product decision, but it pays for itself architecturally: it is what
lets `handleScoreChange` stop being the most intricate code in the repo.

#### Content and mix

Commands divide in two:

- **Mix** — mute, solo, volume, pan. Applied live during playback and pushed
  straight to the engine. Mixing while listening is how an arrangement gets
  listened to; it is not editing.
- **Content** — everything else: notes, measures, tracks, clefs, instruments,
  tempo, plus undo and redo. Refused while playing.

The split cannot be made on command *type*, because `changeTrackPropsCommand`
carries a partial patch and serves both — `{ muted }` is mix, `{ name }` and
`{ midiProgram }` are content. So `ScoreCommand` gains a declared `kind`, and
`changeTrackPropsCommand` computes its own from the patch it was handed. The
classification lives with the command that knows its contents rather than in a
switch somewhere else that has to be kept in step.

The guard is then one line in `score-slice.dispatchCommand`, plus `undo` and
`redo`. Every editing route in the app reaches it, including any added later.

#### Mix needs an engine method it does not have

**Found while planning; the design above was wrong about this.** `PlaybackEngine`
declares `setTrackMute` and `setTrackSolo` and nothing for volume or pan. In
`SoundfontPlaybackEngine`, `TrackState.volume` is populated only in `loadScore`
and `applyTrackLevels` reads it from there, so a volume change that does not
reload cannot reach CC7 — and pan cannot reach CC10 at all.

A mix change is precisely the thing that does not reload. So as written, moving
a fader during playback would move the fader and not the sound.

`PlaybackEngine` therefore gains **`applyMix(score: Score): void`**: re-read
every track's volume, pan, mute and solo from the score and push them, touching
nothing that is scheduled. One method rather than a setter per property, because
the controller has exactly one thing to say — "the mix changed, here is the
score" — and saying it once is idempotent and leaves no way to get it half
right. Both engines implement it; the React Native one is compiled and reviewed
here but, as always, verified on a device.

`applyMix` being *called* is unit-testable. `applyMix` being *audible*, with no
gap in playback, is not — that check is by hand.

#### What this buys the controller

`PlaybackController.handleScoreChange` becomes two branches:

- **Playing** — the lock guarantees the only thing that can have changed is mix
  state, so call `engine.applyMix(score)`. **No reload, no reschedule.**
- **Not playing** — load the score.

Deleted with it: `pendingResume`, `scoreChangeGeneration`, and the interlocking
reasoning about superseded calls, stop-clears-resume, and failed loads clearing
a newer call's resume. That machinery exists solely to make stop-reload-seek-
resume safe under a burst of edits during playback, and there are no longer any.

The soundness of the no-reload branch rests entirely on the lock. It is stated
here as an invariant so that a future change to the lock cannot quietly
invalidate it: **while playing, the only score changes are mix changes.**

#### Foreign score arrivals

A generation result landing or a snapshot being opened changes the score without
going through `dispatchCommand`. These **stop playback first**, rather than
rescheduling underneath the listener. `useGenerationJob`'s reload and the
snapshot-open path each stop the transport before adopting the new score, which
also keeps the invariant above true by construction.

#### In the UI

Content-editing affordances go disabled while playing; mix controls stay
enabled. A gesture that would commit a content command — pitch drag, note move —
does not start while playing, so there is no dead drag that silently does
nothing on release. Selection is not an edit and stays available, as does
scrolling, zooming and track visibility (which is UI state, not score state).

Auditioning also stays: pressing a piano key sounds through `noteOn`/`noteOff`,
which touch no transport state by design. Only the write on release is
suppressed. Playing along with the piece stays possible; recording into it does
not.

### 3.5 Dead preview subsystem

`playPreview` has no callers. `stopPreview()` is called in four places, all
defensively, and since `previewing` is only ever set by `playPreview`, every one
of them is a permanent no-op — a leftover from the candidate-preview removal.

`previewing`, `previewGeneration`, `playPreview`, `stopPreview`,
`resyncEngineToCommittedScore`, `togglePlay`'s preview branch and the
subscription's `if (this.previewing) return` are all deleted, along with the four
call sites. Independent of the rest of this design, but it lands in the same file
as 3.4 and leaving it would obscure what that file now does.

---

## 4. Error handling

**Worker unavailable or crashed.** `transferControlToOffscreen` is not
universal, and a worker can die. Host selection is a capability check plus
runtime `onerror`/`onmessageerror` handlers that swap in `MainThreadRenderHost`
and redraw. A blank canvas is never an acceptable outcome. Because the renderer
is the same object in both hosts, this is a genuine fallback rather than a
degraded second implementation.

**Patch divergence.** Sequence-numbered patches with full-resync on mismatch;
see 2.4.

**Sequencer queue overrun.** Horizon bounded on both time and event count; see
1.2.

**Synth bring-up.** Unchanged in shape — `reportLoad({status:'failed'})` and
rethrow, so silence always has a reason. Simpler now: one instance, so there is
no partially-grown state to reason about.

The pump's `try/catch` and `MAX_REPORTED_TICK_FAILURES` stay, but a failed tick
is no longer an audio event — there are already seconds queued ahead of it.

---

## 5. Testing

The engine's existing DI seams (`now`, `startPump`, `createContext`, `loadFont`,
`SynthHostLike`) are what make this testable without an audio device. All
survive.

New pure units, each tested directly:

| Unit | Test |
| --- | --- |
| Flat channel allocation | percussion reserved to `c % 16 === 9`; no pitched track lands there; >256 opens instance 2 |
| Horizon scheduler | what is queued given position, horizon and event cap; flush on seek |
| Sounding-set cursors | delta emission; emits nothing when nothing changed |
| Identity diff | one-note edit produces one measure; undo, import and generation all diff correctly |
| Formatted-measure cache | hit/miss and every invalidation axis |
| Colour delta encoder | set/clear pairs |
| Worker protocol | encode/decode, dirty tracking, when bbox maps are resent |
| Command `kind` | `changeTrackPropsCommand` classifies from its patch: `{muted}` is mix, `{name}`/`{midiProgram}` is content, a mixed patch is content |
| Edit lock | every content command and undo/redo refused while playing; mix commands accepted; refusal leaves the score reference untouched |
| Controller mix path | a mix change while playing re-applies levels and does **not** reload the engine |
| Foreign arrivals | generation reload and snapshot open each stop the transport before adopting a score |

Two tests carry disproportionate weight:

- **Culling determinism.** Render one measure column with different visible
  stave subsets; assert identical x positions for notes present in both. This is
  what keeps 2.1 an optimisation instead of a bug.
- **Restyle, not rebuild.** `createMock2DContext` records every op. Draw, change
  colour, draw again, assert the two op streams differ only in style calls. That
  pins the cache's whole purpose in one assertion.

Plus perf regressions with real numbers in the style of the existing ones —
colour-only frame time and staves-drawn-per-frame at 200 tracks — and e2e for
the worker path, the fallback path, and a 200-track playback smoke test.

jsdom has neither `Worker` nor `OffscreenCanvas`, so the worker host's coverage
comes from the pure protocol layer plus e2e; the Worker shell stays a thin
dispatcher over tested pure functions.

All tests verified by sabotage: break the code, confirm the edit landed, confirm
the right tests fail.

---

## 6. Migration order

Eight steps, each independently shippable and verifiable.

1. **Engine: single 256-channel synth + sequencer-owned timing** — `music_io`
   only, no app changes. Biggest audio win.
2. **Edit lock + controller simplification** — `music_lib` + `music_app`.
   Command `kind`, the `dispatchCommand` guard, the two-branch
   `handleScoreChange`, foreign-arrival stops, and the dead preview deletion.
   Sequenced before the bus because the lock is what makes the controller
   collapse, and the collapsed controller is what the bus then wires into.
3. **`PlaybackBus` + store split** — `music_lib` + `music_app`. Ends the 20 Hz
   store writes.
4. **Per-stave culling + geometry determinism** — `music_lib` only.
5. **Formatted-measure cache** — `music_lib` only; after 4, since the cache key
   depends on the culling geometry.
6. **`LayoutPlan` derived boxes** — `music_lib` only.
7. **Render host seam + `MainThreadRenderHost`** — `music_app`, pure refactor,
   no behaviour change. Proves the seam before anything depends on it.
8. **`WorkerRenderHost` + patch protocol + fallback** — `music_app`.

**Steps 1–6 alone deliver smooth playback at hundreds of tracks.** Steps 7–8
deliver smooth scrolling. If step 8 hits trouble, everything before it stands.

This is too large for one implementation plan. Each step gets its own plan and
its own verification pass; this document is the shared design they refer back
to. Steps 4–6 touch only `music_lib` and are independent of 1–3, so they can be
run in either order or in parallel.

**Spike before step 7:** VexFlow must run in a worker without touching
`document` — font metrics and glyph setup are the likely offenders. A negative
result means stopping at step 6 with most of the value banked, so this must be
resolved before the seam work begins, not after.

---

## 7. What gets deleted

- `pendingOffs`, `releaseDue`, `GRACE_SECONDS`, and `shared/playback/pump-window.ts`
  in its entirety — with the skip-late rule gone, `planDispatch` is a `map` and
  the module has no reason to exist
- `positionTick` and `activeNoteIds` from the store
- `findEvent` from the playback hot path (the function stays for other callers)
- `pendingResume`, `scoreChangeGeneration`, and the stop-reload-seek-resume path
  in `handleScoreChange` — made unnecessary by the edit lock (3.4)
- The dead preview subsystem in `controller.ts` and its four no-op call sites
  (3.5)
- The `__followScroll` diagnostic in `ScoreEditorView` and `e2e/__diag.spec.ts`,
  currently uncommitted in the working tree

## 8. Documentation this invalidates

Updating these is part of the work, not a follow-up.

- **"There is no worker anywhere in this stack"** — becomes false. Rewritten
  with the measurement that justifies it (119 ms per draw), since that gotcha
  exists precisely to stop someone adding a worker without measuring.
- **"The red caret IS `playback-slice.positionTick` (no separate state)"** —
  becomes the caret split (3.2).
- **"Playback must not touch the main thread more than it has to"** — timing no
  longer lives there at all.
- **"Nothing high-frequency may be read at a large component's top level"** —
  still true, but structural rather than a convention.
- **"The caret interpolates; it is not driven straight off `positionTick`"** —
  still true; the source becomes the bus.
- The engine and channel-allocation gotchas describing multiple synth instances.
- `docs/architecture.md`'s playback data flow.
- **`docs/spec.md` §10**, which lists "reschedule safely after edits" among the
  playback requirements. The edit lock (3.4) removes the situation rather than
  handling it; the requirement becomes "refuse edits during playback, and apply
  mix changes without rescheduling." This is a product-spec change, not just an
  implementation note.

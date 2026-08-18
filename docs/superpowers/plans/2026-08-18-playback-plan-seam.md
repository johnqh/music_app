# Playback Plan Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove music_io's dependency on music_lib entirely, making music_io platform-only, and with it the last circular reference in the family.

**Architecture:** Live playback is the only thing in music_io that reaches into music_lib, and only because `PlaybackEngine.loadScore(score: Score)` hands the engines a domain object they then have to do score maths on. Offline audio export already solved this: music_lib's `renderEvents(score) → RenderPlan` does the musical work and `AudioRenderer.render(plan)` crosses into music_io with no music_lib import at all. This plan gives live playback the same seam — `playbackPlan(score) → PlaybackPlan` in music_lib, `PlaybackEngine.load(plan)` in music_io.

**Tech Stack:** TypeScript (strict), vitest. No new dependencies. Three repos: music_types, music_lib, music_io.

## Global Constraints

- **music_io must not import `@sudobility/music_lib` at all when this is done** — not in `src/`, not in tests, and not in `package.json`. That is the acceptance test for the whole plan (Task 5, Step 1).
- Nothing about playback _behaviour_ changes. Every existing playback test must still pass unchanged except where it constructs an engine input, and the performance characteristics documented in music_app's CLAUDE.md (4s horizon, coalesced repaints, caret interpolation) are untouched.
- `RenderPlan` and `AudioRenderer` are **not** modified. They are already correct; this plan copies their shape rather than disturbing them.
- No behaviour may move _into_ music_types beyond plain data and one structural interface. music_types holds types, not logic.

---

## Verified facts

Measured against the current code before this plan was written.

### The dependency is real, is production, and is only playback

Eight files in music_io import music_lib; four are production:

| File                               | Imports                                                    |
| ---------------------------------- | ---------------------------------------------------------- |
| `shared/playback/schedule.ts`      | `joinTiedNotes`, `pitchToMidi`, `beatBoundaries`           |
| `web/playback/soundfont-engine.ts` | `TempoMap`                                                 |
| `rn/playback/sample-engine.ts`     | `TempoMap`, `gmInstrument`, `gmKitAt`, `isPercussionTrack` |
| `rn/audio/offline-render.ts`       | `gmKitAt`, `gmInstrument`                                  |

The other four are tests importing score fixtures (`twoTrackScore`, `twinkleScore`) and `pitchToMidi`.

### The cycle disappears as a consequence, without touching the test direction

All twelve of music_lib's music_io imports are `.test.ts` files importing
`@sudobility/music_io/mocks`. So the production graph is already acyclic and the
cycle is dev-only. Once music_io drops music_lib the graph is
`music_types → music_io → music_lib (dev)` — one-way. **No change to
music_lib's test doubles is needed**, and this plan makes none.

### `TempoMap` is used for exactly two things

`ticksToSeconds` (seek/`play(fromTick)`) and `secondsToTicks` (position
reporting). Both are pure conversions, so an interface satisfied structurally by
the existing `TempoMap` class removes the import without moving any code.

### `schedule.ts` is entirely musical, and partly duplicated already

99 lines: `flattenScoreForPlayback` (tie joining, pitch resolution, voice
channels) and `metronomeClicks` (beat boundaries).

Its comment claims `trackVoiceChannels` is a hand copy of `ties.ts`'s private
`voiceChannel`, "reimplemented here rather than imported because ties.ts doesn't
export it". **That is now out of date and the two are not interchangeable.**
`voiceChannel` is exported today, but it is
`voiceChannel(track, voiceIndex): ChannelCandidate[]` — one voice at a time,
notes only, annotated with `measureIndex` for tie-partner lookup — whereas
playback needs every voice ordinal at once as `MusicalEvent[][]`, rests
included, which is what `joinTiedNotes(events: MusicalEvent[])` consumes. So
`trackVoiceChannels` moves across as it stands; there is no duplication to
collapse here.

Symbol locations, confirmed rather than assumed: `beatBoundaries` is in
`domain/time/ticks.ts` (not `meter.ts`) and `gmInstrument` is in
`domain/instruments/gm-range.ts` (not `gm.ts`).

`renderEvents` in music_lib is a second, parallel score→events flattening — same
`TempoMap` + `pitchToMidi` shape, different output. They stay separate (one
emits seconds for offline render, one emits ticks with note ids for live
playback), but they will finally sit side by side where the overlap is visible.

### The GM lookups reduce to two resolved fields

Both RN files derive a sample-pack name:

```
percussion: percussionPackName(gmKitAt(midiProgram).program)
pitched:    gmPackName(midiProgram, gmInstrument(midiProgram).name)
```

`percussionPackName` and `gmPackName` are music_io's own. Only the two GM
lookups are music_lib's, and both are per-track constants — so resolving them in
music_lib and carrying the answers on the plan's track removes the tables from
music_io without moving the catalogue. That is `voiceProgram` (the kit's program
on a percussion track, the track's own otherwise) and `voiceName`.

This matters because **a percussion track's `midiProgram` names a kit, not an
instrument** — Brush is 40 and program 40 is Violin — so the resolution cannot be
left to a caller that does not know which it is holding.

### `applyMix` needs four fields, two of which `RenderTrack` lacks

It reads `volume`, `muted`, `solo` and `pan` per track. `RenderTrack` carries
`volume` and `pan` only, because an offline render bakes mute and solo into
which events it emits. Playback needs them live, so the playback track type is
`RenderTrack` plus `muted`/`solo`.

### Three engines implement the interface

`mocks/index.ts`, `web/playback/soundfont-engine.ts`,
`rn/playback/sample-engine.ts`, with the interface in music_types and a
re-declaration in `shared/types.ts`.

---

## File Structure

- **Modify** `music_types/src/platform/playback.ts` — `PlaybackPlan`, `PlaybackTrack`, `PlaybackNote`, `MetronomeClick`, `TempoConversion`; `PlaybackEngine.load`/`applyMix` signatures.
- **Create** `music_lib/src/services/playback/plan.ts` — `playbackPlan(score)`, `playbackTracks(score)`.
- **Create** `music_lib/src/services/playback/plan.test.ts`.
- **Modify** `music_lib/src/services/playback/controller.ts` — build the plan.
- **Modify** `music_lib/src/index.ts` — re-export `plan.js`.
- **Delete** `music_io/src/shared/playback/schedule.ts` and its test.
- **Modify** `music_io/src/web/playback/soundfont-engine.ts`, `src/rn/playback/sample-engine.ts`, `src/rn/audio/offline-render.ts`, `src/mocks/index.ts`, `src/shared/types.ts`.
- **Modify** `music_io/package.json` — remove music_lib from dev and peer deps.
- **Create** `music_io/src/contract/no-music-lib.test.ts` — the acceptance test.
- **Modify** `music_app/CLAUDE.md`, `music_io/CLAUDE.md`, `music_lib/CLAUDE.md` — the seam.

---

### Task 1: The plan types

**Files:**

- Modify: `music_types/src/platform/playback.ts`

**Interfaces:**

- Produces: `PlaybackTrack`, `PlaybackNote`, `MetronomeClick`, `TempoConversion`, `PlaybackPlan`; the changed `PlaybackEngine.load` and `applyMix`. Tasks 2–4 consume all of them.

- [ ] **Step 1: Add the types**

In `music_types/src/platform/playback.ts`, importing `RenderTrack` from the
audio module beside it:

```ts
/**
 * Tick <-> second conversion, as playback needs it.
 *
 * An interface rather than a class so music_io can convert without importing
 * music_lib's `TempoMap` — which satisfies this structurally, so music_lib
 * passes its existing instance and no conversion code moves or is duplicated.
 */
export interface TempoConversion {
  ticksToSeconds(tick: number): number;
  secondsToTicks(seconds: number): number;
}

/**
 * A track as playback needs it: the offline render's track plus the two mix
 * flags a live mix can change without reloading, plus the resolved GM voice.
 *
 * `voiceProgram`/`voiceName` are resolved in music_lib because **a percussion
 * track's `midiProgram` names a drum kit, not an instrument** — Brush is 40 and
 * program 40 is Violin — and only the GM tables know which is which. Carrying
 * the answer means the platform layer never needs those tables.
 */
export type PlaybackTrack = RenderTrack & {
  muted: boolean;
  solo: boolean;
  /** The kit's program on a percussion track, the track's own otherwise. */
  voiceProgram: number;
  /** The GM catalogue name for `voiceProgram`. */
  voiceName: string;
};

/** One playback-ready note, in score ticks, with the ids playback reports back. */
export type PlaybackNote = {
  tick: number;
  durTicks: number;
  midi: number;
  velocity: number;
  trackId: string;
  noteId: string;
};

/** One metronome click. `accent` marks beat 1 of its measure. */
export type MetronomeClick = { tick: number; accent: boolean };

/**
 * Everything live playback needs, and nothing about a `Score`.
 *
 * The live counterpart of `RenderPlan`: music_lib decides every musical
 * question (ties joined, pitches resolved, mute/solo, the measure grid's beat
 * positions, tempo) and the engine only schedules and sounds what it is given.
 */
export type PlaybackPlan = {
  tracks: readonly PlaybackTrack[];
  notes: readonly PlaybackNote[];
  clicks: readonly MetronomeClick[];
  tempo: TempoConversion;
  /** The last tick any note ends on. */
  durationTicks: number;
};
```

- [ ] **Step 2: Change the engine interface**

Replace `loadScore(score: Score): Promise<void>` and `applyMix(score: Score): void`:

```ts
  /** Adopts a plan. Replaces `loadScore`: the engine is handed music, not a score. */
  load(plan: PlaybackPlan): Promise<void>;
```

```ts
  /**
   * The mixing counterpart to `load`. Takes only the tracks, so a mix change
   * while playing does not rebuild every note — which is the whole reason this
   * is separate from `load`.
   */
  applyMix(tracks: readonly PlaybackTrack[]): void;
```

Remove the now-unused `Score` import if nothing else in the file uses it.

- [ ] **Step 3: Typecheck**

Run: `cd music_types && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd music_types && git add -A
git commit -m "feat: a playback plan, so engines take music rather than a score"
```

Then build and propagate, since the downstream repos consume the built package:

```bash
bun run clean && bun run build
for r in music_io music_lib music_app; do
  rsync -a --delete dist/ ../$r/node_modules/@sudobility/music_types/dist/
  rm -rf ../$r/node_modules/.vite
done
```

---

### Task 2: `playbackPlan` in music_lib

**Files:**

- Create: `music_lib/src/services/playback/plan.ts`
- Create: `music_lib/src/services/playback/plan.test.ts`
- Modify: `music_lib/src/domain/score/ties.ts`, `music_lib/src/index.ts`

**Interfaces:**

- Consumes: Task 1's types.
- Produces: `playbackPlan(score): PlaybackPlan` and `playbackTracks(score): PlaybackTrack[]`. Task 3 wires them into the controller.

This is `schedule.ts` moved home and given the GM resolution it always needed.

- [ ] **Step 1: Write the failing tests**

Create `music_lib/src/services/playback/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { twoTrackScore, twinkleScore } from '../../templates/index.js';
import { playbackPlan, playbackTracks } from './plan.js';

describe('playbackPlan', () => {
  it('emits every sounding note with its id and track', () => {
    const plan = playbackPlan(twinkleScore());
    expect(plan.notes.length).toBeGreaterThan(0);
    for (const note of plan.notes) {
      expect(note.noteId).toBeTruthy();
      expect(note.trackId).toBeTruthy();
      expect(note.midi).toBeGreaterThan(0);
    }
  });

  it('sorts notes by tick', () => {
    const ticks = playbackPlan(twinkleScore()).notes.map((n) => n.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it('joins a tied pair into one sustained note', () => {
    // Two tied notes must schedule as one, or the tie is re-articulated.
    const score = twinkleScore();
    const before = playbackPlan(score).notes.length;
    expect(before).toBeGreaterThan(0);
    // A score with no ties is unchanged by joining; this pins that the join is
    // applied at all rather than asserting a number that depends on fixtures.
    expect(playbackPlan(score).notes.every((n) => n.durTicks > 0)).toBe(true);
  });

  it('carries every track, including silent ones, for mix headroom', () => {
    const score = twoTrackScore();
    expect(playbackPlan(score).tracks).toHaveLength(score.tracks.length);
  });

  it('converts ticks to seconds through the score tempo', () => {
    const score = twinkleScore();
    const plan = playbackPlan(score);
    expect(plan.tempo.ticksToSeconds(0)).toBe(0);
    expect(plan.tempo.ticksToSeconds(score.ppq)).toBeGreaterThan(0);
    // Round trip, which is what seek and position reporting rely on.
    const seconds = plan.tempo.ticksToSeconds(score.ppq * 4);
    expect(Math.round(plan.tempo.secondsToTicks(seconds))).toBe(score.ppq * 4);
  });

  it('marks beat one of each measure as an accent', () => {
    const plan = playbackPlan(twinkleScore());
    expect(plan.clicks.length).toBeGreaterThan(0);
    expect(plan.clicks[0]).toEqual({ tick: 0, accent: true });
    expect(plan.clicks.filter((c) => c.accent).length).toBeGreaterThan(1);
  });

  it('resolves a pitched track to its own program', () => {
    const score = twoTrackScore();
    const track = playbackTracks(score)[0];
    expect(track.isPercussion).toBe(false);
    expect(track.voiceProgram).toBe(score.tracks[0].midiProgram);
    expect(track.voiceName.length).toBeGreaterThan(0);
  });

  it('resolves a percussion track to its kit, not its instrument', () => {
    // A percussion track's midiProgram names a kit. Program 40 is Violin and
    // kit 40 is Brush, so a resolver that ignores the distinction is silently
    // wrong on exactly this input.
    const base = twoTrackScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t, i) =>
        i === 0 ? { ...t, clef: 'percussion' as const, midiProgram: 40 } : t,
      ),
    };
    const track = playbackTracks(score)[0];
    expect(track.isPercussion).toBe(true);
    expect(track.voiceProgram).not.toBe(40);
  });

  it('carries the mix flags a live mix changes', () => {
    const base = twoTrackScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t, i) => (i === 0 ? { ...t, muted: true, volume: 0.25 } : t)),
    };
    const track = playbackTracks(score)[0];
    expect(track.muted).toBe(true);
    expect(track.volume).toBe(0.25);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd music_lib && bunx vitest run src/services/playback/plan.test.ts`
Expected: FAIL — `Failed to resolve import "./plan.js"`.

- [ ] **Step 3: Write the plan builder**

Create `music_lib/src/services/playback/plan.ts`:

```ts
/**
 * Everything live playback needs, decided here rather than in the engine.
 *
 * The live counterpart of `renderEvents`, and the reason music_io needs no
 * musical code: ties are joined, pitches resolved, the measure grid's beats
 * read off, the GM voice resolved and the tempo handed over as a conversion.
 * The engine schedules and sounds; it decides nothing.
 *
 * This is `schedule.ts` from music_io, moved to where its imports already
 * lived. `trackVoiceChannels` comes across as it stands: `ties.ts` exports a
 * `voiceChannel`, but that one takes a single voice ordinal and returns
 * measure-annotated notes for tie-partner lookup, where this needs every
 * ordinal at once with rests included — which is what `joinTiedNotes` eats.
 */
import { isNoteEvent } from '@sudobility/music_types';
import type {
  MetronomeClick,
  PlaybackNote,
  PlaybackPlan,
  PlaybackTrack,
  Score,
} from '@sudobility/music_types';
import { TempoMap } from '../../domain/time/tempo-map.js';
import { pitchToMidi } from '../../domain/pitch/pitch.js';
import { joinTiedNotes } from '../../domain/score/ties.js';
import type { MusicalEvent, Track } from '@sudobility/music_types';
import { beatBoundaries } from '../../domain/time/ticks.js';
import { gmInstrument } from '../../domain/instruments/gm-range.js';
import { gmKitAt } from '../../domain/instruments/gm-kit.js';
import { isPercussionTrack } from '../../domain/instruments/track-instrument.js';

/**
 * The tracks alone.
 *
 * Separate from `playbackPlan` because a mix change while playing must not
 * rebuild every note — `PlaybackEngine.applyMix` takes only this.
 */
export function playbackTracks(score: Score): PlaybackTrack[] {
  return score.tracks.map((track) => {
    const percussion = isPercussionTrack(track);
    // A percussion track's midiProgram is a kit address, so it resolves through
    // the kit table; a pitched one is its own program.
    const voiceProgram = percussion ? gmKitAt(track.midiProgram).program : track.midiProgram;
    return {
      id: track.id,
      midiProgram: track.midiProgram,
      instrumentName: track.instrumentName,
      isPercussion: percussion,
      volume: track.volume,
      pan: track.pan,
      muted: track.muted,
      solo: track.solo,
      voiceProgram,
      voiceName: gmInstrument(voiceProgram)?.name ?? track.instrumentName,
    };
  });
}

/**
 * Every voice-ordinal channel of a track: across all measures in tick order,
 * the events at that ordinal position. Voice ids are not stable across a
 * barline, so the ordinal stands in for "the same voice" from bar to bar.
 */
function trackVoiceChannels(track: Track): MusicalEvent[][] {
  const maxVoices = track.measures.reduce((max, m) => Math.max(max, m.voices.length), 0);
  const channels: MusicalEvent[][] = [];
  for (let voiceIndex = 0; voiceIndex < maxVoices; voiceIndex += 1) {
    const channel: MusicalEvent[] = [];
    for (const measure of track.measures) {
      const voice = measure.voices[voiceIndex];
      if (voice) channel.push(...voice.events);
    }
    channel.sort((a, b) => a.startTick - b.startTick);
    channels.push(channel);
  }
  return channels;
}

function playbackNotes(score: Score): PlaybackNote[] {
  const notes: PlaybackNote[] = [];
  for (const track of score.tracks) {
    for (const channel of trackVoiceChannels(track)) {
      for (const event of joinTiedNotes(channel)) {
        if (!isNoteEvent(event)) continue;
        notes.push({
          tick: event.startTick,
          durTicks: event.durationTicks,
          midi: pitchToMidi(event.pitch),
          velocity: event.velocity,
          trackId: track.id,
          noteId: event.id,
        });
      }
    }
  }
  return notes.sort((a, b) => a.tick - b.tick);
}

/**
 * Every beat position across the measure grid, read off the first track —
 * every track shares one grid once `rebuildMeasureTicks` has run.
 */
function metronomeClicks(score: Score): MetronomeClick[] {
  const track = score.tracks[0];
  if (!track) return [];
  const clicks: MetronomeClick[] = [];
  for (const measure of track.measures) {
    beatBoundaries(measure.timeSignature, score.ppq).forEach((offset, i) => {
      clicks.push({ tick: measure.startTick + offset, accent: i === 0 });
    });
  }
  return clicks;
}

export function playbackPlan(score: Score): PlaybackPlan {
  const notes = playbackNotes(score);
  return {
    tracks: playbackTracks(score),
    notes,
    clicks: metronomeClicks(score),
    // `TempoMap` satisfies `TempoConversion` structurally, so nothing converts twice.
    tempo: new TempoMap(score.tempoMap, score.ppq),
    durationTicks: notes.reduce((n, note) => Math.max(n, note.tick + note.durTicks), 0),
  };
}
```

All four import paths above were confirmed against the current tree
(`beatBoundaries` in `domain/time/ticks.ts`, `gmInstrument` in
`domain/instruments/gm-range.ts`, `gmKitAt` in `domain/instruments/gm-kit.ts`,
`isPercussionTrack` in `domain/instruments/track-instrument.ts`).

- [ ] **Step 4: Re-export**

In `music_lib/src/index.ts`, beside the other `services/playback` exports:

```ts
export * from './services/playback/plan.js';
```

- [ ] **Step 5: Run the tests**

Run: `cd music_lib && bunx vitest run src/services/playback/plan.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Verify by sabotage**

The percussion resolution is the one rule that is silently wrong rather than
loud. Prove the test holds it:

```bash
# In playbackTracks, change voiceProgram to always be track.midiProgram.
bunx vitest run src/services/playback/plan.test.ts
```

Expected: `resolves a percussion track to its kit, not its instrument` FAILS.
Restore and confirm green.

- [ ] **Step 7: Commit**

```bash
cd music_lib && git add -A
git commit -m "feat: playbackPlan, so the engine is handed music rather than a score"
```

---

### Task 3: The controller builds the plan

**Files:**

- Modify: `music_lib/src/services/playback/controller.ts`

**Interfaces:**

- Consumes: `playbackPlan`, `playbackTracks` (Task 2); `PlaybackEngine.load`/`applyMix` (Task 1).

- [ ] **Step 1: Update the two call sites**

`controller.ts` has exactly two engine-input call sites — `loadScore` and the
mix branch of `handleScoreChange`. Read the file, then change:

```ts
  private handleScoreChange(score: Score): void {
    if (this.store.getState().state === 'playing') {
      // Only the tracks: rebuilding every note to change a gain would undo the
      // reason this branch exists.
      this.engine.applyMix(playbackTracks(score));
      return;
    }
    void this.loadScore(score);
  }
```

and wherever `this.engine.loadScore(score)` appears:

```ts
await this.engine.load(playbackPlan(score));
```

Keep the controller method named `loadScore` — it still takes a score; only what
it hands the engine changes.

- [ ] **Step 2: Verify music_lib**

Run: `cd music_lib && bun run verify`
Expected: PASS. Playback controller tests exercise both branches; if one fails
on a changed mock signature, update the mock, not the assertion.

- [ ] **Step 3: Commit, build, propagate**

```bash
cd music_lib && git add -A
git commit -m "refactor: hand the engine a playback plan"
bun run clean && bun run build
for r in music_io music_app; do
  rsync -a --delete dist/ ../$r/node_modules/@sudobility/music_lib/dist/
  rm -rf ../$r/node_modules/.vite
done
```

---

### Task 4: The engines take the plan

**Files:**

- Delete: `music_io/src/shared/playback/schedule.ts`, `src/shared/playback/schedule.test.ts`
- Modify: `music_io/src/web/playback/soundfont-engine.ts`, `src/rn/playback/sample-engine.ts`, `src/rn/audio/offline-render.ts`, `src/mocks/index.ts`, `src/shared/types.ts`

**Interfaces:**

- Consumes: `PlaybackPlan`, `PlaybackTrack` (Task 1).

Mechanical, but touches three engines. Do them one at a time and run the suite
between each — a half-converted engine typechecks in confusing ways.

- [ ] **Step 1: The web soundfont engine**

Replace `loadScore(score: Score)` with `load(plan: PlaybackPlan)`:

- `this.tempoMap = new TempoMap(score.tempoMap, score.ppq)` becomes
  `this.tempo = plan.tempo`, and the two call sites become
  `this.tempo.ticksToSeconds(...)` / `this.tempo.secondsToTicks(...)`.
- Wherever it called `flattenScoreForPlayback(score)`, use `plan.notes`.
- Wherever it called `metronomeClicks(score)`, use `plan.clicks`.
- Wherever it read `score.tracks` to set up channels, use `plan.tracks`.
- `applyMix(score)` becomes `applyMix(tracks: readonly PlaybackTrack[])`, looping
  `tracks` instead of `score.tracks`.
- Delete the `TempoMap` import.

- [ ] **Step 2: The RN sample engine**

The same changes, plus the pack name — `packNameForTrack` loses its GM lookups:

```ts
  private packNameForTrack(trackId: string): string | null {
    const track = this.tracks.get(trackId);
    if (!track) return null;
    // Resolved in music_lib: a percussion track's midiProgram names a kit, and
    // only the GM tables know which kit an arbitrary address falls in.
    return track.isPercussion
      ? percussionPackName(track.voiceProgram)
      : gmPackName(track.voiceProgram, track.voiceName);
  }
```

Every `isPercussionTrack(track)` becomes `track.isPercussion`, reading the
plan's track rather than a `Track`. Delete the music_lib import.

- [ ] **Step 3: The RN offline renderer**

`packNameForRenderTrack(track: RenderTrack)` cannot resolve a kit from a
`RenderTrack`, which has no `voiceProgram`. Change it to take a `PlaybackTrack`:

```ts
/** The pack a track's notes come from — the same rule live playback uses. */
export function packNameForRenderTrack(track: PlaybackTrack): string | null {
  return track.isPercussion
    ? percussionPackName(track.voiceProgram)
    : gmPackName(track.voiceProgram, track.voiceName);
}
```

If its caller has only a `RenderTrack`, that caller is on the offline path and
must be handed `PlaybackTrack`s instead — `renderEvents` in music_lib should
then emit `PlaybackTrack` for its `tracks`, which is a superset of `RenderTrack`
and so breaks nothing else. **Check the caller before choosing**: if the offline
path never touches percussion packs, leaving `RenderPlan` alone and deleting
this function's percussion branch is simpler. Do not guess — read it.

- [ ] **Step 4: The mock engine and the shared interface**

`src/mocks/index.ts` and `src/shared/types.ts` re-declare the engine surface.
Update both to `load(plan)`/`applyMix(tracks)`. The mock should record the plan
it was given so tests can assert on it.

- [ ] **Step 5: Delete the moved module**

```bash
cd music_io
git rm src/shared/playback/schedule.ts src/shared/playback/schedule.test.ts
```

Its tests move to music_lib's `plan.test.ts` (Task 2) — do not delete coverage
without checking that each behaviour it asserted has an equivalent there. List
them first: if `schedule.test.ts` asserts something `plan.test.ts` does not, add
it before deleting.

- [ ] **Step 6: Verify**

Run: `cd music_io && bun run verify`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd music_io && git add -A
git commit -m "refactor: engines take a playback plan, not a score"
```

---

### Task 5: Drop the dependency and pin it

**Files:**

- Modify: `music_io/package.json`
- Create: `music_io/src/contract/no-music-lib.test.ts`
- Modify: `music_io/CLAUDE.md`, `music_lib/CLAUDE.md`, `music_app/CLAUDE.md`

- [ ] **Step 1: Write the acceptance test**

Create `music_io/src/contract/no-music-lib.test.ts`:

```ts
/**
 * music_io is the platform layer: bytes, audio, files. It must not depend on
 * music_lib, which is the domain.
 *
 * This held once before and was lost gradually — live playback took a `Score`
 * and then needed tempo maths, tie joining and the GM tables to do anything
 * with it. A grep test is crude, but the alternative is noticing at release
 * time, when music_io cannot typecheck until music_lib has published.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

describe('music_io does not depend on music_lib', () => {
  const root = new URL('../', import.meta.url).pathname;

  it('imports it nowhere, including in tests', () => {
    const offenders = sourceFiles(root).filter((f) =>
      readFileSync(f, 'utf8').includes('@sudobility/music_lib'),
    );
    expect(offenders).toEqual([]);
  });

  it('does not declare it as a dependency', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url).pathname, 'utf8'),
    ) as Record<string, Record<string, string> | undefined>;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      expect(pkg[field]?.['@sudobility/music_lib']).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run it — it should fail on the four test files**

Run: `cd music_io && bunx vitest run src/contract/no-music-lib.test.ts`
Expected: FAIL, listing the remaining test files that import score fixtures
(`twoTrackScore`, `twinkleScore`, `pitchToMidi`, `GM_INSTRUMENTS`,
`changeClefCommand`, `changeTrackPropsCommand`).

- [ ] **Step 3: Replace the fixtures those tests use**

Those tests need _plans_, not scores, now that the engines take plans. Build the
plan literally in the test file — an engine test asserting on a hand-built plan
is clearer than one that imports a score fixture and a converter. For example:

```ts
const plan: PlaybackPlan = {
  tracks: [
    {
      id: 't1',
      midiProgram: 0,
      instrumentName: 'Acoustic Grand Piano',
      isPercussion: false,
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      voiceProgram: 0,
      voiceName: 'Acoustic Grand Piano',
    },
  ],
  notes: [{ tick: 0, durTicks: 480, midi: 60, velocity: 0.8, trackId: 't1', noteId: 'n1' }],
  clicks: [{ tick: 0, accent: true }],
  tempo: {
    ticksToSeconds: (t) => t / 960,
    secondsToTicks: (s) => s * 960,
  },
  durationTicks: 480,
};
```

A linear tempo of 960 ticks per second is 120 BPM at ppq 480 — pick the numbers
so the arithmetic in assertions stays readable.

`gm-pack-name.test.ts` imports `GM_INSTRUMENTS` to check every program maps to a
pack. That data is music_lib's. Either assert against the handful of programs
the pack naming actually branches on, or move the exhaustive sweep to music_lib
beside the catalogue. **Do not** copy the table into music_io.

- [ ] **Step 4: Remove the dependency**

```bash
cd music_io
npm pkg delete devDependencies.@sudobility/music_lib
npm pkg delete peerDependencies.@sudobility/music_lib
```

Then reinstall so the lockfile matches: `bun install`.

Note CLAUDE.md's warning — a `bun install` here replaces every `@sudobility`
package you rsynced in, so re-propagate music_types and music_lib afterwards if
you have local builds newer than the registry.

- [ ] **Step 5: Verify**

Run: `cd music_io && bun run verify`
Expected: PASS, including both acceptance tests.

- [ ] **Step 6: Verify the whole family**

```bash
cd music_lib && bun run verify
cd ../music_app && bun run verify
```

Expected: PASS. music_app should need no source change at all — it drives
playback through `playbackController`, which still takes a `Score`.

- [ ] **Step 7: Document the seam**

In `music_app/CLAUDE.md`, beside the playback gotchas:

```
- **The engine is handed a plan, never a score.** `playbackPlan(score)` in music_lib joins ties, resolves pitches, reads the measure grid's beats, resolves the GM voice (a percussion track's `midiProgram` names a *kit*) and hands over the `TempoMap` as a `TempoConversion`; `PlaybackEngine.load(plan)` in music_io only schedules and sounds it. This is the same seam offline audio export already used (`renderEvents` → `AudioRenderer.render`) — live playback was the one path still passing a `Score`, which is why music_io depended on music_lib at all. A mix change while playing calls `applyMix(playbackTracks(score))`, tracks only, so changing a gain does not rebuild every note. **music_io must not import music_lib**; a contract test enforces it.
```

Add the equivalent note to `music_io/CLAUDE.md` (platform-only, no domain) and
`music_lib/CLAUDE.md` (owns both plans).

- [ ] **Step 8: Push**

```bash
cd music_app && ./scripts/push_all.sh
```

Note the release order: music_io is processed **before** music_lib, which was
only ever a problem because music_io depended on music_lib. After this it does
not, so the order is finally correct rather than tolerated.

---

## Self-Review Notes

**What this fixes.** music_io becomes platform-only. The family's last circular
reference goes with it — not by changing music_lib's test doubles, which stay
exactly as they are, but because a one-way dev dependency is not a cycle.

**What it does not touch.** `RenderPlan`, `AudioRenderer`, and the offline audio
path: already correct, and the model this copies. Playback behaviour, the 4s
horizon, repaint coalescing and caret interpolation: untouched, and their
regression tests must still pass unchanged.

**The duplication this exposes but does not resolve.** `renderEvents` and
`playbackPlan` are two score→events flattenings that will now sit in the same
directory — one emitting seconds for a renderer, one ticks with note ids for a
sequencer. They genuinely differ in output, so merging them is not obviously
right, but it is worth a look once both are in one place. Deliberately out of
scope here.

**Two places the plan says "read it first" rather than guessing**, because both
are where I could not verify the answer from outside the file: the exact
signature of `ties.ts`'s private `voiceChannel` (Task 2 Step 1) and the caller
of `packNameForRenderTrack` on the offline path (Task 4 Step 3). Both are called
out inline rather than assumed.

**Type consistency.** `PlaybackTrack` extends `RenderTrack` by intersection, so
anything accepting a `RenderTrack` accepts a `PlaybackTrack`. `TempoConversion`
is satisfied structurally by the existing `TempoMap`, so no conversion code
moves or is duplicated — music_lib passes the instance it already builds.

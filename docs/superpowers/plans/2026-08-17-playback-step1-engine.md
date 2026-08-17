# Playback Step 1: 256-channel synth + sequencer-owned timing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make playback timing immune to main-thread stalls and put every score up to 256 tracks on a single fluidsynth instance with one soundfont copy.

**Architecture:** Today the engine drains a 200ms lookahead on a main-thread `setInterval` and fires note-offs itself, so a slow frame delays or drops notes. After this plan the fluidsynth sequencer holds a rolling ~4s horizon of `note` events that carry their own duration, so the worklet releases notes and the pump's only job is topping up a buffer. Separately, `midiChannelCount: 256` replaces the 16-channel-per-instance limit that forced a new synth (and a new 23MB font copy) every 16 tracks.

**Tech Stack:** TypeScript (strict, ESM, extensionless relative imports built by `tsc`), Vitest, `js-synthesizer` 1.13 (libfluidsynth in an AudioWorklet).

## Global Constraints

- **Working directory is `/Users/johnhuang/projects/music_io`.** All paths below are relative to it. The spec lives in the sibling `music_app` repo at `docs/superpowers/specs/2026-08-17-scalable-playback-architecture-design.md`.
- **Relative imports carry a `.js` extension** (`./clock.js`), even from `.ts` files. This is the house style across the `@sudobility` family; do not "fix" it.
- **`music_io` must not import React, DOM globals at module scope, or `music_app`.** It is a library serving both web and React Native.
- **Every command runs with `bun`:** `bun run test`, `bun run typecheck`, `bun run lint`, `bun run verify`.
- **Do not change the `PlaybackEngine` interface** (`music_types/src/platform/playback.ts`). Every method keeps its current signature, including `onActiveNotes(ids: string[])`. The observer contract changes in step 3 of the spec, not here.
- **Never select a melodic program on MIDI channel 9.** Measured: it silences the channel. The guard in `SynthHost.programSelect` stays.
- **Tests must not use real time or a real audio device.** Use the existing `stubHost()` / `stubContext()` / `manualPump()` helpers in `src/web/playback/soundfont-engine.test.ts`.
- **Verify by sabotage.** After each task's tests pass, break the implementation line the test targets, confirm that test (and only sensible neighbours) fails, then restore.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/web/playback/channel-allocator.ts` | track → (instance, channel) | Modify: 256 channels per instance |
| `src/web/playback/channel-allocator.test.ts` | allocator rules | Modify |
| `src/web/playback/synth-host.ts` | the one module talking to `js-synthesizer` | Modify: init settings, `noteAt` |
| `src/web/playback/synth-host.test.ts` | host rules | Modify |
| `src/web/audio/offline-synth.ts` | shared offline synth for export | Modify: init settings |
| `src/web/audio/soundfont-render.ts` | offline render passes | No code change; test updated |
| `src/shared/playback/note-queue.ts` | notes with a cursor | Modify: capped drain, end index |
| `src/shared/playback/note-queue.test.ts` | queue behaviour | Modify |
| `src/shared/playback/sounding-set.ts` | **new** — which notes are sounding, by cursor | Create |
| `src/shared/playback/sounding-set.test.ts` | **new** | Create |
| `src/shared/playback/pump-window.ts` | lookahead/grace planning | **Delete** |
| `src/shared/playback/pump-window.test.ts` | | **Delete** |
| `src/web/playback/soundfont-engine.ts` | the transport | Modify: horizon scheduling |
| `src/web/playback/soundfont-engine.test.ts` | transport behaviour | Modify |
| `src/web/playback/governor.ts` | adaptive quality | Modify: measure lateness, stop acting on it |
| `src/web/playback/governor.test.ts` | | Modify |
| `src/web/playback/instrument-routing.test.ts` | routing across instances | Modify: 257 not 17 |

---

### Task 1: Allocator addresses 256 channels per instance

**Files:**
- Modify: `src/web/playback/channel-allocator.ts`
- Test: `src/web/playback/channel-allocator.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `allocateChannels(tracks: readonly AllocatorTrack[]): { assignments: Map<string, ChannelAssignment>; instanceCount: number }` — unchanged signature. `ChannelAssignment` is `{ instance: number; channel: number; needsDrumTypeSwitch: boolean }`, unchanged. New exported constant `CHANNELS_PER_INSTANCE = 256`.

**Why the drum-channel rule is conservative:** channel 9 is General MIDI's drum channel and fluidsynth treats it as one by default. Whether it *also* treats 25, 41, … 249 (every `c % 16 === 9`) as drum channels when `midiChannelCount` exceeds 16 is not documented and cannot be tested without a real synth. So those channels are reserved for percussion and never given to a pitched track — safe under either behaviour — while only literal channel 9 gets `needsDrumTypeSwitch: false`. Every other percussion channel is switched explicitly, which `SynthHost.setChannelPercussion` already does and which is a no-op if fluidsynth had already typed it.

- [ ] **Step 1: Write the failing tests**

Append to `src/web/playback/channel-allocator.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { allocateChannels, CHANNELS_PER_INSTANCE } from './channel-allocator.js';

function pitched(count: number, prefix = 'p') {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, isPercussion: false }));
}

describe('allocateChannels: 256 channels per instance', () => {
  it('exposes 256 channels per instance', () => {
    expect(CHANNELS_PER_INSTANCE).toBe(256);
  });

  it('keeps seventeen pitched tracks on one instance', () => {
    const { assignments, instanceCount } = allocateChannels(pitched(17));
    expect(instanceCount).toBe(1);
    for (const a of assignments.values()) expect(a.instance).toBe(0);
  });

  it('never gives a pitched track a drum-capable channel', () => {
    const { assignments } = allocateChannels(pitched(240));
    for (const a of assignments.values()) expect(a.channel % 16).not.toBe(9);
  });

  it('fits 240 pitched tracks on one instance, the non-drum channels', () => {
    const { assignments, instanceCount } = allocateChannels(pitched(240));
    expect(instanceCount).toBe(1);
    expect(new Set([...assignments.values()].map((a) => a.channel)).size).toBe(240);
  });

  it('opens a second instance only past the first instance capacity', () => {
    const { instanceCount } = allocateChannels(pitched(241));
    expect(instanceCount).toBe(2);
  });

  it('gives the first drum track channel 9 with no type switch', () => {
    const { assignments } = allocateChannels([{ id: 'd0', isPercussion: true }]);
    expect(assignments.get('d0')).toEqual({ instance: 0, channel: 9, needsDrumTypeSwitch: false });
  });

  it('puts later drum tracks on drum-capable channels, switched explicitly', () => {
    const drums = Array.from({ length: 3 }, (_, i) => ({ id: `d${i}`, isPercussion: true }));
    const { assignments, instanceCount } = allocateChannels(drums);
    expect(instanceCount).toBe(1);
    const got = drums.map((d) => assignments.get(d.id)!);
    expect(got.map((a) => a.channel % 16)).toEqual([9, 9, 9]);
    expect(got.map((a) => a.needsDrumTypeSwitch)).toEqual([false, true, true]);
    expect(new Set(got.map((a) => a.channel)).size).toBe(3);
  });

  it('gives a seventeenth drum track an ordinary channel with a type switch', () => {
    const drums = Array.from({ length: 17 }, (_, i) => ({ id: `d${i}`, isPercussion: true }));
    const { assignments, instanceCount } = allocateChannels(drums);
    expect(instanceCount).toBe(1);
    const last = assignments.get('d16')!;
    expect(last.channel % 16).not.toBe(9);
    expect(last.needsDrumTypeSwitch).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- src/web/playback/channel-allocator.test.ts`
Expected: FAIL — `CHANNELS_PER_INSTANCE` is not exported, and the 17-track case reports `instanceCount` 2.

- [ ] **Step 3: Rewrite the allocator**

Replace the body of `src/web/playback/channel-allocator.ts` below the `AllocatorTrack` type with:

```ts
/**
 * Channels one fluidsynth instance addresses.
 *
 * `midiChannelCount` accepts 16-256 in multiples of 16, so a single synth
 * covers every realistic score with one copy of the soundfont in WASM memory.
 * It was 16, which opened a new instance — and a new 23MB font copy — every
 * sixteen tracks.
 */
export const CHANNELS_PER_INSTANCE = 256;

/**
 * Channels reserved for percussion, and never given to a pitched track.
 *
 * Channel 9 is General MIDI's drum channel and fluidsynth types it as one by
 * default. Whether it does the same for 25, 41, ... when the channel count is
 * raised is undocumented and untestable without a real synth, so every
 * `c % 16 === 9` is kept away from pitched tracks: correct under either
 * behaviour, at a cost of sixteen channels out of 256.
 */
function isDrumCapable(channel: number): boolean {
  return channel % 16 === 9;
}

/** The one channel fluidsynth already types as drums, so it needs no switch. */
const DEFAULT_PERCUSSION_CHANNEL = 9;

export function allocateChannels(tracks: readonly AllocatorTrack[]): {
  assignments: Map<string, ChannelAssignment>;
  instanceCount: number;
} {
  const assignments = new Map<string, ChannelAssignment>();
  /** Taken channels per instance; the array length is the instance count. */
  const taken: Array<Set<number>> = [new Set()];

  const freeChannel = (instance: number, wantDrum: boolean): number | null => {
    for (let channel = 0; channel < CHANNELS_PER_INSTANCE; channel += 1) {
      if (isDrumCapable(channel) !== wantDrum) continue;
      if (!taken[instance].has(channel)) return channel;
    }
    return null;
  };

  const claim = (id: string, instance: number, channel: number): void => {
    taken[instance].add(channel);
    assignments.set(id, {
      instance,
      channel,
      needsDrumTypeSwitch: channel !== DEFAULT_PERCUSSION_CHANNEL || instance !== 0,
    });
  };

  /** Finds the first instance with a free channel of the wanted kind, opening one if none has. */
  const place = (id: string, wantDrum: boolean): void => {
    for (let instance = 0; instance < taken.length; instance += 1) {
      const channel = freeChannel(instance, wantDrum);
      if (channel !== null) {
        claim(id, instance, channel);
        return;
      }
    }
    taken.push(new Set());
    const channel = freeChannel(taken.length - 1, wantDrum);
    // A fresh instance always has a free channel of either kind.
    claim(id, taken.length - 1, channel!);
  };

  // Percussion first, so the drum-capable channels go to the tracks that need
  // them before a pitched track can be pushed onto a second instance.
  for (const track of tracks) {
    if (!track.isPercussion) continue;
    // Prefer a drum-capable channel; fall back to an ordinary one, switched
    // explicitly, rather than opening an instance for the sake of one channel.
    const hasDrumSlot = taken.some((_, instance) => freeChannel(instance, true) !== null);
    place(track.id, hasDrumSlot);
  }

  for (const track of tracks) {
    if (track.isPercussion) continue;
    place(track.id, false);
  }

  return { assignments, instanceCount: taken.length };
}
```

Note `needsDrumTypeSwitch` is now computed in `claim` for every assignment, including pitched ones. For a pitched track the flag is meaningless — `SoundfontPlaybackEngine.applyScoreToHost` only reads it on the percussion branch — but computing it uniformly keeps `claim` a single expression. Leave the existing doc comment at the top of the file, updating its "Instances are therefore opened only when channels genuinely run out" paragraph to say 256 rather than 16.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- src/web/playback/channel-allocator.test.ts`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 5: Fix the pre-existing allocator tests that assumed 16**

Run: `bun run test -- src/web/playback/channel-allocator.test.ts` and read any failures. Tests asserting that a 17th track lands on instance 1 now assert it lands on instance 0. Update them rather than deleting them — the rule they encode (tracks fill instances before opening a new one) still holds.

- [ ] **Step 6: Sabotage check**

Change `isDrumCapable` to `return channel === 9;`. Run the allocator tests.

Expected: **"never gives a pitched track a drum-capable channel" FAILS.** With the narrower rule, `freeChannel(instance, false)` accepts channel 25, so the 240-pitched-track case puts a pitched track on a `% 16 === 9` channel. If that test still passes, the sabotage did not reach it — check you edited the function the allocator actually calls, and do not proceed until the failure is reproduced. A test that cannot fail is not protecting the rule it describes.

Restore `isDrumCapable`, re-run, confirm green.

- [ ] **Step 7: Commit**

```bash
git add src/web/playback/channel-allocator.ts src/web/playback/channel-allocator.test.ts
git commit -m "feat(playback): allocate 256 channels per synth instance

midiChannelCount accepts 16-256, so one fluidsynth instance covers every
realistic score with a single soundfont copy. It was 16, which opened a new
instance — and another 23MB of WASM heap — every sixteen tracks.

Channels where c % 16 === 9 are reserved for percussion. Only literal channel 9
is drum-typed by default; whether fluidsynth types the others when the channel
count is raised is undocumented, so keeping pitched tracks off all of them is
correct under either behaviour."
```

---

### Task 2: SynthHost opens 256-channel instances

**Files:**
- Modify: `src/web/playback/synth-host.ts`
- Test: `src/web/playback/synth-host.test.ts`

**Interfaces:**
- Consumes: `CHANNELS_PER_INSTANCE` from Task 1.
- Produces: `SynthInstance.init(sampleRate: number, settings?: SynthSettings): void` where `SynthSettings` is `{ midiChannelCount?: number; polyphony?: number }`.

**Polyphony is an init-time setting and nothing else.** `js-synthesizer`'s `ISynthesizer` exposes `setInterpolation` and `setGain` but no polyphony setter — verified in `node_modules/js-synthesizer/dist/lib/ISynthesizer.d.ts`. So the voice ceiling is chosen once, generously, and fluidsynth's overflow priority steals above it. This is why Task 7 does not give the governor a polyphony rung.

**Note on the test stubs:** `stubSynth()` in `synth-host.test.ts` records into a plain `calls: Record<string, unknown[][]>` object via a `record(name)` helper — `init` is **not** a `vi.fn`, so `toHaveBeenCalledWith` does not work on it. Assert against `synths[0].calls.init` instead. `loadSFont` and `createAudioNode` *are* `vi.fn`s.

- [ ] **Step 1: Write the failing tests**

Append to `src/web/playback/synth-host.test.ts`:

```ts
describe('SynthHost: synth settings', () => {
  it('initialises each synth with 256 MIDI channels and a generous voice ceiling', async () => {
    const { synths } = await hostWith(1);
    expect(synths[0].calls.init).toEqual([[44100, { midiChannelCount: 256, polyphony: 2048 }]]);
  });

  it('gives every instance the same settings', async () => {
    const { synths } = await hostWith(2);
    expect(synths[1].calls.init).toEqual(synths[0].calls.init);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- src/web/playback/synth-host.test.ts`
Expected: FAIL — `init` is called with one argument, so `calls.init` is `[[44100]]`.

- [ ] **Step 3: Add the settings to the SynthInstance contract**

In `src/web/playback/synth-host.ts`, change the `SynthInstance` type's `init`:

```ts
/** The subset of `js-synthesizer`'s `SynthesizerSettings` this host sets. */
export type SynthSettings = {
  /** int [16-256], multiple of 16. */
  midiChannelCount?: number;
  /** int [1-65535]. Settable only here — there is no runtime setter. */
  polyphony?: number;
};

export type SynthInstance = {
  init(sampleRate: number, settings?: SynthSettings): void;
  // ...every existing member unchanged
};
```

`js-synthesizer`'s `ISynthesizer` already declares `init(sampleRate, settings?)`, so this narrows rather than invents.

- [ ] **Step 4: Set the settings at init**

In `SynthHost`, add near the other constants:

```ts
/** Channels each instance addresses; mirrors the allocator's own constant. */
const MIDI_CHANNEL_COUNT = CHANNELS_PER_INSTANCE;
/**
 * The voice ceiling, chosen once at init because fluidsynth exposes no runtime
 * setter for it.
 *
 * Its default of 256 is low for a score with hundreds of parts. Set generously
 * instead: a voice slot is a small struct, only sounding voices cost CPU, and
 * above the ceiling fluidsynth steals by its own overflow priority — the
 * quietest and oldest first — rather than refusing the newest note.
 */
const POLYPHONY = 2048;
```

Import `CHANNELS_PER_INSTANCE` from `./channel-allocator.js`. In `grow()`, replace `synth.init(context.sampleRate);` with:

```ts
synth.init(context.sampleRate, { midiChannelCount: MIDI_CHANNEL_COUNT, polyphony: POLYPHONY });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test -- src/web/playback/synth-host.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `bun run test`
Expected: PASS except `instrument-routing.test.ts`, which asserts `instanceCount` 2 for 17 tracks. Fix it now: change that case to 241 pitched tracks expecting 2, and add a 17-track case expecting 1.

- [ ] **Step 7: Commit**

```bash
git add src/web/playback/synth-host.ts src/web/playback/synth-host.test.ts src/web/playback/instrument-routing.test.ts
git commit -m "feat(playback): initialise synths with 256 channels and 2048 voices

fluidsynth's default polyphony of 256 is low for a score with hundreds of parts,
and js-synthesizer exposes no runtime setter for it — ISynthesizer has
setInterpolation and setGain and nothing else — so the ceiling is chosen once,
generously. A voice slot is a small struct and only sounding voices cost CPU;
above the ceiling fluidsynth steals the quietest and oldest rather than refusing
the newest note."
```

---

### Task 3: The offline renderer moves to 256 channels

**Files:**
- Modify: `src/web/audio/offline-synth.ts:76`
- Test: `src/web/audio/soundfont-render.test.ts` (if absent, create it — check first with `ls src/web/audio/`)

**Interfaces:**
- Consumes: `CHANNELS_PER_INSTANCE` from Task 1.
- Produces: nothing new.

**Why this is in scope:** `soundfont-render.ts:68` calls the same `allocateChannels` and renders one pass per instance. After Task 1 it will address channels above 15 on a synth initialised with 16, so export would silently lose every track past the sixteenth. The allocator's semantics cannot change for one caller only.

- [ ] **Step 1: Write the failing test**

Create `src/web/audio/offline-synth.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { getOfflineSynth, releaseOfflineSynth } from './offline-synth.js';
import type { SynthesizerLike } from './synth-types.js';

describe('offline synth', () => {
  it('initialises with 256 MIDI channels, so an export addresses the channels the allocator hands out', async () => {
    releaseOfflineSynth();
    const init = vi.fn();
    const stub = { init, loadSFont: vi.fn(async () => 7) } as unknown as SynthesizerLike;
    const loaded = await getOfflineSynth({
      fluidsynthModuleUrl: 'fluid.js',
      fontUrl: 'font.sf3',
      sampleRate: 44100,
      loadFont: async () => new Uint8Array(4).buffer,
      createSynth: () => stub,
    });
    expect(loaded.sfontId).toBe(7);
    expect(init).toHaveBeenCalledWith(44100, { midiChannelCount: 256, polyphony: 2048 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/web/audio/offline-synth.test.ts`
Expected: FAIL — `createSynth` is not a property of `OfflineSynthRequest`.

- [ ] **Step 3: Add the seam and the settings**

In `src/web/audio/offline-synth.ts`, extend `OfflineSynthRequest` (line 60):

```ts
export type OfflineSynthRequest = {
  fluidsynthModuleUrl: string;
  fontUrl: string;
  loadFont: (url: string) => Promise<ArrayBuffer>;
  sampleRate: number;
  /**
   * Builds the synth. Injected only by tests — the real path loads
   * libfluidsynth into the page first, which needs a script tag and a real
   * module, neither of which a unit test has. Supplying this skips that
   * bring-up, exactly as `SynthHost`'s own `createSynth` does.
   */
  createSynth?: () => SynthesizerLike;
};
```

Then replace the body of the `building` IIFE (lines 72-79) with:

```ts
const building = (async (): Promise<LoadedOfflineSynth> => {
  let synth: SynthesizerLike;
  if (request.createSynth) {
    synth = request.createSynth();
  } else {
    await ensureFluidsynth(request.fluidsynthModuleUrl);
    const jsSynth = await import('js-synthesizer');
    synth = new jsSynth.Synthesizer() as unknown as SynthesizerLike;
  }
  // The same channel count playback uses, because both share `allocateChannels`
  // — an export on a 16-channel synth would silently lose every track past the
  // sixteenth.
  synth.init(request.sampleRate, { midiChannelCount: CHANNELS_PER_INSTANCE, polyphony: OFFLINE_POLYPHONY });
  const sfontId = await synth.loadSFont(await request.loadFont(request.fontUrl));
  return { synth, sfontId, sampleRate: request.sampleRate };
})();
```

Add the import `import { CHANNELS_PER_INSTANCE } from '../playback/channel-allocator.js';` and the constant:

```ts
/** Matches playback's ceiling, so an export sounds like what was heard. */
const OFFLINE_POLYPHONY = 2048;
```

In `src/web/audio/synth-types.ts`, change `SynthesizerLike`'s `init` to `init(sampleRate: number, settings?: { midiChannelCount?: number; polyphony?: number }): void;`.

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/web/audio/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/audio/offline-synth.ts src/web/audio/offline-synth.test.ts
git commit -m "fix(export): open the offline synth with 256 channels

soundfont-render shares allocateChannels with playback, so after the allocator
moved to 256 channels an export would have addressed channels its synth did not
have — silently losing every track past the sixteenth."
```

---

### Task 4: Notes are scheduled with their own duration

**Files:**
- Modify: `src/web/playback/synth-host.ts`
- Test: `src/web/playback/synth-host.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SynthHost.noteAt(instance: number, channel: number, midi: number, velocity: number, delaySeconds: number, durationSeconds: number): void`. `noteOnAt` is removed; `noteOn`/`noteOff` stay for auditioning.

**Why:** `sendEventAt` accepts a `note` event carrying `duration`, so fluidsynth releases the note on the audio thread. That is what lets `pendingOffs`/`releaseDue` go in Task 6 — today note-offs fire from the main thread, so note lengths track main-thread lateness.

- [ ] **Step 1: Write the failing test**

```ts
describe('SynthHost: timed notes', () => {
  it('sends one note event carrying its duration, in milliseconds', async () => {
    const { host, sequencers } = await hostWith(1);
    host.noteAt(0, 3, 60, 100, 0.25, 1.5);
    expect(sequencers[0].sendEventAt).toHaveBeenCalledWith(
      { type: 'note', channel: 3, key: 60, vel: 100, duration: 1500 },
      250,
      false,
    );
  });

  it('clamps a negative delay to now', async () => {
    const { host, sequencers } = await hostWith(1);
    host.noteAt(0, 3, 60, 100, -0.4, 1);
    expect(sequencers[0].sendEventAt.mock.calls[0][1]).toBe(0);
  });

  it('falls back to an immediate note-on when the instance has no sequencer', async () => {
    const { host, synths } = await hostWith(1, { withSequencer: false });
    host.noteAt(0, 3, 60, 100, 0.25, 1.5);
    // `midiNoteOn` is recorded by the `record()` helper, not a vi.fn.
    expect(synths[0].calls.midiNoteOn).toEqual([[3, 60, 100]]);
  });
});
```

`hostWith` (at `src/web/playback/synth-host.test.ts:62`) currently builds bare `stubSynth()` instances with no sequencer, and `stubSynth(sequencer?)` only attaches `createSequencer` when passed one. Replace `hostWith` with:

```ts
async function hostWith(instanceCount: number, options: { withSequencer?: boolean } = {}) {
  const withSequencer = options.withSequencer ?? true;
  const sequencers = Array.from({ length: instanceCount }, () => stubSequencer());
  const synths = Array.from({ length: instanceCount }, (_, i) =>
    stubSynth(withSequencer ? sequencers[i] : undefined),
  );
  let made = 0;
  const host = new SynthHost({ createSynth: () => synths[made++] });
  await host.init(stubContext(), {
    fluidsynthModuleUrl: 'fluid.js',
    workletModuleUrl: 'worklet.js',
    soundfont: new Uint8Array(4).buffer,
    instanceCount,
  });
  return { host, synths, sequencers };
}
```

Every existing caller passes only `instanceCount`, so they keep working and now get a sequencer — check that no existing test asserts the no-sequencer fallback path; if one does, give it `{ withSequencer: false }`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/web/playback/synth-host.test.ts`
Expected: FAIL — `noteAt` is not a function.

- [ ] **Step 3: Replace `noteOnAt` with `noteAt`**

In `src/web/playback/synth-host.ts`, replace the `noteOnAt` method with:

```ts
/**
 * Schedules a note and its release together, ahead of time.
 *
 * The sequencer's `note` event carries its own duration, so fluidsynth releases
 * the note on the audio thread. Note-offs used to be fired from the main thread
 * as the pump noticed them, which made every note's length track main-thread
 * lateness — and a stall that held notes long added voices, loading the audio
 * thread in turn.
 *
 * The time scale is milliseconds (`setTimeScale(1000)` in `createSequencerFor`).
 */
noteAt(
  instance: number,
  channel: number,
  midi: number,
  velocity: number,
  delaySeconds: number,
  durationSeconds: number,
): void {
  const sequencer = this.sequencers[instance];
  if (!sequencer) {
    // No timed dispatch available; the note still sounds, just immediately and
    // without an automatic release. `allSoundOff` is the only thing that stops it.
    this.noteOn(instance, channel, midi, velocity);
    return;
  }
  sequencer.sendEventAt(
    {
      type: 'note',
      channel,
      key: midi,
      vel: velocity,
      duration: Math.max(1, Math.round(durationSeconds * 1000)),
    },
    Math.max(0, Math.round(delaySeconds * 1000)),
    false,
  );
}
```

Extend the `SynthSequencer` type's `sendEventAt` event union to include the note form:

```ts
sendEventAt(
  event:
    | { type: 'noteon'; channel: number; key: number; vel: number }
    | { type: 'note'; channel: number; key: number; vel: number; duration: number },
  tick: number,
  isAbsolute: boolean,
): void;
```

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/web/playback/synth-host.test.ts`
Expected: PASS.

- [ ] **Step 5: Point the engine at `noteAt` (temporarily keeping `pendingOffs`)**

In `src/web/playback/soundfont-engine.ts`, in `dispatchTick`, change the dispatch call to pass a duration and stop recording a pending off. Replace:

```ts
this.deps.host.noteOnAt(instance, channel, note.midi, note.velocity, (atSeconds - position) / speed);
this.activeNoteIds.add(note.noteId);
this.pendingOffs.push({
  atSeconds: this.secondsForTick(note.tick + note.durTicks),
  assignment: state.assignment,
  midi: note.midi,
  noteId: note.noteId,
});
```

with:

```ts
const endSeconds = this.secondsForTick(note.tick + note.durTicks);
this.deps.host.noteAt(
  instance,
  channel,
  note.midi,
  note.velocity,
  (atSeconds - position) / speed,
  (endSeconds - atSeconds) / speed,
);
```

Then delete the `PendingOff` type, the `pendingOffs` field, the `releaseDue` method and its call in `dispatchTick`, and change `clearSounding` to drop its `this.pendingOffs = []` line. The end-of-piece check loses its `pendingOffs.length === 0` term; replace that whole line for now with:

```ts
if (this.queue.exhausted && this.clock.isRunning && position >= this.lastNoteEndSeconds) this.stop();
```

and add the field plus its assignment in `loadScore`:

```ts
/** When the last note of the loaded score finishes, so the transport knows the piece is over. */
private lastNoteEndSeconds = 0;
```

```ts
// in loadScore, after this.queue.load(...)
const notes = flattenScoreForPlayback(score);
this.lastNoteEndSeconds = notes.reduce(
  (end, n) => Math.max(end, this.tempoMap.ticksToSeconds(n.tick + n.durTicks)),
  0,
);
```

Hoist `flattenScoreForPlayback(score)` into a local so it is called once and passed to both `this.queue.load(...)` and this reduce.

`activeNoteIds` maintenance is deliberately left broken by this step — Task 6 replaces it wholesale. Note-highlighting tests will fail here and are fixed there.

- [ ] **Step 6: Run the suite and record what is expected to fail**

Run: `bun run test`
Expected: `soundfont-engine.test.ts` fails only on active-note/highlighting assertions. Any *other* failure means this step went wrong — read it before continuing. Do not "fix" a highlighting failure here.

- [ ] **Step 7: Commit**

```bash
git add src/web/playback/synth-host.ts src/web/playback/synth-host.test.ts src/web/playback/soundfont-engine.ts
git commit -m "feat(playback): schedule each note with its own duration

The sequencer's note event carries a duration, so fluidsynth releases the note
on the audio thread. Note-offs used to fire from the main thread as the pump
noticed them, so every note's length tracked main-thread lateness — and a stall
that held notes long added voices, loading the audio thread in turn.

Active-note highlighting is left broken here and rebuilt on a cursor query in
the commit after next."
```

---

### Task 5: A rolling horizon replaces the lookahead window

**Files:**
- Modify: `src/shared/playback/note-queue.ts`, `src/shared/playback/note-queue.test.ts`
- Modify: `src/web/playback/soundfont-engine.ts`, `src/web/playback/soundfont-engine.test.ts`
- Delete: `src/shared/playback/pump-window.ts`, `src/shared/playback/pump-window.test.ts`

**Interfaces:**
- Consumes: `SynthHost.noteAt` from Task 4.
- Produces: `NoteQueue.drainUntil(tick: number, maxCount: number): ScheduledNote[]` — the second parameter is new and required.

**The two bounds.** The horizon is bounded in seconds (`HORIZON_SECONDS`, memory in the worklet) and in events per refill (`MAX_EVENTS_PER_REFILL`, main-thread `postMessage` cost per tick). The spec calls the second bound "events in flight"; per-refill is the simpler realisation and bounds the same thing that matters — a single tick's burst — because the pump runs every 50ms and catches up across ticks.

- [ ] **Step 1: Write the failing queue test**

Append to `src/shared/playback/note-queue.test.ts`:

```ts
it('drains no more than maxCount, leaving the rest for the next call', () => {
  const queue = new NoteQueue();
  queue.load(
    Array.from({ length: 10 }, (_, i) => ({
      tick: i,
      durTicks: 1,
      midi: 60,
      velocity: 80,
      trackId: 't',
      noteId: `n${i}`,
    })),
  );
  expect(queue.drainUntil(100, 4).map((n) => n.noteId)).toEqual(['n0', 'n1', 'n2', 'n3']);
  expect(queue.drainUntil(100, 4).map((n) => n.noteId)).toEqual(['n4', 'n5', 'n6', 'n7']);
  expect(queue.exhausted).toBe(false);
  expect(queue.drainUntil(100, 4).map((n) => n.noteId)).toEqual(['n8', 'n9']);
  expect(queue.exhausted).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test -- src/shared/playback/note-queue.test.ts`
Expected: FAIL — the second argument is ignored, so the first call returns all ten.

- [ ] **Step 3: Cap the drain**

In `src/shared/playback/note-queue.ts`, change `drainUntil`:

```ts
/**
 * Every not-yet-returned note starting at or before `tick`, up to `maxCount`
 * of them, advancing the cursor past what it returns.
 *
 * The cap bounds one pump tick's cost: each note becomes a `postMessage` to the
 * worklet sequencer, and a four-second horizon over a two-hundred-track score
 * is thousands of them. Whatever the cap leaves behind is picked up 50ms later,
 * long before it is due.
 */
drainUntil(tick: number, maxCount: number): ScheduledNote[] {
  const out: ScheduledNote[] = [];
  while (
    out.length < maxCount &&
    this.cursor < this.notes.length &&
    this.notes[this.cursor].tick <= tick
  ) {
    out.push(this.notes[this.cursor]);
    this.cursor += 1;
  }
  return out;
}
```

- [ ] **Step 4: Run the queue tests**

Run: `bun run test -- src/shared/playback/note-queue.test.ts`
Expected: PASS. Existing callers in that file that pass one argument now fail to typecheck — update them to pass a large cap such as `Number.MAX_SAFE_INTEGER`.

- [ ] **Step 5: Write the failing engine tests**

Append to `src/web/playback/soundfont-engine.test.ts`:

```ts
describe('SoundfontPlaybackEngine: scheduling horizon', () => {
  it('queues several seconds of music on the first tick, not 200ms', async () => {
    const { engine, host, pump, score } = setup();
    await engine.initialize();
    await engine.loadScore(score);
    await engine.play();
    pump.step();
    const delays = host.noteAt.mock.calls.map((c) => c[4] as number);
    expect(Math.max(...delays)).toBeGreaterThan(1);
  });

  it('does not re-send a note it has already scheduled', async () => {
    const { engine, host, pump, clock, score } = setup();
    await engine.initialize();
    await engine.loadScore(score);
    await engine.play();
    pump.step();
    const first = host.noteAt.mock.calls.length;
    clock.t += 0.05;
    pump.step();
    const ids = host.noteAt.mock.calls.slice(first).map((c) => `${c[1]}:${c[2]}:${c[4]}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('plays every note of the piece even when the pump runs far behind', async () => {
    const { engine, host, pump, clock, score } = setup();
    await engine.initialize();
    await engine.loadScore(score);
    await engine.play();
    pump.step();
    // A stall far longer than the old 200ms grace window, which used to skip
    // every note inside it.
    clock.t += 1.5;
    pump.step();
    clock.t += 1.5;
    pump.step();
    const scheduled = host.noteAt.mock.calls.length;
    expect(scheduled).toBeGreaterThanOrEqual(twoTrackNoteCount(score));
  });
});

/** How many notes the fixture actually has, so the assertion above is not a magic number. */
function twoTrackNoteCount(score: Score): number {
  return score.tracks.reduce(
    (n, t) =>
      n +
      t.measures.reduce(
        (m, measure) => m + measure.voices.reduce((v, voice) => v + voice.events.length, 0),
        0,
      ),
    0,
  );
}
```

Add `noteAt: vi.fn()` to `stubHost()` and remove `noteOnAt`.

- [ ] **Step 6: Run them to verify they fail**

Run: `bun run test -- src/web/playback/soundfont-engine.test.ts`
Expected: FAIL — the first assertion sees a maximum delay of ~0.2s.

- [ ] **Step 7: Replace the window with a horizon**

In `src/web/playback/soundfont-engine.ts`, delete the `planDispatch` import and replace the `LOOKAHEAD_SECONDS` / `GRACE_SECONDS` constants with:

```ts
/**
 * How far ahead the sequencer is kept filled.
 *
 * Deep enough that a main-thread stall of any plausible length lands entirely
 * inside already-queued audio. The old 200ms window plus a 200ms grace meant a
 * stall longer than 400ms silently dropped every note inside it — a 200-track
 * notation redraw measured at 119ms, so three unlucky frames did it.
 */
const HORIZON_SECONDS = 4;
/**
 * The most notes handed to the sequencer in one tick.
 *
 * Each is a `postMessage` to the worklet, so without this a dense score's first
 * tick would post thousands at once. Whatever is left waits 50ms, which is
 * nothing against a four-second horizon.
 */
const MAX_EVENTS_PER_REFILL = 512;
```

Replace the middle of `dispatchTick` — from `const speed = this.playbackSpeed;` through the end of the dispatch loop — with:

```ts
const speed = this.playbackSpeed;
const untilSeconds = position + HORIZON_SECONDS * speed;
const due = this.queue.drainUntil(this.tickForSeconds(untilSeconds), MAX_EVENTS_PER_REFILL);

for (const note of due) {
  const state = this.tracks.get(note.trackId);
  if (!state) continue;
  const { instance, channel } = state.assignment;
  const atSeconds = this.secondsForTick(note.tick);
  const endSeconds = this.secondsForTick(note.tick + note.durTicks);
  this.deps.host.noteAt(
    instance,
    channel,
    note.midi,
    note.velocity,
    // Clamped in `noteAt`; a note whose moment passed during a stall sounds at
    // once rather than being dropped, because the sequencer holds its release.
    (atSeconds - position) / speed,
    (endSeconds - atSeconds) / speed,
  );
}
```

Then delete `src/shared/playback/pump-window.ts` and `src/shared/playback/pump-window.test.ts`, and remove any re-export of them from `src/web/index.ts` or `src/shared/` barrels (grep for `pump-window` and `planDispatch` before deleting).

- [ ] **Step 8: Run the tests**

Run: `bun run test -- src/web/playback/soundfont-engine.test.ts`
Expected: the three new tests PASS. Existing tests asserting late notes are skipped now fail — those encoded the grace rule, which is deliberately gone. Delete them and note in the commit that the behaviour they pinned was removed on purpose.

- [ ] **Step 9: Sabotage check**

Set `HORIZON_SECONDS = 0.2`. Run the engine tests. Expected: "queues several seconds of music on the first tick" fails, and "plays every note of the piece even when the pump runs far behind" fails. Restore.

- [ ] **Step 10: Commit**

```bash
git add -A src/shared/playback src/web/playback/soundfont-engine.ts src/web/playback/soundfont-engine.test.ts
git commit -m "feat(playback): keep a four-second horizon in the sequencer

The pump drained a 200ms lookahead and skipped anything more than 200ms late,
so a stall over ~400ms silently dropped every note inside it. A 200-track
notation redraw measures 119ms, which made three unlucky frames enough.

Timing now lives in the worklet: the pump tops up a rolling horizon, bounded in
seconds for worklet memory and in events per tick for postMessage cost. The
skip-late rule and pump-window.ts go with it — a note whose moment passed during
a stall now sounds at once, because the sequencer holds its release."
```

---

### Task 6: Sounding notes from a cursor query, emitted only on change

**Files:**
- Create: `src/shared/playback/sounding-set.ts`, `src/shared/playback/sounding-set.test.ts`
- Modify: `src/web/playback/soundfont-engine.ts`, `src/web/playback/soundfont-engine.test.ts`

**Interfaces:**
- Consumes: `ScheduledNote` from `src/shared/playback/schedule.js`.
- Produces:

```ts
export class SoundingSet {
  load(notes: readonly ScheduledNote[], secondsForTick: (tick: number) => number): void;
  /** Moves to `positionSeconds` and returns the ids sounding there, or null if unchanged since the last call. */
  advanceTo(positionSeconds: number): string[] | null;
  /** Drops every sounding note and resets both cursors to `positionSeconds`. */
  reset(positionSeconds: number): void;
}
```

**Why:** today `report()` calls `onActiveNotes([...this.activeNoteIds])` every tick with a fresh array whether or not anything changed, so every downstream consumer wakes ~20 times a second. The set itself came from `pendingOffs`, which Task 4 deleted.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/playback/sounding-set.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SoundingSet } from './sounding-set.js';
import type { ScheduledNote } from './schedule.js';

/** Ticks are seconds here, so the arithmetic in the assertions is readable. */
const seconds = (tick: number) => tick;

function note(noteId: string, tick: number, durTicks: number): ScheduledNote {
  return { noteId, tick, durTicks, midi: 60, velocity: 80, trackId: 't' };
}

function loaded(notes: ScheduledNote[]) {
  const set = new SoundingSet();
  set.load(notes, seconds);
  return set;
}

describe('SoundingSet', () => {
  it('reports a note from its start until its end', () => {
    const set = loaded([note('a', 0, 2)]);
    expect(set.advanceTo(0)).toEqual(['a']);
    expect(set.advanceTo(1)).toBeNull();
    expect(set.advanceTo(2)).toEqual([]);
  });

  it('returns null while nothing changes, so a held chord emits once', () => {
    const set = loaded([note('a', 0, 10), note('b', 0, 10)]);
    expect(set.advanceTo(0)!.sort()).toEqual(['a', 'b']);
    expect(set.advanceTo(1)).toBeNull();
    expect(set.advanceTo(2)).toBeNull();
    expect(set.advanceTo(3)).toBeNull();
  });

  it('handles a short note starting after a long one and ending before it', () => {
    const set = loaded([note('long', 0, 10), note('short', 2, 1)]);
    expect(set.advanceTo(0)).toEqual(['long']);
    expect(set.advanceTo(2)!.sort()).toEqual(['long', 'short']);
    expect(set.advanceTo(3)).toEqual(['long']);
    expect(set.advanceTo(10)).toEqual([]);
  });

  it('emits on the first call after a reset even if the set is the same', () => {
    const set = loaded([note('a', 0, 10)]);
    expect(set.advanceTo(0)).toEqual(['a']);
    set.reset(0);
    expect(set.advanceTo(0)).toEqual(['a']);
  });

  it('clears everything on reset, matching the engine silencing the synth on a seek', () => {
    const set = loaded([note('a', 0, 10)]);
    set.advanceTo(1);
    set.reset(5);
    // 'a' spans tick 5 but was not restarted, exactly as no voice is sounding
    // after allSoundOff.
    expect(set.advanceTo(5)).toEqual([]);
  });

  it('is empty for a score with no notes', () => {
    const set = loaded([]);
    expect(set.advanceTo(0)).toEqual([]);
    expect(set.advanceTo(1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test -- src/shared/playback/sounding-set.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/shared/playback/sounding-set.ts`:

```ts
/**
 * Which notes are sounding at a given moment, by two monotonic cursors.
 *
 * Replaces deriving the set from a list of pending note-offs the pump walked
 * every tick. One cursor over notes by start, one over the same notes by end;
 * both only ever move forward, so a step costs the number of notes that
 * actually started or stopped rather than the size of the score.
 *
 * `advanceTo` returns `null` when nothing changed, which is the point: the
 * engine used to hand its observer a freshly-allocated array twenty times a
 * second whether or not a single note had begun or ended, waking every
 * downstream consumer for nothing.
 */
import type { ScheduledNote } from './schedule.js';

type Ends = { noteId: string; endSeconds: number };

export class SoundingSet {
  private byStart: Array<{ noteId: string; startSeconds: number }> = [];
  private byEnd: Ends[] = [];
  private startCursor = 0;
  private endCursor = 0;
  private sounding = new Set<string>();
  /** Forces the next `advanceTo` to emit, so a reset is always observable. */
  private dirty = true;

  load(notes: readonly ScheduledNote[], secondsForTick: (tick: number) => number): void {
    this.byStart = notes
      .map((n) => ({ noteId: n.noteId, startSeconds: secondsForTick(n.tick) }))
      .sort((a, b) => a.startSeconds - b.startSeconds);
    this.byEnd = notes
      .map((n) => ({ noteId: n.noteId, endSeconds: secondsForTick(n.tick + n.durTicks) }))
      .sort((a, b) => a.endSeconds - b.endSeconds);
    this.reset(0);
  }

  reset(positionSeconds: number): void {
    this.sounding.clear();
    this.startCursor = lowerBound(this.byStart, positionSeconds, (e) => e.startSeconds);
    this.endCursor = lowerBound(this.byEnd, positionSeconds, (e) => e.endSeconds);
    this.dirty = true;
  }

  advanceTo(positionSeconds: number): string[] | null {
    let changed = this.dirty;
    this.dirty = false;

    while (
      this.startCursor < this.byStart.length &&
      this.byStart[this.startCursor].startSeconds <= positionSeconds
    ) {
      this.sounding.add(this.byStart[this.startCursor].noteId);
      this.startCursor += 1;
      changed = true;
    }
    while (
      this.endCursor < this.byEnd.length &&
      this.byEnd[this.endCursor].endSeconds <= positionSeconds
    ) {
      // `delete` on an id never added (its start was skipped by a reset) is a
      // no-op, which is why a seek into the middle of a held note is safe.
      if (this.sounding.delete(this.byEnd[this.endCursor].noteId)) changed = true;
      this.endCursor += 1;
    }

    return changed ? [...this.sounding] : null;
  }
}

/** First index whose key is >= `value`. */
function lowerBound<T>(items: readonly T[], value: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/shared/playback/sounding-set.test.ts`
Expected: PASS.

Note the "clears everything on reset" test relies on `endCursor` also advancing past `a`'s end without `changed` flipping, since `a` was never re-added. If that test fails, the bug is in `reset`'s `endCursor` placement, not in `advanceTo`.

- [ ] **Step 5: Wire it into the engine**

In `src/web/playback/soundfont-engine.ts`:

Replace `private activeNoteIds = new Set<string>();` with `private readonly sounding = new SoundingSet();` and import it from `../../shared/playback/sounding-set.js`.

In `loadScore`, after computing the flattened notes local from Task 4:

```ts
this.sounding.load(notes, (tick) => this.secondsForTick(tick));
```

In `seek`, replace `this.clearSounding();` with:

```ts
this.sounding.reset(seconds);
this.observer?.onActiveNotes([]);
```

In `stop`, do the same with `this.sounding.reset(0);`.

Replace `report` with:

```ts
/**
 * Position and sounding notes.
 *
 * Position is throttled to ~30Hz. Sounding notes are emitted only when they
 * actually change: they used to be re-sent every tick as a fresh array, so
 * every consumer downstream woke twenty times a second through a held chord.
 */
private report(position: number): void {
  const sounding = this.sounding.advanceTo(position);
  if (sounding) this.observer?.onActiveNotes(sounding);

  const nowMs = position * 1000;
  if (nowMs - this.lastReportedAt < POSITION_TICK_INTERVAL_MS) return;
  this.lastReportedAt = nowMs;
  this.observer?.onPositionTick(Math.max(0, Math.round(this.tickForSeconds(position))));
}
```

Delete the `clearSounding` method and its remaining call sites (`dispose`).

- [ ] **Step 6: Write the engine-level test**

```ts
it('reports sounding notes only when they change', async () => {
  const { engine, pump, clock, score } = setup();
  const onActiveNotes = vi.fn();
  engine.setObserver({
    onPositionTick: vi.fn(),
    onActiveNotes,
    onStateChange: vi.fn(),
  });
  await engine.initialize();
  await engine.loadScore(score);
  await engine.play();
  pump.step();
  const afterFirst = onActiveNotes.mock.calls.length;
  // Three ticks inside the first note, during which nothing starts or stops.
  clock.t += 0.01;
  pump.step();
  clock.t += 0.01;
  pump.step();
  clock.t += 0.01;
  pump.step();
  expect(onActiveNotes.mock.calls.length).toBe(afterFirst);
});
```

- [ ] **Step 7: Run the whole suite**

Run: `bun run test`
Expected: PASS. The highlighting tests broken in Task 4 pass again. If one asserts `onActiveNotes` fires per tick, that assertion pinned the behaviour just removed — rewrite it to assert change-only emission.

- [ ] **Step 8: Sabotage check**

In `advanceTo`, change `return changed ? [...this.sounding] : null;` to `return [...this.sounding];`. Run the engine and sounding-set tests. Expected: "returns null while nothing changes" and "reports sounding notes only when they change" both fail. Restore.

- [ ] **Step 9: Commit**

```bash
git add src/shared/playback/sounding-set.ts src/shared/playback/sounding-set.test.ts src/web/playback/soundfont-engine.ts src/web/playback/soundfont-engine.test.ts
git commit -m "feat(playback): derive sounding notes from cursors, emit only on change

The set used to be a by-product of the pending note-offs the pump walked every
tick, and was re-sent as a fresh array whether or not anything had changed — so
every consumer downstream woke twenty times a second through a held chord.

Two monotonic cursors, one over notes by start and one by end: a step costs the
number of notes that actually started or stopped, not the size of the score."
```

---

### Task 7: Retire the governor's lateness signal

**Files:**
- Modify: `src/web/playback/governor.ts`, `src/web/playback/governor.test.ts`
- Modify: `src/web/playback/soundfont-engine.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Governor.record(lateBySeconds: number): void` — unchanged signature. `Governor` gains a documented `stalled` reading; nothing else changes shape.

**Why this task shrank.** The spec (§1.3) proposed the governor drive fluidsynth's `polyphony` from the concurrent-voice count. `js-synthesizer` exposes no runtime polyphony setter, so that is not available — the ceiling is set once at init (Task 2), generously, and fluidsynth's overflow priority does the stealing. Spec §1.3 needs amending to match; see Task 8.

What remains is a smaller, real problem. The governor steps interpolation down after ten consecutive frames more than 100ms late. After Task 5 the main thread can stall for a second with no audible consequence at all — the worklet has four seconds queued — so that signal now fires on main-thread busyness that the audio does not care about, and its response (degrading timbre for every listener) is a pure loss. There is no audio-thread load signal available to replace it with: `AudioWorkletNode` exposes none, and `AudioContext` exposes only latency figures that do not move under voice pressure.

So the honest change is to stop acting on the signal while keeping the measurement, which costs nothing and is the thing a future audio-thread signal would plug into.

- [ ] **Step 1: Write the failing test**

Replace the degradation tests in `src/web/playback/governor.test.ts` with:

```ts
describe('Governor', () => {
  it('does not degrade interpolation on main-thread lateness alone', () => {
    const onChange = vi.fn();
    const governor = new Governor({ onChange });
    // Far more than the ten consecutive late frames that used to step it down.
    for (let i = 0; i < 100; i += 1) governor.record(0.5);
    expect(onChange).not.toHaveBeenCalled();
    expect(governor.interpolation).toBe(7);
  });

  it('still counts consecutive late frames, so a future audio-thread signal has something to read', () => {
    const governor = new Governor({});
    for (let i = 0; i < 12; i += 1) governor.record(0.5);
    expect(governor.stalledFrames).toBeGreaterThanOrEqual(10);
    governor.record(0);
    expect(governor.stalledFrames).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test -- src/web/playback/governor.test.ts`
Expected: FAIL — `onChange` fires after ten late frames, and `stalledFrames` does not exist.

- [ ] **Step 3: Implement**

In `src/web/playback/governor.ts`, rewrite the module doc to say why the ladder no longer steps, keep `LADDER` and `interpolation`, and replace `record` with:

```ts
/**
 * One pump frame's lateness, in seconds.
 *
 * Counted but no longer acted on. This used to step interpolation down after
 * ten consecutive frames over 100ms late, on the reasoning that a starved pump
 * meant a starved synth. That reasoning died with the scheduling horizon: the
 * worklet now holds four seconds of queued audio, so the main thread can stall
 * for a second with nothing audible happening — and degrading timbre in
 * response to a busy main thread is a cost with no benefit.
 *
 * The count is kept because it is free and because it is the shape a real
 * audio-thread load signal would take. `AudioWorkletNode` exposes no such
 * signal today; when one exists, it plugs in here.
 */
record(lateBySeconds: number): void {
  if (lateBySeconds > LATE_THRESHOLD_SECONDS) {
    this.lateFrames += 1;
    return;
  }
  this.lateFrames = 0;
}

/** Consecutive frames measured late. Diagnostic; nothing acts on it. */
get stalledFrames(): number {
  return this.lateFrames;
}
```

Delete `CLEAN_FRAMES_TO_RECOVER`, `LATE_FRAMES_TO_DEGRADE`, `cleanFrames`, `rung` mutation and the `step` method. Keep `rung` as a `readonly 0` backing `interpolation`, or simply return `LADDER[0]` from the getter and drop the field.

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/web/playback/governor.test.ts`
Expected: PASS. Any remaining test asserting a step-down encoded the behaviour just removed — delete it.

- [ ] **Step 5: Run the whole suite**

Run: `bun run test`
Expected: PASS. `soundfont-engine.ts` needs no change: it already calls `this.governor.record(...)` with one argument and passes `onChange` to the constructor, which is now never invoked.

- [ ] **Step 6: Commit**

```bash
git commit -am "refactor(playback): stop degrading timbre on main-thread lateness

The governor stepped interpolation down after ten consecutive pump frames more
than 100ms late, on the reasoning that a starved pump meant a starved synth.
The scheduling horizon killed that reasoning: the worklet holds four seconds of
queued audio, so the main thread can stall for a second with nothing audible
happening — and degrading timbre for every listener in response to a busy main
thread is a cost with no benefit.

The measurement stays, unread, because it is free and because it is the shape a
real audio-thread load signal would take. AudioWorkletNode exposes none today.

fluidsynth's polyphony, which the design had the governor drive instead, turns
out to have no runtime setter in js-synthesizer — it is set once at init."
```

---

### Task 8: Verify, document, and hand off

**Files:**
- Modify: `CLAUDE.md` (in `music_io`)

- [ ] **Step 1: Full verification**

Run: `bun run verify`
Expected: typecheck, lint, test and build all pass. Fix anything that does not before continuing.

- [ ] **Step 2: Confirm the app still builds against it**

```bash
bun run clean && bun run build
rsync -a --delete dist/ ../music_app/node_modules/@sudobility/music_io/dist/
rm -rf ../music_app/node_modules/.vite
cd ../music_app && bun run verify
```

The `.vite` removal is required: Vite pre-bundles dependencies, so a freshly built package copied in is otherwise ignored and the browser keeps running the old code.

Expected: `music_app` passes. `music_app` calls `playbackController` only through the unchanged `PlaybackEngine` interface, so no app change should be needed. If one is, stop — it means this step-1 work altered the contract, which it must not.

- [ ] **Step 3: Amend spec §1.3 in `music_app`**

`docs/superpowers/specs/2026-08-17-scalable-playback-architecture-design.md` §1.3 says the governor drives the polyphony cap from the concurrent-voice count. `js-synthesizer` has no runtime polyphony setter, so rewrite that section to record: the ceiling is set once at init at 2048; fluidsynth's overflow priority does the per-voice degradation; the governor's lateness signal is measured but no longer acted on, because after the horizon it no longer indicates anything audible; and no audio-thread load signal is available to replace it. Commit that in `music_app`, not here.

- [ ] **Step 4: Update `music_io`'s CLAUDE.md**

Add or amend gotchas to record, in the codebase's own voice:

- One synth instance addresses 256 channels; a second opens only past 240 pitched tracks, at the cost of another soundfont copy. It used to be every sixteen.
- Channels where `c % 16 === 9` are reserved for percussion because only literal channel 9 is documented as drum-typed by default, and whether fluidsynth types the rest at a raised channel count is untestable here.
- Polyphony is an init-time setting; `js-synthesizer` has no runtime setter. It is 2048, and fluidsynth steals above it by overflow priority.
- Timing lives in the worklet: the pump tops up a four-second horizon and note events carry their own duration. There is no grace window and no skip-late rule — do not reintroduce one without re-reading why it went.
- `onActiveNotes` fires only on change. Anything that starts re-sending it per tick has undone the reason `SoundingSet` exists.
- The offline renderer shares `allocateChannels` with playback, so a change to channel counts must move `offline-synth.ts` in the same commit or export silently loses tracks.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the 256-channel synth and worklet-owned timing"
```

- [ ] **Step 6: Report back**

Summarise: which tests were deleted and why (the grace-window and governor-step-down ones encoded behaviour deliberately removed), whether the 200-track hesitation is gone by ear, and any place the plan's code did not match the real files. Step 2 of the spec — the edit lock and controller simplification — is the next plan.

---

## Self-Review Notes

**Spec coverage:** §1.1 → Tasks 1–3. §1.2 → Tasks 4–5. §1.3 → Task 7, **not as written** (see below). §1.4 → Task 6. §1.1's note that the offline renderer shares the allocator → Task 3.

**Deliberately out of scope:** §2 (rendering), §3 (bus, edit lock, caret split) and §4's worker error handling are steps 2–8 of the spec. The `PlaybackEngine` interface and `onActiveNotes`'s `string[]` signature are unchanged here on purpose — the observer contract changes in the spec's step 3.

**Spec deviation, resolved not deferred:** §1.3 has the governor drive fluidsynth's `polyphony` from the concurrent-voice count. `js-synthesizer`'s `ISynthesizer` exposes `setInterpolation` and `setGain` and no polyphony setter, so polyphony is set once at init (2048) and the governor instead stops acting on a signal that no longer means anything. Task 8 Step 3 amends the spec to match rather than leaving the two out of step.

**Constant naming:** the spec calls the second scheduling bound `MAX_QUEUED_EVENTS` ("events in flight"); the plan implements `MAX_EVENTS_PER_REFILL`, which bounds the same thing that matters — one tick's `postMessage` burst — without needing to track completions. Task 5 says so at the point of use.

**Test-double gotcha, checked:** `stubSynth` in `synth-host.test.ts` records into a plain `calls` object via a `record(name)` helper, so `init`, `midiNoteOn` and friends are **not** `vi.fn`s and `toHaveBeenCalledWith` does not work on them. Assertions in Tasks 2 and 4 use `synths[i].calls.<name>`. `loadSFont`, `createAudioNode` and every member of `stubSequencer` *are* `vi.fn`s.

# Playback Step 2: the edit lock and the controller collapse

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuse content edits while the transport is playing, keep mixing live, and collapse `PlaybackController.handleScoreChange` from a stop-reload-seek-resume interlock into two branches.

**Architecture:** Commands declare whether they are *content* or *mix*. One guard in `score-slice.dispatchCommand` (plus `undo`/`redo`) refuses content while playing. Because content is then immutable during playback, the controller's "score changed while playing" branch can push mix state to the engine and never reload — which deletes `pendingResume`, `scoreChangeGeneration` and the whole burst-of-edits interlock they exist for.

**Tech Stack:** TypeScript (strict, ESM, extensionless relative imports built by `tsc`), Zustand + immer, Vitest, React 19 + Testing Library.

## Global Constraints

- **Three repos, in this order:** `music_types` → `music_io` → `music_lib` → `music_app`. Paths below are prefixed with the repo when ambiguous. Each repo's own commands are `bun run test` / `typecheck` / `lint` / `verify`.
- **Relative imports carry a `.js` extension** even from `.ts` files. House style across `@sudobility`; do not "fix" it.
- **Cross-repo propagation:** after changing `music_types` or `music_io` or `music_lib`, run `bun run clean && bun run build`, `rsync -a --delete dist/ ../<consumer>/node_modules/@sudobility/<pkg>/dist/`, and `rm -rf ../<consumer>/node_modules/.vite`. Vite pre-bundles dependencies, so without that removal the consumer keeps running the old code while the file on disk is right.
- **`music_lib` is platform-free.** No React, no DOM, no `import.meta.env`. It is told about its environment, never sniffs it.
- **Do not touch the React Native engine's scheduling.** `music_io/src/rn/playback/sample-engine.ts` implements `PlaybackEngine`, so it must implement any method added to that interface — but nothing else about it changes here.
- **Verify by sabotage.** After each task's tests pass, break the implementation line the test targets, confirm that test fails, restore.
- **Spec:** `docs/superpowers/specs/2026-08-17-scalable-playback-architecture-design.md` §3.4 and §3.5. Step 1 is merged into `music_io/main`.

---

## What the spec did not account for

**§3.4 says mute, solo, volume and pan stay live during playback. Two of those four have no route to the engine.**

`PlaybackEngine` declares `setTrackMute(trackId, muted)` and `setTrackSolo(trackId, solo)` and nothing for volume or pan. In `SoundfontPlaybackEngine`, `TrackState.volume` is populated only in `loadScore`, and `applyTrackLevels` reads it from there — so a volume change that does not reload the score cannot reach CC7, and a pan change cannot reach CC10 at all.

Under the lock, a mix change explicitly does **not** reload. So without a new engine method, moving a fader during playback would move the fader and not the sound — a silent failure of exactly the kind this codebase keeps getting bitten by.

Task 3 adds one method, `applyMix(score)`, rather than a setter per property: it is idempotent, it is the only thing the controller's playing branch needs to call, and it keeps the interface from growing four methods to express one idea.

---

## File Structure

| Repo | File | Responsibility | Change |
| --- | --- | --- | --- |
| types | `src/platform/playback.ts` | engine contract | Modify: `applyMix` |
| io | `src/web/playback/soundfont-engine.ts` | web engine | Modify: implement `applyMix` |
| io | `src/rn/playback/sample-engine.ts` | RN engine | Modify: implement `applyMix` |
| lib | `src/domain/commands/types.ts` | `ScoreCommand` | Modify: `kind` |
| lib | `src/domain/commands/snapshot.ts` | command base | Modify: default `kind` |
| lib | `src/domain/commands/structure-commands.ts` | `changeTrackPropsCommand` | Modify: classify from patch |
| lib | `src/store/slices/score-slice.ts` | dispatch/undo/redo | Modify: the guard |
| lib | `src/services/playback/controller.ts` | store ↔ engine bridge | Modify: collapse; delete preview |
| app | `src/features/score-editor/editing.ts` | note entry | Modify: refuse while playing |
| app | `src/components/layout/AppLayout.tsx` | snapshot open, generation reload | Modify: stop first; drop `stopPreview` |
| app | `src/app/router.tsx`, `src/features/projects/DashboardPage.tsx`, `src/components/transport/TransportBar.tsx` | dead `stopPreview` calls | Modify: delete |
| app | `src/features/score-editor/EditorToolbar.tsx` | content controls | Modify: disable while playing |
| app | `src/features/tracks/TrackEditorPanel.tsx` | track controls | Modify: disable content, keep mix |
| app | `src/features/score-editor/useEditorShortcuts.ts` | keyboard | No change — guard is upstream |

---

### Task 1: Commands declare content or mix

**Repo:** `music_lib`

**Files:**
- Modify: `src/domain/commands/types.ts`
- Modify: `src/domain/commands/snapshot.ts:60`
- Modify: `src/domain/commands/structure-commands.ts:214-224`
- Test: `src/domain/commands/structure-commands.test.ts`

**Interfaces:**
- Produces: `ScoreCommand.kind: CommandKind` where `type CommandKind = 'content' | 'mix'`, both exported from `src/domain/commands/types.js`. `snapshotCommand(label, mutate, kind = 'content')`. Every one of the 31 command factories routes through `snapshotCommand` or `transformCommand`, so they all inherit `'content'` and only `changeTrackPropsCommand` overrides.

**Why the field is required, not optional:** a command written later without thinking about the lock must be refused during playback, not admitted. Making `kind` required means a hand-rolled command literal fails to typecheck rather than defaulting to whatever is convenient.

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/commands/structure-commands.test.ts`:

```ts
import { changeTrackPropsCommand } from './structure-commands.js';
import { addTrackCommand } from './structure-commands.js';

describe('command kind', () => {
  it('classifies a patch of only mix properties as mix', () => {
    expect(changeTrackPropsCommand('t1', { muted: true }).kind).toBe('mix');
    expect(changeTrackPropsCommand('t1', { solo: true }).kind).toBe('mix');
    expect(changeTrackPropsCommand('t1', { volume: 0.5 }).kind).toBe('mix');
    expect(changeTrackPropsCommand('t1', { pan: -1 }).kind).toBe('mix');
    expect(changeTrackPropsCommand('t1', { volume: 0.5, muted: true }).kind).toBe('mix');
  });

  it('classifies anything touching the score as content', () => {
    expect(changeTrackPropsCommand('t1', { name: 'Viola' }).kind).toBe('content');
    expect(changeTrackPropsCommand('t1', { midiProgram: 41 }).kind).toBe('content');
    expect(changeTrackPropsCommand('t1', { clef: 'bass' }).kind).toBe('content');
  });

  it('classifies a mixed patch as content, because half of it is', () => {
    expect(changeTrackPropsCommand('t1', { muted: true, name: 'Viola' }).kind).toBe('content');
  });

  it('treats an empty patch as mix, since it changes nothing', () => {
    expect(changeTrackPropsCommand('t1', {}).kind).toBe('mix');
  });

  it('defaults every other command to content', () => {
    expect(addTrackCommand({ name: 'New' }).kind).toBe('content');
  });
});
```

Check `addTrackCommand`'s real `CreateTrackOptions` shape before writing that last case and pass whatever it actually requires.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- src/domain/commands/structure-commands.test.ts`
Expected: FAIL — `kind` is not a property of `ScoreCommand`.

- [ ] **Step 3: Add the field**

In `src/domain/commands/types.ts`:

```ts
/**
 * Whether a command changes the music or only how it is mixed.
 *
 * The distinction exists for one reason: content is immutable while the
 * transport is playing (see `store/slices/score-slice.ts`), and mixing is not
 * editing — muting a part while listening is how an arrangement gets listened
 * to. `PlaybackController` also relies on it: while playing, the only score
 * change that can reach it is a mix change, which is what lets it push levels
 * to the engine instead of reloading and resuming.
 */
export type CommandKind = 'content' | 'mix';

export type ScoreCommand = {
  id: string;
  label: string;
  timestamp: number;
  /** Required, so a command written without thinking about the lock is refused rather than admitted. */
  kind: CommandKind;
  execute(score: Score): Score;
  undo(score: Score): Score;
};
```

- [ ] **Step 4: Default it at the base**

In `src/domain/commands/snapshot.ts`, add a `kind` parameter defaulting to `'content'` to `snapshotCommand` and set it on the returned object; add the same pass-through parameter to `transformCommand`:

```ts
export function transformCommand(
  label: string,
  transform: (score: Score) => Score,
  kind: CommandKind = 'content',
): ScoreCommand {
  return snapshotCommand(label, (draft) => {
    const next = transform(current(draft) as Score);
    Object.assign(draft, next);
  }, kind);
}
```

Read `snapshotCommand`'s full body before editing and thread the parameter through in the same shape.

- [ ] **Step 5: Classify `changeTrackPropsCommand` from its own patch**

In `src/domain/commands/structure-commands.ts`, above the command:

```ts
/**
 * The track properties that are mixing rather than music.
 *
 * `changeTrackPropsCommand` carries a partial patch and serves both purposes —
 * `{ muted }` is mixing, `{ name }` and `{ midiProgram }` are the score — so
 * the classification cannot be made on the command's type. It is made here,
 * where the patch is, rather than in a switch elsewhere that has to be kept in
 * step with this list.
 */
const MIX_PROPS = new Set<keyof TrackPropsPatch>(['volume', 'pan', 'muted', 'solo']);

/** A patch is mix only if *every* key in it is. An empty patch changes nothing, so it is mix too. */
function trackPatchKind(patch: TrackPropsPatch): CommandKind {
  return Object.keys(patch).every((key) => MIX_PROPS.has(key as keyof TrackPropsPatch))
    ? 'mix'
    : 'content';
}
```

and pass it through:

```ts
export function changeTrackPropsCommand(trackId: UUID, patch: TrackPropsPatch): ScoreCommand {
  return transformCommand(
    'Change track properties',
    (score) => changeTrackProps(score, trackId, patch),
    trackPatchKind(patch),
  );
}
```

Import `CommandKind` from `./types.js`.

- [ ] **Step 6: Run the tests, then the whole suite**

Run: `bun run test -- src/domain/commands/structure-commands.test.ts` → PASS
Run: `bun run test && bun run typecheck` → PASS. Any hand-rolled `ScoreCommand` literal in a test now fails to typecheck; add `kind: 'content'` to it.

- [ ] **Step 7: Sabotage check**

Change `.every(` to `.some(` in `trackPatchKind`. Expected: "classifies a mixed patch as content, because half of it is" FAILS. Restore.

- [ ] **Step 8: Commit**

```bash
git add src/domain/commands
git commit -m "feat(commands): declare whether a command is content or mix

Content is about to become immutable while the transport plays, and mixing is
not editing — muting a part while listening is how an arrangement gets listened
to. The split cannot be made on command type, because changeTrackPropsCommand
carries a partial patch and serves both, so it classifies from its own patch.

Required rather than optional: a command written later without thinking about
the lock should be refused during playback, not admitted by a default."
```

---

### Task 2: The edit lock

**Repo:** `music_lib`

**Files:**
- Modify: `src/store/slices/score-slice.ts:75-110`
- Test: `src/store/slices/score-slice.test.ts`

**Interfaces:**
- Consumes: `ScoreCommand.kind` from Task 1.
- Produces: no new API. `dispatchCommand` becomes a no-op for a content command while `state === 'playing'`; `undo` and `redo` become no-ops while playing.

**Why here:** every editing route in the app — the toolbar, `useEditorShortcuts`, chord entry, the piano keyboard, drag handlers — reaches the store through these three functions. One guard in each is the whole lock, and a route added later gets it for free.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the playback edit lock', () => {
  it('refuses a content command while playing, leaving the score untouched', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    const before = store.getState().score;
    store.getState().setPlaybackState('playing');

    store.getState().dispatchCommand(addMeasureCommand());

    expect(store.getState().score).toBe(before); // same reference: nothing ran
  });

  it('accepts a mix command while playing', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    const trackId = store.getState().score!.tracks[0].id;
    store.getState().setPlaybackState('playing');

    store.getState().dispatchCommand(changeTrackPropsCommand(trackId, { muted: true }));

    expect(store.getState().score!.tracks[0].muted).toBe(true);
  });

  it('refuses undo and redo while playing', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    store.getState().dispatchCommand(addMeasureCommand());
    const edited = store.getState().score;

    store.getState().setPlaybackState('playing');
    store.getState().undo();
    expect(store.getState().score).toBe(edited);
  });

  it('accepts content again once playback stops', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    store.getState().setPlaybackState('playing');
    store.getState().dispatchCommand(addMeasureCommand());
    store.getState().setPlaybackState('stopped');

    const before = store.getState().score;
    store.getState().dispatchCommand(addMeasureCommand());
    expect(store.getState().score).not.toBe(before);
  });

  it('does not mark the project dirty for a refused command', () => {
    // A refusal that still queued an autosave would upload an unchanged score.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    store.getState().setPlaybackState('playing');
    const dirtyBefore = store.getState().dirty;

    store.getState().dispatchCommand(addMeasureCommand());
    expect(store.getState().dirty).toBe(dirtyBefore);
  });
});
```

These names are verified against the code, not guessed: the store is built with `createAppStore({ context: testStoreContext() })` (as `score-slice.test.ts`'s existing cases do), the dirty flag is `dirty` and not `isDirty` (`project-slice.ts:35`), and the transport state type is `TransportPlaybackState` (`music_types/src/platform/playback.ts:11`).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test -- src/store/slices/score-slice.test.ts`
Expected: FAIL — the content command applies and the score reference changes.

- [ ] **Step 3: Implement the guard**

In `src/store/slices/score-slice.ts`, add above the slice:

```ts
/**
 * Whether `cmd` may run right now.
 *
 * While the transport is playing, the score's musical content is immutable.
 * Mixing is exempt — mute, solo, volume and pan reach the engine live, which
 * is what those engine methods are for, and muting a part while listening is
 * how an arrangement gets listened to.
 *
 * This is also load-bearing for `services/playback/controller.ts`: its
 * "score changed while playing" branch pushes mix state to the engine and does
 * not reload, which is only sound because this guarantees a content change
 * cannot have happened. Loosening the rule here without revisiting that will
 * silently play stale music.
 */
function commandAllowed(cmd: ScoreCommand, playbackState: TransportPlaybackState): boolean {
  return playbackState !== 'playing' || cmd.kind === 'mix';
}
```

Then in the slice:

```ts
dispatchCommand: (cmd) => {
  const { score, state } = get();
  if (!score) return;
  if (!commandAllowed(cmd, state)) return;
  // ...unchanged from here
},

undo: () => {
  const score = get().score;
  // Undo is always content: it reverses whatever was done, and while playing
  // nothing that needs reversing can have happened.
  if (!score || get().state === 'playing' || !historyManager.canUndo) return;
  // ...unchanged
},

redo: () => {
  const score = get().score;
  if (!score || get().state === 'playing' || !historyManager.canRedo) return;
  // ...unchanged
},
```

Import `TransportPlaybackState` from `@sudobility/music_types` — that is the exported name; there is no `PlaybackState`.

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `bun run test -- src/store/slices/score-slice.test.ts` → PASS
Run: `bun run test` → some existing tests may edit while a fixture happens to be `'playing'`. Read each failure: if the test's subject is the edit rather than the transport, set the state to `'stopped'` in its setup. Do **not** weaken the guard to accommodate a test.

- [ ] **Step 5: Sabotage check**

Change `commandAllowed` to `return true;`. Expected: "refuses a content command while playing" and "does not mark the project dirty for a refused command" both FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/store/slices/score-slice.ts src/store/slices/score-slice.test.ts
git commit -m "feat(store): refuse content edits while the transport is playing

Every editing route in the app reaches the score through dispatchCommand, undo
and redo, so one guard in each is the whole lock and a route added later gets it
for free. Mixing is exempt: mute, solo, volume and pan reach the engine live.

This is load-bearing for PlaybackController, whose playing branch is about to
stop reloading the score on the strength of it."
```

---

### Task 3: `applyMix` on the engine contract

**Repos:** `music_types`, then `music_io`

**Files:**
- Modify: `music_types/src/platform/playback.ts`
- Modify: `music_io/src/web/playback/soundfont-engine.ts`
- Modify: `music_io/src/rn/playback/sample-engine.ts`
- Test: `music_io/src/web/playback/soundfont-engine.test.ts`

**Interfaces:**
- Produces: `PlaybackEngine.applyMix(score: Score): void`.

**Why one method and not four setters:** the controller has exactly one thing to say — "the mix changed, here is the score" — and saying it once is both idempotent and impossible to get half-right. Four setters would need the controller to diff which property changed, which is work it has no reason to do.

- [ ] **Step 1: Write the failing test**

In `music_io/src/web/playback/soundfont-engine.test.ts`:

```ts
describe('SoundfontPlaybackEngine: applyMix', () => {
  it('pushes changed volume and pan without reloading the score', async () => {
    const { engine, host, score } = setup();
    await engine.initialize();
    await engine.loadScore(score);

    host.controlChange.mockClear();
    const quieter = {
      ...score,
      tracks: [{ ...score.tracks[0], volume: 0.25, pan: -1 }, ...score.tracks.slice(1)],
    };
    engine.applyMix(quieter);

    const cc7 = host.controlChange.mock.calls.find((c) => c[2] === 7);
    const cc10 = host.controlChange.mock.calls.find((c) => c[2] === 10);
    expect(cc7?.[3]).toBe(Math.round(0.25 * 127));
    expect(cc10?.[3]).toBe(0); // hard left
  });

  it('honours mute and solo from the score it is handed', async () => {
    const { engine, host, score } = setup();
    await engine.initialize();
    await engine.loadScore(score);

    host.controlChange.mockClear();
    const soloed = {
      ...score,
      tracks: [{ ...score.tracks[0], solo: true }, ...score.tracks.slice(1)],
    };
    engine.applyMix(soloed);

    const cc7 = host.controlChange.mock.calls.filter((c) => c[2] === 7);
    expect(cc7.some((c) => c[3] === 0)).toBe(true); // the non-soloed track
    expect(cc7.some((c) => c[3] > 0)).toBe(true); // the soloed one
  });

  it('does not reschedule anything', async () => {
    const { engine, host, pump, score } = setup();
    await engine.initialize();
    await engine.loadScore(score);
    await engine.play();
    pump.step();

    host.noteAt.mockClear();
    engine.applyMix(score);
    expect(host.noteAt).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test -- src/web/playback/soundfont-engine.test.ts`
Expected: FAIL — `engine.applyMix is not a function`.

- [ ] **Step 3: Add it to the contract**

In `music_types/src/platform/playback.ts`, in the `PlaybackEngine` interface, after `setTrackSolo`:

```ts
/**
 * Re-reads every track's volume, pan, mute and solo from `score` and pushes
 * them, without touching what is scheduled.
 *
 * The mixing counterpart to `loadScore`. Mute and solo had setters; volume and
 * pan did not, and a track's volume was only ever read at load time — so once
 * a mix change stopped reloading the score, moving a fader during playback
 * moved the fader and not the sound.
 *
 * Idempotent: the caller says "the mix changed, here is the score" and does not
 * work out which property it was.
 */
applyMix(score: Score): void;
```

- [ ] **Step 4: Implement in the web engine**

In `music_io/src/web/playback/soundfont-engine.ts`, beside `setTrackSolo`:

```ts
applyMix(score: Score): void {
  for (const track of score.tracks) {
    const state = this.tracks.get(track.id);
    if (!state) continue;
    state.volume = track.volume;
    state.muted = track.muted;
    state.solo = track.solo;
    this.deps.host.controlChange(
      state.assignment.instance,
      state.assignment.channel,
      CC_PAN,
      panToCc(track.pan),
    );
  }
  this.applyTrackLevels();
}
```

A track the engine does not know is skipped rather than throwing: a mix change cannot add a track (that would be content), so an unknown id means the engine has an older score and the next `loadScore` settles it.

- [ ] **Step 5: Implement in the RN engine**

In `music_io/src/rn/playback/sample-engine.ts`, mirror it against whatever that engine keeps per track — read `setTrackMute`/`setTrackSolo` there (around line 553) and follow their shape. It must compile and behave; it is not device-tested here, consistent with the standing rule that the RN engine is verified on a phone.

- [ ] **Step 6: Build and propagate**

```bash
cd music_types && bun run clean && bun run build
rsync -a --delete dist/ ../music_io/node_modules/@sudobility/music_types/dist/
rsync -a --delete dist/ ../music_lib/node_modules/@sudobility/music_types/dist/
rsync -a --delete dist/ ../music_app/node_modules/@sudobility/music_types/dist/
rm -rf ../music_app/node_modules/.vite
cd ../music_io && bun run verify
```

- [ ] **Step 7: Sabotage check**

Delete the `state.volume = track.volume;` line. Expected: "pushes changed volume and pan without reloading the score" FAILS on the CC7 value. Restore.

- [ ] **Step 8: Commit (both repos)**

```bash
# music_types
git commit -am "feat(playback): add applyMix to the engine contract

Mute and solo had setters; volume and pan did not, and a track's volume was only
read at loadScore. Once a mix change stops reloading the score, that gap means
moving a fader during playback moves the fader and not the sound."

# music_io
git commit -am "feat(playback): implement applyMix in both engines"
```

---

### Task 4: The controller collapses

**Repo:** `music_lib`

**Files:**
- Modify: `src/services/playback/controller.ts`
- Test: `src/services/playback/controller.test.ts`

**Interfaces:**
- Consumes: the lock (Task 2), `applyMix` (Task 3).
- Produces: `handleScoreChange` becomes private and two-branched. `pendingResume` and `scoreChangeGeneration` are gone.

**The invariant this rests on, stated so it cannot be quietly broken:** while playing, the only score change that can reach the controller is a mix change. Task 2's guard is what makes that true, and Task 6 is what makes it true for score changes that do not go through `dispatchCommand`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('PlaybackController: score changes while playing', () => {
  it('applies mix to the engine without reloading', async () => {
    const { engine, store, controller } = setup();
    store.getState().setScore(twinkleScore());
    await flush();
    store.getState().setPlaybackState('playing');

    engine.loadScore.mockClear();
    const trackId = store.getState().score!.tracks[0].id;
    store.getState().dispatchCommand(changeTrackPropsCommand(trackId, { muted: true }));
    await flush();

    expect(engine.applyMix).toHaveBeenCalled();
    expect(engine.loadScore).not.toHaveBeenCalled();
    expect(engine.stop).not.toHaveBeenCalled();
    expect(controller).toBeDefined();
  });

  it('loads the score when a change arrives while stopped', async () => {
    const { engine, store } = setup();
    store.getState().setScore(twinkleScore());
    await flush();

    engine.loadScore.mockClear();
    store.getState().dispatchCommand(addMeasureCommand());
    await flush();

    expect(engine.loadScore).toHaveBeenCalled();
  });

  it('never resumes playback on its own', async () => {
    // pendingResume existed to restart playback after a stop-reload cycle.
    // There is no such cycle now, so nothing may call play() but the user.
    const { engine, store } = setup();
    store.getState().setScore(twinkleScore());
    await flush();
    store.getState().setPlaybackState('playing');

    engine.play.mockClear();
    const trackId = store.getState().score!.tracks[0].id;
    store.getState().dispatchCommand(changeTrackPropsCommand(trackId, { volume: 0.3 }));
    await flush();

    expect(engine.play).not.toHaveBeenCalled();
  });
});
```

`setup()` and `flush()` already exist in `controller.test.ts` (880 lines) — read them and match. Add `applyMix: vi.fn()` to its engine stub.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test -- src/services/playback/controller.test.ts`
Expected: FAIL — `applyMix` is never called; `loadScore` is.

- [ ] **Step 3: Replace `handleScoreChange`**

Delete the `pendingResume` field, the `scoreChangeGeneration` field and every reference to them — including in `dispose`, `stop`, `seek` and `togglePlay` — and replace the method with:

```ts
/**
 * Reacts to the store's `score` reference changing.
 *
 * Two branches, and the lock (`store/slices/score-slice.ts`) is what allows the
 * first one: while playing, the only score change that can reach here is a mix
 * change, so there is nothing to reschedule and the engine keeps its queue.
 *
 * This used to be a stop-reload-seek-resume cycle, with a generation counter to
 * decide which of several in-flight calls owned the resume and a captured
 * `pendingResume` because the engine's own `stop()` synchronously reset the
 * store state a later call would have read. All of that existed to make editing
 * during playback safe. Editing during playback is now refused, so it is gone —
 * and if the lock is ever loosened, this is the code that has to come back.
 */
private handleScoreChange(score: Score): void {
  if (this.store.getState().state === 'playing') {
    this.engine.applyMix(score);
    return;
  }
  void this.loadScore(score);
}

/** Loads a score into the engine, reporting a failure rather than swallowing it. */
private async loadScore(score: Score): Promise<void> {
  try {
    await this.engine.loadScore(score);
    // loadScore reseeds each channel's mute from `Track.muted`, so hidden
    // tracks would sound again on the next load without this.
    this.applyTrackAudibility();
  } catch (error) {
    this.reportError('Failed to load the score for playback', error);
  }
}
```

Update the constructor's initial call and the subscription to call `handleScoreChange` synchronously.

- [ ] **Step 4: Run the tests**

Run: `bun run test -- src/services/playback/controller.test.ts`
Expected: the three new tests PASS. Many existing tests in that file assert the resume behaviour — they encoded a contract that is deliberately gone. Delete them, and say so in the commit. Keep every test about `stop`, `seek`, loop, tempo, metronome, volume and audition.

- [ ] **Step 5: Sabotage check**

Change the playing branch to `void this.loadScore(score);`. Expected: "applies mix to the engine without reloading" FAILS. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/services/playback
git commit -m "refactor(playback): collapse handleScoreChange to two branches

While playing, the lock guarantees the only score change that can arrive is a
mix change, so the engine keeps its queue and just re-reads levels. Otherwise it
loads the score.

pendingResume, scoreChangeGeneration and the stop-reload-seek-resume cycle go
with it — roughly eighty lines whose entire job was making a burst of edits
during playback safe. The tests that pinned the resume behaviour are deleted for
the same reason.

If the edit lock is ever loosened, this is the code that has to come back."
```

---

### Task 5: Delete the dead preview subsystem

**Repos:** `music_lib`, then `music_app`

**Files:**
- Modify: `music_lib/src/services/playback/controller.ts`
- Modify: `music_app/src/app/router.tsx:101,116`, `src/features/projects/DashboardPage.tsx:93`, `src/components/transport/TransportBar.tsx:404`, `src/components/layout/AppLayout.tsx:366`

**Why:** `playPreview` has no callers anywhere. `stopPreview()` is called in four places, all defensively, and since `previewing` is only ever set by `playPreview`, every one of them is a permanent no-op — a leftover from the candidate-preview removal. Leaving it obscures what the file now does, which after Task 4 is most of the file's remaining bulk.

- [ ] **Step 1: Confirm it is dead before deleting it**

```bash
cd music_lib && grep -rn "playPreview" src | grep -v controller.ts
cd ../music_app && grep -rn "playPreview" src
```

Expected: no output from either. **If anything turns up, stop** — the subsystem is live and this task does not apply.

- [ ] **Step 2: Delete from the controller**

Remove `previewing`, `previewGeneration`, `playPreview`, `stopPreview`, `resyncEngineToCommittedScore`, the `if (this.previewing)` branch in `togglePlay`, the `if (this.previewing) return;` in the store subscription, and the preview clean-up lines in `dispose`.

`togglePlay` becomes:

```ts
togglePlay(): void {
  const { state, score } = this.store.getState();
  if (!score) return;
  if (state === 'playing') {
    this.engine.pause();
    return;
  }
  // Starting playback deselects. Only on the ->playing transition: pause() and
  // stop() deliberately leave the selection alone, so pausing to edit keeps
  // what you had selected.
  //
  // "Play from the caret" needs no code here — the engine resumes from the
  // transport position, and a caret seek is exactly what set it.
  this.store.getState().clearSelection();
  this.engine.play().catch((error: unknown) => this.reportError('Playback failed to start', error));
}
```

- [ ] **Step 3: Run music_lib's suite**

Run: `bun run test && bun run typecheck`
Expected: preview tests in `controller.test.ts` fail to compile. Delete them — they test a subsystem that no longer exists.

- [ ] **Step 4: Build, propagate, remove the app's call sites**

```bash
cd music_lib && bun run clean && bun run build
rsync -a --delete dist/ ../music_app/node_modules/@sudobility/music_lib/dist/
rm -rf ../music_app/node_modules/.vite
```

Then delete the four `playbackController.stopPreview();` lines and the comments explaining them. In `AppLayout.tsx:365-366` the `stop()` on the next line stays — Task 6 depends on it.

- [ ] **Step 5: Verify both repos**

Run in each: `bun run typecheck && bun run test`

- [ ] **Step 6: Commit (both repos)**

```bash
git commit -am "refactor(playback): delete the dead candidate-preview subsystem

playPreview has no callers. stopPreview is called in four places, all
defensively, and since previewing is only ever set by playPreview every one of
them is a permanent no-op — a leftover from the candidate-preview removal."
```

---

### Task 6: A foreign score arrival stops the transport

**Repo:** `music_app`

**Files:**
- Modify: `src/components/layout/AppLayout.tsx:215-220` (generation reload), `:357-374` (`openSnapshot`)
- Test: `src/components/layout/AppLayout.test.tsx`

**Why:** a generation result landing or a snapshot being opened replaces the score without going through `dispatchCommand`, so the lock does not see it. Task 4's playing branch would then push mix state for music the engine is not playing, and the transport would carry on with the old score's schedule. Stopping first is what keeps the invariant "while playing, the only score change is a mix change" true by construction rather than by luck.

- [ ] **Step 1: Write the failing tests**

```ts
it('stops playback before adopting a generated score', async () => {
  // The lock does not see this write — it does not go through dispatchCommand
  // — so the transport has to be stopped explicitly, or the controller's
  // playing branch pushes mix state for music the engine is not playing.
  const { store } = renderAppLayout();
  store.getState().setPlaybackState('playing');

  await act(async () => {
    await resolveGenerationJob(); // whatever the suite's existing helper is
  });

  expect(store.getState().state).toBe('stopped');
});

it('stops playback before opening a snapshot', async () => {
  const { store, user } = renderAppLayout();
  store.getState().setPlaybackState('playing');

  await openSnapshotThroughTheUi(user); // ditto

  expect(store.getState().state).toBe('stopped');
});
```

`AppLayout.test.tsx` already renders the layout with `installTestAppServices()` and drives the snapshot dialogs — read it and reuse its helpers rather than inventing the two named above.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test -- src/components/layout/AppLayout.test.tsx`
Expected: FAIL on the generation case — the state stays `'playing'`. The snapshot case may already pass, since `openSnapshot` calls `stop()` today; keep the test regardless, so the ordering is pinned.

- [ ] **Step 3: Implement**

In the `useProjectGeneration` options:

```ts
onApplied: async () => {
  if (!projectId) return;
  // Before the score is replaced: this write bypasses the edit lock, so the
  // transport has to be taken out of `playing` explicitly or the controller
  // will treat the new score as a mix change and keep playing the old one.
  playbackController.stop();
  await store.getState().openProject(projectId);
},
```

In `openSnapshot`, move `playbackController.stop()` to **before** `setScore`, and note why in a comment.

- [ ] **Step 4: Run the tests and the suite**

Run: `bun run test` → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(playback): stop the transport before a foreign score arrives

A generation result landing or a snapshot opening replaces the score without
going through dispatchCommand, so the edit lock never sees it. The controller's
playing branch would then push mix state for music the engine is not playing.

Stopping first is what keeps 'while playing, the only score change is a mix
change' true by construction rather than by luck."
```

---

### Task 7: The UI says no before the guard has to

**Repo:** `music_app`

**Files:**
- Modify: `src/features/score-editor/editing.ts` (`insertNoteAtCaret:143`, `insertChordAtCaret:229`)
- Modify: `src/features/score-editor/EditorToolbar.tsx`
- Modify: `src/features/tracks/TrackEditorPanel.tsx`
- Test: `src/features/score-editor/editing.test.ts`, `src/features/tracks/TrackEditorPanel.test.tsx`

**Why both layers:** the store guard is correctness; this is honesty. A control that looks live and does nothing is worse than one that is visibly unavailable.

- [ ] **Step 1: Write the failing tests**

```ts
// editing.test.ts
it('refuses note entry while playing', () => {
  const store = createTestStore();
  store.getState().setScore(twinkleScore());
  store.getState().setPlaybackState('playing');
  const before = store.getState().score;

  insertNoteAtCaret(store, { step: 'C', octave: 4 });
  expect(store.getState().score).toBe(before);
});

it('refuses chord entry while playing, which is the piano keyboard route', () => {
  const store = createTestStore();
  store.getState().setScore(twinkleScore());
  store.getState().setPlaybackState('playing');
  const before = store.getState().score;

  expect(insertChordAtCaret(store, [{ step: 'C', octave: 4 }])).toBe(false);
  expect(store.getState().score).toBe(before);
});
```

```tsx
// TrackEditorPanel.test.tsx
it('keeps mute and solo usable while playing', async () => {
  const { store, user } = renderPanel();
  store.getState().setPlaybackState('playing');
  await user.click(screen.getByRole('button', { name: /mute this track/i }));
  expect(store.getState().score!.tracks[0].muted).toBe(true);
});

it('disables the instrument picker while playing', () => {
  const { store } = renderPanel();
  store.getState().setPlaybackState('playing');
  expect(screen.getByRole('combobox', { name: /instrument/i })).toBeDisabled();
});
```

Match the panel's real accessible names — read the file for its `Tooltip` content and `aria-label`s rather than trusting these.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test -- src/features/score-editor/editing.test.ts src/features/tracks/TrackEditorPanel.test.tsx`
Expected: FAIL — entry succeeds; the picker is enabled.

- [ ] **Step 3: Guard the two entry points**

In `editing.ts`, at the top of both functions, after the `state` read:

```ts
// Note entry is content, and content is immutable while playing. The store
// would refuse this anyway; refusing here keeps the caret and the toolbar's
// duration state from advancing as though something had been written.
if (state.state === 'playing') return; // `return false` in insertChordAtCaret
```

- [ ] **Step 4: Disable the affordances**

In `EditorToolbar.tsx` and `TrackEditorPanel.tsx`, read `const isPlaying = store((s) => s.state === 'playing');` and pass `disabled={isPlaying}` to every control that dispatches a content command — the duration and accidental buttons, Add Track, delete, the instrument and clef selects.

**Leave enabled:** mute, solo, volume and pan; track visibility (UI state, not score); zoom, layout mode, scrolling and selection.

`s.state === 'playing'` is a boolean, so this subscription re-renders only on a transport transition — it is not one of the high-frequency reads the codebase forbids at a component's top level.

- [ ] **Step 5: Run the suite**

Run: `bun run test` → PASS. A test that edits through a disabled control now fails; set the transport to `'stopped'` in its setup.

- [ ] **Step 6: Sabotage check**

Remove the guard from `insertChordAtCaret`. Expected: "refuses chord entry while playing" FAILS. Restore.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(editor): disable content editing while the transport plays

The store guard is correctness; this is honesty. A control that looks live and
does nothing is worse than one that is visibly unavailable.

Mute, solo, volume, pan, track visibility, zoom and selection all stay live —
mixing and reading are not editing."
```

---

### Task 8: Verify, document, hand off

- [ ] **Step 1: Verify every repo, in dependency order**

```bash
cd music_types && bun run verify
cd ../music_io && bun run verify
cd ../music_lib && bun run verify
cd ../music_app && bun run typecheck && bun run test && bun run build
```

`music_app`'s `lint` currently fails on the untracked `e2e/__diag.spec.ts`, which is unrelated pre-existing work — do not delete it, and do not let it block this step.

- [ ] **Step 2: Exercise it by hand**

Open a multi-track project, press Play, and confirm: the duration buttons and instrument picker are visibly disabled; mute, solo and a volume fader all take effect **immediately and without a gap in the audio**; pressing a piano key still sounds but writes nothing; Stop, then editing works again.

The fader is the one to watch. It is the case the spec missed, and a unit test can only prove `applyMix` was called, not that it was audible.

- [ ] **Step 3: Update the docs**

`music_app/CLAUDE.md`:
- The caret entry — "the red caret IS `playback-slice.positionTick`" — is **not** yet the split described in spec §3.2; that lands in step 3. Leave it, and do not let this task's changes imply otherwise.
- Add: content is immutable while playing; the classification lives on the command; mixing stays live through `applyMix`; a foreign score arrival stops the transport first.

`music_lib/CLAUDE.md`: `ScoreCommand.kind`, and that the controller's no-reload branch depends on the lock.

`music_io/CLAUDE.md`: `applyMix`, and why volume and pan needed it when mute and solo did not.

`music_app/docs/spec.md` §10: replace "reschedule safely after edits" with the lock — the situation is removed rather than handled. This is a product-spec change, called out in the design doc's §8.

- [ ] **Step 4: Commit and report**

Report: how many lines left `controller.ts`, which tests were deleted and why, whether the fader was audible by hand, and anything the plan's code did not match. Step 3 of the spec — the `PlaybackBus` and the caret split — is the next plan.

---

## Self-Review Notes

**Spec coverage:** §3.4 → Tasks 1, 2, 4, 6, 7. §3.5 → Task 5. The `applyMix` gap is not in the spec at all — it is recorded above under "What the spec did not account for" and should be folded into §3.4 during Task 8.

**Deliberately out of scope:** §3.1–3.3 (the `PlaybackBus`, the caret split, the resolved sounding-note payload) are step 3. `positionTick` and `activeNoteIds` stay in the store through this plan, and `resolveInsertTarget` still reads `positionTick` — it becomes `caretTick` in step 3, and Task 7's guard makes that rename behaviourally inert when it happens.

**Ordering constraints:** Task 3 before Task 4 (the controller calls `applyMix`). Task 2 before Task 4 (the no-reload branch is only sound under the lock). Task 6 closes the hole Task 4 opens for non-`dispatchCommand` writes, so the two should land together or Task 6 first.

**Riskiest task:** Task 4. It deletes the most intricate reasoning in the repo, and the tests being deleted with it are the ones that documented why it was there. The invariant is restated in the code comment and in `score-slice.ts` so that loosening the lock later has a chance of surfacing it.

**Verified against the code, not assumed:** all 31 command factories route through `snapshotCommand`/`transformCommand`; `changeTrackPropsCommand` is the only one serving both kinds; `playPreview` has no callers; `openSnapshot` already calls `stop()` but *after* `setScore`; `PlaybackEngine` has no per-track volume or pan setter.

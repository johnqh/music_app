/**
 * Shared Playwright e2e helpers (spec §30). Deliberately import nothing
 * from `@/*` (the app's own path alias/tsconfig isn't wired into
 * Playwright's runner) -- every type here is a small, local, "just enough
 * to read from `page.evaluate`" duck-type of the real domain/store shapes.
 *
 * Three testing techniques recur throughout the specs built on this file:
 *
 * 1. **The `__SCORESMITH_STORE__` window hook** (wired in `src/app/App.tsx`,
 *    gated behind `import.meta.env.DEV` only -- true for the `npm run dev`
 *    server this suite's `webServer` boots; there is no query-param
 *    opt-in, so it never ships in a production build). Real audio
 *    playback needs a user gesture and produces no observable DOM signal
 *    in headless Chromium (Tone.js), so playback assertions read
 *    `state`/`positionTick` off the store instead of listening for sound.
 *    The *workflow* tests (e.g. `regeneration.spec.ts`'s main test) also
 *    select "measures 3 and 4" through the hook (`selectMeasuresByIndex`)
 *    rather than pixel-perfect clicking on VexFlow's rendered SVG: driving
 *    the same `selectMeasures` call a real click ends up making is a
 *    faithful, far less flaky stand-in when the point of the test is the
 *    regeneration workflow *after* selection, not the click gesture
 *    itself. Technique 3, below, is the one place a real click on a
 *    measure is exercised end to end.
 *
 * 2. **Real pointer interaction for piano-roll dragging** (`view-switch-
 *    piano-roll.spec.ts`): unlike jsdom (the unit/component test
 *    environment), Playwright's Chromium does real DOM layout, so bounding
 *    boxes read via `getBoundingClientRect()` are real screen pixels --
 *    dragging a `[data-testid="pr-note-<id>"]` rect (a single, opaquely-
 *    filled div with no overlapping siblings) via real
 *    `page.mouse.down`/`move`/`up` reliably hits it. Selecting a *notation*
 *    note is deliberately NOT done this way (see `clickNoteGroup`'s doc
 *    comment): VexFlow draws a note's stem/flag/beam as separate,
 *    overlapping elements, so a coordinate click at the notehead's own
 *    bounding-box center often actually hits one of those instead.
 *
 * 3. **A genuine real-coordinate click for measure selection**
 *    (`findMeasureStaveClickPoint`, used once, in
 *    `regeneration.spec.ts`'s "selects a measure via a real click" test):
 *    unlike a note's stem/beam/flag (technique 2's problem), a measure's
 *    stave is drawn as thin painted line strokes, not a filled hit region
 *    covering the whole stave -- most points inside its bounding box hit
 *    nothing at all. This probes a handful of candidate points along the
 *    stave's own vertical middle (empirically, its middle line) via real
 *    `elementFromPoint` hit-testing until one actually resolves to the
 *    measure's own group, then hands that back for a real
 *    `page.mouse.click` -- genuinely exercising `ScoreEditorView`'s click
 *    handler end to end, without guessing at fixed pixel offsets that
 *    would silently drift with engraving changes.
 */
import { expect, type Page } from '@playwright/test';

/** Passed as `?seed=` (spec §31: deterministic mock-provider output for the same request + seed). Every spec in this suite uses the same seed so re-runs are reproducible. */
export const SEED = '42';

type PitchLike = { step: string; accidental: number; octave: number };

type NoteEventLike = {
  id: string;
  pitch: PitchLike;
  startTick: number;
  durationTicks: number;
  trackId: string;
};

type MeasureLike = { id: string; index: number; startTick: number; durationTicks: number };
type TrackLike = { id: string; name: string; measures: MeasureLike[] };
type ScoreLike = { ppq: number; tracks: TrackLike[] };

/** A `page.evaluate`-safe summary of the store's current score -- every note across every track/measure/voice, flattened, plus the raw measure grid of the first track (every track shares the same grid -- see `RegenerationPanel.tsx`'s `measureIndexRange` doc comment for the same convention used in-app). `null` if no score is loaded. */
export type ScoreSummary = {
  trackCount: number;
  measureCount: number;
  notes: NoteEventLike[];
  measures: MeasureLike[];
};

export type GenerationOptions = {
  prompt: string;
  measures?: number;
  keyFifths?: string; // visible option label, e.g. "C", "Bb"
  keyMode?: 'major' | 'minor';
  tempo?: number;
};

/** Navigates to the dashboard with the shared deterministic seed. */
export async function gotoDashboard(page: Page, seed: string = SEED): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await expect(page.getByRole('heading', { name: 'ScoreSmith' })).toBeVisible();
}

/** Creates a brand-new project from the dashboard and waits for the editor route to load. */
export async function createNewProject(page: Page, name = 'E2E Project'): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click();
  const nameField = page.getByLabel('New project name');
  await nameField.fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.getByLabel('Edit project title')).toBeVisible();
}

/** Fills out `GenerationPanel` and clicks Generate, waiting for the mock provider's response to land (spec §39 items 3-5). Assumes the panel is already visible (empty selection -> `mode === 'generate'`, the default for a freshly-created project). */
export async function generateWholeScore(page: Page, options: GenerationOptions): Promise<void> {
  // `exact: true` throughout: Playwright's label/role name matching is
  // substring-by-default, and several nearby controls' aria-labels contain
  // these as substrings (e.g. "Preset prompts" contains "Prompt", the
  // transport's "Tempo (BPM)" contains "Tempo") -- a non-exact match would
  // hit Playwright's strict-mode "resolved to N elements" error.
  await page.getByLabel('Prompt', { exact: true }).fill(options.prompt);
  if (options.measures !== undefined) {
    await page.getByLabel('Measures', { exact: true }).fill(String(options.measures));
  }
  if (options.keyFifths !== undefined) {
    await page.getByRole('combobox', { name: 'Key', exact: true }).click();
    await page.getByRole('option', { name: options.keyFifths, exact: true }).click();
  }
  if (options.keyMode !== undefined) {
    await page.getByRole('combobox', { name: 'Mode', exact: true }).click();
    await page.getByRole('option', { name: options.keyMode, exact: true }).click();
  }
  if (options.tempo !== undefined) {
    await page.getByLabel('Tempo', { exact: true }).fill(String(options.tempo));
  }
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await waitForGenerationSettled(page);
  await waitForNotation(page);
}

/** Waits for `generation-slice.pending` to go back to `false` (Generate/Regenerate's `LinearProgress` disappears). */
export async function waitForGenerationSettled(page: Page): Promise<void> {
  await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 15_000 });
}

/** Waits until the notation view has rendered at least one VexFlow-drawn element. */
export async function waitForNotation(page: Page): Promise<void> {
  await expect(async () => {
    const count = await page.locator('[data-testid="score-editor-canvas"] [id^="vf-"]').count();
    expect(count).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });
}

/** Reads the store's `getState()` and throws a clear error if the e2e hook (`src/app/App.tsx`) isn't present -- e.g. running against a production build instead of `npm run dev`. */
async function requireStore(page: Page): Promise<void> {
  const hasHook = await page.evaluate(() => typeof (window as unknown as { __SCORESMITH_STORE__?: unknown }).__SCORESMITH_STORE__ !== 'undefined');
  if (!hasHook) {
    throw new Error(
      '__SCORESMITH_STORE__ is not present on window -- the e2e test hook only wires up in dev mode (import.meta.env.DEV). Is Playwright\'s webServer really running `npm run dev`?',
    );
  }
}

/** A flattened, JSON-safe summary of the currently-loaded score, or `null` if none is loaded. */
export async function readScoreSummary(page: Page): Promise<ScoreSummary | null> {
  await requireStore(page);
  return page.evaluate(() => {
    const store = (window as unknown as { __SCORESMITH_STORE__: { getState: () => { score: ScoreLike | null } } }).__SCORESMITH_STORE__;
    const score = store.getState().score;
    if (!score) return null;
    const notes: NoteEventLike[] = [];
    for (const track of score.tracks) {
      for (const measure of track.measures) {
        for (const voice of (measure as unknown as { voices: Array<{ events: Array<Record<string, unknown>> }> }).voices) {
          for (const event of voice.events) {
            if ('pitch' in event) {
              notes.push({
                id: event.id as string,
                pitch: event.pitch as PitchLike,
                startTick: event.startTick as number,
                durationTicks: event.durationTicks as number,
                trackId: event.trackId as string,
              });
            }
          }
        }
      }
    }
    notes.sort((a, b) => a.startTick - b.startTick);
    return {
      trackCount: score.tracks.length,
      measureCount: score.tracks[0]?.measures.length ?? 0,
      notes,
      measures: (score.tracks[0]?.measures ?? []).map((m) => ({
        id: m.id,
        index: m.index,
        startTick: m.startTick,
        durationTicks: m.durationTicks,
      })),
    };
  });
}

/** Drives `selectMeasures` directly through the store hook for a 0-based range of measure indices on the first track (see this file's module doc for why -- a faithful, deterministic stand-in for clicking each measure's stave background). */
export async function selectMeasuresByIndex(page: Page, indices: number[]): Promise<void> {
  await requireStore(page);
  await page.evaluate((wantedIndices) => {
    type Store = { getState: () => { score: ScoreLike | null; selectMeasures: (ids: string[]) => void } };
    const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
    const score = store.getState().score;
    if (!score) throw new Error('selectMeasuresByIndex: no score is loaded');
    const measures = score.tracks[0]?.measures ?? [];
    const ids = wantedIndices.map((i) => {
      const measure = measures.find((m) => m.index === i);
      if (!measure) throw new Error(`selectMeasuresByIndex: no measure at index ${i}`);
      return measure.id;
    });
    store.getState().selectMeasures(ids);
  }, indices);
}

export type MeasureClickPoint = { x: number; y: number };

/**
 * Finds a real, on-screen point that lands on measure `measureIndex`'s own
 * rendered stave (its `[id="vf-<measureId>"]` group), not a note glyph --
 * for exercising `ScoreEditorView`'s real click-based measure-selection
 * path (`target.closest('[id^="vf-"]')` resolving via `measureIdToBBox`)
 * with a genuine `page.mouse.click`, rather than driving `selectMeasures`
 * through the store hook the way `selectMeasuresByIndex` does.
 *
 * VexFlow's stave lines are thin painted strokes, not a filled
 * measure-wide hit region, so not every point inside the stave's
 * bounding box actually lands on painted stave geometry (confirmed by
 * direct hit-test probing while building this helper: empty margins above/
 * below the stave hit nothing at all, and a note's own glyph can locally
 * cover the stave underneath it). This tries a handful of candidate
 * points along the stave's own vertical middle -- empirically always the
 * stave's own middle line -- at different horizontal fractions, and
 * returns the first one real `document.elementFromPoint` hit-testing
 * confirms actually resolves to the measure's own group (via the same
 * `closest('[id^="vf-"]')` walk the app's own click handler does), not a
 * note's. Throws if none of the candidates do (e.g. notes happen to sit
 * under every candidate x for this particular generated score) rather
 * than clicking blind and asserting on a false premise.
 */
export async function findMeasureStaveClickPoint(page: Page, measureIndex: number): Promise<MeasureClickPoint> {
  await requireStore(page);
  const measureId = await page.evaluate((index) => {
    type Store = { getState: () => { score: ScoreLike | null } };
    const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
    const measure = store.getState().score?.tracks[0]?.measures.find((m) => m.index === index);
    if (!measure) throw new Error(`findMeasureStaveClickPoint: no measure at index ${index}`);
    return measure.id;
  }, measureIndex);

  const targetId = `vf-${measureId}`;
  const point = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const candidateFractionsX = [0.5, 0.85, 0.15, 0.7, 0.3];
    for (const fracX of candidateFractionsX) {
      const x = rect.x + rect.width * fracX;
      const y = rect.y + rect.height * 0.5;
      const hit = document.elementFromPoint(x, y);
      const group = hit?.closest('[id^="vf-"]');
      if (group && group.id === id) return { x, y };
    }
    return null;
  }, targetId);

  if (!point) {
    throw new Error(
      `findMeasureStaveClickPoint: no candidate point on measure index ${measureIndex} hit its stave (every candidate landed on a note, or nothing)`,
    );
  }
  return point;
}

/** Reads `{ trackId, positionTick, playbackState }` off the store's `playback-slice`. */
export async function readPlaybackState(page: Page): Promise<{ state: string; positionTick: number }> {
  await requireStore(page);
  return page.evaluate(() => {
    type Store = { getState: () => { state: string; positionTick: number } };
    const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
    const s = store.getState();
    return { state: s.state, positionTick: s.positionTick };
  });
}

/** Reads `generation-slice.candidates` (id + label only -- enough to target each candidate card's controls by accessible name, without guessing at label text conventions the mock provider happens to use). */
export async function readCandidates(page: Page): Promise<Array<{ id: string; label: string }>> {
  await requireStore(page);
  return page.evaluate(() => {
    type Store = { getState: () => { candidates: Array<{ id: string; label: string }> } };
    const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
    return store.getState().candidates.map((c) => ({ id: c.id, label: c.label }));
  });
}

export type NoteGroup = { id: string };

/**
 * Every real note event currently rendered inside `containerTestId`
 * (per `readScoreSummary`'s own event ids -- the source of truth for
 * which `[id^="vf-"]` groups are real notes, as opposed to one of
 * VexFlow's own "vf-autoNNN" internal glyph ids for stems/beams/clefs/
 * etc, which share the same prefix but were never registered in
 * `idToElement` -- clicking one is a no-op, silently leaving the
 * selection unchanged), in tick order (`readScoreSummary`'s own note
 * order -- NOT on-screen x position, which only reflects reading order
 * *within* one system: a score wrapping across multiple systems restarts
 * each row back near x=0, so sorting purely by x would interleave notes
 * across rows out of chronological order).
 */
export async function getNoteGroups(page: Page, containerTestId = 'score-editor-canvas'): Promise<NoteGroup[]> {
  const summary = await readScoreSummary(page);
  const noteIds = (summary?.notes ?? []).map((n) => n.id);
  const renderedIds = await page.evaluate((containerTestId) => {
    const container = document.querySelector(`[data-testid="${containerTestId}"]`);
    if (!container) return [];
    return Array.from(container.querySelectorAll('[id^="vf-"]')).map((g) => g.id.slice('vf-'.length));
  }, containerTestId);
  const rendered = new Set(renderedIds);
  return noteIds.filter((id) => rendered.has(id)).map((id) => ({ id }));
}

/**
 * "Clicks" a `NoteGroup` returned by `getNoteGroups` by dispatching a real,
 * bubbling `MouseEvent` directly on its SVG group element (`id="vf-<id>"`)
 * rather than a real-coordinate `page.mouse.click`. `ScoreEditorView`'s
 * click handler (`target.closest('[id^="vf-"]')`) reads `event.target`,
 * not click coordinates, so this exercises the exact same handler -- but a
 * coordinate-based click at the note's own bounding-box center is
 * unreliable here: VexFlow draws a note's stem/flag/beam as separate,
 * overlapping sibling elements (their own "vf-autoNNN" ids, unregistered
 * in `idToElement`), and whichever one happens to be topmost at that exact
 * pixel -- not necessarily the notehead -- silently wins the real
 * browser's hit-test, making the click a no-op more often than not.
 */
export async function clickNoteGroup(page: Page, group: NoteGroup, options?: { shift?: boolean }): Promise<void> {
  await page.evaluate(
    ({ id, shift }) => {
      const element = document.getElementById(`vf-${id}`);
      if (!element) throw new Error(`clickNoteGroup: no element with id "vf-${id}"`);
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, shiftKey: shift }));
    },
    { id: group.id, shift: options?.shift ?? false },
  );
}

/** Collects uncaught page errors and console "error"-level messages for the lifetime of `page` (spec §39 item 25: "All operations complete without uncaught errors"). Call the returned function at the end of a test to assert none occurred. */
export function collectPageErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  return () => errors;
}

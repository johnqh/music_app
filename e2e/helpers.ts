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
 *    piano-roll.spec.ts`): Playwright's Chromium does real DOM layout, so
 *    dragging a `[data-testid="pr-note-<id>"]` rect via real
 *    `page.mouse.down`/`move`/`up` reliably hits it.
 *
 * 3. **Coordinate clicks resolved through `window.__scoresmith`** (the
 *    canvas notation renderer has no per-glyph DOM at all): the app's
 *    dev/e2e handle exposes the live render result's `idToBBox`/
 *    `measureIdToBBox` maps and the scroll box. Helpers translate a
 *    note/measure id -> content bbox -> viewport point and drive a real
 *    `page.mouse.click`; the app's own click handler resolves that point
 *    against the very same maps (`hit-test.ts`), so a bbox-center click
 *    always lands -- the SVG era's "stem/beam wins the hit-test" hazard is
 *    gone by construction.
 */
import { expect, type Page } from '@playwright/test';

// Determinism now comes from music_api's AI_TEST_MODE FixtureTransport
// (identical requests -> identical responses); the old mock-provider
// `?seed=` mechanism died with the Phase-2 move to server-side AI.

type PitchLike = { step: string; accidental: number; octave: number };

type NoteEventLike = {
  id: string;
  pitch: PitchLike;
  startTick: number;
  durationTicks: number;
  velocity: number;
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

/** `GenerationPanel.tsx`'s own `KEY_FIFTHS_OPTIONS` order (fifths -7..7), used to reach a given label by keyboard (see `generateWholeScore`'s Key-select doc comment). */
const KEY_FIFTHS_LABELS = [
  'Cb',
  'Gb',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
];

/** Navigates to the dashboard (auth is satisfied by the VITE_E2E shim). */
export async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/en/projects');
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
  // Library sweep 2: GenerationPanel's Key/Mode `<select>`s became
  // @sudobility/components' Radix-backed `Select` -- its trigger is a
  // `<button role="combobox">`, not a real `<select>`, so `selectOption`
  // no longer applies. Mode (2 options) is opened and clicked, same as the
  // Pitch step select this file's callers already drive that way (see
  // `acceptance.spec.ts`/`select-edit-undo.spec.ts`). Key (15 options,
  // spanning fifths -7..7 -- GenerationPanel.tsx's own `KEY_FIFTHS_OPTIONS`)
  // is driven by keyboard instead: the library `SelectContent`'s
  // `Viewport` is given a fixed `h-[var(--radix-select-trigger-height)]`
  // (the *trigger's* own height, not the popup's available height -- see
  // `select.tsx`), so for a list this long, most items genuinely render
  // outside any scrollable-into-view area a real browser click can reach
  // -- confirmed by a real Playwright run timing out on exactly that
  // click. `Home` + `ArrowDown` × index + `Enter` reaches the same item
  // via Radix's own internally-managed highlight/scroll instead.
  if (options.keyFifths !== undefined) {
    await page.getByRole('combobox', { name: 'Key', exact: true }).click();
    const index = KEY_FIFTHS_LABELS.indexOf(options.keyFifths);
    if (index === -1)
      throw new Error(`generateWholeScore: unknown keyFifths label "${options.keyFifths}"`);
    await page.keyboard.press('Home');
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
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

/** Waits for `generation-slice.pending` to go back to `false` (Generate/Regenerate's `role="progressbar"` indicator disappears). */
export async function waitForGenerationSettled(page: Page): Promise<void> {
  await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 15_000 });
}

/** Waits until the notation canvas has drawn at least one note (the `__scoresmith` handle's bbox map is non-empty). */
export async function waitForNotation(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const h = (window as unknown as { __scoresmith?: ScoresmithHandle }).__scoresmith;
      return (h?.result?.idToBBox.size ?? 0) > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** The shape of `window.__scoresmith` (ScoreEditorView's dev/e2e introspection handle). */
type ScoresmithHandle = {
  result: {
    idToBBox: Map<string, { x: number; y: number; width: number; height: number }>;
    measureIdToBBox: Map<string, { x: number; y: number; width: number; height: number }>;
  } | null;
  scrollBox: HTMLElement | null;
};

/**
 * Converts a content-coordinate bbox (as stored in the handle's maps) to a
 * viewport point at the bbox center, scrolling the box into view first if
 * needed. Runs entirely in-page; returns null when the id isn't in `map`.
 */
async function viewportPointForId(
  page: Page,
  map: 'idToBBox' | 'measureIdToBBox',
  id: string,
  offset?: { x: number; y: number },
): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ map, id, offset }) => {
      const h = (window as unknown as { __scoresmith?: ScoresmithHandle }).__scoresmith;
      if (!h?.result || !h.scrollBox) {
        throw new Error('__scoresmith is not present -- dev/e2e build required');
      }
      const box = h.result[map].get(id);
      if (!box) return null;
      const scroll = h.scrollBox;
      const targetY = box.y + box.height / 2;
      if (targetY < scroll.scrollTop || targetY > scroll.scrollTop + scroll.clientHeight) {
        scroll.scrollTo({ top: Math.max(0, box.y - scroll.clientHeight / 2) });
      }
      const rect = scroll.getBoundingClientRect();
      const cx = offset ? box.x + offset.x : box.x + box.width / 2;
      const cy = offset ? box.y + offset.y : box.y + box.height / 2;
      return { x: rect.left + cx - scroll.scrollLeft, y: rect.top + cy - scroll.scrollTop };
    },
    { map, id, offset },
  );
}

/** Asserts the notation canvas actually painted pixels (canvas smoke check: a broken draw would leave it fully transparent). */
export async function expectCanvasPainted(page: Page): Promise<void> {
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="score-canvas"]');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return false;
    const w = Math.min(canvas.width, 400);
    const hgt = Math.min(canvas.height, 400);
    if (w === 0 || hgt === 0) return false;
    const data = ctx.getImageData(0, 0, w, hgt).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return true; // any non-transparent pixel
    }
    return false;
  });
  expect(painted).toBe(true);
}

/** Reads the store's `getState()` and throws a clear error if the e2e hook (`src/app/App.tsx`) isn't present -- e.g. running against a production build instead of `npm run dev`. */
async function requireStore(page: Page): Promise<void> {
  const hasHook = await page.evaluate(
    () =>
      typeof (window as unknown as { __SCORESMITH_STORE__?: unknown }).__SCORESMITH_STORE__ !==
      'undefined',
  );
  if (!hasHook) {
    throw new Error(
      "__SCORESMITH_STORE__ is not present on window -- the e2e test hook only wires up in dev mode (import.meta.env.DEV). Is Playwright's webServer really running `npm run dev`?",
    );
  }
}

/** A flattened, JSON-safe summary of the currently-loaded score, or `null` if none is loaded. */
export async function readScoreSummary(page: Page): Promise<ScoreSummary | null> {
  await requireStore(page);
  return page.evaluate(() => {
    const store = (
      window as unknown as { __SCORESMITH_STORE__: { getState: () => { score: ScoreLike | null } } }
    ).__SCORESMITH_STORE__;
    const score = store.getState().score;
    if (!score) return null;
    const notes: NoteEventLike[] = [];
    for (const track of score.tracks) {
      for (const measure of track.measures) {
        for (const voice of (
          measure as unknown as { voices: Array<{ events: Array<Record<string, unknown>> }> }
        ).voices) {
          for (const event of voice.events) {
            if ('pitch' in event) {
              notes.push({
                id: event.id as string,
                pitch: event.pitch as PitchLike,
                startTick: event.startTick as number,
                durationTicks: event.durationTicks as number,
                velocity: event.velocity as number,
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
    type Store = {
      getState: () => { score: ScoreLike | null; selectMeasures: (ids: string[]) => void };
    };
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
 * Finds a real, on-screen point inside measure `measureIndex`'s stave box
 * that is NOT inside any note bbox, so a real `page.mouse.click` there
 * resolves to the measure (not a note) through `ScoreEditorView`'s
 * geometric hit-testing -- exercising the genuine click-based
 * measure-selection path end to end. With canvas rendering the whole
 * stave box is a valid hit region (no "thin painted strokes" problem),
 * so the only thing to avoid is landing on a drawn note.
 */
export async function findMeasureStaveClickPoint(
  page: Page,
  measureIndex: number,
): Promise<MeasureClickPoint> {
  await requireStore(page);
  const measureId = await page.evaluate((index) => {
    type Store = { getState: () => { score: ScoreLike | null } };
    const store = (window as unknown as { __SCORESMITH_STORE__: Store }).__SCORESMITH_STORE__;
    const measure = store.getState().score?.tracks[0]?.measures.find((m) => m.index === index);
    if (!measure) throw new Error(`findMeasureStaveClickPoint: no measure at index ${index}`);
    return measure.id;
  }, measureIndex);

  const point = await page.evaluate((id) => {
    const h = (window as unknown as { __scoresmith?: ScoresmithHandle }).__scoresmith;
    if (!h?.result || !h.scrollBox) {
      throw new Error('__scoresmith is not present -- dev/e2e build required');
    }
    const box = h.result.measureIdToBBox.get(id);
    if (!box) return null;
    const scroll = h.scrollBox;
    const rect = scroll.getBoundingClientRect();
    for (let dx = 2; dx < box.width; dx += 4) {
      for (let dy = 2; dy < box.height; dy += 4) {
        const px = box.x + dx;
        const py = box.y + dy;
        let insideNote = false;
        for (const noteBox of h.result.idToBBox.values()) {
          if (
            px >= noteBox.x &&
            px <= noteBox.x + noteBox.width &&
            py >= noteBox.y &&
            py <= noteBox.y + noteBox.height
          ) {
            insideNote = true;
            break;
          }
        }
        if (!insideNote) {
          return { x: rect.left + px - scroll.scrollLeft, y: rect.top + py - scroll.scrollTop };
        }
      }
    }
    return null;
  }, measureId);

  if (!point) {
    throw new Error(
      `findMeasureStaveClickPoint: measure index ${measureIndex} is not in the drawn window, or every probed point lies on a note`,
    );
  }
  return point;
}

/** Reads `{ trackId, positionTick, playbackState }` off the store's `playback-slice`. */
export async function readPlaybackState(
  page: Page,
): Promise<{ state: string; positionTick: number }> {
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
 * Every real note event currently drawn by the notation canvas (the
 * `__scoresmith` handle's `idToBBox` keys intersected with
 * `readScoreSummary`'s event ids), in tick order (`readScoreSummary`'s
 * own note order -- NOT on-screen x position, which restarts near x=0 on
 * every wrapped system).
 */
export async function getNoteGroups(page: Page): Promise<NoteGroup[]> {
  const summary = await readScoreSummary(page);
  const noteIds = (summary?.notes ?? []).map((n) => n.id);
  const renderedIds = await page.evaluate(() => {
    const h = (window as unknown as { __scoresmith?: ScoresmithHandle }).__scoresmith;
    return h?.result ? Array.from(h.result.idToBBox.keys()) : [];
  });
  const rendered = new Set(renderedIds);
  return noteIds.filter((id) => rendered.has(id)).map((id) => ({ id }));
}

/**
 * Clicks a `NoteGroup` with a real `page.mouse.click` at the center of its
 * drawn bbox (scrolled into view first if needed). The app's click handler
 * resolves the point against the same `idToBBox` map this reads, so a
 * bbox-center click deterministically selects exactly this note -- the SVG
 * era's overlapping stem/beam hit-test hazard no longer exists.
 */
export async function clickNoteGroup(
  page: Page,
  group: NoteGroup,
  options?: { shift?: boolean },
): Promise<void> {
  const point = await viewportPointForId(page, 'idToBBox', group.id);
  if (!point) throw new Error(`clickNoteGroup: note ${group.id} is not in the drawn window`);
  if (options?.shift) await page.keyboard.down('Shift');
  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    if (options?.shift) await page.keyboard.up('Shift');
  }
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

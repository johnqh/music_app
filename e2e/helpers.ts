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
 * 2. **Real pointer interaction for drag gestures**: Playwright's Chromium
 *    does real DOM layout, so dragging via real
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
  /** Names the project this creates. Defaults to a unique generated name; pass one when the spec asserts on the title. */
  title?: string;
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
/**
 * What a generated project is called.
 *
 * Deliberately not the prompt: prompts routinely start with "Create ...",
 * which collided with the dashboard's own Create button under Playwright's
 * substring name matching.
 */
export const GENERATED_NAME = 'Generated score';

/** A distinct title per call: e2e files run in parallel against one database, so two projects sharing a name is a strict-mode violation waiting to happen. */
let generatedCounter = 0;

export async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/en/projects');
  // Waits on the dashboard's own controls rather than the product name: the
  // name comes from VITE_APP_NAME, so asserting it here made the whole suite
  // fail on any machine whose .env rebrands the app.
  await expect(page.getByLabel('Search projects')).toBeVisible();
}

/**
 * Picks one format out of the dashboard's Import menu.
 *
 * The five import buttons became one Select — a menu whose trigger keeps
 * reading "Import" — so every spec that used to click a button by name now
 * opens this and chooses an option.
 */
export async function chooseImport(page: Page, label: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Import a file' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

/**
 * Creates a brand-new project from the dashboard and waits for the editor route.
 *
 * Through the New Project modal, which replaced the inline name field: the
 * project's name is the modal's Title, which is also the score's title, so a
 * project is named once rather than twice.
 */
export async function createNewProject(page: Page, name = 'E2E Project'): Promise<void> {
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.getByLabel('Edit project title')).toBeVisible();
}

/**
 * Generates a whole score from the dashboard and opens it.
 *
 * Whole-score generation moved off the editor sidebar: it now creates its own
 * project and runs as a background job, so this navigates to the dashboard,
 * submits, waits for the job to finish, and opens the result. Callers keep the
 * same contract as before — a generated score is open in the editor when this
 * returns.
 */
export async function generateWholeScore(page: Page, options: GenerationOptions): Promise<string> {
  await gotoDashboard(page);
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  // Generation is a toggle on the New Project form now, and it starts off.
  await page.getByRole('switch', { name: 'Generate for me' }).click();

  generatedCounter += 1;
  const title =
    options.title ??
    `${GENERATED_NAME} ${process.env.TEST_PARALLEL_INDEX ?? '0'}-${generatedCounter}-${Date.now()}`;
  await page.getByLabel('Title', { exact: true }).fill(title);

  // `exact: true` throughout: Playwright matches names by substring, and
  // several nearby controls contain these as substrings.
  await page.getByLabel('Prompt', { exact: true }).fill(options.prompt);
  if (options.measures !== undefined) {
    await page.getByLabel('Bars', { exact: true }).fill(String(options.measures));
  }
  if (options.keyFifths !== undefined) {
    await page.getByRole('combobox', { name: 'Key', exact: true }).click();
    const index = KEY_FIFTHS_LABELS.indexOf(options.keyFifths);
    if (index === -1)
      throw new Error(`generateWholeScore: unknown keyFifths label "${options.keyFifths}"`);
    // Keyboard rather than click: the Radix viewport is trigger-height, so
    // most of a 15-item list is unreachable by a real click.
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

  await page.getByRole('button', { name: 'Create', exact: true }).click();

  // Wait on a positive condition, never on the badge being absent: the badge
  // has not necessarily rendered yet at this point, so "no badge" passes
  // instantly and opens a project the job has not filled in.
  const card = page.getByRole('button', { name: `Open project: ${title}`, exact: true });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(/\/project\//);

  await waitForGenerationSettled(page);
  await waitForNotation(page);

  // The job writes the score server-side, so the notes are the only proof it
  // actually landed rather than leaving the placeholder behind.
  await expect
    .poll(async () => (await readScoreSummary(page))?.notes.length ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(0);

  return title;
}

/**
 * Waits for the open project's generation to finish.
 *
 * The editor's overlay, and deliberately *only* that. It used to also assert
 * that no dashboard badge said "Generating…" anywhere on the page, which was
 * two mistakes at once: every caller is in the editor, where that badge does
 * not exist, so the line was unreachable — and it was scoped to the whole page
 * rather than to a project, so the moment anything did call it from the
 * dashboard it would have been satisfied (or blocked) by a *different worker's*
 * project. The suite runs two workers against one `music_test` database, so
 * "no project anywhere is generating" is not a condition this test controls.
 *
 * A dashboard check belongs in the spec that owns the project, scoped to that
 * project's own card — see `generation-jobs.spec.ts`.
 */
export async function waitForGenerationSettled(page: Page): Promise<void> {
  await expect(page.getByText('Generating notes…')).toHaveCount(0, { timeout: 60_000 });
}

/**
 * Presses Play and waits until the transport is actually playing.
 *
 * The first press of the run has a 23MB soundfont to fetch and hand to
 * fluidsynth, and the transport no longer claims to be playing during that: it
 * disables the button, says "Preparing instruments", and flips to Pause only
 * once a note can sound. (It used to report "playing" immediately, which made
 * the caret — interpolated from elapsed real time — glide silently through
 * several bars and then snap back.) So this waits on a load-sized budget rather
 * than Playwright's default five seconds.
 */
export async function startPlayback(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 60_000 });
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
type BoxLike = { x: number; y: number; width: number; height: number };
type ScoresmithHandle = {
  result: {
    idToBBox: Map<string, BoxLike>;
    measureIdToBBox: Map<string, BoxLike>;
    /** The cached layout the frame drew against — the gutter band lives here, not in the bbox maps. */
    plan: {
      systems: Array<{ measureIndices: number[]; gutterTop: number; yTop: number }>;
      trackLayouts: Array<{ measures: Array<{ measureIndex: number; box: BoxLike }> }>;
    };
  } | null;
  scrollBox: HTMLElement | null;
};

/**
 * Converts a content-coordinate bbox (as stored in the handle's maps) to a
 * viewport point at the bbox center, scrolling the box into view first if
 * needed. Runs entirely in-page; returns null when the id isn't in `map`.
 */
export async function viewportPointForId(
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
 * A real, on-screen point inside measure `measureIndex`'s **gutter cell** --
 * the measure-number band above its system, which is where measure selection
 * lives now. A click on the stave body itself places the caret instead, so
 * this deliberately targets the band between `system.gutterTop` and
 * `system.yTop`.
 *
 * Geometry comes from the same `LayoutPlan` the app hit-tests against
 * (`measureIndexAtGutterPoint`), so a band-center click always lands.
 */
export async function findMeasureGutterClickPoint(
  page: Page,
  measureIndex: number,
): Promise<MeasureClickPoint> {
  await requireStore(page);

  // Scroll the band into view first, in its own step: the notation viewport
  // is short (the keyboard panel takes a fixed slice of the window), so a
  // measure a system or two down is below the fold, and a point computed
  // against the unscrolled box would land on whatever sits underneath.
  await page.evaluate((index) => {
    const h = (window as unknown as { __scoresmith?: ScoresmithHandle }).__scoresmith;
    if (!h?.result || !h.scrollBox) {
      throw new Error('__scoresmith is not present -- dev/e2e build required');
    }
    const system = h.result.plan.systems.find((sys) => sys.measureIndices.includes(index));
    if (!system) return;
    const scroll = h.scrollBox;
    // Leave a little headroom above the band so it isn't flush with the edge.
    scroll.scrollTop = Math.max(0, system.gutterTop - 8);
  }, measureIndex);
  // One frame for the scroll to apply and the redraw to run.
  await page.waitForTimeout(100);

  const point = await page.evaluate((index) => {
    const h = (window as unknown as { __scoresmith?: ScoresmithHandle }).__scoresmith;
    if (!h?.result || !h.scrollBox) {
      throw new Error('__scoresmith is not present -- dev/e2e build required');
    }
    const plan = h.result.plan;
    const system = plan.systems.find((sys) => sys.measureIndices.includes(index));
    const box = plan.trackLayouts[0]?.measures.find((m) => m.measureIndex === index)?.box;
    if (!system || !box) return null;

    const scroll = h.scrollBox;
    const rect = scroll.getBoundingClientRect();
    const px = box.x + box.width / 2;
    const py = (system.gutterTop + system.yTop) / 2;
    const x = rect.left + px - scroll.scrollLeft;
    const y = rect.top + py - scroll.scrollTop;
    // Refuse to return a point outside the visible box rather than silently
    // clicking through to whatever is behind it.
    if (y < rect.top || y > rect.bottom || x < rect.left || x > rect.right) return null;
    return { x, y };
  }, measureIndex);

  if (!point) {
    throw new Error(
      `findMeasureGutterClickPoint: measure index ${measureIndex} is not in the drawn window, or its gutter band could not be scrolled into view`,
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
  options?: { shift?: boolean; meta?: boolean },
): Promise<void> {
  const point = await viewportPointForId(page, 'idToBBox', group.id);
  if (!point) throw new Error(`clickNoteGroup: note ${group.id} is not in the drawn window`);
  // Meta (not Control): the app treats either as the range modifier, but
  // Playwright's Meta maps to the platform accelerator the user actually
  // presses on macOS, where this suite runs.
  if (options?.meta) await page.keyboard.down('Meta');
  if (options?.shift) await page.keyboard.down('Shift');
  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    if (options?.shift) await page.keyboard.up('Shift');
    if (options?.meta) await page.keyboard.up('Meta');
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

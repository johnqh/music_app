/**
 * VexFlow `ScoreRenderer` implementation (spec §7, §26): orchestrates
 * `layout.ts` (system/stave positions) and `convert.ts` (musical content)
 * into an actual VexFlow SVG draw, then `id-map.ts` to build the returned
 * id maps. Also exports `applyHighlights`, the caller-side helper for
 * painting selection/playback/preview state onto a `RenderResult`.
 *
 * Pure DOM adapter: no store/React imports (spec §3, §37).
 */
import { Beam, Formatter, Renderer as VexRenderer, Stave, StaveConnector, StaveTie, Voice } from 'vexflow';
import type { StaveNote } from 'vexflow';
import type { KeySignature, Measure, Score, TimeSignature, Track } from '@/domain/score/types';
import { buildVoiceContent, keySignatureToVexSpec } from '@/adapters/vexflow/convert';
import type { NoteMeta } from '@/adapters/vexflow/convert';
import { buildEventMaps, buildMeasureMap } from '@/adapters/vexflow/id-map';
import { computeLayout } from '@/adapters/vexflow/layout';
import type { MeasureLayout } from '@/adapters/vexflow/layout';
import type { RenderOptions, RenderResult, RenderTheme, ScoreChangeSet, ScoreRenderer } from '@/adapters/vexflow/types';

function sameTimeSignature(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function sameKeySignature(a: KeySignature, b: KeySignature): boolean {
  return a.fifths === b.fifths && a.mode === b.mode;
}

/** A single note/rest "channel" (spec §25 voice-ordinal convention, mirrored from `domain/score/ties.ts`) accumulated across a track's measures, for cross-measure/cross-decomposition tie detection. */
type Channel = Array<{ note: StaveNote; meta: NoteMeta }>;

/** Builds one measure's `Stave`, its VexFlow `Voice`s, and its beams; records notes into `channels` for tie building. */
function buildMeasureContent(
  measure: Measure,
  track: Track,
  placement: MeasureLayout,
  prevMeasure: Measure | undefined,
  ppq: number,
  channels: Map<number, Channel>,
  allMetas: NoteMeta[],
): { stave: Stave; voices: Voice[]; beams: Beam[] } {
  const { box, isFirstInSystem } = placement;
  const stave = new Stave(box.x, box.y, box.width);
  stave.setAttribute('id', measure.id);

  if (isFirstInSystem) {
    stave.addClef(track.clef);
  }
  if (isFirstInSystem || !prevMeasure || !sameKeySignature(prevMeasure.keySignature, measure.keySignature)) {
    stave.addKeySignature(keySignatureToVexSpec(measure.keySignature));
  }
  if (!prevMeasure || !sameTimeSignature(prevMeasure.timeSignature, measure.timeSignature)) {
    stave.addTimeSignature(`${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`);
  }

  const voices: Voice[] = [];
  const beams: Beam[] = [];

  measure.voices.forEach((domainVoice, voiceOrdinal) => {
    const { notes, metas } = buildVoiceContent(domainVoice.events, ppq);
    if (notes.length === 0) return;

    const vexVoice = new Voice({
      num_beats: measure.timeSignature.numerator,
      beat_value: measure.timeSignature.denominator,
    });
    // SOFT mode: don't throw if a voice's summed ticks don't exactly match
    // the time signature (e.g. the decomposeDuration nearest-duration
    // fallback for a non-standard remainder can be off by a few ticks).
    vexVoice.setMode(Voice.Mode.SOFT);
    vexVoice.addTickables(notes);
    voices.push(vexVoice);
    beams.push(...Beam.generateBeams(notes));

    const channel = channels.get(voiceOrdinal) ?? [];
    notes.forEach((note, i) => channel.push({ note, meta: metas[i] }));
    channels.set(voiceOrdinal, channel);
    allMetas.push(...metas);
  });

  return { stave, voices, beams };
}

/** Ties every adjacent (tieStart, tieStop) pair in a voice-ordinal channel — covers both cross-barline ties and same-measure duration-decomposition ties uniformly. */
function buildTies(channel: Channel): StaveTie[] {
  const ties: StaveTie[] = [];
  for (let i = 0; i < channel.length - 1; i += 1) {
    const a = channel[i];
    const b = channel[i + 1];
    if (!a.meta.tieStart || !b.meta.tieStop) continue;
    const keyCount = Math.min(a.note.getKeys().length, b.note.getKeys().length);
    const indices = Array.from({ length: keyCount }, (_, idx) => idx);
    ties.push(new StaveTie({ first_note: a.note, last_note: b.note, first_indices: indices, last_indices: indices }));
  }
  return ties;
}

export class VexFlowScoreRenderer implements ScoreRenderer {
  private lastOptions: RenderOptions | undefined;
  private lastContainer: HTMLElement | undefined;

  render(score: Score, container: HTMLElement, options: RenderOptions): RenderResult {
    this.lastOptions = options;
    this.lastContainer = container;

    // VexFlow's SVGContext appends a fresh <svg> to the container on every
    // construction rather than clearing it first — without this, repeated
    // render()/update() calls would stack up duplicate <svg> elements.
    container.replaceChildren();

    const plan = computeLayout(score, options);
    // VexFlow's typings require HTMLDivElement specifically (legacy DOM
    // props like `align`); our contract takes the broader HTMLElement
    // (spec §26), and VexFlow only actually requires a plain container to
    // append an <svg> into, so the cast is safe.
    const vexRenderer = new VexRenderer(container as HTMLDivElement, VexRenderer.Backends.SVG);
    vexRenderer.resize(Math.max(1, Math.ceil(plan.totalWidth)), Math.max(1, Math.ceil(plan.totalHeight)));
    const ctx = vexRenderer.getContext();

    const allMetas: NoteMeta[] = [];
    const allMeasureIds: string[] = [];
    const staves: Stave[] = [];
    const voicesToDraw: Voice[] = [];
    const beamsToDraw: Beam[] = [];
    const tiesToDraw: StaveTie[] = [];
    /** trackId -> measureIndex -> its drawn Stave, for connector placement. */
    const staveByTrackMeasure = new Map<string, Map<number, Stave>>();

    plan.trackLayouts.forEach(({ track, measures }) => {
      const channels = new Map<number, Channel>();
      staveByTrackMeasure.set(track.id, new Map());

      measures.forEach((placement) => {
        const measure = track.measures[placement.measureIndex];
        const prevMeasure = track.measures[placement.measureIndex - 1];
        allMeasureIds.push(measure.id);

        const { stave, voices, beams } = buildMeasureContent(
          measure,
          track,
          placement,
          prevMeasure,
          score.ppq,
          channels,
          allMetas,
        );
        stave.setContext(ctx);
        stave.format();
        staveByTrackMeasure.get(track.id)!.set(placement.measureIndex, stave);
        staves.push(stave);
        beamsToDraw.push(...beams);

        if (voices.length > 0) {
          voices.forEach((v) => v.setStave(stave));
          const formatter = new Formatter();
          formatter.joinVoices(voices);
          const justifyWidth = Math.max(20, stave.getNoteEndX() - stave.getNoteStartX());
          formatter.format(voices, justifyWidth);
          voicesToDraw.push(...voices);
        }
      });

      for (const channel of channels.values()) {
        tiesToDraw.push(...buildTies(channel));
      }
    });

    // Draw order: staves, then notes/voices, then beams/ties/connectors on top.
    staves.forEach((s) => s.draw());
    voicesToDraw.forEach((v) => v.draw(ctx));
    beamsToDraw.forEach((b) => {
      b.setContext(ctx);
      b.draw();
    });
    tiesToDraw.forEach((t) => {
      t.setContext(ctx);
      t.draw();
    });

    if (plan.tracks.length > 1) {
      plan.systems.forEach((system) => {
        const firstMeasureIndex = system.measureIndices[0];
        const topStave = staveByTrackMeasure.get(plan.tracks[0].id)?.get(firstMeasureIndex);
        const bottomStave = staveByTrackMeasure
          .get(plan.tracks[plan.tracks.length - 1].id)
          ?.get(firstMeasureIndex);
        if (!topStave || !bottomStave || topStave === bottomStave) return;
        const connector = new StaveConnector(topStave, bottomStave);
        connector.setType('brace');
        connector.setContext(ctx);
        connector.draw();
      });
    }

    const { idToElement, idToBBox } = buildEventMaps(container, allMetas);
    const measureIdToBBox = buildMeasureMap(container, allMeasureIds);

    return { idToElement, idToBBox, measureIdToBBox, height: plan.totalHeight };
  }

  update(score: Score, _changes: ScoreChangeSet, container: HTMLElement, _previous: RenderResult): RenderResult {
    // MVP: always a full re-render (O(score) — proportional to total note
    // count, same cost as `render`), regardless of `_changes`. The
    // `ScoreChangeSet` shape (`"all"` | `{ dirtyMeasureIds }`) is kept in
    // the contract so a future incremental implementation (re-layout/redraw
    // only the systems containing `dirtyMeasureIds`, reusing unaffected
    // staves from `_previous`) can slot in without changing callers.
    void _previous;
    if (!this.lastOptions) {
      throw new Error('VexFlowScoreRenderer.update() called before render()');
    }
    return this.render(score, container, this.lastOptions);
  }

  dispose(): void {
    this.lastContainer?.replaceChildren();
    this.lastContainer = undefined;
    this.lastOptions = undefined;
  }
}

export type HighlightSets = { selectedIds: string[]; playingIds: string[]; previewIds: string[] };

const HIGHLIGHT_CLASSES = ['selected', 'playing', 'preview'] as const;
const PAINTED_DESCENDANTS_SELECTOR = 'path, rect, ellipse, circle, polygon, polyline, line, text';

/**
 * Sets inline `fill` on `element` and every shape descendant (or clears it
 * when `color` is `null`). VexFlow's drawn shapes already carry their own
 * `fill` presentation attribute (lowest CSS priority); an inherited `fill`
 * set only on the ancestor group would never win over that, so we paint
 * each shape directly instead of relying on CSS inheritance.
 */
function paintDescendants(element: SVGElement, color: string | null): void {
  const targets: SVGElement[] = [element, ...Array.from(element.querySelectorAll<SVGElement>(PAINTED_DESCENDANTS_SELECTOR))];
  for (const target of targets) {
    if (color === null) target.style.removeProperty('fill');
    else target.style.fill = color;
  }
}

function paint(result: RenderResult, id: string, cls: string, color: string): void {
  const element = result.idToElement.get(id);
  if (!element) return;
  element.classList.add(cls);
  paintDescendants(element, color);
}

/**
 * Sets/clears `.selected` / `.playing` / `.preview` classes and fill colors
 * (from `theme`) on the elements in `result.idToElement` named by
 * `highlights`. Every previously-painted element is reset first, so calling
 * this again with a smaller/different set correctly un-highlights whatever
 * fell out. When an id appears in more than one set, `playing` wins over
 * `selected`, which wins over `preview` (applied in that order, last wins).
 */
export function applyHighlights(result: RenderResult, highlights: HighlightSets, theme: RenderTheme): void {
  for (const element of result.idToElement.values()) {
    for (const cls of HIGHLIGHT_CLASSES) element.classList.remove(cls);
    paintDescendants(element, null);
  }

  for (const id of highlights.previewIds) paint(result, id, 'preview', theme.preview);
  for (const id of highlights.selectedIds) paint(result, id, 'selected', theme.selection);
  for (const id of highlights.playingIds) paint(result, id, 'playing', theme.playback);
}

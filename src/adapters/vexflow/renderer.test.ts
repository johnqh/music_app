import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyHighlights, VexFlowScoreRenderer } from '@/adapters/vexflow/renderer';
import type { RenderOptions, RenderTheme } from '@/adapters/vexflow/types';
import { allNotes } from '@/domain/score/queries';
import { chordScore, twinkleScore, twoTrackScore } from '@/test/fixtures';

const theme: RenderTheme = { foreground: '#111', selection: '#06f', playback: '#f60', preview: '#999' };

function options(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return { zoom: 1, layoutMode: 'page', width: 900, theme, ...overrides };
}

let container: HTMLDivElement;
let renderer: VexFlowScoreRenderer;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  renderer = new VexFlowScoreRenderer();
});

afterEach(() => {
  renderer.dispose();
  container.remove();
});

describe('VexFlowScoreRenderer.render', () => {
  it('renders a note group for every note event in a single-voice melody', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());

    const notes = allNotes(score);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      const element = result.idToElement.get(note.id);
      expect(element, `missing element for note ${note.id}`).toBeDefined();
      expect(element?.classList.contains('vf-stavenote')).toBe(true);
      expect(container.querySelector(`[id="vf-${note.id}"]`)).toBe(element);
    }
  });

  it('produces exactly one drawn note group for a chord, shared by every chord member id', () => {
    const score = chordScore();
    const result = renderer.render(score, container, options());

    const firstMeasure = score.tracks[0].measures[0];
    const chordEventIds = firstMeasure.voices[0].events.map((e) => e.id);
    expect(chordEventIds.length).toBeGreaterThan(1);

    const elements = chordEventIds.map((id) => result.idToElement.get(id));
    expect(elements.every((el) => el !== undefined)).toBe(true);
    expect(new Set(elements).size).toBe(1);

    const staveNoteGroups = container.querySelectorAll('.vf-stavenote');
    // 4 chord measures, one StaveNote group per measure.
    expect(staveNoteGroups.length).toBe(firstMeasure.durationTicks > 0 ? score.tracks[0].measures.length : 0);
  });

  it('maps every rendered measure id to a bounding box', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    for (const measure of score.tracks[0].measures) {
      expect(result.measureIdToBBox.has(measure.id)).toBe(true);
    }
  });

  it('renders a stave per track for a multi-track score', () => {
    const score = twoTrackScore();
    renderer.render(score, container, options());
    const staveGroups = container.querySelectorAll('.vf-stave');
    const expectedStaveCount = score.tracks.reduce((sum, t) => sum + t.measures.length, 0);
    expect(staveGroups.length).toBe(expectedStaveCount);
  });

  it('draws a brace connector for a multi-track score (extra <path>s versus the sum of each track alone)', () => {
    // StaveConnector draws raw path/fill/stroke calls (no wrapping
    // group/class of its own, unlike Stave/StaveNote), so assert its effect
    // indirectly: rendering both tracks together must produce strictly more
    // <path> elements than rendering each track alone and summing, since
    // the shared content is otherwise identical and the connector is pure
    // addition.
    const score = twoTrackScore();

    const countFor = (trackIds: string[]): number => {
      const scratch = document.createElement('div');
      document.body.appendChild(scratch);
      const r = new VexFlowScoreRenderer();
      r.render(score, scratch, options({ trackIds }));
      const count = scratch.querySelectorAll('path').length;
      r.dispose();
      scratch.remove();
      return count;
    };

    const soloCounts = score.tracks.map((t) => countFor([t.id]));
    const combinedCount = countFor(score.tracks.map((t) => t.id));

    expect(combinedCount).toBeGreaterThan(soloCounts.reduce((a, b) => a + b, 0));
  });

  it('honors trackIds filtering', () => {
    const score = twoTrackScore();
    const [treble, bass] = score.tracks;
    renderer.render(score, container, options({ trackIds: [treble.id] }));
    const staveGroups = container.querySelectorAll('.vf-stave');
    expect(staveGroups.length).toBe(treble.measures.length);
    void bass;
  });

  it('returns a positive height', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    expect(result.height).toBeGreaterThan(0);
  });
});

describe('VexFlowScoreRenderer.update', () => {
  it('re-renders without leaking previous SVG content', () => {
    const score = twinkleScore();
    renderer.render(score, container, options());
    const svgCountAfterFirstRender = container.querySelectorAll('svg').length;
    const childCountAfterFirstRender = container.childElementCount;

    const result = renderer.render(score, container, options());
    renderer.update(score, 'all', container, result);

    expect(container.querySelectorAll('svg').length).toBe(svgCountAfterFirstRender);
    expect(container.childElementCount).toBe(childCountAfterFirstRender);
  });

  it('produces a fresh, structurally-equivalent result', () => {
    const score = twinkleScore();
    const first = renderer.render(score, container, options());
    const updated = renderer.update(score, { dirtyMeasureIds: [score.tracks[0].measures[0].id] }, container, first);
    expect(updated.idToElement.size).toBe(first.idToElement.size);
  });

  it('throws if called before render()', () => {
    const score = twinkleScore();
    const fresh = new VexFlowScoreRenderer();
    expect(() => fresh.update(score, 'all', container, { idToElement: new Map(), idToBBox: new Map(), measureIdToBBox: new Map(), height: 0 })).toThrow();
  });
});

describe('VexFlowScoreRenderer.dispose', () => {
  it('clears the container', () => {
    const score = twinkleScore();
    renderer.render(score, container, options());
    expect(container.childElementCount).toBeGreaterThan(0);
    renderer.dispose();
    expect(container.childElementCount).toBe(0);
  });
});

describe('applyHighlights', () => {
  it('toggles selected/playing/preview classes and clears them on the next call', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    const [a, b, c] = allNotes(score);

    applyHighlights(result, { selectedIds: [a.id], playingIds: [b.id], previewIds: [c.id] }, theme);
    expect(result.idToElement.get(a.id)?.classList.contains('selected')).toBe(true);
    expect(result.idToElement.get(b.id)?.classList.contains('playing')).toBe(true);
    expect(result.idToElement.get(c.id)?.classList.contains('preview')).toBe(true);

    applyHighlights(result, { selectedIds: [], playingIds: [], previewIds: [] }, theme);
    expect(result.idToElement.get(a.id)?.classList.contains('selected')).toBe(false);
    expect(result.idToElement.get(b.id)?.classList.contains('playing')).toBe(false);
    expect(result.idToElement.get(c.id)?.classList.contains('preview')).toBe(false);
  });

  it('ignores unknown ids without throwing', () => {
    const score = twinkleScore();
    const result = renderer.render(score, container, options());
    expect(() =>
      applyHighlights(result, { selectedIds: ['nope'], playingIds: [], previewIds: [] }, theme),
    ).not.toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Formatter, Renderer, Stave, StaveNote } from 'vexflow';
import { buildEventMaps, buildMeasureMap } from '@/adapters/vexflow/id-map';
import type { NoteMeta } from '@/adapters/vexflow/convert';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

function drawStaveWithNotes(measureId: string, notes: Array<{ note: StaveNote }>): void {
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(400, 200);
  const ctx = renderer.getContext();

  const stave = new Stave(10, 10, 300);
  stave.setAttribute('id', measureId);
  stave.setContext(ctx).draw();

  const vexNotes = notes.map((n) => n.note);
  if (vexNotes.length > 0) {
    Formatter.FormatAndDraw(ctx, stave, vexNotes);
  }
}

describe('buildEventMaps', () => {
  it('maps a single note id to its drawn element and bbox', () => {
    const note = new StaveNote({ keys: ['c/4'], duration: 'q' });
    note.setAttribute('id', 'note-1');
    drawStaveWithNotes('measure-1', [{ note }]);

    const metas: NoteMeta[] = [{ vexId: 'note-1', eventIds: ['note-1'], tieStart: false, tieStop: false, isRest: false }];
    const { idToElement, idToBBox } = buildEventMaps(container, metas);

    const element = idToElement.get('note-1');
    expect(element).toBeDefined();
    expect(element?.getAttribute('id')).toBe('vf-note-1');
    expect(element?.classList.contains('vf-stavenote')).toBe(true);
    expect(idToBBox.get('note-1')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('maps every chord member event id to the same drawn element', () => {
    const chord = new StaveNote({ keys: ['c/4', 'e/4', 'g/4'], duration: 'q' });
    chord.setAttribute('id', 'chord-1');
    drawStaveWithNotes('measure-1', [{ note: chord }]);

    const metas: NoteMeta[] = [
      { vexId: 'chord-1', eventIds: ['a', 'b', 'c'], tieStart: false, tieStop: false, isRest: false },
    ];
    const { idToElement } = buildEventMaps(container, metas);

    expect(idToElement.get('a')).toBe(idToElement.get('b'));
    expect(idToElement.get('b')).toBe(idToElement.get('c'));
  });

  it('resolves a duration-decomposed event to its first drawn segment', () => {
    const seg0 = new StaveNote({ keys: ['c/4'], duration: 'q' });
    seg0.setAttribute('id', 'long');
    const seg1 = new StaveNote({ keys: ['c/4'], duration: '8' });
    seg1.setAttribute('id', 'long::seg1');
    drawStaveWithNotes('measure-1', [{ note: seg0 }, { note: seg1 }]);

    const metas: NoteMeta[] = [
      { vexId: 'long', eventIds: ['long'], tieStart: true, tieStop: false, isRest: false },
      { vexId: 'long::seg1', eventIds: ['long'], tieStart: false, tieStop: true, isRest: false },
    ];
    const { idToElement } = buildEventMaps(container, metas);

    expect(idToElement.get('long')?.getAttribute('id')).toBe('vf-long');
  });

  it('skips metas whose element was never drawn', () => {
    const metas: NoteMeta[] = [{ vexId: 'missing', eventIds: ['missing'], tieStart: false, tieStop: false, isRest: false }];
    const { idToElement, idToBBox } = buildEventMaps(container, metas);
    expect(idToElement.has('missing')).toBe(false);
    expect(idToBBox.has('missing')).toBe(false);
  });
});

describe('buildMeasureMap', () => {
  it('maps a measure id to its drawn stave bbox', () => {
    drawStaveWithNotes('measure-42', []);
    const map = buildMeasureMap(container, ['measure-42']);
    expect(map.get('measure-42')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('omits measure ids with no drawn stave', () => {
    const map = buildMeasureMap(container, ['nope']);
    expect(map.has('nope')).toBe(false);
  });
});

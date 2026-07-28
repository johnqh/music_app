import { describe, expect, it } from 'vitest';
import { buildNoteColors } from '@/features/score-editor/note-colors';

describe('buildNoteColors', () => {
  it('is empty when nothing is selected or playing', () => {
    expect(buildNoteColors({ selectedIds: [], playingIds: [], regenerated: false }).size).toBe(0);
  });

  it('marks selected ids as selected', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: [], regenerated: false });
    expect(map.get('a')).toBe('selected');
  });

  it('marks selected ids as regenerated when the flag is set', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: [], regenerated: true });
    expect(map.get('a')).toBe('regenerated');
  });

  it('marks playing ids as playing', () => {
    const map = buildNoteColors({ selectedIds: [], playingIds: ['a'], regenerated: false });
    expect(map.get('a')).toBe('playing');
  });

  it('lets playing win over selected for the same id', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: ['a'], regenerated: false });
    expect(map.get('a')).toBe('playing');
  });

  it('lets playing win over regenerated for the same id', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: ['a'], regenerated: true });
    expect(map.get('a')).toBe('playing');
  });

  it('keeps unrelated selected and playing ids distinct', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: ['b'], regenerated: false });
    expect(map.get('a')).toBe('selected');
    expect(map.get('b')).toBe('playing');
    expect(map.size).toBe(2);
  });

  it('leaves unmentioned ids absent, so the renderer treats them as normal', () => {
    const map = buildNoteColors({ selectedIds: ['a'], playingIds: [], regenerated: false });
    expect(map.has('z')).toBe(false);
  });
});

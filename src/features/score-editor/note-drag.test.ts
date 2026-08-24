import { describe, expect, it } from 'vitest';
import { collisionForEditMode } from '@sudobility/music_lib';
import { computeLayout, testRenderTheme, twoTrackScore } from '@sudobility/music_lib';
import { resolveDrop } from '@/features/score-editor/note-drag';

const score = twoTrackScore();
const plan = () =>
  computeLayout(score, {
    zoom: 1,
    layoutMode: 'page',
    width: 1200,
    theme: testRenderTheme(),
  });

describe('collisionForEditMode', () => {
  it('maps the editor modes onto the command s collision rules', () => {
    // A drop is a write, so it obeys the same mode as every other write.
    expect(collisionForEditMode('replace')).toBe('replace');
    expect(collisionForEditMode('stack')).toBe('stack');
    expect(collisionForEditMode('insert')).toBe('ripple');
  });
});

describe('resolveDrop', () => {
  it('reports the track under the pointer and the snapped tick delta', () => {
    const p = plan();
    const box = p.trackLayouts[1].measures[0].box;
    const drop = resolveDrop(
      p,
      score,
      { anchorId: 'n1', anchorTick: 0 },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      480,
    );

    expect(drop?.trackId).toBe(p.trackLayouts[1].track.id);
    expect(drop!.deltaTicks % 480).toBe(0);
  });

  it('snaps the destination to the grid', () => {
    const p = plan();
    const box = p.trackLayouts[0].measures[0].box;
    const drop = resolveDrop(
      p,
      score,
      { anchorId: 'n1', anchorTick: 0 },
      { x: box.x + 7, y: box.y + box.height / 2 },
      480,
    );
    expect(drop!.deltaTicks % 480).toBe(0);
  });

  it('is null when the pointer is not over any stave', () => {
    expect(
      resolveDrop(plan(), score, { anchorId: 'n1', anchorTick: 0 }, { x: 100, y: -500 }, 480),
    ).toBeNull();
  });

  it('reports a delta relative to the anchor, so a phrase keeps its shape', () => {
    const p = plan();
    const box = p.trackLayouts[0].measures[0].box;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const fromZero = resolveDrop(p, score, { anchorId: 'n1', anchorTick: 0 }, point, 480);
    const fromLater = resolveDrop(p, score, { anchorId: 'n1', anchorTick: 960 }, point, 480);

    expect(fromZero!.deltaTicks - fromLater!.deltaTicks).toBe(960);
  });
});

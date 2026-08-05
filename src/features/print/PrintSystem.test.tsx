import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { computeLayout, twinkleScore } from '@sudobility/music_lib';
import { LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import { PRINT_SCALE, PRINT_WIDTH, printSystems } from '@/features/print/print-layout';
import { PrintSystem } from '@/features/print/PrintSystem';

function firstSlice() {
  const score = twinkleScore();
  const plan = computeLayout(score, {
    zoom: 1,
    layoutMode: 'page',
    width: PRINT_WIDTH,
    theme: LIGHT_RENDER_THEME,
    showTrackInfo: false,
  });
  return { score, slice: printSystems(plan)[0] };
}

describe('PrintSystem', () => {
  it('renders one canvas', () => {
    const { score, slice } = firstSlice();
    const { container } = render(<PrintSystem score={score} slice={slice} trackIds={[]} />);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('sizes the backing store above screen resolution', () => {
    // Displayed at the page width but drawn much larger, or the print comes
    // out visibly pixelated.
    const { score, slice } = firstSlice();
    const { container } = render(<PrintSystem score={score} slice={slice} trackIds={[]} />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(Math.floor(PRINT_WIDTH * PRINT_SCALE));
    expect(canvas.height).toBe(Math.floor(slice.height * PRINT_SCALE));
  });

  it('displays at the page width, whatever the backing store is', () => {
    const { score, slice } = firstSlice();
    const { container } = render(<PrintSystem score={score} slice={slice} trackIds={[]} />);
    expect(container.querySelector('canvas')!.style.width).toBe('100%');
  });

  it('is a block a page break may not fall inside', () => {
    // This is what puts breaks between systems rather than through one.
    const { score, slice } = firstSlice();
    const { container } = render(<PrintSystem score={score} slice={slice} trackIds={[]} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.breakInside).toBe('avoid');
  });
});

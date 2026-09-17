/**
 * One system of the score, drawn into its own canvas.
 *
 * One canvas per system. Feature 6 groups them into pages it chooses itself,
 * but the canvas per system is what keeps a page break from ever falling
 * through one.
 */
import { useEffect, useRef } from 'react';
import { CanvasScoreRenderer } from '@/app-library';
import type { Score } from '@sudobility/music_types';
import { PRINT_SCALE, PRINT_WIDTH, printRenderOptions } from '@sudobility/music_drawing';
import type { PrintSystemSlice } from '@sudobility/music_drawing';

export type PrintSystemProps = {
  score: Score;
  slice: PrintSystemSlice;
  trackIds: string[];
};

export function PrintSystem({ score, slice, trackIds }: PrintSystemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Drawn far larger than it is displayed: the CSS width is the page, the
    // backing store is print resolution.
    canvas.width = Math.floor(PRINT_WIDTH * PRINT_SCALE);
    canvas.height = Math.floor(slice.height * PRINT_SCALE);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    new CanvasScoreRenderer().render(score, ctx, {
      ...printRenderOptions(trackIds),
      viewport: { top: slice.top, bottom: slice.bottom },
    });
  }, [score, slice, trackIds]);

  return (
    <div
      data-testid={`print-system-${slice.systemIndex}`}
      // Inline rather than a class: this is the rule the whole feature exists
      // to guarantee, and it belongs on the element that carries it.
      style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
    </div>
  );
}

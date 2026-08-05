/**
 * One system of the score, drawn into its own canvas.
 *
 * One canvas per system is what puts page breaks *between* systems: each is an
 * indivisible block, so the browser fits as many whole ones per page as the
 * paper allows — any paper, no arithmetic, no size picker. Feature 6 replaces
 * this with a page's worth of systems once turns have to land on rests.
 */
import { useEffect, useRef } from 'react';
import { CanvasScoreRenderer } from '@sudobility/music_lib';
import type { Score } from '@sudobility/music_types';
import { PRINT_SCALE, PRINT_WIDTH, printRenderOptions } from '@/features/print/print-layout';
import type { PrintPage } from '@/features/print/print-layout';

export type PrintSystemProps = {
  score: Score;
  page: PrintPage;
  trackIds: string[];
};

export function PrintSystem({ score, page, trackIds }: PrintSystemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Drawn far larger than it is displayed: the CSS width is the page, the
    // backing store is print resolution.
    canvas.width = Math.floor(PRINT_WIDTH * PRINT_SCALE);
    canvas.height = Math.floor(page.height * PRINT_SCALE);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    new CanvasScoreRenderer().render(score, ctx, {
      ...printRenderOptions(trackIds),
      viewport: { top: page.top, bottom: page.bottom },
    });
  }, [score, page, trackIds]);

  return (
    <div
      data-testid={`print-system-${page.systemIndex}`}
      // Inline rather than a class: this is the rule the whole feature exists
      // to guarantee, and it belongs on the element that carries it.
      style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
    </div>
  );
}

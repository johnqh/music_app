/**
 * Renders an instrument's line art as an inline `<svg>`.
 *
 * The art itself (`gmInstrumentIcon`) lives in `music_lib` beside the GM
 * catalogue, because the canvas renderer draws the same shapes into the track
 * gutter — one source beats passing a per-track art map into the renderer as an
 * option. This component is the DOM half of that pair; `icon-canvas.ts` in the
 * lib is the canvas half.
 *
 * `stroke="currentColor"` is the point of the whole exercise: the icon takes the
 * colour of the text it sits beside, which the emoji glyphs it replaced could
 * not do.
 */
import { ICON_STROKE_WIDTH, ICON_VIEWBOX, trackInstrumentIcon } from '@sudobility/music_lib';
import type { Track } from '@sudobility/music_types';

export type InstrumentIconProps = {
  /**
   * The track, not a program number: `midiProgram` addresses a drum kit on a
   * percussion track, so the same number that draws a violin there should draw
   * a kit. Only the two fields that decide the art are required, so a caller
   * with a partial track (a generation preview, say) can still pass one.
   */
  track: Pick<Track, 'clef' | 'midiProgram'>;
  /** Size the icon with a `size-*`/`h-*` class; it has no intrinsic size of its own. */
  className?: string;
};

/**
 * Decorative: the instrument's name is always rendered beside it, so this is
 * `aria-hidden` and screen readers get the name rather than a shape.
 */
export function InstrumentIcon({ track, className }: InstrumentIconProps) {
  const art = trackInstrumentIcon(track);
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {art.shapes.map((shape, index) =>
        shape.kind === 'circle' ? (
          <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} />
        ) : (
          <path key={index} d={shape.d} />
        ),
      )}
    </svg>
  );
}

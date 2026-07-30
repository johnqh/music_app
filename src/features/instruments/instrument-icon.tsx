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
import { ICON_STROKE_WIDTH, ICON_VIEWBOX, gmInstrumentIcon } from '@sudobility/music_lib';

export type InstrumentIconProps = {
  program: number;
  /** Size the icon with a `size-*`/`h-*` class; it has no intrinsic size of its own. */
  className?: string;
};

/**
 * Decorative: the instrument's name is always rendered beside it, so this is
 * `aria-hidden` and screen readers get the name rather than a shape.
 */
export function InstrumentIcon({ program, className }: InstrumentIconProps) {
  const art = gmInstrumentIcon(program);
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

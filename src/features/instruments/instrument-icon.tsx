/**
 * Renders an instrument's emoji glyph.
 *
 * Its own file so the glyph table (`instrument-emoji.ts`) can be imported by
 * non-component code without tripping Fast Refresh, which needs a module to
 * export only components.
 */
import { instrumentEmoji } from '@/features/instruments/instrument-emoji';

export type InstrumentIconProps = { program: number; className?: string };

/**
 * Decorative: the instrument's name is always rendered beside it, so this is
 * `aria-hidden` and screen readers get the name rather than an emoji reading.
 */
export function InstrumentIcon({ program, className }: InstrumentIconProps) {
  return (
    <span aria-hidden="true" className={className}>
      {instrumentEmoji(program)}
    </span>
  );
}

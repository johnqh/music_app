/**
 * The app's slider: a native range input over painted divs.
 *
 * Extracted from the mixer, which had already discovered why the shared
 * `Slider` will not do here. Its unfilled track is `bg-muted`, and against
 * these surfaces that is very nearly the background — so a control reads as a
 * short bar floating in space, with nothing to say how much further it goes.
 * The mixer painted its own groove in `bg-border` and looked right; the
 * transport bar kept the library control and looked wrong, which is exactly
 * the kind of divergence that happens when two places solve one problem.
 *
 * The input stays native so every keyboard and accessibility behaviour the
 * platform already implements comes for free — arrows, Home/End, touch
 * targets — while the visuals are ours. `appearance-none` over a transparent
 * background is what lets the painting show through.
 *
 * `aria-label` on the input rather than a wrapping `<label>`: the library
 * control takes no accessible name of its own, and every caller here has one.
 */
import type { ReactNode } from 'react';
import { cn } from '@sudobility/components';

/** The bed both a level and a position are painted on. */
export const TRACK_BASE_CLASS = 'absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2';

/** A level: a rounded groove, the ordinary shape for an amount. */
export const TRACK_CLASS = `${TRACK_BASE_CLASS} rounded-full`;

/**
 * The unfilled groove — the part that says how much further the control goes.
 *
 * `bg-border`, deliberately, and not this app's usual `bg-theme-border`: that
 * class compiles to `background-color: var(--color-border)`, and the token the
 * design system actually injects at runtime is `--border`. The variable does
 * not exist, so the rule resolves to nothing and the groove paints
 * *transparent* — which left volume with no right-hand side and pan with
 * nothing but a thumb. `bg-border` is `hsl(var(--border))`: a real 80%/20%
 * grey, measured at `rgb(204,204,204)` against this panel in the light theme.
 */
export const GROOVE_CLASS = 'bg-border';

/** A round knob, which is what a level's thumb should look like. */
export const THUMB_CLASS = [
  '[&::-webkit-slider-thumb]:appearance-none',
  '[&::-webkit-slider-thumb]:size-3',
  '[&::-webkit-slider-thumb]:rounded-full',
  '[&::-webkit-slider-thumb]:bg-primary',
  '[&::-webkit-slider-thumb]:border',
  '[&::-webkit-slider-thumb]:border-background',
  '[&::-moz-range-thumb]:size-3',
  '[&::-moz-range-thumb]:rounded-full',
  '[&::-moz-range-thumb]:bg-primary',
  '[&::-moz-range-thumb]:border-0',
].join(' ');

export type SliderShellProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  thumbClass?: string;
  /** Extra classes for the shell, for callers that size it themselves. */
  className?: string;
  children: ReactNode;
};

/** The input and its painted bed; each control supplies its own painting. */
export function SliderShell({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  thumbClass = THUMB_CLASS,
  className,
  children,
}: SliderShellProps) {
  return (
    <div className={cn('relative h-4 flex-1', className)}>
      {children}
      <input
        type="range"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          'relative block h-4 w-full cursor-pointer appearance-none bg-transparent',
          disabled && 'cursor-not-allowed opacity-50',
          thumbClass,
        )}
      />
    </div>
  );
}

export type LevelSliderProps = {
  /** The accessible name — what property of what this controls. */
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
};

/**
 * A level: filled from the left, with the groove visible behind it.
 *
 * The whole control in one call, so a caller cannot get the groove wrong by
 * forgetting to paint it — which is how the transport bar ended up without
 * one.
 */
export function LevelSlider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
  onChange,
  className,
}: LevelSliderProps) {
  const span = max - min;
  const percent = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;
  return (
    <SliderShell
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={onChange}
      className={className}
    >
      <div className={cn(TRACK_CLASS, GROOVE_CLASS)} aria-hidden />
      <div
        className={cn(TRACK_CLASS, 'right-auto bg-primary')}
        style={{ width: `${percent}%` }}
        aria-hidden
      />
    </SliderShell>
  );
}

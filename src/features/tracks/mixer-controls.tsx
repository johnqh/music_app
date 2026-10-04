/**
 * Volume and pan, drawn as the things they are.
 *
 * The shared `Slider` is a good general control and a poor mixer one, for two
 * reasons this fixes:
 *
 * - **Volume gave no sense of its range.** Its unfilled track is `bg-muted`,
 *   which against the inspector's own surface is very nearly invisible — so a
 *   quiet track looked like a short bar floating in space, with nothing to say
 *   how much further it could go. Here the groove is always visible behind the
 *   fill, and a percent readout says the same thing in words.
 * - **Pan is not a number in a range.** It is a position between left and
 *   right, and the only readings that matter are which side and how far from
 *   centre. So it fills *from the middle*, marks the centre, and reads out
 *   "C" / "L40" / "R25" — a bar growing from the left said "40% of maximum
 *   pan", which is not a thing.
 *
 * Both are a native range input laid over painted divs: the input keeps every
 * keyboard and accessibility behaviour the platform already implements
 * (arrows, Home/End, touch targets), while the visuals are ours. `appearance-
 * none` and a transparent background are what let the painting show through.
 *
 * Each owns its whole row — label, control, readout — rather than being
 * dropped into a row the caller builds. The two sit directly above one another
 * in the panel, so any difference between them reads as a mistake, and letting
 * each caller size its own label column is exactly how they diverged: the
 * volume groove sat 14px left of the pan groove and ran 68px wider, because
 * "Volume" is a longer word than "Pan" and both rows were sizing to their own
 * text.
 *
 * Committing is the caller's business — see `CommitSlider` — because a mixer
 * drag fires continuously and each commit would otherwise be an undo entry.
 */
import { Button, cn } from '@sudobility/components';
/*
  `panReadout` is music_types', not this app's, and so are `volumeReadout` and
  the two clamps beside it. It was three lines here and
  three identical lines in music_app_rn once the native property sheet gained
  the same row — which is the moment a display conversion stops being a detail
  of one panel and becomes a fact both apps have to agree on. It sits with the
  other "say a stored value the way a musician says it" conversions in
  `music-vocabulary.ts`.
*/
import { clampPan, clampVolume, panReadout, volumeReadout } from '@sudobility/music_types';
/*
  The shell, the groove and the level are shared with the transport bar now.
  They were defined here because this is where the shared `Slider` was first
  found wanting; keeping them here meant the transport bar went on using the
  library control and its near-invisible `bg-muted` groove. One definition,
  so the two cannot look different again.
*/
import { LevelSlider, SliderShell, TRACK_BASE_CLASS } from '@/components/controls/level-slider';

/**
 * Pan: square-cornered, and a different ground from volume's.
 *
 * Pan is not a level, and the point of drawing it differently is that the two
 * rows sit directly above one another — same size, same place, opposite
 * meanings. Square ends and a darker bed read as a channel with a position in
 * it rather than as an amount that has been filled up to somewhere.
 */
const PAN_TRACK_CLASS = TRACK_BASE_CLASS;
const PAN_GROOVE_CLASS = 'bg-muted-foreground/45';

/**
 * The pan knob: a tall, narrow rectangle rather than a dot.
 *
 * A round thumb reads as a bead sliding along a wire, which is right for a
 * level and wrong for a position — the physical control this stands in for is
 * a slotted knob, and the rectangle is what makes the row legible at a glance
 * as the pan row.
 */
const PAN_THUMB_CLASS = [
  '[&::-webkit-slider-thumb]:appearance-none',
  '[&::-webkit-slider-thumb]:h-4',
  '[&::-webkit-slider-thumb]:w-2',
  '[&::-webkit-slider-thumb]:rounded-none',
  '[&::-webkit-slider-thumb]:bg-primary',
  '[&::-webkit-slider-thumb]:border',
  '[&::-webkit-slider-thumb]:border-background',
  '[&::-moz-range-thumb]:h-4',
  '[&::-moz-range-thumb]:w-2',
  '[&::-moz-range-thumb]:rounded-none',
  '[&::-moz-range-thumb]:bg-primary',
  '[&::-moz-range-thumb]:border-0',
].join(' ');

/** The row shape both controls use, stated once so the two cannot drift. */
const ROW_CLASS = 'flex items-center gap-2';
const ROW_LABEL_CLASS = 'w-12 shrink-0 text-xs text-muted-foreground';
const ROW_READOUT_CLASS = 'w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground';

/**
 * The trailing action column.
 *
 * Only pan has anything to put in it, but both rows reserve it — otherwise the
 * pan groove would be a button's width shorter than the volume groove directly
 * above it, which is the misalignment this row shape exists to prevent.
 */
const ROW_ACTION_CLASS = 'w-5 shrink-0';

export type MixerSliderProps = {
  /** The accessible name — what property of what this controls. */
  label: string;
  /** The visible text in the row's label column, which is shorter. */
  rowLabel: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

/** 0 to 1, filled from the left, on a groove that shows the whole range. */
export function VolumeSlider({ label, rowLabel, value, disabled, onChange }: MixerSliderProps) {
  const clamped = clampVolume(value);

  return (
    <div className={ROW_CLASS}>
      <span className={ROW_LABEL_CLASS}>{rowLabel}</span>
      <LevelSlider label={label} value={clamped} onChange={onChange} disabled={disabled} />
      <span className={ROW_READOUT_CLASS}>{volumeReadout(clamped)}</span>
      <span className={ROW_ACTION_CLASS} aria-hidden />
    </div>
  );
}

export type PanSliderProps = MixerSliderProps & {
  /** Centres the pan. Omitted where there is nothing to commit to. */
  onReset?: () => void;
  /** The reset button's accessible name; the caller owns the words. */
  resetLabel?: string;
};

/** -1 to 1, filled from the centre outwards. */
export function PanSlider({
  label,
  rowLabel,
  value,
  disabled,
  onChange,
  onReset,
  resetLabel = 'Center pan',
}: PanSliderProps) {
  const clamped = clampPan(value);
  // Half-widths either side of centre, so the fill grows out of the middle.
  const width = Math.abs(clamped) * 50;
  const left = clamped < 0 ? 50 - width : 50;

  return (
    <div className={ROW_CLASS}>
      <span className={ROW_LABEL_CLASS}>{rowLabel}</span>
      <SliderShell
        label={label}
        value={clamped}
        min={-1}
        max={1}
        step={0.01}
        disabled={disabled}
        onChange={onChange}
        thumbClass={PAN_THUMB_CLASS}
      >
        <div className={cn(PAN_TRACK_CLASS, PAN_GROOVE_CLASS)} aria-hidden />
        {/* The centre detent, so "no pan" is findable by eye as well as by feel. */}
        <div
          className="absolute left-1/2 top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-muted-foreground/70"
          aria-hidden
        />
        <div
          className={cn(PAN_TRACK_CLASS, 'right-auto bg-primary')}
          style={{ left: `${left}%`, width: `${width}%` }}
          aria-hidden
        />
      </SliderShell>
      <span className={ROW_READOUT_CLASS}>{panReadout(clamped)}</span>
      <div className={ROW_ACTION_CLASS}>
        {onReset ? (
          <Button
            type="button"
            // The colours are the ghost variant's; the rest only shrinks the
            // library's 44px control to fit the row's 20px action column.
            variant="ghost"
            aria-label={resetLabel}
            title={resetLabel}
            // Nothing to do when it is already centred, and saying so is
            // better than a button that looks live and is a no-op.
            disabled={disabled || clamped === 0}
            onClick={onReset}
            className={cn(
              'size-5 min-h-0 rounded p-0 text-sm leading-none hover:scale-100 hover:text-foreground',
              'disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            {/* A reset arrow: ⌖ was the obvious "centre" mark and was
                illegible at this size. */}
            ↺
          </Button>
        ) : null}
      </div>
    </div>
  );
}

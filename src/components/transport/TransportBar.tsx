/**
 * Playback transport bar (spec §22): go-to-start, previous/next measure,
 * play/pause, stop, loop toggle, metronome toggle, current measure/beat,
 * tempo display+edit, playback speed, master volume, and a timeline
 * scrubber.
 *
 * Every control that actually moves the transport (play/pause/stop/seek/
 * loop/metronome/speed/volume) calls the `playbackController` singleton
 * directly (never `store.dispatchCommand` — playback is real-time device
 * control, not score history; see `services/playback/controller.ts`'s doc
 * comment). Tempo is the one exception: editing the BPM number *is* a
 * score edit (spec §22 "tempo control", persisted with the score, unlike
 * the ephemeral playback-speed multiplier), so it goes through
 * `changeTempoCommand`/`dispatchCommand` like any other score mutation.
 *
 * Adopts `@sudobility/components` controls (library sweep 1): plain
 * buttons become the library `Button` (variant="ghost", `size="icon"` for
 * icon-only controls; `aria-pressed`/`aria-label`/`disabled` all just work
 * since it forwards `ButtonHTMLAttributes`), the native `<select>` becomes
 * the library's Radix-backed `Select`, and master volume becomes the
 * library `Slider`. The library `Slider` accepts no `aria-label`/`id`
 * (its props are a closed `SliderProps`, no HTML-attribute passthrough),
 * so its accessible name is supplied by wrapping it in a `<label>` with a
 * visually-hidden (`sr-only`) text node -- the same accessible-name result
 * as an explicit `aria-label`, via the standard implicit label-association
 * algorithm (`getByRole('slider', {name})`/`getByLabelText` both resolve
 * it). The visible "Vol" abbreviation stays a plain sibling *outside* that
 * label so it doesn't also get folded into the accessible name.
 *
 * The timeline scrubber stays a native `<input type="range">`: spec-wise
 * it's the one range control here that isn't a "commit once, not per
 * tick" control (every intermediate tick genuinely re-seeks playback), so
 * there's no draft/commit split to preserve and no benefit to wrapping it.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent, KeyboardEvent } from 'react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Spinner,
  Tooltip,
  cn,
} from '@sudobility/components';
import { changeTempoCommand } from '@sudobility/music_lib';
import { scoreEndTick, TempoMap } from '@sudobility/music_lib';
import { playbackController } from '@sudobility/music_lib';
import type { PlaybackStoreApi } from '@sudobility/music_lib';
import { selectCurrentMeasureBeat } from '@sudobility/music_lib';
import { usePlaybackPosition } from '@/features/score-editor/usePlayback';
import type { MeasureBeat } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import { ArrowPathRoundedSquareIcon } from '@heroicons/react/24/solid';
import {
  GoToStartIcon,
  ICON_CONTROL_CLASS,
  ICON_GLYPH_CLASS,
  MetronomeIcon,
  NextMeasureIcon,
  PreviousMeasureIcon,
  TEXT_CONTROL_CLASS,
} from '@/components/icons/notation-icons';
import { ExclamationTriangleIcon, PauseIcon, PlayIcon, StopIcon } from '@heroicons/react/24/solid';

export type TransportBarProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: PlaybackStoreApi;
};

/** Spec §22: "Speeds: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x." */
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Icon-only transport controls, all at the bar's shared control height. */
const ICON_BUTTON_CLASS = ICON_CONTROL_CLASS;

/** Loop and metronome: icon-only toggles, so square at the shared height. */
const TOGGLE_BUTTON_CLASS = cn(
  ICON_CONTROL_CLASS,
  'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90',
);

function formatMeasureBeat(mb: MeasureBeat | null): string {
  return mb ? `${mb.measureIndex}.${mb.beat}` : '-.-';
}

/** `M:SS.d` (minutes, zero-padded seconds, tenths) — tenths update ~3x/sec during playback, making the actual playback rate visible against a wall clock. */
function formatTimecode(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60);
  const rest = clamped - minutes * 60;
  const whole = Math.floor(rest);
  const tenths = Math.floor((rest - whole) * 10);
  return `${minutes}:${String(whole).padStart(2, '0')}.${tenths}`;
}

/**
 * The three position-driven readouts, each isolated as its own subscriber.
 *
 * The engine reports position 30 times a second. Read at `TransportBar`'s top
 * level, every one of those re-rendered the whole bar — a dozen Buttons, two
 * Radix Selects, a Slider and their Tooltips, all `forwardRef` components that
 * showed up as `updateForwardRef` when the playback profile was taken. Split
 * out, a position update touches one span, one input and one span.
 */
/**
 * What the engine is doing before it can make a sound.
 *
 * The soundfont engine has tens of megabytes to fetch and several seconds of
 * synth setup on the first press of Play. The transport responds immediately —
 * it reports "playing" and starts the music once the synth is up — but without
 * saying so, those seconds of silence read as a broken button.
 *
 * Renders nothing when there is nothing to say, so a ready engine costs no
 * space in the bar.
 */
function SynthLoadIndicator({ store }: { store: PlaybackStoreApi }) {
  const { t } = useTranslation();
  const load = store((s) => s.synthLoad);
  if (load.status === 'idle' || load.status === 'ready') return null;

  if (load.status === 'failed') {
    return (
      <div
        role="status"
        className="flex items-center gap-1.5 whitespace-nowrap text-xs text-theme-error"
      >
        <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t('transport.loadFailed')}</span>
      </div>
    );
  }

  const percent = load.fraction === null ? null : Math.round(load.fraction * 100);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 whitespace-nowrap text-xs text-theme-text-secondary"
    >
      <span>Preparing instruments{percent === null ? '' : ` ${percent}%`}</span>
      <div
        // Determinate while downloading; the synth digesting the font reports
        // nothing, so that half is a moving bar rather than a false percentage.
        role="progressbar"
        aria-label={t('transport.preparing')}
        {...(percent === null
          ? {}
          : { 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
        className="h-1 w-16 overflow-hidden rounded-full bg-theme-border"
      >
        <div
          className={
            percent === null
              ? 'h-full w-1/3 animate-pulse rounded-full bg-theme-text-secondary'
              : 'h-full rounded-full bg-theme-text-secondary transition-[width] duration-200'
          }
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Play/Pause, and the only control that knows the synth may not be ready.
 *
 * Its own subscriber for the reason every readout in this file is one: the load
 * reports progress per percent, and read at the bar's top level each of those
 * would re-render a dozen Buttons and two Selects. Here it touches one button.
 *
 * Disabled while preparing rather than showing a Play the engine cannot honour.
 * The transport used to claim "playing" through the whole first load, and the
 * caret — which interpolates from elapsed real time between position reports —
 * ran on ahead through several silent bars before snapping back when the music
 * actually started. Nothing can play until the font is in, so the control that
 * starts playing says so.
 */
function PlayPauseButton({ store, hasScore }: { store: PlaybackStoreApi; hasScore: boolean }) {
  const { t } = useTranslation();
  const playbackState = store((s) => s.state);
  const preparing = store((s) => s.synthLoad.status === 'loading');
  const label = preparing
    ? t('transport.preparing')
    : playbackState === 'playing'
      ? t('player.pause')
      : t('player.play');

  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-busy={preparing || undefined}
        disabled={!hasScore || preparing}
        onClick={() => playbackController.togglePlay()}
        className={ICON_BUTTON_CLASS}
      >
        {preparing ? (
          // Decorative here: the button already carries the name, and a nested
          // role="status" would announce the same thing twice.
          <Spinner size="small" aria-hidden="true" />
        ) : playbackState === 'playing' ? (
          <PauseIcon className={ICON_GLYPH_CLASS} />
        ) : (
          <PlayIcon className={ICON_GLYPH_CLASS} />
        )}
      </Button>
    </Tooltip>
  );
}

function MeasureBeatReadout({ store }: { store: PlaybackStoreApi }) {
  const { t } = useTranslation();
  const measureBeat = store(selectCurrentMeasureBeat);
  return (
    <Tooltip content={t('transport.measureBeat')}>
      <span
        aria-label={t('transport.measureBeat')}
        className="min-w-[40px] text-center text-sm text-theme-text-primary"
      >
        {formatMeasureBeat(measureBeat)}
      </span>
    </Tooltip>
  );
}

function PositionScrubber({
  maxTick,
  disabled,
  onScrub,
}: {
  maxTick: number;
  disabled: boolean;
  onScrub: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t } = useTranslation();
  // From the bus, not the store: the engine reports position on every seek and
  // stop as well as while playing, so this is always current — and it is the
  // subscription that keeps a 30Hz value out of every other component.
  const positionTick = usePlaybackPosition();
  return (
    // `wrapperClassName` keeps the scrubber full-width: Tooltip's wrapper is
    // inline-block, which would otherwise collapse it to its intrinsic size.
    <Tooltip content={t('transport.scrub')} wrapperClassName="w-full">
      <input
        type="range"
        aria-label={t('transport.position')}
        min={0}
        max={maxTick}
        value={Math.min(positionTick, maxTick)}
        disabled={disabled}
        onChange={onScrub}
        className="w-full"
      />
    </Tooltip>
  );
}

function Timecode({
  maxTick,
  tempoMap,
  totalSeconds,
}: {
  maxTick: number;
  tempoMap: TempoMap | null;
  totalSeconds: number;
}) {
  const { t } = useTranslation();
  const positionTick = usePlaybackPosition();
  const positionSeconds = tempoMap ? tempoMap.ticksToSeconds(Math.min(positionTick, maxTick)) : 0;
  return (
    <Tooltip content={t('transport.elapsed')}>
      <span
        data-testid="playback-timecode"
        aria-label={t('transport.time')}
        className="min-w-[104px] text-right text-sm tabular-nums text-theme-text-primary"
      >
        {formatTimecode(positionSeconds)} / {formatTimecode(totalSeconds)}
      </span>
    </Tooltip>
  );
}

export function TransportBar({ store = useAppStore }: TransportBarProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  // `state` is deliberately not read here: `PlayPauseButton` is the only
  // control that needs it, and it subscribes for itself.
  const loopRange = store((s) => s.loopRange);
  const metronome = store((s) => s.metronome);
  const tempoMultiplier = store((s) => s.tempoMultiplier);
  const masterVolume = store((s) => s.masterVolume);

  const hasScore = score !== null;
  // Rounded for display as well as on commit: a score can arrive carrying a
  // fractional tempo from a MIDI file or a detected one from audio import, and
  // "119.87421 BPM" in the transport is noise, not precision.
  const currentBpm = Math.round(score?.tempoMap[0]?.bpm ?? 120);
  const maxTick = useMemo(() => (score ? Math.max(1, scoreEndTick(score)) : 1), [score]);
  // Score-time seconds via the same TempoMap the playback engine schedules
  // with, so this readout advances exactly 1 second per wall-clock second at
  // 1x speed — a live check that playback runs at the score's real tempo.
  const tempoMap = useMemo(() => (score ? new TempoMap(score.tempoMap, score.ppq) : null), [score]);
  const totalSeconds = tempoMap ? tempoMap.ticksToSeconds(maxTick) : 0;

  const [tempoDraft, setTempoDraft] = useState('');
  const [editingTempo, setEditingTempo] = useState(false);

  const beginEditTempo = (): void => {
    if (!hasScore) return;
    setTempoDraft(String(currentBpm));
    setEditingTempo(true);
  };

  const commitTempo = (): void => {
    setEditingTempo(false);
    // Whole numbers only. The field is a number input, so a stepper or a paste
    // can put "104.5" in it, and a tempo the transport rounds for display but
    // stores unrounded reads back differently the next time it is opened.
    const bpm = Math.round(Number(tempoDraft));
    if (!score || !Number.isFinite(bpm) || bpm <= 0) return;
    const firstEvent = score.tempoMap[0];
    store
      .getState()
      .dispatchCommand(
        changeTempoCommand({ tempoEventId: firstEvent?.id, tick: firstEvent?.tick ?? 0, bpm }),
      );
  };

  const handleTempoKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      // Commit directly rather than delegating to onBlur: the field unmounts
      // immediately after (editingTempo -> false), so a real blur may never
      // reach the DOM/React in time to fire it.
      commitTempo();
    } else if (event.key === 'Escape') {
      setEditingTempo(false);
    }
  };

  const handleSpeedChange = (value: string): void => {
    playbackController.setTempoMultiplier(Number(value));
  };

  const handleVolumeChange = (value: number): void => {
    playbackController.setMasterVolume(value);
  };

  const handleScrub = (event: ChangeEvent<HTMLInputElement>): void => {
    playbackController.seek(Number(event.target.value));
  };

  return (
    <div
      role="toolbar"
      aria-label={t('transport.transport')}
      // Same reasoning as the editor toolbar: one row, scrolled, never wrapped.
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-theme-border px-2 py-1"
    >
      <Tooltip content={t('transport.goToStart')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('transport.goToStart')}
          disabled={!hasScore}
          onClick={() => playbackController.goToStart()}
          className={ICON_BUTTON_CLASS}
        >
          <GoToStartIcon className={ICON_GLYPH_CLASS} />
        </Button>
      </Tooltip>
      <Tooltip content={t('transport.previousMeasure')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('transport.previousMeasure')}
          disabled={!hasScore}
          onClick={() => playbackController.previousMeasure()}
          className={ICON_BUTTON_CLASS}
        >
          <PreviousMeasureIcon className={ICON_GLYPH_CLASS} />
        </Button>
      </Tooltip>
      <PlayPauseButton store={store} hasScore={hasScore} />
      <Tooltip content={t('transport.stop')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('transport.stop')}
          disabled={!hasScore}
          onClick={() => {
            // Stop both the main transport and any candidate preview
            playbackController.stop();
          }}
          className={ICON_BUTTON_CLASS}
        >
          <StopIcon className={ICON_GLYPH_CLASS} />
        </Button>
      </Tooltip>
      <Tooltip content={t('transport.nextMeasure')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('transport.nextMeasure')}
          disabled={!hasScore}
          onClick={() => playbackController.nextMeasure()}
          className={ICON_BUTTON_CLASS}
        >
          <NextMeasureIcon className={ICON_GLYPH_CLASS} />
        </Button>
      </Tooltip>

      <Tooltip content={t('transport.toggleLoop')}>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('transport.toggleLoop')}
          aria-pressed={loopRange !== null}
          disabled={!hasScore}
          onClick={() => playbackController.toggleLoop()}
          className={TOGGLE_BUTTON_CLASS}
        >
          <ArrowPathRoundedSquareIcon className={ICON_GLYPH_CLASS} />
        </Button>
      </Tooltip>

      <Tooltip content={t('transport.toggleMetronome')}>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('transport.toggleMetronome')}
          aria-pressed={metronome}
          disabled={!hasScore}
          onClick={() => playbackController.setMetronome(!metronome)}
          className={TOGGLE_BUTTON_CLASS}
        >
          <MetronomeIcon className={ICON_GLYPH_CLASS} />
        </Button>
      </Tooltip>

      <MeasureBeatReadout store={store} />

      {editingTempo ? (
        <Input
          type="number"
          aria-label={t('transport.tempoBpm')}
          title={t('transport.tempoHint')}
          value={tempoDraft}
          autoFocus
          onChange={(event: ChangeEvent<HTMLInputElement>) => setTempoDraft(event.target.value)}
          onBlur={commitTempo}
          onKeyDown={handleTempoKeyDown}
          className={cn(TEXT_CONTROL_CLASS, 'w-[84px]')}
        />
      ) : (
        <Tooltip content={t('transport.editTempo')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('transport.tempoBpm')}
            disabled={!hasScore}
            onClick={beginEditTempo}
            className={cn(
              TEXT_CONTROL_CLASS,
              'min-w-[72px] justify-center disabled:cursor-default enabled:cursor-pointer',
            )}
          >
            {currentBpm} BPM
          </Button>
        </Tooltip>
      )}

      <Tooltip content={t('transport.speedMultiplier')}>
        <Select value={String(tempoMultiplier)} onValueChange={handleSpeedChange}>
          <SelectTrigger
            aria-label={t('transport.speed')}
            // Matches the bar's icon size; the trigger's chevron is 16px by default.
            className={cn(TEXT_CONTROL_CLASS, 'w-auto min-w-[64px] [&_svg]:size-[18px]')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEED_OPTIONS.map((speed) => (
              <SelectItem key={speed} value={String(speed)}>
                {speed}x
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Tooltip>

      <div className="flex w-[120px] items-center gap-2">
        <span className="text-sm text-theme-text-primary">Vol</span>
        <label className="flex-1">
          <span className="sr-only">{t('transport.masterVolume')}</span>
          <Slider value={masterVolume} onChange={handleVolumeChange} min={0} max={1} step={0.01} />
        </label>
      </div>

      <div className="min-w-[120px] flex-1">
        <PositionScrubber maxTick={maxTick} disabled={!hasScore} onScrub={handleScrub} />
      </div>

      <Timecode maxTick={maxTick} tempoMap={tempoMap} totalSeconds={totalSeconds} />

      {/* Last, so it never shifts the controls: it appears only while loading. */}
      <SynthLoadIndicator store={store} />
    </div>
  );
}

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
  Tooltip,
  cn,
} from '@sudobility/components';
import { changeTempoCommand } from '@sudobility/music_lib';
import { scoreEndTick } from '@sudobility/music_lib';
import { playbackController } from '@sudobility/music_lib';
import type { PlaybackStoreApi } from '@sudobility/music_lib';
import { selectCurrentMeasureBeat } from '@sudobility/music_lib';
import type { MeasureBeat } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';

export type TransportBarProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: PlaybackStoreApi;
};

/** Spec §22: "Speeds: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x." */
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const ICON_BUTTON_CLASS = 'h-auto w-auto p-1.5 text-sm leading-none';

const TOGGLE_BUTTON_CLASS = cn(
  'px-2 py-1 text-xs',
  'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90',
);

function formatMeasureBeat(mb: MeasureBeat | null): string {
  return mb ? `${mb.measureIndex}.${mb.beat}` : '-.-';
}

export function TransportBar({ store = useAppStore }: TransportBarProps) {
  const score = store((s) => s.score);
  const playbackState = store((s) => s.state);
  const positionTick = store((s) => s.positionTick);
  const loopRange = store((s) => s.loopRange);
  const metronome = store((s) => s.metronome);
  const tempoMultiplier = store((s) => s.tempoMultiplier);
  const masterVolume = store((s) => s.masterVolume);
  const measureBeat = store(selectCurrentMeasureBeat);

  const hasScore = score !== null;
  const currentBpm = score?.tempoMap[0]?.bpm ?? 120;
  const maxTick = useMemo(() => (score ? Math.max(1, scoreEndTick(score)) : 1), [score]);

  const [tempoDraft, setTempoDraft] = useState('');
  const [editingTempo, setEditingTempo] = useState(false);

  const beginEditTempo = (): void => {
    if (!hasScore) return;
    setTempoDraft(String(currentBpm));
    setEditingTempo(true);
  };

  const commitTempo = (): void => {
    setEditingTempo(false);
    const bpm = Number(tempoDraft);
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
      aria-label="Playback transport"
      className="flex flex-wrap items-center gap-2 border-t border-theme-border px-2 py-1"
    >
      <Tooltip content="Go to start">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Go to start"
          disabled={!hasScore}
          onClick={() => playbackController.goToStart()}
          className={ICON_BUTTON_CLASS}
        >
          ◀◀
        </Button>
      </Tooltip>
      <Tooltip content="Previous measure">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous measure"
          disabled={!hasScore}
          onClick={() => playbackController.previousMeasure()}
          className={ICON_BUTTON_CLASS}
        >
          ◀
        </Button>
      </Tooltip>
      <Tooltip content={playbackState === 'playing' ? 'Pause' : 'Play'}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={playbackState === 'playing' ? 'Pause' : 'Play'}
          disabled={!hasScore}
          onClick={() => playbackController.togglePlay()}
          className={ICON_BUTTON_CLASS}
        >
          {playbackState === 'playing' ? '❚❚' : '▶'}
        </Button>
      </Tooltip>
      <Tooltip content="Stop">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Stop"
          disabled={!hasScore}
          onClick={() => {
            // Stop both the main transport and any candidate preview
            // (spec §13/§22): a preview and the main transport share
            // playback-slice's `state`, so the global Stop button must
            // cleanly resync the engine back to the committed score even
            // if a `CandidateList` preview (not the main transport) is
            // what's actually sounding. `stopPreview()` is a no-op when
            // no preview is active.
            playbackController.stop();
            playbackController.stopPreview();
          }}
          className={ICON_BUTTON_CLASS}
        >
          ■
        </Button>
      </Tooltip>
      <Tooltip content="Next measure">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next measure"
          disabled={!hasScore}
          onClick={() => playbackController.nextMeasure()}
          className={ICON_BUTTON_CLASS}
        >
          ▶
        </Button>
      </Tooltip>

      <Tooltip content="Toggle loop">
        <Button
          type="button"
          variant="ghost"
          aria-label="Toggle loop"
          aria-pressed={loopRange !== null}
          disabled={!hasScore}
          onClick={() => playbackController.toggleLoop()}
          className={TOGGLE_BUTTON_CLASS}
        >
          Loop
        </Button>
      </Tooltip>

      <Tooltip content="Toggle metronome">
        <Button
          type="button"
          variant="ghost"
          aria-label="Toggle metronome"
          aria-pressed={metronome}
          disabled={!hasScore}
          onClick={() => playbackController.setMetronome(!metronome)}
          className={TOGGLE_BUTTON_CLASS}
        >
          Metronome
        </Button>
      </Tooltip>

      <span
        aria-label="Current measure and beat"
        className="min-w-[40px] text-center text-sm text-theme-text-primary"
      >
        {formatMeasureBeat(measureBeat)}
      </span>

      {editingTempo ? (
        <Input
          type="number"
          aria-label="Tempo (BPM)"
          value={tempoDraft}
          autoFocus
          onChange={(event: ChangeEvent<HTMLInputElement>) => setTempoDraft(event.target.value)}
          onBlur={commitTempo}
          onKeyDown={handleTempoKeyDown}
          className="w-[84px] px-2 py-1 text-sm"
        />
      ) : (
        <Tooltip content="Edit tempo">
          <Button
            type="button"
            variant="ghost"
            aria-label="Tempo (BPM)"
            disabled={!hasScore}
            onClick={beginEditTempo}
            className="min-w-[64px] px-1 py-1 disabled:cursor-default enabled:cursor-pointer"
          >
            {currentBpm} BPM
          </Button>
        </Tooltip>
      )}

      <Select value={String(tempoMultiplier)} onValueChange={handleSpeedChange}>
        <SelectTrigger
          aria-label="Playback speed"
          className="h-auto w-auto min-w-[64px] px-2 py-1 text-sm"
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

      <div className="flex w-[120px] items-center gap-2">
        <span className="text-sm text-theme-text-primary">Vol</span>
        <label className="flex-1">
          <span className="sr-only">Master volume</span>
          <Slider value={masterVolume} onChange={handleVolumeChange} min={0} max={1} step={0.01} />
        </label>
      </div>

      <div className="min-w-[120px] flex-1">
        <input
          type="range"
          aria-label="Playback position"
          min={0}
          max={maxTick}
          value={Math.min(positionTick, maxTick)}
          disabled={!hasScore}
          onChange={handleScrub}
          className="w-full"
        />
      </div>
    </div>
  );
}

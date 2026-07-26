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
 * Re-skinned onto Tailwind + @sudobility/components (T12 batch 2): MUI
 * ToggleButtons become plain buttons with `aria-pressed`, the MUI Select
 * becomes a native `<select>`, and the MUI Slider becomes a native
 * `<input type="range">` — all so testing-library's native-control queries
 * (`selectOptions`, `fireEvent.change`) keep working unchanged.
 */
import { useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Tooltip, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
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

const ICON_BUTTON_CLASS = cn(variants.button.ghost.icon(), 'h-auto w-auto p-1.5 text-sm leading-none');

const TOGGLE_BUTTON_CLASS = cn(
  variants.button.ghost.default(),
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
      .dispatchCommand(changeTempoCommand({ tempoEventId: firstEvent?.id, tick: firstEvent?.tick ?? 0, bpm }));
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

  const handleSpeedChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    playbackController.setTempoMultiplier(Number(event.target.value));
  };

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>): void => {
    playbackController.setMasterVolume(Number(event.target.value));
  };

  const handleScrub = (event: ChangeEvent<HTMLInputElement>): void => {
    playbackController.seek(Number(event.target.value));
  };

  return (
    <div
      role="toolbar"
      aria-label="Playback transport"
      className="flex flex-wrap items-center gap-2 border-b border-theme-border px-2 py-1"
    >
      <Tooltip content="Go to start">
        <button
          type="button"
          aria-label="Go to start"
          disabled={!hasScore}
          onClick={() => playbackController.goToStart()}
          className={ICON_BUTTON_CLASS}
        >
          ◀◀
        </button>
      </Tooltip>
      <Tooltip content="Previous measure">
        <button
          type="button"
          aria-label="Previous measure"
          disabled={!hasScore}
          onClick={() => playbackController.previousMeasure()}
          className={ICON_BUTTON_CLASS}
        >
          ◀
        </button>
      </Tooltip>
      <Tooltip content={playbackState === 'playing' ? 'Pause' : 'Play'}>
        <button
          type="button"
          aria-label={playbackState === 'playing' ? 'Pause' : 'Play'}
          disabled={!hasScore}
          onClick={() => playbackController.togglePlay()}
          className={ICON_BUTTON_CLASS}
        >
          {playbackState === 'playing' ? '❚❚' : '▶'}
        </button>
      </Tooltip>
      <Tooltip content="Stop">
        <button
          type="button"
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
        </button>
      </Tooltip>
      <Tooltip content="Next measure">
        <button
          type="button"
          aria-label="Next measure"
          disabled={!hasScore}
          onClick={() => playbackController.nextMeasure()}
          className={ICON_BUTTON_CLASS}
        >
          ▶
        </button>
      </Tooltip>

      <Tooltip content="Toggle loop">
        <button
          type="button"
          aria-label="Toggle loop"
          aria-pressed={loopRange !== null}
          disabled={!hasScore}
          onClick={() => playbackController.toggleLoop()}
          className={TOGGLE_BUTTON_CLASS}
        >
          Loop
        </button>
      </Tooltip>

      <Tooltip content="Toggle metronome">
        <button
          type="button"
          aria-label="Toggle metronome"
          aria-pressed={metronome}
          disabled={!hasScore}
          onClick={() => playbackController.setMetronome(!metronome)}
          className={TOGGLE_BUTTON_CLASS}
        >
          Metronome
        </button>
      </Tooltip>

      <span aria-label="Current measure and beat" className="min-w-[40px] text-center text-sm text-theme-text-primary">
        {formatMeasureBeat(measureBeat)}
      </span>

      {editingTempo ? (
        <input
          type="number"
          aria-label="Tempo (BPM)"
          value={tempoDraft}
          autoFocus
          onChange={(event) => setTempoDraft(event.target.value)}
          onBlur={commitTempo}
          onKeyDown={handleTempoKeyDown}
          className="w-[84px] rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1 text-sm text-theme-text-primary"
        />
      ) : (
        <Tooltip content="Edit tempo">
          <button
            type="button"
            aria-label="Tempo (BPM)"
            disabled={!hasScore}
            onClick={beginEditTempo}
            className={cn(
              variants.button.ghost.default(),
              'min-w-[64px] px-1 py-1 disabled:cursor-default enabled:cursor-pointer',
            )}
          >
            {currentBpm} BPM
          </button>
        </Tooltip>
      )}

      <select
        aria-label="Playback speed"
        value={tempoMultiplier}
        onChange={handleSpeedChange}
        className="rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1 text-sm text-theme-text-primary"
      >
        {SPEED_OPTIONS.map((speed) => (
          <option key={speed} value={speed}>
            {speed}x
          </option>
        ))}
      </select>

      <div className="flex w-[120px] items-center gap-2">
        <span className="text-sm text-theme-text-primary">Vol</span>
        <input
          type="range"
          aria-label="Master volume"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={handleVolumeChange}
          className="w-full"
        />
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

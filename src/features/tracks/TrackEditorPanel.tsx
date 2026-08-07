/**
 * Editing controls for the active track, beside the piano keyboard.
 *
 * Replaces the per-track DOM list that used to sit left of the sheet. That list
 * had to mirror the staves, which meant positioning it from reported geometry
 * and stopping it from scrolling independently — a problem it shipped twice.
 * Read-only track information now lives in the notation canvas itself
 * (`drawTrackInfoGutter` in music_lib), where alignment is structural, and the
 * controls live here.
 *
 * Beside the keyboard on purpose: the keyboard already shows only the active
 * track, so the two share one subject and read as one unit.
 *
 * `TRACK_INFO_WIDTH` wide, matching the canvas gutter, so a track's label on the
 * sheet and its controls here line up on the same column.
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button, Input, SheetSelector, Slider, Tooltip, cn } from '@sudobility/components';
import type { Clef, Track, UUID } from '@sudobility/music_types';
import {
  GM_FAMILIES,
  GM_FAMILY_LABELS,
  TRACK_INFO_WIDTH,
  changeClefCommand,
  changeTrackPropsCommand,
  deleteTrackCommand,
  findTrack,
  gmInstrument,
  gmInstrumentsByFamily,
  selectActiveTrackId,
  useAppStore,
} from '@sudobility/music_lib';
import { InstrumentIcon } from '@/features/instruments/instrument-icon';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/24/solid';
import { ICON_GLYPH_CLASS, SoloIcon } from '@/components/icons/notation-icons';

export type TrackEditorPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

const CLEF_OPTIONS: Clef[] = ['treble', 'bass', 'alto', 'tenor', 'percussion'];

const CLEF_SELECT_OPTIONS = CLEF_OPTIONS.map((clef) => ({ value: clef, label: clef }));

/**
 * All 128 General MIDI programs, flattened once with their family as a group
 * heading. Built at module scope rather than per render: it never changes, and
 * rebuilding 128 objects every time the active track's volume slider moves is
 * pure waste.
 */
const INSTRUMENT_OPTIONS = GM_FAMILIES.flatMap((family) =>
  gmInstrumentsByFamily(family).map((instrument) => ({
    value: String(instrument.program),
    label: instrument.name,
    group: GM_FAMILY_LABELS[family],
  })),
);

const ICON_BUTTON_CLASS = 'h-auto w-auto p-1 text-sm leading-none';
const TOGGLE_BUTTON_CLASS = cn(
  'px-2 py-0.5 text-xs',
  'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90',
);

export function TrackEditorPanel({ store = useAppStore }: TrackEditorPanelProps) {
  const score = store((s) => s.score);
  const activeTrackId = store(selectActiveTrackId);
  const [pendingDelete, setPendingDelete] = useState(false);

  const track: Track | null = score && activeTrackId ? findTrack(score, activeTrackId) : null;

  // Local draft so typing doesn't dispatch a command per keystroke; committed on
  // blur, and reset whenever the active track changes underneath us.
  const [nameDraft, setNameDraft] = useState(track?.name ?? '');
  useEffect(() => {
    setNameDraft(track?.name ?? '');
  }, [track?.id, track?.name]);

  const patch = (props: Parameters<typeof changeTrackPropsCommand>[1]): void => {
    if (!track) return;
    store.getState().dispatchCommand(changeTrackPropsCommand(track.id, props));
  };

  const header = (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-theme-border px-2 py-1"
      style={{ height: 28 }}
    >
      <span className="flex-1 truncate text-xs font-medium text-theme-text-primary">
        {track ? track.name : 'No track'}
      </span>
      <Tooltip content="Delete track">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Delete track"
          disabled={!track}
          onClick={() => setPendingDelete(true)}
          className={ICON_BUTTON_CLASS}
        >
          ✕
        </Button>
      </Tooltip>
    </div>
  );

  return (
    <div
      className="flex h-full min-h-0 shrink-0 flex-col border-r border-theme-border"
      style={{ width: TRACK_INFO_WIDTH }}
      role="region"
      aria-label="Track editor"
    >
      {header}

      {!track ? (
        <p className="p-2 text-xs text-theme-text-secondary">
          {score ? 'Select a track to edit it.' : 'No score loaded.'}
        </p>
      ) : (
        // Scrolls internally when a short window squeezes it. Harmless here,
        // unlike the old track list: this panel mirrors nothing.
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-2">
          <Input
            value={nameDraft}
            aria-label={`Track name: ${track.name}`}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNameDraft(e.target.value)}
            onBlur={() => {
              const next = nameDraft.trim();
              if (next !== '' && next !== track.name) patch({ name: next });
              else setNameDraft(track.name);
            }}
            className="px-1 py-0.5 text-xs"
          />

          <div className="flex items-center gap-1">
            <InstrumentIcon program={track.midiProgram} className="size-4 shrink-0" />
            <SheetSelector
              title="Instrument"
              aria-label={`Instrument: ${track.name}`}
              options={INSTRUMENT_OPTIONS}
              value={String(track.midiProgram)}
              onChange={(value: string) => {
                const instrument = gmInstrument(Number(value));
                if (!instrument) return;
                // Both together: `instrumentName` is free text and could
                // otherwise drift from `midiProgram`.
                patch({ midiProgram: instrument.program, instrumentName: instrument.name });
              }}
              size="large"
              className="h-auto w-full px-1 py-0.5 text-xs"
            />
          </div>

          <SheetSelector
            title="Clef"
            aria-label={`Clef: ${track.clef}`}
            options={CLEF_SELECT_OPTIONS}
            value={track.clef}
            onChange={(value) =>
              store.getState().dispatchCommand(changeClefCommand(track.id, value as Clef))
            }
            size="small"
            className="h-auto w-full px-1 py-0.5 text-xs"
          />

          <div className="flex items-center gap-1">
            {/*
              Icons rather than "M" and "S": those initials only read to
              someone who already knows the convention, and this panel is the
              one place a newcomer meets these controls. A struck-through
              speaker and headphones say it without the vocabulary.
            */}
            <Tooltip content={track.muted ? 'Unmute this track' : 'Mute this track'}>
              <Button
                type="button"
                variant="ghost"
                aria-label={`Mute: ${track.name}`}
                aria-pressed={track.muted}
                onClick={() => patch({ muted: !track.muted })}
                className={TOGGLE_BUTTON_CLASS}
              >
                {track.muted ? (
                  <SpeakerXMarkIcon className={ICON_GLYPH_CLASS} />
                ) : (
                  <SpeakerWaveIcon className={ICON_GLYPH_CLASS} />
                )}
              </Button>
            </Tooltip>
            <Tooltip content={track.solo ? 'Stop soloing this track' : 'Solo this track'}>
              <Button
                type="button"
                variant="ghost"
                aria-label={`Solo: ${track.name}`}
                aria-pressed={track.solo}
                onClick={() => patch({ solo: !track.solo })}
                className={TOGGLE_BUTTON_CLASS}
              >
                <SoloIcon className={ICON_GLYPH_CLASS} />
              </Button>
            </Tooltip>
          </div>

          <label className="flex items-center gap-1 text-xs text-theme-text-secondary">
            <span className="w-8 shrink-0">Vol</span>
            <span className="sr-only">{`Volume: ${track.name}`}</span>
            <Slider
              value={track.volume}
              onChange={(v: number) => patch({ volume: v })}
              min={0}
              max={1}
              step={0.01}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-theme-text-secondary">
            <span className="w-8 shrink-0">Pan</span>
            <span className="sr-only">{`Pan: ${track.name}`}</span>
            {/*
              `origin={0}`: pan is bipolar, so the reading that matters is how
              far from centre and which way. A left-anchored fill made a centred
              pan look like a half-open volume.
            */}
            <Slider
              value={track.pan}
              onChange={(v: number) => patch({ pan: v })}
              min={-1}
              max={1}
              step={0.01}
              origin={0}
            />
          </label>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete}
        title="Delete track"
        message={`Delete "${track?.name ?? ''}" and all of its measures? This can be undone.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => {
          const id: UUID | null = track?.id ?? null;
          setPendingDelete(false);
          if (id) store.getState().dispatchCommand(deleteTrackCommand(id));
        }}
      />
    </div>
  );
}

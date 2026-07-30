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
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Slider,
  Tooltip,
  cn,
} from '@sudobility/components';
import type { Clef, Track, UUID } from '@sudobility/music_types';
import {
  GM_FAMILIES,
  GM_FAMILY_LABELS,
  TRACK_INFO_WIDTH,
  addTrackCommand,
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

export type TrackEditorPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

const CLEF_OPTIONS: Clef[] = ['treble', 'bass', 'alto', 'tenor', 'percussion'];

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

  const addTrack = (): void => {
    store.getState().dispatchCommand(addTrackCommand({ name: 'New track' }));
  };

  const header = (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-theme-border px-2 py-1"
      style={{ height: 28 }}
    >
      <span className="flex-1 truncate text-xs font-medium text-theme-text-primary">
        {track ? track.name : 'No track'}
      </span>
      <Tooltip content="Add track">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Add track"
          disabled={!score}
          onClick={addTrack}
          className={ICON_BUTTON_CLASS}
        >
          +
        </Button>
      </Tooltip>
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
            <Select
              value={String(track.midiProgram)}
              onValueChange={(value: string) => {
                const instrument = gmInstrument(Number(value));
                if (!instrument) return;
                // Both together: `instrumentName` is free text and could
                // otherwise drift from `midiProgram`.
                patch({ midiProgram: instrument.program, instrumentName: instrument.name });
              }}
            >
              <SelectTrigger
                aria-label={`Instrument: ${track.name}`}
                className="h-auto w-full px-1 py-0.5 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GM_FAMILIES.map((family) => (
                  <SelectGroup key={family}>
                    <SelectLabel>{GM_FAMILY_LABELS[family]}</SelectLabel>
                    {gmInstrumentsByFamily(family).map((instrument) => (
                      <SelectItem key={instrument.program} value={String(instrument.program)}>
                        {instrument.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Select
            value={track.clef}
            onValueChange={(value) =>
              store.getState().dispatchCommand(changeClefCommand(track.id, value as Clef))
            }
          >
            <SelectTrigger
              aria-label={`Clef: ${track.clef}`}
              className="h-auto w-full px-1 py-0.5 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLEF_OPTIONS.map((clef) => (
                <SelectItem key={clef} value={clef}>
                  {clef}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              aria-label={`Mute: ${track.name}`}
              aria-pressed={track.muted}
              onClick={() => patch({ muted: !track.muted })}
              className={TOGGLE_BUTTON_CLASS}
            >
              M
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Solo: ${track.name}`}
              aria-pressed={track.solo}
              onClick={() => patch({ solo: !track.solo })}
              className={TOGGLE_BUTTON_CLASS}
            >
              S
            </Button>
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
            <Slider
              value={track.pan}
              onChange={(v: number) => patch({ pan: v })}
              min={-1}
              max={1}
              step={0.01}
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

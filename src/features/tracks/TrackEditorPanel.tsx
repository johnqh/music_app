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
import { useTranslation } from 'react-i18next';
import type { ChangeEvent } from 'react';
import { Button, Input, SheetSelector, Slider, Tooltip, cn } from '@sudobility/components';
import { isNoteEvent } from '@sudobility/music_types';
import type { Clef, Score, Track, UUID } from '@sudobility/music_types';
import {
  GM_FAMILIES,
  GM_FAMILY_LABELS,
  GM_KITS,
  TRACK_INFO_WIDTH,
  changeClefCommand,
  changeTrackPropsCommand,
  deleteTrackCommand,
  findTrack,
  gmInstrument,
  gmInstrumentRange,
  gmInstrumentsByFamily,
  gmKit,
  gmKitAt,
  isPercussionTrack,
  pitchToMidi,
  selectActiveTrackId,
  transformCommand,
  transposePitch,
  useAppStore,
  withTracks,
} from '@sudobility/music_lib';
import type { MidiRange } from '@sudobility/music_lib';
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

/**
 * The eight drum kits, for a percussion track.
 *
 * A percussion track's `midiProgram` selects a kit, not an instrument, so the
 * melodic list above is the wrong list for it: picking "Celesta" there quietly
 * switched the kit to Room, and picking "Jazz Guitar" did nothing at all
 * because no kit sits at that address.
 */
const KIT_OPTIONS = GM_KITS.map((kit) => ({ value: String(kit.program), label: kit.name }));

const ICON_BUTTON_CLASS = 'h-auto w-auto p-1 text-sm leading-none';
const TOGGLE_BUTTON_CLASS = cn(
  'px-2 py-0.5 text-xs',
  'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90',
);

type TrackPropsPatch = Parameters<typeof changeTrackPropsCommand>[1];
type InstrumentPatch = Pick<Track, 'midiProgram' | 'instrumentName'>;

function closestToZero(min: number, max: number): number {
  if (min <= 0 && max >= 0) return 0;
  return min > 0 ? min : max;
}

function shiftToFitRange(midis: number[], range: MidiRange): number | null {
  if (midis.length === 0) return 0;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const midi of midis) {
    min = Math.min(min, midi);
    max = Math.max(max, midi);
  }
  if (min >= range.min && max <= range.max) return 0;
  if (max - min > range.max - range.min) return null;

  const minOctaves = Math.ceil((range.min - min) / 12);
  const maxOctaves = Math.floor((range.max - max) / 12);
  if (minOctaves <= maxOctaves) return closestToZero(minOctaves, maxOctaves) * 12;

  const minSemitones = range.min - min;
  const maxSemitones = range.max - max;
  return minSemitones <= maxSemitones ? closestToZero(minSemitones, maxSemitones) : null;
}

function noteMidis(track: Track): number[] {
  const midis: number[] = [];
  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (isNoteEvent(event)) midis.push(pitchToMidi(event.pitch));
      }
    }
  }
  return midis;
}

function fitShiftForInstrument(score: Score, trackId: UUID, midiProgram: number): number | null {
  const track = findTrack(score, trackId);
  return track ? shiftToFitRange(noteMidis(track), gmInstrumentRange(midiProgram)) : null;
}

function changeInstrumentAndFitNotesCommand(trackId: UUID, patch: InstrumentPatch) {
  return transformCommand('Change track instrument', (score) => {
    const shift = fitShiftForInstrument(score, trackId, patch.midiProgram);
    if (shift === null) return score;

    const tracks = score.tracks.map((candidate) => {
      if (candidate.id !== trackId) return candidate;

      const measures =
        shift === 0
          ? candidate.measures
          : candidate.measures.map((measure) => ({
              ...measure,
              voices: measure.voices.map((voice) => ({
                ...voice,
                events: voice.events.map((event) =>
                  isNoteEvent(event)
                    ? { ...event, pitch: transposePitch(event.pitch, shift, measure.keySignature) }
                    : event,
                ),
              })),
            }));

      return { ...candidate, ...patch, measures };
    });

    return withTracks(score, tracks);
  });
}

export function TrackEditorPanel({ store = useAppStore }: TrackEditorPanelProps) {
  const { t } = useTranslation();
  const score = store((s) => s.score);
  const activeTrackId = store(selectActiveTrackId);
  /**
   * Content editing is refused while the transport plays (`score-slice`'s edit
   * lock), so name, instrument, kit, clef and delete say so rather than looking
   * live and doing nothing.
   *
   * Mute, solo, volume and pan stay enabled: they are mixing, not editing, and
   * they reach the engine live through `applyMix`. Mixing while listening is
   * the point.
   */
  const isPlaying = store((s) => s.state === 'playing');
  const [pendingDelete, setPendingDelete] = useState(false);

  const track: Track | null = score && activeTrackId ? findTrack(score, activeTrackId) : null;

  // Local draft so typing doesn't dispatch a command per keystroke; committed on
  // blur, and reset whenever the active track changes underneath us.
  const [nameDraft, setNameDraft] = useState(track?.name ?? '');
  useEffect(() => {
    setNameDraft(track?.name ?? '');
  }, [track?.id, track?.name]);

  const patch = (props: TrackPropsPatch): void => {
    if (!track) return;
    store.getState().dispatchCommand(changeTrackPropsCommand(track.id, props));
  };

  const changeInstrument = (instrument: InstrumentPatch): void => {
    if (!track || !score) return;
    if (fitShiftForInstrument(score, track.id, instrument.midiProgram) === null) {
      store.getState().pushToast({
        message: t('track.instrumentRangeError', { instrument: instrument.instrumentName }),
        severity: 'error',
      });
      return;
    }

    store.getState().dispatchCommand(changeInstrumentAndFitNotesCommand(track.id, instrument));
  };

  const header = (
    <div
      className="flex shrink-0 items-center gap-1 border-b border-theme-border px-2 py-1"
      style={{ height: 28 }}
    >
      <span className="flex-1 truncate text-xs font-medium text-theme-text-primary">
        {track ? track.name : 'No track'}
      </span>
      <Tooltip content={t('track.delete')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('track.delete')}
          disabled={!track || isPlaying}
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
      aria-label={t('track.editor')}
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
            aria-label={t('track.nameOf', { name: track.name })}
            disabled={isPlaying}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNameDraft(e.target.value)}
            onBlur={() => {
              const next = nameDraft.trim();
              if (next !== '' && next !== track.name) patch({ name: next });
              else setNameDraft(track.name);
            }}
            className="px-1 py-0.5 text-xs"
          />

          <div className="flex items-center gap-1">
            <InstrumentIcon track={track} className="size-4 shrink-0" />
            {isPercussionTrack(track) ? (
              <SheetSelector
                title={t('track.drumKit')}
                aria-label={t('track.kitOf', { name: track.name })}
                disabled={isPlaying}
                options={KIT_OPTIONS}
                // Through `gmKitAt`, so a track sitting at an address no kit is
                // at still selects the kit it actually plays rather than
                // showing an empty control.
                value={String(gmKitAt(track.midiProgram).program)}
                onChange={(value: string) => {
                  const kit = gmKit(Number(value));
                  if (!kit) return;
                  // Both together, for the same reason the melodic branch does
                  // it: `instrumentName` is free text and would otherwise drift.
                  patch({ midiProgram: kit.program, instrumentName: kit.name });
                }}
                size="large"
                className="h-auto w-full px-1 py-0.5 text-xs"
              />
            ) : (
              <SheetSelector
                title={t('generate.instrument')}
                aria-label={`Instrument: ${track.name}`}
                disabled={isPlaying}
                options={INSTRUMENT_OPTIONS}
                value={String(track.midiProgram)}
                onChange={(value: string) => {
                  const instrument = gmInstrument(Number(value));
                  if (!instrument) return;
                  // Both together: `instrumentName` is free text and could
                  // otherwise drift from `midiProgram`. Existing notes move
                  // with the new instrument when their current range would sit
                  // outside its playable compass.
                  changeInstrument({
                    midiProgram: instrument.program,
                    instrumentName: instrument.name,
                  });
                }}
                size="large"
                className="h-auto w-full px-1 py-0.5 text-xs"
              />
            )}
          </div>

          <SheetSelector
            title={t('importMidi.colClef')}
            aria-label={`Clef: ${track.clef}`}
            disabled={isPlaying}
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
            <span className="w-8 shrink-0">{t('track.volume')}</span>
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
            <span className="w-8 shrink-0">{t('track.pan')}</span>
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
        title={t('track.delete')}
        message={t('track.deleteMessage', { name: track?.name ?? '' })}
        confirmLabel={t('common.delete')}
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

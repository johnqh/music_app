/**
 * Region-regeneration panel (spec §12, §21): shown by the app shell (Task
 * 16) in place of `GenerationPanel` once `generation-slice.mode ===
 * 'regenerate'` (i.e. the selection carries content). Shows the selected
 * measure range/tracks (and the "expanded to full measures" explanation
 * when the selection didn't already fall on measure boundaries), an
 * instruction field with a preset-instruction menu (spec §12's exact
 * list), preservation checkboxes, a candidate-count field, and Generate
 * alternatives/Cancel. Renders `CandidateList` underneath for the resulting
 * preview cards.
 *
 * Every control that actually *requests* regeneration is disabled — and an
 * explanatory message shown instead of the range/track summary — whenever
 * `selectionIsRegenerable` is false (spec §21: "Disable generation when the
 * selection is invalid"), covering both "nothing selected" and a selection
 * that resolves to an out-of-bounds or dangling-track range.
 *
 * Re-skinned onto Tailwind (T12 batch 4): the MUI Menu becomes a small
 * `role="menu"`/`role="menuitem"` popover built from plain buttons, MUI
 * Checkboxes become native `<input type="checkbox">`s, and MUI
 * LinearProgress becomes a `role="progressbar"` div — same roles/labels/
 * accessible names as before, so no test assertions changed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { findTrack } from '@sudobility/music_lib';
import type { Score } from '@sudobility/music_types';
import type { ScoreRange } from '@sudobility/music_lib';
import { selectionIsRegenerable } from '@sudobility/music_lib';
import { prepareRegenerationRequest } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { GenerationStoreApi } from '@/features/generation/preview';
import { CandidateList } from '@/features/generation/CandidateList';

export type RegenerationPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: GenerationStoreApi;
};

/** Spec §12, verbatim. */
const PRESET_INSTRUCTIONS: string[] = [
  'Make this more dramatic',
  'Simplify this passage',
  'Add rhythmic variation',
  'Make the melody more memorable',
  'Create a stronger transition',
  'Add harmonic tension',
  'Resolve the phrase',
  'Make this more upbeat',
  'Make this darker',
  'Create a variation while preserving the melody',
  'Preserve rhythm but change harmony',
  'Preserve harmony but change melody',
  'Add accompaniment',
  'Thin out the orchestration',
];

const MIN_CANDIDATE_COUNT = 1;
const MAX_CANDIDATE_COUNT = 3;
const DEFAULT_CANDIDATE_COUNT = 3;

/** `[firstMeasureIndex, lastMeasureIndex]` (0-based, spec §4 `Measure.index`) overlapping `range`, read off the score's first track (every track shares the same measure grid — same convention as `services/playback/controller.ts`'s `measureAt`). `null` if nothing overlaps. */
function measureIndexRange(score: Score, range: ScoreRange): [number, number] | null {
  const track = score.tracks[0];
  if (!track) return null;
  const overlapping = track.measures.filter(
    (m) => m.startTick < range.endTick && m.startTick + m.durationTicks > range.startTick,
  );
  if (overlapping.length === 0) return null;
  return [overlapping[0].index, overlapping[overlapping.length - 1].index];
}

function trackNamesLabel(score: Score, trackIds: string[]): string {
  if (trackIds.length === 0) return 'All tracks';
  const names = trackIds.map((id) => findTrack(score, id)?.name).filter((n): n is string => !!n);
  return names.length > 0 ? names.join(', ') : 'All tracks';
}

const TEXT_BUTTON_CLASS =
  'rounded-md border border-theme-border px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40';

const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';

const TEXT_INPUT_CLASS =
  'w-full rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1.5 text-sm text-theme-text-primary disabled:cursor-not-allowed disabled:opacity-60';

const INFO_BOX_CLASS = 'rounded-md bg-theme-bg-secondary px-3 py-2 text-sm text-theme-text-primary';

export function RegenerationPanel({ store = useAppStore }: RegenerationPanelProps) {
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const pending = store((s) => s.pending);
  const error = store((s) => s.error);

  const [instruction, setInstruction] = useState('');
  const [preserveBoundaryNotes, setPreserveBoundaryNotes] = useState(false);
  const [preserveHarmony, setPreserveHarmony] = useState(false);
  const [preserveRhythm, setPreserveRhythm] = useState(false);
  const [preserveMelody, setPreserveMelody] = useState(false);
  const [candidateCount, setCandidateCount] = useState(String(DEFAULT_CANDIDATE_COUNT));
  const [presetOpen, setPresetOpen] = useState(false);
  const presetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!presetOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!presetRef.current?.contains(event.target as Node)) setPresetOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [presetOpen]);

  const regenerable = score !== null && selectionIsRegenerable(score, selection);

  // Pure and side-effect-free (`prepareRegenerationRequest` only reads
  // `score`/`selection`; `instruction` is just carried through into the
  // returned object, unused by the range/track/expansion fields this panel
  // displays) — safe to recompute on every relevant render purely for
  // display, without waiting for "Generate alternatives".
  const prepared = useMemo(() => {
    if (!score || !regenerable) return null;
    try {
      return prepareRegenerationRequest(score, selection, instruction);
    } catch {
      return null;
    }
  }, [score, selection, instruction, regenerable]);

  const parsedCandidateCount = Number(candidateCount);
  const canGenerate =
    regenerable &&
    !pending &&
    instruction.trim() !== '' &&
    Number.isInteger(parsedCandidateCount) &&
    parsedCandidateCount >= MIN_CANDIDATE_COUNT &&
    parsedCandidateCount <= MAX_CANDIDATE_COUNT;

  const handlePresetSelect = (text: string): void => {
    setInstruction(text);
    setPresetOpen(false);
  };

  const handleGenerate = (): void => {
    if (!canGenerate) return;
    void store.getState().regenerate(instruction, {
      candidateCount: parsedCandidateCount,
      constraints: { preserveBoundaryNotes, preserveHarmony, preserveRhythm, preserveMelody },
    });
  };

  const handleCancel = (): void => {
    store.getState().cancel();
  };

  const measureRange = score && prepared ? measureIndexRange(score, prepared.range) : null;

  return (
    <div aria-label="Regeneration panel" className="flex flex-col gap-4 p-4">
      <h3 className="text-sm font-semibold text-theme-text-primary">Regenerate selection</h3>

      {!regenerable && <div className={INFO_BOX_CLASS}>Select a region of the score to regenerate.</div>}
      {error && (
        <div role="alert" className="rounded-md bg-red-600 px-3 py-2 text-sm text-white">
          {error}
        </div>
      )}

      {regenerable && score && prepared && (
        <div className="flex flex-col gap-1">
          {measureRange && (
            <p className="text-sm text-theme-text-primary">
              Measures {measureRange[0] + 1}–{measureRange[1] + 1}
            </p>
          )}
          <p className="text-sm text-theme-text-primary">Tracks: {trackNamesLabel(score, prepared.range.trackIds)}</p>
          {prepared.expandedToFullMeasures && (
            <div className={`mt-1 ${INFO_BOX_CLASS}`}>
              The selection didn't fall on measure boundaries, so it was expanded to cover whole measures —
              regeneration always replaces complete measures.
            </div>
          )}
        </div>
      )}

      <div className="flex items-start gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-theme-text-secondary">Regeneration instruction</span>
          <textarea
            aria-label="Regeneration instruction"
            rows={2}
            value={instruction}
            disabled={!regenerable}
            onChange={(e) => setInstruction(e.target.value)}
            className={TEXT_INPUT_CLASS}
          />
        </label>
        <div ref={presetRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Preset instructions"
            aria-haspopup="menu"
            aria-expanded={presetOpen}
            disabled={!regenerable}
            onClick={() => setPresetOpen((open) => !open)}
            className={TEXT_BUTTON_CLASS}
          >
            Presets
          </button>
          {presetOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-theme-border bg-theme-bg-secondary py-1 shadow-lg"
            >
              {PRESET_INSTRUCTIONS.map((text) => (
                <button
                  key={text}
                  type="button"
                  role="menuitem"
                  onClick={() => handlePresetSelect(text)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-theme-text-primary hover:bg-theme-hover-bg"
                >
                  {text}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div role="group" aria-label="Preservation options" className="flex flex-col gap-2">
        <span className="text-sm text-theme-text-primary">Preserve</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-theme-text-primary">
            <input
              type="checkbox"
              aria-label="Preserve boundary notes"
              disabled={!regenerable}
              checked={preserveBoundaryNotes}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPreserveBoundaryNotes(e.target.checked)}
              className="h-4 w-4 rounded border-theme-border"
            />
            Boundary notes
          </label>
          <label className="flex items-center gap-2 text-sm text-theme-text-primary">
            <input
              type="checkbox"
              aria-label="Preserve harmony"
              disabled={!regenerable}
              checked={preserveHarmony}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPreserveHarmony(e.target.checked)}
              className="h-4 w-4 rounded border-theme-border"
            />
            Harmony
          </label>
          <label className="flex items-center gap-2 text-sm text-theme-text-primary">
            <input
              type="checkbox"
              aria-label="Preserve rhythm"
              disabled={!regenerable}
              checked={preserveRhythm}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPreserveRhythm(e.target.checked)}
              className="h-4 w-4 rounded border-theme-border"
            />
            Rhythm
          </label>
          <label className="flex items-center gap-2 text-sm text-theme-text-primary">
            <input
              type="checkbox"
              aria-label="Preserve melody"
              disabled={!regenerable}
              checked={preserveMelody}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPreserveMelody(e.target.checked)}
              className="h-4 w-4 rounded border-theme-border"
            />
            Melody
          </label>
        </div>
      </div>

      <label className="flex w-40 flex-col gap-1">
        <span className="text-xs text-theme-text-secondary">Candidate count</span>
        <input
          type="number"
          aria-label="Candidate count"
          value={candidateCount}
          disabled={!regenerable}
          min={MIN_CANDIDATE_COUNT}
          max={MAX_CANDIDATE_COUNT}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCandidateCount(e.target.value)}
          className={TEXT_INPUT_CLASS}
        />
      </label>

      {pending && (
        <div role="progressbar" aria-label="Regenerating" className="h-1 w-full overflow-hidden rounded-full bg-theme-bg-secondary">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          aria-label="Generate alternatives"
          disabled={!canGenerate}
          onClick={handleGenerate}
          className={PRIMARY_BUTTON_CLASS}
        >
          Generate alternatives
        </button>
        {pending && (
          <button type="button" aria-label="Cancel" onClick={handleCancel} className={TEXT_BUTTON_CLASS}>
            Cancel
          </button>
        )}
      </div>

      <CandidateList store={store} />
    </div>
  );
}

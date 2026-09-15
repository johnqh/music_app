/**
 * The Note tab's fields — the ones with enough logic to be worth their own
 * component rather than a line in the tab body.
 *
 * `BarBeatField` is the interesting one: it reads and writes a position as
 * bar and beat, which is what a musician says, while the model stores ticks.
 * The conversion lives in music_lib's `music-vocabulary`, not here.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Input } from '@sudobility/components';
import { barBeatForTick, setChordSymbol, tickForBarBeat } from '@sudobility/music_lib';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { formatBeatForField, parseNumericDraft } from '@sudobility/music_types';
import { setFingering } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';
import {
  FIELD_HEIGHT_CLASS,
  FIELD_LABEL_CLASS,
  TEXT_INPUT_CLASS,
} from '@/components/inspector/shared';

/** A library `Slider` wrapped with an accessible name (via a visually-hidden
 * label, since `Slider` accepts no `aria-label`) and a commit-on-release
 * handler (since `Slider` exposes only a continuous `onChange`, no
 * `onValueCommitted`-style callback of its own) -- same pattern as
 * `TrackPanel.tsx`'s identical volume/pan sliders. */
/**
 * A mixer control that reports once, on release.
 *
 * Every commit is an undo entry, so committing per pointer-move would bury the
 * history under a drag. `kind` picks the control rather than a min/max, because
 * volume and pan are different *shapes* — see `mixer-controls.tsx`.
 */
/**
 * A note's position, as a bar and a beat.
 *
 * Two fields rather than one, because that is how the position is said aloud:
 * "bar 12, beat 3". Beat takes a decimal so an off-beat note can still be
 * stated exactly — a swung eighth is beat 2.5 — and the domain clamps a beat
 * past the end of its bar rather than rejecting it.
 *
 * Drafted and committed on blur, like every other typed field here: committing
 * per keystroke would move the note through every intermediate number.
 */
export function BarBeatField({
  score,
  tick,
  onCommit,
  disabled,
}: {
  score: Score;
  tick: number;
  onCommit: (tick: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const position = barBeatForTick(score, tick);
  // Pulled out as primitives: the effect below must re-run when the *values*
  // change, and `position` is a fresh object every render.
  const bar = position?.bar ?? null;
  // Two decimals is enough for any grid the editor offers, and trailing zeroes
  // on a whole beat read as noise — music_types' rule, shared with the native
  // property sheet.
  const beat = position ? formatBeatForField(position.beat) : null;

  const [barDraft, setBarDraft] = useState('');
  const [beatDraft, setBeatDraft] = useState('');

  useEffect(() => {
    setBarDraft(bar === null ? '' : String(bar));
    setBeatDraft(beat ?? '');
  }, [bar, beat]);

  if (!position) return null;

  const commit = (bar: string, beat: string): void => {
    // A cleared field is "no change", never bar 0 — `Number('')` is 0.
    const barNumber = parseNumericDraft(bar);
    const beatNumber = parseNumericDraft(beat);
    if (barNumber === null || beatNumber === null) return;
    const next = tickForBarBeat(score, barNumber, beatNumber);
    if (next !== null && next !== tick) onCommit(next);
  };

  return (
    <div className="flex gap-2">
      <label className="flex flex-1 flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.bar')}</span>
        <Input
          value={barDraft}
          inputMode="numeric"
          aria-label={t('inspector.bar')}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBarDraft(e.target.value)}
          onBlur={() => commit(barDraft, beatDraft)}
          className={TEXT_INPUT_CLASS}
        />
      </label>
      <label className="flex flex-1 flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.beat')}</span>
        <Input
          value={beatDraft}
          inputMode="decimal"
          aria-label={t('inspector.beat')}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBeatDraft(e.target.value)}
          onBlur={() => commit(barDraft, beatDraft)}
          className={TEXT_INPUT_CLASS}
        />
      </label>
    </div>
  );
}

/**
 * A note's chord symbol, drafted and committed on blur.
 *
 * Committing per keystroke would put an undo entry on the history for every
 * character of "Cmaj7(add13)", the same reason the track name and the score
 * title are drafted.
 */
/**
 * The finger written beside a note.
 *
 * Free text, not a number picker: piano writing uses 1-5, guitar adds `T` for
 * the thumb, and editions write `1-2` for a substitution. A picker would have
 * to refuse two of those.
 *
 * A draft committed on blur, like the track name, or every keystroke would be
 * its own undo entry.
 */
export function FingeringField({
  store,
  note,
  disabled,
}: {
  store: EditorStoreApi;
  note: NoteEvent;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  useEffect(() => {
    setDraft(note.fingering ?? '');
  }, [note.id, note.fingering]);

  // `setFingering` trims, treats blank as clearing, and skips a value the note
  // already carries — so there is nothing to decide here.
  const commit = (): void => {
    setFingering(store, draft);
  };

  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL_CLASS}>{t('inspector.fingering')}</span>
      <Input
        value={draft}
        disabled={disabled}
        aria-label={t('inspector.fingering')}
        className={FIELD_HEIGHT_CLASS}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

export function ChordSymbolField({
  store,
  note,
  disabled,
}: {
  store: EditorStoreApi;
  note: NoteEvent;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(note.chordSymbol ?? '');

  useEffect(() => {
    setDraft(note.chordSymbol ?? '');
  }, [note.id, note.chordSymbol]);

  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL_CLASS}>{t('inspector.chordSymbol')}</span>
      <Input
        value={draft}
        disabled={disabled}
        placeholder={t('inspector.chordSymbolPlaceholder')}
        aria-label={t('inspector.chordSymbol')}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
        onBlur={() => {
          setChordSymbol(store, note.id, draft);
        }}
        className={TEXT_INPUT_CLASS}
      />
    </label>
  );
}

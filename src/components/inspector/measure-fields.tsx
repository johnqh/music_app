/**
 * The Measure tab's fields.
 *
 * Each one edits a property of a single bar — its clef, its barline, the
 * navigation marks on it, whether it is a pickup, the tempo in force at it.
 * They are grouped by the tab they serve rather than by shape, because that is
 * how anyone looks for them: "where is the pickup control" has an obvious
 * answer and "where are the selects" does not.
 *
 * All of them are one-bar-at-a-time. A clef change, a barline and a repeat are
 * boundaries; applying one across a span would write the same boundary onto
 * every bar in it.
 */

import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '@sudobility/components';
import {
  commitBarTempo,
  measureClefOptions,
  removeTempoAt,
  selectEditLocked,
  setBarline,
  setClefAtMeasure,
  setNavigation,
  setPickup,
  setRepeats,
  measureIndexOf,
  trackOfMeasure,
} from '@sudobility/music_lib';
import type { EditorStoreApi, NavigationPatch, RepeatPatch } from '@sudobility/music_lib';
/*
  The pickers' lists and sentinels are music_types', and what each field does
  with a value — the clef options a bar offers, what a typed tempo commits, the
  pickup lengths, how "1, 2" becomes a volta — is music_editing's and
  music_types'. The native property sheet writes the same fields, and the two
  used to agree only where nobody had yet changed one of them.

  The jump labels are not translated on purpose — `D.S. al Coda` is Italian on
  every edition in every country, and a reader looking for it is looking for
  those letters.
*/
import {
  BARLINE_OPTIONS,
  INHERIT_CLEF,
  NO_JUMP,
  NO_PICKUP,
  REPEAT_JUMPS,
  REPEAT_JUMP_LABEL,
  SINGLE_BARLINE,
  formatEndingNumbers,
  parseEndingNumbers,
  pickupBeatOptions,
  tempoAtBar,
} from '@sudobility/music_types';
import type { BarlineStyle, Clef, Measure, RepeatJump, Score } from '@sudobility/music_types';

import { MixedCheckbox, MixedSelect } from '@/components/inspector/controls';
import { FIELD_LABEL_CLASS, TEXT_INPUT_CLASS } from '@/components/inspector/shared';

/**
 * The repeat barlines and volta of one bar.
 *
 * Says outright that playback ignores repeats. The alternative is a marking
 * that draws and exports correctly and then quietly does nothing when you
 * press play, which is a worse experience than a stated limit — and expanding
 * repeats in playback would break the identity that a playback tick is a score
 * tick, which the caret, the following-scroll and the scrubber all rest on.
 */
/**
 * The clef this bar reads in, and whether the bar itself changes it.
 *
 * Shows the clef **in force** rather than `measure.clef`, so it is never blank
 * and never lies — the same rule `MeasureTempoField` follows for an inherited
 * tempo. "Inherit" is offered as its own option and is what clears a change;
 * picking the clef already in force clears it too, since the command refuses
 * to store a marking that would print nothing.
 *
 * Offered on bar 1 as well, where it edits the **part's** clef: that is where a
 * clef is established rather than changed, and hiding the control there would
 * leave the only way to set a part's clef in the Track tab, a different tab
 * from the one the reader is looking at the bar in.
 */
/**
 * Whether the score opens with a pickup, and how long it is.
 *
 * Offered only on the first bar, because that is what an anacrusis is — the
 * run-up to bar 1. A short bar anywhere else is an irregular bar, which keeps
 * its number and is a different thing.
 *
 * Measured in beats rather than ticks: "a one-beat pickup" is how a musician
 * describes it, and the tick length follows from the time signature.
 */
export function PickupField({ store, measure }: { store: EditorStoreApi; measure: Measure }) {
  const { t } = useTranslation();
  const isPlaying = store(selectEditLocked);
  const score = store((s) => s.score);
  if (!score) return null;

  const { current, beats } = pickupBeatOptions(measure, score.ppq);

  const apply = (value: string): void => {
    setPickup(store, value === NO_PICKUP ? null : Number(value));
  };

  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL_CLASS}>{t('inspector.pickup')}</span>
      <MixedSelect
        value={current}
        ariaLabel={t('inspector.pickup')}
        disabled={isPlaying}
        options={[
          { value: NO_PICKUP, label: t('inspector.pickupNone') },
          // A pickup shorter than the bar; a full-length one is just a bar.
          ...beats.map((count) => ({
            value: String(count),
            label: t('inspector.pickupBeats', { count }),
          })),
        ]}
        onChange={apply}
      />
    </label>
  );
}

/**
 * The line at the end of this bar.
 *
 * A section break or the end of the piece; anything else is the ordinary
 * single barline, which is why "Single" is the absence of a value rather than
 * a style of its own. The repeat barlines live in `RepeatFields` and are not
 * offered here — they are independent flags, and a bar can both close a repeat
 * and end the piece.
 */
export function BarlineField({ store, measure }: { store: EditorStoreApi; measure: Measure }) {
  const { t } = useTranslation();
  const isPlaying = store(selectEditLocked);
  const score = store((s) => s.score);
  if (!score) return null;

  const index = measureIndexOf(score, measure.id);
  if (index === null) return null;

  const apply = (value: string): void => {
    setBarline(store, index, value === SINGLE_BARLINE ? undefined : (value as BarlineStyle));
  };

  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL_CLASS}>{t('inspector.barline')}</span>
      <MixedSelect
        value={measure.barline ?? SINGLE_BARLINE}
        ariaLabel={t('inspector.barline')}
        disabled={isPlaying}
        options={BARLINE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        onChange={apply}
      />
    </label>
  );
}

/**
 * The navigation marks on this bar: the sign, the coda, `To Coda`, `Fine` and
 * the jump instruction.
 *
 * Checkboxes for the places and a select for the instruction, because that is
 * what they are — a bar either carries the segno or it does not, while the
 * jump is one choice among six. They are independent: a bar can carry the coda
 * sign and a `Fine`, so setting one never clears another.
 */
export function NavigationFields({ store, measure }: { store: EditorStoreApi; measure: Measure }) {
  const { t } = useTranslation();
  const isPlaying = store(selectEditLocked);
  const score = store((s) => s.score);
  if (!score) return null;

  const index = measureIndexOf(score, measure.id);
  if (index === null) return null;

  const patch = (next: NavigationPatch): void => {
    setNavigation(store, index, next);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className={FIELD_LABEL_CLASS}>{t('inspector.navigation')}</span>

      <div className="flex flex-wrap gap-4">
        <MixedCheckbox
          label={t('inspector.segno')}
          checked={measure.segno === true}
          disabled={isPlaying}
          onChange={(checked) => patch({ segno: checked })}
        />
        <MixedCheckbox
          label={t('inspector.coda')}
          checked={measure.coda === true}
          disabled={isPlaying}
          onChange={(checked) => patch({ coda: checked })}
        />
        <MixedCheckbox
          label={t('inspector.toCoda')}
          checked={measure.toCoda === true}
          disabled={isPlaying}
          onChange={(checked) => patch({ toCoda: checked })}
        />
        <MixedCheckbox
          label={t('inspector.fine')}
          checked={measure.fine === true}
          disabled={isPlaying}
          onChange={(checked) => patch({ fine: checked })}
        />
      </div>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.jump')}</span>
        <MixedSelect
          value={measure.jump ?? NO_JUMP}
          ariaLabel={t('inspector.jump')}
          disabled={isPlaying}
          options={[
            { value: NO_JUMP, label: t('inspector.jumpNone') },
            ...REPEAT_JUMPS.map((value) => ({ value, label: REPEAT_JUMP_LABEL[value] })),
          ]}
          onChange={(value) =>
            patch({ jump: value === NO_JUMP ? undefined : (value as RepeatJump) })
          }
        />
      </label>
    </div>
  );
}

export function MeasureClefField({ store, measure }: { store: EditorStoreApi; measure: Measure }) {
  const { t } = useTranslation();
  const isPlaying = store(selectEditLocked);
  const score = store((s) => s.score);

  const track = score ? trackOfMeasure(score, measure.id) : null;
  if (!track) return null;

  const index = score ? (measureIndexOf(score, measure.id) ?? 0) : 0;
  // Bar 1 establishes the clef, so it offers no Inherit and shows the clef in
  // force; later bars show their own change, or Inherit.
  const { value, inForce, options } = measureClefOptions(track, index);

  const apply = (next: string): void => {
    setClefAtMeasure(store, measure.id, next === INHERIT_CLEF ? undefined : (next as Clef));
  };

  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL_CLASS}>{t('inspector.measureClef')}</span>
      <MixedSelect
        value={value as string}
        ariaLabel={t('inspector.measureClef')}
        disabled={isPlaying}
        options={options.map((option) => ({
          value: option as string,
          label: option === INHERIT_CLEF ? t('inspector.clefInherit', { clef: inForce }) : option,
        }))}
        onChange={apply}
      />
    </label>
  );
}

export function RepeatFields({ store, measure }: { store: EditorStoreApi; measure: Measure }) {
  const { t } = useTranslation();
  const isPlaying = store(selectEditLocked);
  const [endingDraft, setEndingDraft] = useState('');

  useEffect(() => {
    setEndingDraft(formatEndingNumbers(measure.endingNumbers));
  }, [measure.id, measure.endingNumbers]);

  const patch = (next: RepeatPatch): void => {
    setRepeats(store, measure.id, next);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className={FIELD_LABEL_CLASS}>{t('editor.repeats')}</span>

      <div className="flex gap-4">
        <MixedCheckbox
          label={t('editor.repeatStart')}
          checked={measure.repeatStart === true}
          disabled={isPlaying}
          onChange={(checked) => patch({ repeatStart: checked })}
        />
        <MixedCheckbox
          label={t('editor.repeatEnd')}
          checked={measure.repeatEnd === true}
          disabled={isPlaying}
          onChange={(checked) => patch({ repeatEnd: checked })}
        />
      </div>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('editor.ending')}</span>
        <Input
          value={endingDraft}
          disabled={isPlaying}
          placeholder={t('editor.endingPlaceholder')}
          aria-label={t('editor.ending')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEndingDraft(e.target.value)}
          onBlur={() => {
            // "1, 2" is a bar played on both passes; anything unparseable
            // clears rather than storing a bracket nobody asked for.
            patch({ endingNumbers: parseEndingNumbers(endingDraft) });
          }}
          className={TEXT_INPUT_CLASS}
        />
      </label>

      <span className="text-xs text-theme-text-secondary">{t('editor.repeatsPlaybackNote')}</span>
    </div>
  );
}

/**
 * The tempo in force at a measure, and whether this measure sets it.
 *
 * Shows the tempo a player would count here — inherited from an earlier event
 * when this bar sets none — so the field is never blank and never lies. Typing
 * a value writes an event at this bar's tick; Remove is offered only when the
 * event is this bar's own, since the starting tempo is not a change and
 * removing it would leave the score with no tempo at all.
 */
export function MeasureTempoField({
  store,
  score,
  measure,
}: {
  store: EditorStoreApi;
  score: Score;
  measure: Measure;
}) {
  const { t } = useTranslation();
  const isPlaying = store(selectEditLocked);

  const here = tempoAtBar(score, measure);
  const shown = String(Math.round(here.bpm));

  const [draft, setDraft] = useState('');
  useEffect(() => {
    setDraft(shown);
  }, [shown, measure.id]);

  /*
    `commitBarTempo` parses, rounds and clamps, edits the bar's own event by id
    when it has one, and writes nothing for blank text or the tempo already in
    force — so blurring an inherited tempo untouched no longer turns it into an
    event of this bar's own. When nothing was written the draft goes back to
    what the field showed.
  */
  const commit = (): void => {
    if (!commitBarTempo(store, measure, draft)) setDraft(shown);
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL_CLASS}>{t('inspector.tempoHere')}</span>
        <Input
          value={draft}
          inputMode="numeric"
          disabled={isPlaying}
          aria-label={t('inspector.tempoHere')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
          onBlur={commit}
          className={TEXT_INPUT_CLASS}
        />
      </label>
      {here.ownEventId && !here.isStarting ? (
        <Button
          type="button"
          variant="ghost"
          disabled={isPlaying}
          onClick={() => here.ownEventId && removeTempoAt(store, here.ownEventId)}
          className="self-start px-1 py-0.5 text-xs"
        >
          {t('editor.removeTempoChange')}
        </Button>
      ) : (
        <span className="text-xs text-theme-text-secondary">
          {here.ownEventId ? t('inspector.tempoStarting') : t('inspector.tempoInherited')}
        </span>
      )}
    </div>
  );
}

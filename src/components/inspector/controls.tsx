/**
 * The inspector's shared controls.
 *
 * Every panel field is one of a handful of shapes — a select, a number, a
 * checkbox, a slider — and each has to answer the same awkward question: what
 * does it show when the selection holds *several* notes with different values?
 * `MIXED` is that answer, and these four are the only components that know it.
 *
 * Pulled out of `InspectorPanel.tsx`, where they were 300 lines into a
 * 1,900-line file and invisible to anyone not already reading it. They are the
 * reusable part of that file; the tabs and fields above them are not.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sudobility/components';
import { PanSlider, VolumeSlider } from '@/features/tracks/mixer-controls';
import { FIELD_LABEL_CLASS, MIXED, MIXED_VALUE, SELECT_CLASS, TEXT_INPUT_CLASS } from './shared';
import type { MixedOr } from './shared';

/** `values[0]` if every entry deep-equals it (by `JSON.stringify`, sufficient for this panel's primitive/plain-object fields), `MIXED` if they differ, or `null` for an empty list. */
export function commonValue<T>(values: T[]): MixedOr<T> | null {
  if (values.length === 0) return null;
  const first = values[0];
  const firstKey = JSON.stringify(first);
  return values.every((v) => JSON.stringify(v) === firstKey) ? first : MIXED;
}

/** A `Select` that renders a synthetic disabled "Mixed" option when `value` is `MIXED`, otherwise the given options. Selecting a real option always calls `onChange` with that option's own value (never `MIXED`). */
export function MixedSelect<T extends string>({
  value,
  options,
  ariaLabel,
  onChange,
  disabled,
}: {
  value: MixedOr<T> | null;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const selectValue = value === MIXED ? MIXED_VALUE : (value ?? undefined);
  return (
    <Select
      value={selectValue}
      disabled={disabled || value === null}
      onValueChange={(v) => {
        if (v === MIXED_VALUE) return;
        onChange(v as T);
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className={SELECT_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {value === MIXED && (
          <SelectItem value={MIXED_VALUE} disabled>
            {t('inspector.mixed')}
          </SelectItem>
        )}
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A numeric `<input>` (the library `Input`, `type="number"`) showing an empty value + "Mixed" placeholder when `value` is `MIXED`. Commits on blur/Enter, not on every keystroke, so a partial/invalid draft never dispatches a command.
 *
 * Kept on the library `Input` rather than `NumberInput`: `NumberInput`'s
 * `value`/`onChange` pair is a real `number`, with no representation for
 * "empty, showing a Mixed placeholder" -- exactly the state this field
 * needs whenever a multi-selection's values differ. `Input` is a thin
 * styled `<input>` with full attribute passthrough, so it keeps the same
 * string-draft/blur-commit behavior unchanged. */
export function MixedNumberField({
  label,
  value,
  onCommit,
  disabled,
  min,
  max,
  step,
}: {
  label: string;
  value: MixedOr<number> | null;
  onCommit: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value === MIXED || value === null ? '' : String(value));

  useEffect(() => {
    setDraft(value === MIXED || value === null ? '' : String(value));
  }, [value]);

  const commit = (): void => {
    const parsed = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed);
  };

  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <Input
        type="number"
        value={draft}
        placeholder={value === MIXED ? t('inspector.mixed') : undefined}
        disabled={disabled || value === null}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        className={TEXT_INPUT_CLASS}
      />
    </label>
  );
}

/** A checkbox showing an indeterminate visual state when `indeterminate` is true (the library `Checkbox`'s own `indeterminate` prop, mirroring MUI's `Checkbox indeterminate` for the "Mixed" tri-state fields -- it manages the DOM's `indeterminate` flag via ref internally, so this file no longer has to). */
export function MixedCheckbox({
  label,
  checked,
  indeterminate,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  /** Only a multi-selection can be part-checked, so this defaults to off. */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Checkbox
      label={label}
      checked={checked}
      indeterminate={indeterminate}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

export function CommitSlider({
  label,
  rowLabel,
  value,
  onCommit,
  kind,
  disabled,
}: {
  /** The accessible name, which says which track property this is. */
  label: string;
  /** The visible text in the row's label column. */
  rowLabel: string;
  value: number;
  onCommit: (value: number) => void;
  kind: 'volume' | 'pan';
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const resetLabel = t('track.centerPan');

  /**
   * Commits whatever the slider was left at.
   *
   * Guarded on the target being the range input itself, because this wrapper
   * commits on *any* pointer-up inside it and the pan row now carries a reset
   * button. A `<button>`'s `.value` is `''`, and `Number('')` is `0` — so an
   * unguarded handler silently commits zero for whatever the row controls.
   * On the pan row that happens to be what centring wants, which is precisely
   * why it would go unnoticed; the same button on the volume row would mute
   * the track. The reset commits through `onReset` instead, which says 0
   * because it means 0.
   */
  const commit = (e: ReactPointerEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.type !== 'range') return;
    onCommit(Number(target.value));
  };

  return (
    <div onPointerUp={commit} onKeyUp={commit}>
      {kind === 'volume' ? (
        <VolumeSlider
          label={label}
          rowLabel={rowLabel}
          value={draft}
          disabled={disabled}
          onChange={setDraft}
        />
      ) : (
        <PanSlider
          label={label}
          rowLabel={rowLabel}
          value={draft}
          disabled={disabled}
          onChange={setDraft}
          resetLabel={resetLabel}
          onReset={() => {
            // Straight to the store rather than through `commit`: the button
            // is not the range input, and centring is a decision rather than
            // the end of a drag.
            setDraft(0);
            onCommit(0);
          }}
        />
      )}
    </div>
  );
}

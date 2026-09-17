/**
 * Starting a new project, with or without a model writing the music.
 *
 * One form, two builders. The **Generate for me** toggle decides only which of
 * music_lib's two builders runs over the same draft:
 * `buildGenerateScoreRequest` reads the prompt half and produces a job request,
 * `buildNewProjectScore` ignores it and produces an empty score with the chosen
 * instrumentation. `GenerateScoreRequestDraft` is assignable to
 * `NewProjectDraft`, which is what lets one piece of state feed both — two
 * drafts would be two shapes to keep in step for no gain.
 *
 * Off is the default, because this is New Project: a blank score with the right
 * instruments is the ordinary way to start one. Off hides the whole AI half —
 * prompt, presets, style, mood, complexity, model and the credit line — so
 * there is one rule to learn rather than an exception. Instrumentation and
 * everything below it stays in both modes.
 *
 * **The Style picker goes with the AI half, and it costs something.** Choosing
 * a style also *fills* the form from `GENERATE_SCORE_STYLE_PRESETS` — ensemble,
 * tempo, bars, meter — which is the fastest way to start a country project
 * whether or not a model writes the notes. Keeping it visible in blank mode
 * would have been the one exception to "everything above Instrumentation is
 * the AI half", and a rule with one exception is a rule nobody can apply.
 *
 * It emits a `NewProjectSubmission` rather than a request: the dashboard turns
 * that into a project on the server, and the native app's File menu turns the
 * same thing into a local document.
 *
 * Two fields spec §21's prose lists alongside these ("candidate count",
 * "seed") no longer apply: whole-score generation adopts exactly one
 * committed score (`GenerateScoreRequest` has no candidateCount; the
 * RegenerationPanel is where a real candidateCount lives), and the seed
 * concept died with the deterministic mock provider — real AI generation
 * (music_api/OpenAI) is not seedable. Both are documented as known
 * limitations in docs/architecture.md.
 *
 * Re-skinned onto Tailwind (T12 batch 4): the MUI Select becomes native
 * `<select>`s, the MUI Menu becomes a small `role="menu"`/`role="menuitem"`
 * popover built from plain buttons (same pattern as `EditorToolbar`'s
 * articulation menu), MUI Checkboxes become native `<input
 * type="checkbox">`s, and MUI LinearProgress becomes a `role="progressbar"`
 * div — same roles/labels/accessible names as before, so no test
 * assertions changed.
 *
 * Adopts `@sudobility/components` controls (library sweep 2): the prompt
 * `<textarea>` becomes the library `TextArea` (its accessible name goes
 * through `textareaProps={{ 'aria-label': ... }}`, since `TextArea` has no
 * top-level `aria-label` prop); the Style/Mood/Complexity/Key/Mode/Time-
 * signature `<select>`s become the library's Radix-backed `Select`
 * (Style/Mood need a non-empty sentinel value, `NO_MARK`, for their "No
 * style"/"No mood" option -- Radix `Select.Item` rejects an empty-string
 * value); Measures/Tempo become the library `Input`; the Presets
 * trigger/menuitem buttons and Generate/Cancel become the library `Button`
 * (the popover itself stays a hand-built `role="menu"` div, same reasoning
 * as `EditorToolbar`'s articulation menu: no library Dropdown/Command
 * reproduces `menu`/`menuitem` roles).
 *
 * The instrumentation checklist becomes the library `Checkbox`, which
 * (unlike `Select`) renders a real native `<input type="checkbox">` with
 * the same `role="checkbox"` semantics as before, so no interaction-style
 * test changes are needed there -- but `Checkbox` has no `aria-label` prop
 * at all (only a visible `label` string used for both display *and* the
 * native `<label>`-association that supplies its accessible name), so
 * preserving the exact "Include <Instrument>" accessible name means that
 * text now shows up on screen too (previously "Include Piano" was an
 * aria-label with only "Piano" visible).
 *
 * The `role="progressbar"` div stays native: neither the library `Progress`
 * nor `ProgressBar` accepts an `aria-label` (or anything else) on the
 * element that actually carries `role="progressbar"`, so there's no way to
 * keep the required "Generating" accessible name on a library swap.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalizedLink } from '@/components/layout/LocalizedLink';
import { useBalance } from '@sudobility/consumables_client';
import { useScorePresets } from '@sudobility/music_client';
import { useMusicHookContext, useSiteAdmin } from '@/app/AuthContext';
import type { ChangeEvent, ReactNode } from 'react';
import type * as React from 'react';
import {
  Button,
  FormModal,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  TextArea,
  cn,
} from '@sudobility/components';
import {
  DEFAULT_INSTRUMENT_VALUE,
  GENERATE_SCORE_COMPLEXITY_OPTIONS,
  GENERATE_SCORE_KEY_FIFTHS_OPTIONS,
  GENERATE_SCORE_MOOD_OPTIONS,
  GENERATE_SCORE_STYLE_OPTIONS,
  GENERATION_VARIANTS,
  GENERATION_VARIANT_LABELS,
  GENERATE_SCORE_TIME_SIGNATURE_OPTIONS,
  canCreateNewProject,
  canRemoveNewProjectEntry,
  complexityLabelKey,
  firstMelodyInstrumentEntryId,
  initialNewProjectDraft,
  instrumentLabelFor,
  isNewProjectEntryLocked,
  isOutOfCredits,
  labelledOptions,
  moodLabelKey,
  newProjectCreditEstimate,
  newProjectDefaultTitleKey,
  newProjectDurationRefused,
  newProjectSubmission,
  newProjectTempoRefused,
  optionalFromPicker,
  optionalToPicker,
  reduceNewProjectDraft,
  showNewProjectDuration,
  showNewProjectLyrics,
  showNewProjectLyricsTheme,
  styleLabelKey,
  type GenerateScoreComplexity,
  type KeySignature,
  type NewProjectDraftAction,
  type NewProjectFormDraft,
  type NewProjectSubmission,
} from '@/app-library';
import { InstrumentSelectItems } from '@/features/instruments/InstrumentSelectItems';
import { variants } from '@sudobility/design';

export type NewProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  /**
   * Receives what was asked for; the caller decides where it lands.
   *
   * A discriminated result rather than a request, because the same form backs a
   * server project here and a local document on the native side.
   */
  onSubmit: (submission: NewProjectSubmission) => void;
  /** True while the project is being created, to disable the CTA. */
  submitting?: boolean;
};

/*
  The preset briefs are the server's list and this app's words.

  Which briefs suit which genre is product data — `GET /public/presets?style=`
  — so it can be retuned without shipping an app and two apps cannot offer
  different starting points for the same style. The *text* stays here, because
  the brief a reader picks is also the prompt sent to the model, and a Chinese
  reader should be prompting in Chinese rather than choosing between English
  sentences. Same division as `MusicXmlWarnings`.

  It used to be eight hardcoded prompts that had nothing to do with the chosen
  style, so picking Reggae still offered a waltz.
*/

const SELECT_TRIGGER_CLASS = 'h-auto w-full justify-between px-2 py-1.5 text-sm';

const TEXT_INPUT_CLASS = 'w-full px-2 py-1.5 text-sm';

/**
 * A block that grows and fades in when it is wanted, and collapses when it is
 * not.
 *
 * `grid-template-rows` from `0fr` to `1fr` is what animates a height nobody can
 * state in advance. `max-height` is the usual alternative and needs a guessed
 * number: guess low and the content clips, guess high and the easing happens
 * mostly against empty space, so the block appears to hang before it moves. The
 * inner element carries `overflow-hidden` **and** `min-h-0`, without which a
 * grid row refuses to shrink below its content and nothing collapses at all.
 *
 * The negative margin while collapsed cancels one of the parent's `gap-4`s: a
 * zero-height child still sits between two gaps, which leaves a visible hole
 * exactly where the block used to be.
 *
 * **Hidden means hidden.** `aria-hidden` and `inert` together take it out of
 * the accessibility tree and the tab order, so a collapsed field cannot be
 * tabbed into or announced. A block that is merely invisible and still
 * focusable is worse than one left on screen — the caret vanishes into nothing.
 *
 * `motion-reduce:transition-none` because somebody who asked the OS for less
 * motion asked this dialog too.
 */
const REVEAL_MS = 200;

function CollapsibleReveal({
  shown,
  children,
  ...group
}: {
  shown: boolean;
  children: ReactNode;
} & Pick<React.HTMLAttributes<HTMLDivElement>, 'role' | 'aria-label'>) {
  /*
    `overflow-hidden` is what makes the collapse work, and it is also what cut
    the Presets menu off at the bottom of this block: the menu is an absolutely
    positioned child, so it is clipped to the box it grows out of. The Style and
    Mood selects escaped only because Radix portals them out of the tree.

    So it is clipped while collapsed and while animating, and not once open —
    dropping it immediately instead would let the full-height content overlap
    the rows below for the 200ms the block takes to grow.
  */
  const [clipping, setClipping] = useState(true);
  useEffect(() => {
    if (!shown) {
      setClipping(true);
      return;
    }
    const timer = setTimeout(() => setClipping(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  return (
    <div
      {...group}
      aria-hidden={!shown}
      inert={!shown}
      className={cn(
        'grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out',
        'motion-reduce:transition-none',
        shown ? 'mb-0 grid-rows-[1fr] opacity-100' : '-mb-4 grid-rows-[0fr] opacity-0',
      )}
    >
      <div className={cn('flex min-h-0 flex-col gap-4', clipping && 'overflow-hidden')}>
        {children}
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  min,
  className,
  hint,
  type = 'number',
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'number' | 'text';
  onBlur?: () => void;
  min?: number;
  className?: string;
  /** Shown under the field when what was typed is refused. */
  hint?: string;
}) {
  return (
    <label className={`flex flex-1 flex-col gap-1 ${className ?? ''}`}>
      <span className="text-xs text-theme-text-secondary">{label}</span>
      <Input
        type={type}
        aria-label={label}
        value={value}
        min={min}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        {...(onBlur ? { onBlur } : {})}
        className={TEXT_INPUT_CLASS}
      />
      {hint ? <span className="text-xs text-amber-700 dark:text-amber-400">{hint}</span> : null}
    </label>
  );
}

function TempoSlider({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const bpm = Number(value);
  const sliderValue = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  return (
    <div className="flex min-w-0 flex-[1.4] flex-col gap-1">
      <span className="flex items-center justify-between text-xs text-theme-text-secondary">
        <span>{label}</span>
        <span>{sliderValue} BPM</span>
      </span>
      <input
        type="range"
        aria-label="Fast to slow"
        min={40}
        max={240}
        step={1}
        value={sliderValue}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-full accent-theme-primary"
      />
      <span className="flex justify-between text-[10px] text-theme-text-secondary">
        <span>Slow</span>
        <span>Fast</span>
      </span>
    </div>
  );
}

/**
 * The shared reducer with its randomness left at the default. `useReducer`
 * passes exactly two arguments, and `reduceNewProjectDraft`'s optional third
 * (the `rng` a test pins) does not fit React's reducer type as it stands.
 */
function reduceDraft(
  draft: NewProjectFormDraft,
  action: NewProjectDraftAction,
): NewProjectFormDraft {
  return reduceNewProjectDraft(draft, action);
}

export function NewProjectDialog({
  open,
  onClose,
  onSubmit,
  submitting = false,
}: NewProjectDialogProps) {
  const { t, i18n } = useTranslation();
  /*
    The whole form is one draft, and every rule that changes it is music_lib's
    (`reduceNewProjectDraft`): choosing a style fills the roster, tempo, bars
    and key; turning generation on adds a singer and off takes back exactly that
    one, tracked by entry id inside the draft rather than in a ref beside it;
    bars, tempo, meter and duration keep each other in step. The native sheet
    runs the same reducer, which is what stopped the two forms disagreeing about
    what a salsa is. This component only draws the draft and dispatches.
  */
  const [draft, dispatch] = useReducer(reduceDraft, undefined, initialNewProjectDraft);
  const { generating, style } = draft;
  const [picker, setPicker] = useState(DEFAULT_INSTRUMENT_VALUE);

  /*
    The vocabularies in the order they are read, not the order they were
    written. Thirty-three styles in declaration order — waltz, jazz, pop,
    cinematic, ambient — is a list nobody can find "reggae" in. Sorted on the
    translated label under the active language, with "No style" pinned above
    rather than sorted in among them; `labelledOptions` is shared with the
    native app, which draws the same two pickers.
  */
  const styleOptions = useMemo(
    () =>
      labelledOptions(
        GENERATE_SCORE_STYLE_OPTIONS,
        (value) => t(styleLabelKey(value)),
        i18n.language,
        t('generateScore.noStyle'),
      ),
    [t, i18n.language],
  );
  const moodOptions = useMemo(
    () =>
      labelledOptions(
        GENERATE_SCORE_MOOD_OPTIONS,
        (value) => t(moodLabelKey(value)),
        i18n.language,
        t('generateScore.noMood'),
      ),
    [t, i18n.language],
  );

  /*
    The briefs the server offers for the style in hand.

    Keyed on the style, so choosing Reggae asks for reggae's briefs — the whole
    point of moving this off a hardcoded list. `i18n.exists` filters what
    arrives: a server one version ahead of this app would otherwise print a
    brief's id at the reader, which is worse than showing one fewer brief.
  */
  const { data: presetKeys } = useScorePresets(useMusicHookContext(), style || undefined);
  const presets = (presetKeys ?? [])
    .filter((key) => i18n.exists(`generateScore.preset.${key}`))
    .map((key) => t(`generateScore.preset.${key}`));

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

  // The placeholder *and* the fallback name — see `newProjectDefaultTitleKey`.
  const defaultTitle = t(newProjectDefaultTitleKey(draft));

  const { balance } = useBalance();
  /**
   * Bars times instruments: what the server bills, and "about" because the
   * charge counts what the model actually produced, which is never more.
   */
  const estimatedCredits = newProjectCreditEstimate(draft);
  /**
   * Refused only at zero or below, matching `POST /jobs`, and never for a site
   * administrator, whom the server charges nothing — see `isOutOfCredits`.
   */
  const siteAdmin = useSiteAdmin();
  const outOfCredits = isOutOfCredits(balance, siteAdmin);
  const canCreate = canCreateNewProject(draft, { submitting, outOfCredits });
  const tempoRefused = newProjectTempoRefused(draft);
  const showLyrics = showNewProjectLyrics(draft);
  const showLyricsTheme = showNewProjectLyricsTheme(draft);

  /** The first non-percussion track, which is the one the melody lands on. */
  const melodyEntryId = firstMelodyInstrumentEntryId(draft.ensemble);

  const handlePresetSelect = (text: string): void => {
    dispatch({ type: 'setPrompt', prompt: text });
    setPresetOpen(false);
  };

  const handleCreate = (): void => {
    if (!canCreate) return;
    const submission = newProjectSubmission(draft, defaultTitle);
    if (submission) onSubmit(submission);
  };

  return (
    <FormModal
      open={open}
      title={t('newProject.title')}
      onClose={onClose}
      size="large"
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: t('common.cancel'), onClick: onClose, variant: 'ghost' },
        {
          label: t('dashboard.create'),
          onClick: handleCreate,
          variant: 'primary',
          disabled: !canCreate,
          loading: submitting,
          loadingLabel: t('common.loading'),
        },
      ]}
    >
      <div className="flex flex-col gap-4">
        <CollapsibleReveal shown={generating}>
          {outOfCredits ? (
            <p className="text-sm text-theme-text-secondary">
              {t('generate.outOfCreditsBefore')}{' '}
              <LocalizedLink to="/credits" className="underline">
                {t('generate.buyMore')}
              </LocalizedLink>{' '}
              {t('generate.outOfCreditsAfter')}
            </p>
          ) : (
            estimatedCredits > 0 && (
              <p className="text-xs text-theme-text-secondary">
                {t('generate.estimate', { count: estimatedCredits })}
              </p>
            )
          )}
        </CollapsibleReveal>

        {/* Named up front: every generated project would otherwise be called
          "Generated score", which is useless the moment you have two. */}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-theme-text-secondary">{t('generateScore.titleField')}</span>
          <Input
            value={draft.title}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              dispatch({ type: 'setTitle', title: e.target.value })
            }
            placeholder={defaultTitle}
            aria-label={t('generateScore.titleField')}
            className="px-2 py-1.5 text-sm"
          />
        </label>

        {/* Under the Title, because it is the next thing you decide: whether
            anything is written for you, or you get the staves and write it
            yourself. Everything above Instrumentation belongs to the AI half
            and appears with it; everything below stays in both modes. */}
        <label className="flex items-center gap-3">
          <Switch
            checked={generating}
            onCheckedChange={(next) => dispatch({ type: 'setGenerating', generating: next })}
            aria-label={t('newProject.generateForMe')}
          />
          <span className="flex flex-col">
            <span className="text-sm text-theme-text-primary">{t('newProject.generateForMe')}</span>
            <span className="text-xs text-theme-text-secondary">
              {t('newProject.generateForMeHint')}
            </span>
          </span>
        </label>

        <CollapsibleReveal shown={generating} role="group" aria-label={t('newProject.aiSettings')}>
          {/* The caption sits above the whole row rather than above the prompt
              alone, so the Presets button starts at the top of the prompt box
              instead of a caption's height above it. Its accessible name comes
              from `aria-label`, not from a wrapping `<label>`. */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-theme-text-secondary">{t('generate.prompt')}</span>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <TextArea
                  value={draft.prompt}
                  onChange={(text) => dispatch({ type: 'setPrompt', prompt: text })}
                  rows={3}
                  textareaProps={{ 'aria-label': 'Prompt' }}
                />
              </div>
              {/* No briefs, no button. The list is the server's, so an
                  unreachable API means a control that would open an empty menu
                  — which reads worse than one that is simply not there. Not
                  rendered rather than hidden: a button that is merely invisible
                  is still in the tab order and still announced. */}
              {presets.length > 0 && (
                <div ref={presetRef} className="relative shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={t('generateScore.presetPrompts')}
                    aria-haspopup="menu"
                    aria-expanded={presetOpen}
                    onClick={() => setPresetOpen((open) => !open)}
                    className="px-3 py-1.5"
                  >
                    {t('generate.presets')}
                  </Button>
                  {presetOpen && (
                    <div
                      role="menu"
                      className={cn(
                        variants.card.default.base(),
                        'absolute right-0 top-full z-10 mt-1 max-h-72 w-80 overflow-y-auto rounded-md py-1 shadow-lg',
                      )}
                    >
                      {presets.map((text) => (
                        <Button
                          key={text}
                          type="button"
                          variant="ghost"
                          role="menuitem"
                          onClick={() => handlePresetSelect(text)}
                          className="block w-full justify-start rounded-none px-3 py-1.5 text-left"
                        >
                          {text}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Select
              value={optionalToPicker(style)}
              onValueChange={(v) => dispatch({ type: 'applyStyle', style: optionalFromPicker(v) })}
            >
              <SelectTrigger
                aria-label={t('generateScore.style')}
                className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {styleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={optionalToPicker(draft.mood)}
              onValueChange={(v) => dispatch({ type: 'setMood', mood: optionalFromPicker(v) })}
            >
              <SelectTrigger
                aria-label={t('generateScore.mood')}
                className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {moodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={draft.complexity}
              onValueChange={(v) =>
                dispatch({ type: 'setComplexity', complexity: v as GenerateScoreComplexity })
              }
            >
              <SelectTrigger
                aria-label={t('generateScore.complexity')}
                className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENERATE_SCORE_COMPLEXITY_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(complexityLabelKey(c))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={draft.variant}
              onValueChange={(v) => dispatch({ type: 'setVariant', variant: v })}
            >
              <SelectTrigger
                aria-label={t('generateScore.model')}
                className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENERATION_VARIANTS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {GENERATION_VARIANT_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Only where somebody can sing them: syllables under a bass line are
              not a lyric. The request omits the field entirely otherwise, which
              music_lib enforces rather than trusting this to stay in step. */}
          {showLyrics ? (
            <label className="flex items-center gap-3">
              <Switch
                checked={draft.lyrics}
                onCheckedChange={(next) => dispatch({ type: 'setLyrics', lyrics: next })}
                aria-label={t('newProject.writeLyrics')}
              />
              <span className="flex flex-col">
                <span className="text-sm text-theme-text-primary">
                  {t('newProject.writeLyrics')}
                </span>
                <span className="text-xs text-theme-text-secondary">
                  {t('newProject.writeLyricsHint')}
                </span>
              </span>
            </label>
          ) : null}

          {/* Only where words are actually being written: a subject for a lyric
              nobody asked for is the disagreement this field was once left out
              to avoid, and music_lib drops it from the request on the same
              rule rather than trusting this to stay in step. */}
          {showLyricsTheme ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-theme-text-secondary">
                {t('newProject.lyricsTheme')}
              </span>
              <Input
                value={draft.lyricsTheme}
                placeholder={t('newProject.lyricsThemePlaceholder')}
                aria-label={t('newProject.lyricsTheme')}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  dispatch({ type: 'setLyricsTheme', lyricsTheme: e.target.value })
                }
                className={TEXT_INPUT_CLASS}
              />
            </label>
          ) : null}
        </CollapsibleReveal>

        <div
          role="group"
          aria-label={t('generateScore.instrumentation')}
          className="flex flex-col gap-2"
        >
          <Text as="span" size="sm">
            {t('generateScore.instrumentation')}
          </Text>

          <div className="flex gap-2">
            <Select value={picker} onValueChange={setPicker}>
              <SelectTrigger
                aria-label={t('generateScore.addInstrument')}
                className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <InstrumentSelectItems />
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => dispatch({ type: 'addInstrument', value: picker })}
            >
              {t('common.add')}
            </Button>
          </div>

          {/* The order is the point: the first track that is not percussion is
              the one the melody is written for, so it is labelled rather than
              left to be inferred from position. */}
          <ol className="flex flex-col gap-1">
            {draft.ensemble.map((entry, index) => (
              <li key={entry.id} className="flex items-center justify-between gap-2">
                <Text size="sm">
                  {index + 1}. {instrumentLabelFor(entry.value)}
                  {entry.id === melodyEntryId ? ` ${t('generateScore.melody')}` : ''}
                  {isNewProjectEntryLocked(draft, entry) ? ` ${t('generateScore.essential')}` : ''}
                </Text>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('generateScore.removeInstrument', {
                    instrument: instrumentLabelFor(entry.value),
                  })}
                  disabled={!canRemoveNewProjectEntry(draft, entry)}
                  onClick={() => dispatch({ type: 'removeInstrument', id: entry.id })}
                >
                  {t('common.remove')}
                </Button>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex gap-2">
          <LabeledInput
            label={t('generateScore.measures')}
            value={draft.measuresText}
            onChange={(text) => dispatch({ type: 'setBars', text })}
            min={1}
          />
          {/* Not while words are being written: a song's length is its form,
              and the lyric follows verses and choruses rather than a clock. */}
          {showNewProjectDuration(draft) ? (
            <LabeledInput
              label={t('generateScore.duration')}
              type="text"
              value={draft.durationText}
              onChange={(text) => dispatch({ type: 'setDuration', text })}
              // Tidy what was typed ("45" -> "0:45") to what the bars now play.
              onBlur={() => dispatch({ type: 'tidyDuration' })}
              {...(newProjectDurationRefused(draft)
                ? { hint: t('generateScore.durationInvalid') }
                : {})}
            />
          ) : null}
          {generating ? (
            <div className="flex min-w-0 flex-[2.4] items-start gap-2">
              <TempoSlider
                label={t('generateScore.tempo')}
                value={draft.tempoText}
                onChange={(text) => dispatch({ type: 'setTempo', text })}
              />
              <LabeledInput
                label={t('generateScore.tempo')}
                value={draft.tempoText}
                onChange={(text) => dispatch({ type: 'setTempo', text })}
                min={1}
                className="max-w-20"
                {...(tempoRefused ? { hint: t('generateScore.tempoInvalid') } : {})}
              />
            </div>
          ) : (
            <LabeledInput
              label={t('generateScore.tempo')}
              value={draft.tempoText}
              onChange={(text) => dispatch({ type: 'setTempo', text })}
              min={1}
              {...(tempoRefused ? { hint: t('generateScore.tempoInvalid') } : {})}
            />
          )}
        </div>

        <div className="flex gap-2">
          <Select
            value={String(draft.keySignature.fifths)}
            onValueChange={(v) => dispatch({ type: 'setKey', fifths: Number(v) })}
          >
            <SelectTrigger
              aria-label={t('generateScore.key')}
              className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENERATE_SCORE_KEY_FIFTHS_OPTIONS.map((opt) => (
                <SelectItem key={opt.fifths} value={String(opt.fifths)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={draft.keySignature.mode}
            onValueChange={(v) => dispatch({ type: 'setMode', mode: v as KeySignature['mode'] })}
          >
            <SelectTrigger
              aria-label={t('generateScore.mode')}
              className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Named through the locale: "major" is a word, not a code. */}
              <SelectItem value="major">{t('key.major')}</SelectItem>
              <SelectItem value="minor">{t('key.minor')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={draft.meter}
            onValueChange={(meter) => dispatch({ type: 'setMeter', meter })}
          >
            <SelectTrigger
              aria-label={t('generateScore.timeSignature')}
              className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(GENERATE_SCORE_TIME_SIGNATURE_OPTIONS).map((key) => (
                <SelectItem key={key} value={key}>
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </FormModal>
  );
}

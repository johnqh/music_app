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
 * (Style/Mood need a non-empty sentinel value, `NONE_VALUE`, for their "No
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalizedLink } from '@/components/layout/LocalizedLink';
import { useBalance } from '@sudobility/consumables_client';
import { useScorePresets } from '@sudobility/music_client';
import { getAppServices } from '@/config/initialize';
import { useSiteAdmin } from '@/app/AuthContext';
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
  DEFAULT_GENERATE_SCORE_MEASURES,
  DEFAULT_INSTRUMENT_VALUE,
  GENERATE_SCORE_COMPLEXITY_OPTIONS,
  GENERATE_SCORE_KEY_FIFTHS_OPTIONS,
  GENERATE_SCORE_MOOD_OPTIONS,
  GENERATE_SCORE_STYLE_OPTIONS,
  DEFAULT_VOCAL_INSTRUMENT_VALUE,
  hasVocalInstrument,
  sortOptionsByLabel,
  GENERATION_VARIANTS,
  GENERATION_VARIANT_LABELS,
  withGenerationVariant,
  GENERATE_SCORE_STYLE_PRESETS,
  styleInstrumentsWithGuest,
  GENERATE_SCORE_TIME_SIGNATURE_OPTIONS,
  buildGenerateScoreRequest,
  buildNewProjectScore,
  canBuildGenerateScoreRequest,
  canBuildNewProjectScore,
  estimateGenerateScoreCredits,
  firstMelodyInstrumentEntryId,
  type InstrumentValueEntry,
  generateScoreTrackForInstrumentValue,
  instrumentLabelFor,
  type GenerateScoreComplexity,
  type KeySignature,
  type NewProjectSubmission,
} from '@sudobility/music_lib';
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

/**
 * One chosen instrument. `id` survives reordering and repeats of the same
 * value. The shape is `InstrumentValueEntry` from music_lib, which
 * `firstMelodyInstrumentEntryId` reads — aliased rather than redeclared, since
 * two identical declarations are how the two come apart.
 */
type EnsembleEntry = InstrumentValueEntry;

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

/** Sentinel for Style/Mood's "no selection" option: Radix `Select.Item` rejects an empty-string `value` (it's reserved to mean "cleared"). */
const NONE_VALUE = '__none__';

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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  className?: string;
  /** Shown under the field when what was typed is refused. */
  hint?: string;
}) {
  return (
    <label className={`flex flex-1 flex-col gap-1 ${className ?? ''}`}>
      <span className="text-xs text-theme-text-secondary">{label}</span>
      <Input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className={TEXT_INPUT_CLASS}
      />
      {hint ? <span className="text-xs text-amber-700 dark:text-amber-400">{hint}</span> : null}
    </label>
  );
}

export function NewProjectDialog({
  open,
  onClose,
  onSubmit,
  submitting = false,
}: NewProjectDialogProps) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState('');
  /*
    Whether a model writes the music.

    Off by default: this is New Project, and a blank score with the right
    instruments is the ordinary way to start one. On, the form is exactly the
    Generate dialog it grew out of.

    Flipping it never clears anything. Somebody who types a prompt, turns this
    off and turns it back on gets their prompt back — losing typed text to a
    toggle is not worth the tidiness.
  */
  const [generateForMe, setGenerateForMe] = useState(false);
  /*
    Words under the sung notes. On by default, because somebody who has just
    been given a singer is writing a song — but a switch rather than an
    inference, since a voice program held as a wordless "ooh" pad is a
    different piece of music and there is no way to tell the two apart from the
    roster alone. Only reaches the wire when somebody can sing them, which
    `buildGenerateScoreRequest` enforces.
  */
  const [lyrics, setLyrics] = useState(true);
  /*
    What the words are about, when that is not what the piece is about.

    A separate field because they are separate questions: the prompt describes
    the music, and the words over it can be about coming home without the music
    brief being about coming home. Blank means "the same as the piece", which is
    what the lyric always followed — so leaving it alone changes nothing.
  */
  const [lyricsTheme, setLyricsTheme] = useState('');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('');
  const [mood, setMood] = useState('');
  const [complexity, setComplexity] = useState<GenerateScoreComplexity>('moderate');
  // An ordered list, not a set: `classifyTrackRole` gives the melody to the
  // first treble-clef track, so which instrument comes first is a musical
  // decision and has to be visible and controllable. Ids allow the same
  // instrument twice — two violins is a real ensemble.
  const [ensemble, setEnsemble] = useState<EnsembleEntry[]>(() => [
    { id: 0, value: DEFAULT_INSTRUMENT_VALUE },
  ]);
  const [nextEntryId, setNextEntryId] = useState(1);
  /*
    The singer this dialog added, so turning the toggle back off removes that
    one and not whichever voice happens to be at the top of the list. A ref
    rather than state: it is read inside handlers and must never cause a render.
  */
  const autoVocalId = useRef<number | null>(null);
  const [picker, setPicker] = useState(DEFAULT_INSTRUMENT_VALUE);
  const [measures, setMeasures] = useState(String(DEFAULT_GENERATE_SCORE_MEASURES));
  /*
    Which backend writes the music.

    DeepSeek by default because it is the one whose output people preferred in
    listening: measured side by side on the same briefs, its country and metal
    came back more recognisably in their genre and markedly less over-written
    than the frontier model's, which produced denser, busier parts for the same
    request.

    Chosen HERE rather than in developer settings because it is a property of
    the piece being commissioned, not of the machine doing the commissioning —
    and because someone comparing two backends wants to choose per generation
    rather than open a settings dialog between them.
  */
  const [variant, setVariant] = useState<string>('deepseek');
  const [tempo, setTempo] = useState('');
  const [keyFifths, setKeyFifths] = useState(0);
  const [keyMode, setKeyMode] = useState<KeySignature['mode']>('major');
  const [timeSigPreset, setTimeSigPreset] = useState('4/4');

  /*
    Choosing a style fills the form with the ordinary shape of that genre.

    Reggae is an electric guitar, an organ, a bass and a kit at 78bpm; picking
    the word and then being handed a lone piano at 120 is the generator asking
    the reader to already know the answer. `GENERATE_SCORE_STYLE_PRESETS` in
    music_lib is where the shape lives — both apps fill from it, so a genre
    means the same ensemble on a phone as on the web.

    It **overwrites**, deliberately. A preset that skipped fields the reader had
    touched would leave a half-country, half-whatever-was-there-before ensemble
    that matches no genre and that nobody chose. Everything it sets stays
    editable; this is a starting point, not a lock.

    Clearing the style back to "No style" leaves the form alone: that is the
    reader saying they want no genre, not that they want the defaults back.
  */
  const applyStyle = (next: string) => {
    setStyle(next);
    const preset = next ? GENERATE_SCORE_STYLE_PRESETS[next] : undefined;
    if (!preset) return;
    /*
      The roster plus one guest, from `styleInstrumentsWithGuest` — shared with
      the React Native sheet, which fills the same list. Every generation of one
      style otherwise draws the same five instruments, so two goes at country
      are the same country twice; one instrument from outside the genre's own
      lineup is what makes each attempt its own piece. Appended last and shown
      in this editable list, so it can be removed before generating.
    */
    const withGuest = styleInstrumentsWithGuest(next);
    const entries = withGuest.map((value: string, index: number) => ({
      id: index,
      value,
    }));
    /*
      A style overwrites the whole roster deliberately, so the singer has to be
      put back: a vocal that vanished the moment a genre was chosen is a song
      the reader thought they had asked for and did not get. Not added when the
      preset brought its own voice, and not added at all in blank mode.
    */
    const singing = generateForMe && !hasVocalInstrument(withGuest);
    autoVocalId.current = singing ? withGuest.length : null;
    setEnsemble(
      singing
        ? [{ id: withGuest.length, value: DEFAULT_VOCAL_INSTRUMENT_VALUE }, ...entries]
        : entries,
    );
    setNextEntryId(withGuest.length + (singing ? 1 : 0));
    setTempo(String(preset.tempo));
    setMeasures(String(preset.measures));
    setTimeSigPreset(preset.timeSignature);
    if (preset.mode) setKeyMode(preset.mode);
  };
  /*
    The vocabularies in the order they are read, not the order they were
    written. Thirty-three styles in declaration order — waltz, jazz, pop,
    cinematic, ambient — is a list nobody can find "reggae" in. Sorted on the
    translated label rather than the key, because `electroSwing` is not what is
    on screen, and under the active language, because the labels a Chinese
    reader scans are Chinese. `sortOptionsByLabel` is shared with the native
    app, which draws the same two pickers.
  */
  const styleOptions = useMemo(
    () =>
      sortOptionsByLabel(
        GENERATE_SCORE_STYLE_OPTIONS,
        (value) => t(`generateScore.styleName.${value}`),
        i18n.language,
      ),
    [t, i18n.language],
  );
  const moodOptions = useMemo(
    () =>
      sortOptionsByLabel(
        GENERATE_SCORE_MOOD_OPTIONS,
        (value) => t(`generateScore.moodName.${value}`),
        i18n.language,
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
  const { data: presetKeys } = useScorePresets(
    { ...getAppServices(), token: null },
    style || undefined,
  );
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

  /*
    What the project is called when nothing was typed.

    Two names rather than one, because the two modes produce different things
    and a reader can tell them apart in a list at a glance. It is the
    placeholder *and* the fallback: a placeholder showing a name you do not get
    is a label for a value that never existed.
  */
  const defaultTitle = t(
    generateForMe ? 'newProject.defaultTitleGenerated' : 'newProject.defaultTitle',
  );

  const durationMeasures = Number(measures);
  const instrumentValues = ensemble.map((entry) => entry.value);
  const tracks = instrumentValues.map(generateScoreTrackForInstrumentValue);

  const { balance } = useBalance();
  /**
   * Bars times instruments: what the request asks for, and what the server
   * bills. A four-bar quartet costs about four times a four-bar solo to
   * produce, so an estimate from the bar count alone would understate every
   * wide score four-fold.
   *
   * The charge counts what the model actually *produced*, which agrees whenever
   * generation returns the requested length and is otherwise smaller — so this
   * is never exceeded. Hence "about", and never a re-quote afterwards.
   */
  const estimatedCredits = estimateGenerateScoreCredits(durationMeasures, tracks.length);
  /**
   * Refused only at zero or below, matching `POST /jobs`.
   *
   * Deliberately not `estimatedCredits > balance`: a job may overdraw once by
   * design, and a stricter rule here would refuse work the API would accept.
   *
   * A site administrator is never refused, for the same reason: the server
   * charges them nothing and checks no balance, so gating them here would
   * refuse work it would have accepted — and they sit at zero permanently,
   * because nothing ever grants or spends their credits.
   */
  const siteAdmin = useSiteAdmin();
  const outOfCredits = !siteAdmin && balance !== null && balance <= 0;
  const generationDraft = {
    title,
    prompt,
    durationMeasures,
    instrumentValues,
    complexity,
    timeSignature: GENERATE_SCORE_TIME_SIGNATURE_OPTIONS[timeSigPreset],
    keySignature: { fifths: keyFifths, mode: keyMode },
    style,
    mood,
    tempoText: tempo,
    lyrics,
    lyricsTheme,
  };

  /*
    One rule per mode, both from music_lib, so the form cannot offer a Create
    the builder would then refuse. `outOfCredits` gates generation only — a
    blank project costs nothing, and refusing it would refuse work the server
    never charges for.
  */
  const canCreate =
    !submitting &&
    (generateForMe
      ? !outOfCredits && canBuildGenerateScoreRequest(generationDraft)
      : canBuildNewProjectScore(generationDraft));
  // Blank is fine — no tempo is sent. Anything else that is not a positive
  // number is what stops Generate, so say so rather than just greying it out.
  const tempoRefused = tempo.trim() !== '' && !(Number(tempo) > 0);

  /*
    Turning the model on gives the roster somebody to sing, because a song needs
    one and the form otherwise opens on a piano solo — leaving the reader to
    know that a voice is filed under Ensemble before they can ask for a song.
    Turning it off takes back exactly what was given: a voice the reader chose
    themselves is theirs.
  */
  const toggleGenerateForMe = (next: boolean): void => {
    setGenerateForMe(next);
    if (next) {
      if (hasVocalInstrument(instrumentValues)) return;
      const id = nextEntryId;
      autoVocalId.current = id;
      setEnsemble((prev) => [{ id, value: DEFAULT_VOCAL_INSTRUMENT_VALUE }, ...prev]);
      setNextEntryId((value) => value + 1);
      return;
    }
    const id = autoVocalId.current;
    if (id === null) return;
    autoVocalId.current = null;
    setEnsemble((prev) => (prev.length <= 1 ? prev : prev.filter((entry) => entry.id !== id)));
  };

  const addInstrument = (): void => {
    setEnsemble((prev) => [...prev, { id: nextEntryId, value: picker }]);
    setNextEntryId((id) => id + 1);
  };

  // The floor is one: a score with no tracks is not a score, and `canGenerate`
  // would refuse it anyway — better to disable the last remove than to let the
  // form reach a state it cannot submit from.
  const removeInstrument = (id: number): void => {
    // Removed by hand, so the toggle has nothing left to take back.
    if (autoVocalId.current === id) autoVocalId.current = null;
    setEnsemble((prev) => (prev.length <= 1 ? prev : prev.filter((entry) => entry.id !== id)));
  };

  /** The first non-percussion track, which is the one the melody lands on. */
  const melodyEntryId = firstMelodyInstrumentEntryId(ensemble);

  const handlePresetSelect = (text: string): void => {
    setPrompt(text);
    setPresetOpen(false);
  };

  const handleCreate = (): void => {
    if (!canCreate) return;
    if (generateForMe) {
      /*
        The default title reaches the *request*, not the draft.

        `buildNewProjectScore` reads the same draft and writes the title into
        the score's own metadata, where blank has always meant "Untitled" — the
        score's title and the project's name are different things, and only the
        second is what this default is for.
      */
      const request = buildGenerateScoreRequest({
        ...generationDraft,
        title: title.trim() || defaultTitle,
      });
      if (!request) return;
      onSubmit({ kind: 'generate', request: withGenerationVariant(request, variant) });
      return;
    }
    const score = buildNewProjectScore(generationDraft);
    if (!score) return;
    // The score's title and the project's name are different things: the score
    // says "Untitled", and a row in a list needs something a reader can pick out.
    onSubmit({ kind: 'blank', title: title.trim() || defaultTitle, score });
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
        <CollapsibleReveal shown={generateForMe}>
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
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
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
            checked={generateForMe}
            onCheckedChange={toggleGenerateForMe}
            aria-label={t('newProject.generateForMe')}
          />
          <span className="flex flex-col">
            <span className="text-sm text-theme-text-primary">{t('newProject.generateForMe')}</span>
            <span className="text-xs text-theme-text-secondary">
              {t('newProject.generateForMeHint')}
            </span>
          </span>
        </label>

        <CollapsibleReveal
          shown={generateForMe}
          role="group"
          aria-label={t('newProject.aiSettings')}
        >
          {/* The caption sits above the whole row rather than above the prompt
              alone, so the Presets button starts at the top of the prompt box
              instead of a caption's height above it. Its accessible name comes
              from `aria-label`, not from a wrapping `<label>`. */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-theme-text-secondary">{t('generate.prompt')}</span>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <TextArea
                  value={prompt}
                  onChange={setPrompt}
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
              value={style === '' ? NONE_VALUE : style}
              onValueChange={(v) => applyStyle(v === NONE_VALUE ? '' : v)}
            >
              <SelectTrigger
                aria-label={t('generateScore.style')}
                className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>{t('generateScore.noStyle')}</SelectItem>
                {styleOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`generateScore.styleName.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={mood === '' ? NONE_VALUE : mood}
              onValueChange={(v) => setMood(v === NONE_VALUE ? '' : v)}
            >
              <SelectTrigger
                aria-label={t('generateScore.mood')}
                className={cn(SELECT_TRIGGER_CLASS, 'flex-1')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>{t('generateScore.noMood')}</SelectItem>
                {moodOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`generateScore.moodName.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={complexity}
              onValueChange={(v) => setComplexity(v as GenerateScoreComplexity)}
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
                    {t(`generateScore.complexityName.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={variant} onValueChange={setVariant}>
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
          {hasVocalInstrument(instrumentValues) ? (
            <label className="flex items-center gap-3">
              <Switch
                checked={lyrics}
                onCheckedChange={setLyrics}
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
          {hasVocalInstrument(instrumentValues) && lyrics ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-theme-text-secondary">
                {t('newProject.lyricsTheme')}
              </span>
              <Input
                value={lyricsTheme}
                placeholder={t('newProject.lyricsThemePlaceholder')}
                aria-label={t('newProject.lyricsTheme')}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setLyricsTheme(e.target.value)}
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
            <Button type="button" variant="outline" onClick={addInstrument}>
              {t('common.add')}
            </Button>
          </div>

          {/* The order is the point: the first track that is not percussion is
              the one the melody is written for, so it is labelled rather than
              left to be inferred from position. */}
          <ol className="flex flex-col gap-1">
            {ensemble.map((entry, index) => (
              <li key={entry.id} className="flex items-center justify-between gap-2">
                <Text size="sm">
                  {index + 1}. {instrumentLabelFor(entry.value)}
                  {entry.id === melodyEntryId ? ` ${t('generateScore.melody')}` : ''}
                </Text>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('generateScore.removeInstrument', {
                    instrument: instrumentLabelFor(entry.value),
                  })}
                  disabled={ensemble.length <= 1}
                  onClick={() => removeInstrument(entry.id)}
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
            value={measures}
            onChange={setMeasures}
            min={1}
          />
          <LabeledInput
            label={t('generateScore.tempo')}
            value={tempo}
            onChange={setTempo}
            min={1}
            // Left blank the tempo is simply not sent; typed wrong it blocks
            // Generate, and a disabled button with no reason is the trap this
            // dialog's siblings document.
            {...(tempoRefused ? { hint: t('generateScore.tempoInvalid') } : {})}
          />
        </div>

        <div className="flex gap-2">
          <Select value={String(keyFifths)} onValueChange={(v) => setKeyFifths(Number(v))}>
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
          <Select value={keyMode} onValueChange={(v) => setKeyMode(v as KeySignature['mode'])}>
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
          <Select value={timeSigPreset} onValueChange={setTimeSigPreset}>
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

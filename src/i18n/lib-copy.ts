/**
 * The words `music_lib` no longer carries.
 *
 * The library was made language-free: templates, MusicXML warnings and the
 * selection readout all take their copy from whoever is driving them. That is
 * the right split — a library cannot know the user's language — but it means
 * this app has to supply three tables, and they are gathered here rather than
 * rebuilt at each call site.
 *
 * Read off the initialised i18next instance rather than a hook, for the same
 * reason `command-labels.ts` does: these are consumed by plain modules and by
 * one-shot handlers, not rendered, so they need no re-render on a language
 * change. Anything that *is* rendered should use `useTranslation` as usual.
 *
 * The bare `i18next` singleton, deliberately, not the app's `@/i18n` module:
 * that one calls `.use(Backend).init(...)` on import, so pulling it in here
 * would start an HTTP fetch of the translation bundles in every test that
 * transitively touches editing — which it did, and four suites timed out. The
 * app initialises this same instance at start-up, so at runtime the strings are
 * there; under test `t` returns the key, which is deterministic and harmless.
 */
import i18next from 'i18next';
import type { MusicXmlWarnings, SelectionSummaryCopy, TemplateCopy } from '@sudobility/music_lib';
import { TEMPLATE_IDS } from '@sudobility/music_lib';

/** Name and description per template, keyed by the ids the library declares. */
export function templateCopy(): TemplateCopy {
  return Object.fromEntries(
    TEMPLATE_IDS.map((id) => [
      id,
      {
        name: i18next.t(`templates.${id}.name`),
        description: i18next.t(`templates.${id}.description`),
      },
    ]),
  ) as TemplateCopy;
}

/**
 * What the selection readout says.
 *
 * The count-taking entries go through i18next's plural handling rather than
 * appending an "s", which is an English-only rule.
 */
export function selectionSummaryCopy(): SelectionSummaryCopy {
  return {
    notes: (count) => i18next.t('selection.notes', { count }),
    measures: (count) => i18next.t('selection.measures', { count }),
    tracks: (count) => i18next.t('selection.tracks', { count }),
    none: i18next.t('selection.none'),
    regenerated: (summary) => i18next.t('selection.regenerated', { summary }),
  };
}

/**
 * Every warning the MusicXML importer can raise.
 *
 * One entry per case the importer knows about; the library supplies the
 * *situation* and this supplies the sentence, so a new warning upstream shows
 * up here as a type error rather than as an untranslated string.
 */
export function musicXmlWarnings(): MusicXmlWarnings {
  const t = i18next.t.bind(i18next);
  return {
    unsupportedClef: (sign, line) => t('musicXmlWarn.unsupportedClef', { sign, line }),
    unsupportedKeyMode: (mode) => t('musicXmlWarn.unsupportedKeyMode', { mode }),
    unsupportedTime: (measureNumber) => t('musicXmlWarn.unsupportedTime', { measureNumber }),
    complexTimeSignature: t('musicXmlWarn.complexTimeSignature'),
    clefChangeDropped: (clef, measureNumber) =>
      t('musicXmlWarn.clefChangeDropped', { clef, measureNumber }),
    unsupportedPitchStep: (step) => t('musicXmlWarn.unsupportedPitchStep', { step }),
    alterRounded: (alter, clamped) => t('musicXmlWarn.alterRounded', { alter, clamped }),
    graceNotes: t('musicXmlWarn.graceNotes'),
    lyrics: t('musicXmlWarn.lyrics'),
    tuplets: t('musicXmlWarn.tuplets'),
    unsupportedNotation: (tag) => t('musicXmlWarn.unsupportedNotation', { tag }),
    unsupportedNoteElement: (tag) => t('musicXmlWarn.unsupportedNoteElement', { tag }),
    unsupportedArticulation: (tag) => t('musicXmlWarn.unsupportedArticulation', { tag }),
    multipleArticulations: t('musicXmlWarn.multipleArticulations'),
    unpitched: t('musicXmlWarn.unpitched'),
    noPitchOrRest: t('musicXmlWarn.noPitchOrRest'),
    noDuration: t('musicXmlWarn.noDuration'),
    nonPositiveDuration: t('musicXmlWarn.nonPositiveDuration'),
    noteTrimmed: t('musicXmlWarn.noteTrimmed'),
    unsupportedMeasureElement: (tag) => t('musicXmlWarn.unsupportedMeasureElement', { tag }),
    noTempo: (defaultBpm) => t('musicXmlWarn.noTempo', { defaultBpm }),
    tempoClamped: (bpm, min, max, clamped) =>
      t('musicXmlWarn.tempoClamped', { bpm, min, max, clamped }),
  };
}

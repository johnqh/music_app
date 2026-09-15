/**
 * What each edit is called in the undo history.
 *
 * Commands take their label as an argument now: `music_lib` holds no
 * user-facing strings, so the words come from whichever app is driving it.
 * That is the right split — the same command is "Add note" here and something
 * else in another locale — but it means every call site would otherwise carry
 * a translation key, and half of them live in plain modules with no `t` in
 * scope (`editing.ts` alone dispatches seventeen).
 *
 * So the mapping lives here, once, and reads `t` off the initialised i18next
 * instance rather than a hook. That is legitimate outside React and is what
 * keeps `editing.ts` a plain module: these strings are read at dispatch time,
 * never rendered, so they need no re-render on a language change — the label
 * stored in history is the one the edit was made under, which is what you want
 * when reading back what you did.
 *
 * The bare `i18next` singleton, deliberately, not the app's `@/i18n` module:
 * that one calls `.use(Backend).init(...)` on import, so pulling it in here
 * would start an HTTP fetch of the translation bundles in every test that
 * transitively touches editing — which it did, and four suites timed out. The
 * app initialises this same instance at start-up, so at runtime the strings are
 * there; under test `t` returns the key, which is deterministic and harmless.
 */
import i18next from 'i18next';
import type { CommandLabelKey, EditingCopy } from '@sudobility/music_lib';

export function commandLabel(key: CommandLabelKey): string {
  return i18next.t(`command.${key}`);
}

/**
 * The whole editing-copy contract, for `setEditingCopy` at bootstrap.
 *
 * `commandLabel` is passed as the resolver rather than a captured table, so a
 * language change takes effect on the next edit instead of stranding whatever
 * was loaded at start-up.
 */
export function buildEditingCopy(): EditingCopy {
  return {
    commandLabel,
    validationProblem: (detail: string) => i18next.t('editor.validationProblem', { detail }),
    lastMeasureKept: i18next.t('editor.lastMeasureKept'),
    // The library hands over facts — the pitch, the instrument, its compass,
    // the side and what was refused — and the sentence is ours, so its word
    // order can follow the language rather than English.
    outOfRange: ({ pitch, instrument, low, high, direction, refused }) =>
      i18next.t(`editor.outOfRange.${direction}`, {
        pitch,
        instrument,
        low,
        high,
        action: i18next.t(`editor.refused.${refused}`),
      }),
    tooManyNotes: ({ instrument, limit, refused }) =>
      i18next.t(limit === 1 ? 'editor.polyphonyOne' : 'editor.polyphonyMany', {
        instrument: instrument ?? i18next.t('editor.unknownInstrument'),
        limit,
        action: i18next.t(`editor.refused.${refused}`),
      }),
    undoAction: () => i18next.t('editor.undo'),
  };
}

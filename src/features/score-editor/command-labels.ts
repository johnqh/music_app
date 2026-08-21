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

/** One key per command, named for the command rather than its wording. */
export type CommandLabelKey =
  | 'addNote'
  | 'addMeasure'
  | 'addTrack'
  | 'changeAccidental'
  | 'changeArticulation'
  | 'changeDuration'
  | 'changeDynamic'
  | 'changePitch'
  | 'changeClef'
  | 'changeKeySignature'
  | 'changeRepeats'
  | 'changeMetadata'
  | 'changeTempo'
  | 'changeTimeSignature'
  | 'changeTrackProps'
  | 'changeVelocity'
  | 'deleteEvents'
  | 'changeVoice'
  | 'deleteMeasure'
  | 'deleteTrack'
  | 'importScore'
  | 'insertWithRipple'
  | 'moveNotes'
  | 'pasteEvents'
  | 'quantize'
  | 'relocateNotes'
  | 'resizeNotes'
  | 'setChordSymbol'
  | 'setLyric'
  | 'toGraceNote'
  | 'toggleSlur'
  | 'toggleTie'
  | 'transpose';

export function commandLabel(key: CommandLabelKey): string {
  return i18next.t(`command.${key}`);
}

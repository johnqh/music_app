/**
 * Every keyboard shortcut the editor has, in one list.
 *
 * It lives here rather than inside `ShortcutHelpDialog` because two things
 * show it now — that dialog and the documentation page — and a second copy is
 * how the first one went wrong: the dialog's list was typed by hand from the
 * bindings in `@sudobility/music_lib` and had fallen six entries behind them.
 * Fermata, arpeggiate, glissando, the octave bracket and both hairpins were
 * all bound, all working, and shown nowhere. A reader had no way to find them.
 *
 * `shortcut-table.test.ts` checks this against `SHIFT_MARK_KEYS`, which the
 * bindings themselves publish, so the list cannot fall behind again.
 */

export type ShortcutRow = {
  /** The keys, written out. Mutually exclusive with `keysKey`. */
  keys?: string;
  /** A translated description of the gesture, where it is not a key chord. */
  keysKey?: string;
  actionKey: string;
};

/** Which part of the editor a shortcut belongs to — the docs group by these. */
export const SHORTCUT_GROUPS = [
  'transport',
  'editing',
  'selection',
  'noteEntry',
  'marks',
  'caret',
  'pointer',
] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export const SHORTCUTS: ReadonlyArray<ShortcutRow & { group: ShortcutGroup }> = [
  { group: 'transport', keys: 'Space', actionKey: 'shortcuts.playPause' },

  { group: 'editing', keys: 'Ctrl/Cmd+Z', actionKey: 'editor.undo' },
  { group: 'editing', keys: 'Ctrl/Cmd+Shift+Z', actionKey: 'editor.redo' },
  { group: 'editing', keys: 'Ctrl/Cmd+C', actionKey: 'editor.copy' },
  { group: 'editing', keys: 'Ctrl/Cmd+X', actionKey: 'editor.cut' },
  { group: 'editing', keys: 'Ctrl/Cmd+V', actionKey: 'editor.paste' },
  { group: 'editing', keys: 'Delete', actionKey: 'shortcuts.deleteNotes' },

  { group: 'selection', keys: 'Escape', actionKey: 'shortcuts.clearSelection' },
  { group: 'selection', keys: 'Ctrl/Cmd+A', actionKey: 'editor.selectAllNotes' },
  {
    group: 'selection',
    keys: 'ArrowUp / ArrowDown',
    actionKey: 'shortcuts.pitchSemitone',
  },
  {
    group: 'selection',
    keys: 'Shift+ArrowUp / Shift+ArrowDown',
    actionKey: 'shortcuts.pitchOctave',
  },
  {
    group: 'selection',
    keys: 'ArrowLeft / ArrowRight',
    actionKey: 'shortcuts.moveSelection',
  },

  { group: 'noteEntry', keys: 'N', actionKey: 'shortcuts.noteInput' },
  { group: 'noteEntry', keys: 'A – G', actionKey: 'shortcuts.enterPitch' },
  { group: 'noteEntry', keys: '1 – 6', actionKey: 'shortcuts.chooseDuration' },
  { group: 'noteEntry', keys: '.', actionKey: 'shortcuts.toggleDotted' },
  { group: 'noteEntry', keys: 'R', actionKey: 'shortcuts.insertRest' },
  { group: 'noteEntry', keys: 'T', actionKey: 'shortcuts.toggleTie' },
  { group: 'noteEntry', keys: 'S', actionKey: 'shortcuts.toggleSlur' },

  // The six that were bound and undocumented. Shift is the only modifier free
  // for them: bare letters are note entry and digits are note values.
  { group: 'marks', keys: 'Shift+F', actionKey: 'shortcuts.markFermata' },
  { group: 'marks', keys: 'Shift+A', actionKey: 'shortcuts.markArpeggiate' },
  { group: 'marks', keys: 'Shift+G', actionKey: 'shortcuts.markGlissando' },
  { group: 'marks', keys: 'Shift+O', actionKey: 'shortcuts.markOttava' },
  { group: 'marks', keys: 'Shift+<', actionKey: 'shortcuts.markCrescendo' },
  { group: 'marks', keys: 'Shift+>', actionKey: 'shortcuts.markDiminuendo' },

  {
    group: 'caret',
    keys: 'Alt+ArrowLeft / Alt+ArrowRight',
    actionKey: 'shortcuts.stepCaret',
  },
  { group: 'caret', keys: 'Home / End', actionKey: 'shortcuts.barEdge' },
  {
    group: 'caret',
    keys: 'Ctrl/Cmd+Home / Ctrl/Cmd+End',
    actionKey: 'shortcuts.scoreEdge',
  },

  {
    group: 'pointer',
    keysKey: 'shortcuts.clickChord',
    actionKey: 'shortcuts.selectEveryNote',
  },
  {
    group: 'pointer',
    keysKey: 'shortcuts.pianoKey',
    actionKey: 'shortcuts.addRemoveNote',
  },
];

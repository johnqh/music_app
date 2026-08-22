/**
 * Global keyboard shortcuts for the score editor (spec §7's shortcut
 * table, implemented exactly):
 *
 * ```
 * Space: play/pause. Escape: clear selection. Delete: delete selected notes.
 * Ctrl/Cmd+Z: undo. Ctrl/Cmd+Shift+Z: redo. Ctrl/Cmd+C: copy. Ctrl/Cmd+X: cut. Ctrl/Cmd+V: paste.
 * ArrowUp/ArrowDown: move pitch up/down (semitone). Shift+Up/Shift+Down: move pitch up/down one octave.
 * ArrowLeft/ArrowRight: move selection backward/forward.
 * Ctrl/Cmd+A: select every note.
 *
 * Note entry, none of it modified so a browser or OS shortcut is never
 * mistaken for a note:
 * A-G: write that pitch at the caret, in the octave nearest the note before it.
 * 1-6: choose the note value. `.`: dot it. R: insert a rest. T: tie. S: slur.
 * N: note input on/off — while on, a click on a stave writes a note there.
 * ```
 *
 * Attaches one `keydown` listener on `window` for the component's
 * lifetime. Per spec §27 (accessibility) / the Task 12 brief, every
 * shortcut is skipped while focus is inside an input/textarea/select,
 * anything `contentEditable`, or an open dialog (`[role="dialog"]`) — see
 * `isEditableTarget` — so typing in a text field (e.g. the generation
 * prompt, a rename dialog) never triggers a score edit.
 *
 * `Space`'s play/pause is a plain `state`/`setPlaybackState` toggle here;
 * there is no Tone.js engine yet (Task 13 owns wiring actual audio to
 * this state).
 */
import { useEffect } from 'react';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import {
  caretToBarEdge,
  caretToScoreEdge,
  deleteSelected,
  insertNoteAtCaret,
  insertRestAtSelection,
  moveSelectionHorizontal,
  selectAll,
  stepCaret,
  toggleSlur,
  toggleTie,
  transposeOctave,
  transposeSemitone,
  toggleArpeggiate,
  toggleFermata,
  toggleGlissando,
  toggleHairpin,
  toggleOttava,
} from '@/features/score-editor/editing';
import {
  durationForDigit,
  isPitchLetter,
  pitchForLetter,
} from '@/features/score-editor/note-entry';
import { withModifier } from '@/features/score-editor/duration-modifiers';
import { playbackController } from '@sudobility/music_lib';
import type { ClipboardPrompts } from '@/features/score-editor/useClipboardPrompts';
import type { PlaybackController } from '@sudobility/music_lib';

/** The slice of `PlaybackController` this hook needs — real-time play/pause, not a score edit (see `controller.ts`'s doc comment). */
export type PlaybackToggle = Pick<PlaybackController, 'togglePlay'>;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest('[role="dialog"]')) return true;
  return false;
}

function isModified(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

/**
 * Attaches the spec §7 keyboard shortcut table to `window` for as long as
 * the calling component is mounted. `controller` defaults to the app-wide
 * `playbackController` singleton (DI-safe wiring: tests inject a fake so
 * importing this hook never eagerly constructs a real Tone.js engine).
 */
export function useEditorShortcuts(
  store: EditorStoreApi,
  controller: PlaybackToggle = playbackController,
  /**
   * Cut/paste prompts. Optional so a test — or a host that renders the editor
   * without dialogs — still gets working shortcuts, falling back to the store
   * actions' own defaults.
   */
  clipboard?: ClipboardPrompts,
): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) return;

      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        controller.togglePlay();
        return;
      }

      if (event.key === 'Escape') {
        store.getState().clearSelection();
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        deleteSelected(store);
        return;
      }

      if (isModified(event) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.getState().redo();
        else store.getState().undo();
        return;
      }

      if (isModified(event) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        store.getState().copySelection();
        return;
      }

      if (isModified(event) && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        // Routed through the prompt hook, not straight to the store: cutting
        // has two possible outcomes and the shortcut must offer the same
        // choice the toolbar button does.
        if (clipboard) clipboard.requestCut();
        else store.getState().cutSelection();
        return;
      }

      if (isModified(event) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (clipboard) clipboard.requestPaste();
        else store.getState().paste();
        return;
      }

      if (isModified(event) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll(store);
        return;
      }

      // ---- caret navigation.
      //
      // Alt rather than a bare arrow: the arrows already move the selection and
      // transpose it, and note entry needs the caret moved without disturbing
      // either. Stepping by the toolbar's current note value is the grid the
      // writer is already thinking in.
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        stepCaret(store, event.key === 'ArrowLeft' ? 'prev' : 'next');
        return;
      }

      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const edge = event.key === 'Home' ? 'start' : 'end';
        if (isModified(event)) caretToScoreEdge(store, edge);
        else caretToBarEdge(store, edge);
        return;
      }

      /*
        Marks on the selection, on Shift.

        Shift is the only modifier left: the bare letters are note entry (A-G),
        the digits are note values, and `isModified` reserves Cmd/Ctrl for the
        browser. It also has to be handled *here*, above the entry block —
        `Shift+G` arrives as `"G"`, which `pitchForLetter` would otherwise
        happily write as a note.

        `<` and `>` for the hairpins are the wedge symbols themselves, which is
        the one pair of these nobody has to memorise.
      */
      if (event.shiftKey && !isModified(event) && !event.altKey) {
        const shifted: Record<string, () => void> = {
          F: () => toggleFermata(store),
          A: () => toggleArpeggiate(store),
          G: () => toggleGlissando(store),
          O: () => toggleOttava(store, '8va'),
          '<': () => toggleHairpin(store, 'crescendo'),
          '>': () => toggleHairpin(store, 'diminuendo'),
        };
        const action = shifted[event.key];
        if (action) {
          event.preventDefault();
          action();
          return;
        }
      }

      // Everything below is note entry, and none of it takes a modifier — so a
      // browser or OS shortcut passing through is never mistaken for a note.
      if (isModified(event) || event.altKey) return;

      // Digits pick the note value, preserving the dot or triplet already on.
      const digitDuration = durationForDigit(event.key, store.getState().snapGrid);
      if (digitDuration) {
        event.preventDefault();
        store.getState().setSnapGrid(digitDuration);
        return;
      }

      // Letters write that pitch at the caret, in the octave nearest the note
      // before it, and step the caret past what was written.
      if (isPitchLetter(event.key)) {
        event.preventDefault();
        insertNoteAtCaret(store, pitchForLetter(store, event.key), { advanceCaret: true });
        return;
      }

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        store.getState().setNoteInput(!store.getState().noteInput);
        return;
      }

      if (event.key === '.') {
        event.preventDefault();
        store.getState().setSnapGrid(withModifier(store.getState().snapGrid, 'dotted'));
        return;
      }

      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        insertRestAtSelection(store);
        return;
      }

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        toggleSlur(store);
        return;
      }

      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        toggleTie(store, 'tieStart');
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (event.shiftKey) transposeOctave(store, 1);
        else transposeSemitone(store, 1);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (event.shiftKey) transposeOctave(store, -1);
        else transposeSemitone(store, -1);
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveSelectionHorizontal(store, 'prev');
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveSelectionHorizontal(store, 'next');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store, controller, clipboard]);
}

/**
 * Global keyboard shortcuts for the score editor (spec §7's shortcut
 * table, implemented exactly):
 *
 * ```
 * Space: play/pause. Escape: clear selection. Delete: delete selected notes.
 * Ctrl/Cmd+Z: undo. Ctrl/Cmd+Shift+Z: redo. Ctrl/Cmd+C: copy. Ctrl/Cmd+X: cut. Ctrl/Cmd+V: paste.
 * ArrowUp/ArrowDown: move pitch up/down (semitone). Shift+Up/Shift+Down: move pitch up/down one octave.
 * ArrowLeft/ArrowRight: move selection backward/forward.
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
  deleteSelected,
  moveSelectionHorizontal,
  transposeOctave,
  transposeSemitone,
} from '@/features/score-editor/editing';

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

/** Attaches the spec §7 keyboard shortcut table to `window` for as long as the calling component is mounted. */
export function useEditorShortcuts(store: EditorStoreApi): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) return;

      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        const state = store.getState();
        state.setPlaybackState(state.state === 'playing' ? 'paused' : 'playing');
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
        store.getState().cutSelection();
        return;
      }

      if (isModified(event) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        store.getState().paste();
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
  }, [store]);
}

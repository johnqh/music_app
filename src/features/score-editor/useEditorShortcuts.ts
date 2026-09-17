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
import type { ClipboardPrompts } from '@sudobility/music_editing';
import type { EditorStoreApi, PlaybackAdapter } from '@/app-library';
import { playbackController, runEditorShortcut } from '@/app-library';

/** The slice of `PlaybackAdapter` this hook needs — real-time play/pause, not a score edit (see `controller.ts`'s doc comment). */
export type PlaybackToggle = Pick<PlaybackAdapter, 'togglePlay'>;

/**
 * Where a keypress is the platform's business rather than the editor's.
 *
 * Per spec section 27, every shortcut is skipped while focus is inside an
 * input, a textarea, a select, anything `contentEditable`, or an open dialog —
 * so typing a generation prompt or a rename never triggers a score edit. This
 * is the DOM's own question, which is why it stays here.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest('[role="dialog"]')) return true;
  return false;
}

/**
 * Attaches the editor's key bindings to `window` for as long as the calling
 * component is mounted.
 *
 * The bindings themselves are `runEditorShortcut` in music_lib, so a desktop
 * build transposes with the same arrows and writes notes with the same letters
 * rather than reproducing the table. What is left here is the parts that are
 * genuinely the browser's: the listener, the focused-field guard, mapping
 * Cmd/Ctrl onto one `mod` flag, and swallowing the key when the editor claims
 * it.
 *
 * `controller` defaults to the app-wide `playbackController` singleton
 * (DI-safe wiring: tests inject a fake so importing this hook never eagerly
 * constructs a real audio engine).
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

      const handled = runEditorShortcut(
        store,
        {
          // `code` as well as `key`: a space arrives as `' '` everywhere that
          // matters, but not on every layout.
          key: event.code === 'Space' ? ' ' : event.key,
          shift: event.shiftKey,
          alt: event.altKey,
          // Cmd on macOS, Ctrl elsewhere — one flag, decided here because only
          // the host knows which platform it is.
          mod: event.metaKey || event.ctrlKey,
        },
        {
          togglePlay: () => controller.togglePlay(),
          ...(clipboard
            ? {
                requestCut: clipboard.requestCut,
                requestPaste: clipboard.requestPaste,
              }
            : {}),
        },
      );

      if (handled) event.preventDefault();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store, controller, clipboard]);
}

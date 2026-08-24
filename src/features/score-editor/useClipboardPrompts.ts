/**
 * Cut and paste, with the question each one has to ask.
 *
 * The store actions themselves take an answer (`cutSelection({ closeGap })`,
 * `paste(tick, { scope })`) and do not ask anything — deciding is the UI's job,
 * and keeping it out of the store is what lets the keyboard shortcut, the
 * toolbar button and a future drag all share one rule.
 *
 * The rule, following the export dialog's precedent: **ask only when the
 * answers differ**. `clipboard-prompts.ts` owns that test.
 */
import { useCallback, useState } from 'react';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent } from '@sudobility/music_types';
import { findEvent, selectActiveTrackId } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';
import {
  clipboardSpan,
  cutNeedsPrompt,
  pasteNeedsPrompt,
} from '@/features/score-editor/clipboard-prompts';

export type CutChoice = 'silence' | 'close';
export type PasteChoice = 'replace' | 'insert';

export type ClipboardPrompts = {
  /** Cuts, asking first if closing the gap would differ from leaving silence. */
  requestCut: () => void;
  /** Pastes, asking first if the target span already holds something. */
  requestPaste: () => void;
  /** Non-null while the cut question is on screen. */
  pendingCut: boolean;
  /** Non-null while the paste question is on screen. */
  pendingPaste: boolean;
  resolveCut: (choice: CutChoice) => void;
  resolvePaste: (choice: PasteChoice) => void;
  cancel: () => void;
};

export function useClipboardPrompts(store: EditorStoreApi): ClipboardPrompts {
  const [pendingCut, setPendingCut] = useState(false);
  const [pendingPaste, setPendingPaste] = useState(false);

  const requestCut = useCallback(() => {
    const state = store.getState();
    if (!state.score) return;

    const notes = state.selection.eventIds
      .map((id) => findEvent(state.score!, id))
      .filter((event): event is NoteEvent => event !== null && isNoteEvent(event));
    if (notes.length === 0) return;

    if (cutNeedsPrompt(state.score, notes)) setPendingCut(true);
    else state.cutSelection();
  }, [store]);

  const requestPaste = useCallback(() => {
    const state = store.getState();
    const clipboard = state.clipboard;
    if (!state.score || !clipboard || clipboard.events.length === 0) return;

    const trackId = selectActiveTrackId(state);
    const anchorTick = clipboard.anchorTick;
    const span = clipboardSpan(clipboard.events);

    if (trackId && pasteNeedsPrompt(state.score, trackId, anchorTick, span)) setPendingPaste(true);
    else state.paste();
  }, [store]);

  const resolveCut = useCallback(
    (choice: CutChoice) => {
      setPendingCut(false);
      store.getState().cutSelection({ closeGap: choice === 'close' });
    },
    [store],
  );

  const resolvePaste = useCallback(
    (choice: PasteChoice) => {
      setPendingPaste(false);
      store.getState().paste(undefined, { scope: choice });
    },
    [store],
  );

  const cancel = useCallback(() => {
    setPendingCut(false);
    setPendingPaste(false);
  }, []);

  return {
    requestCut,
    requestPaste,
    pendingCut,
    pendingPaste,
    resolveCut,
    resolvePaste,
    cancel,
  };
}

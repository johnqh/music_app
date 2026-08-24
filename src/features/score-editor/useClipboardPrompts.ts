/**
 * Cut and paste, with the question each one has to ask.
 *
 * The store actions themselves take an answer (`cutSelection({ closeGap })`,
 * `paste(tick, { scope })`) and do not ask anything — deciding is the UI's job,
 * and keeping it out of the store is what lets the keyboard shortcut, the
 * toolbar button and a future drag all share one rule.
 *
 * The rule, following the export dialog's precedent: **ask only when the
 * answers differ**. music_lib owns that test; this hook only opens dialogs.
 */
import { useCallback, useState } from 'react';
import type { EditorStoreApi } from '@sudobility/music_lib';
import { cutWouldPrompt, pasteWouldPrompt } from '@sudobility/music_lib';

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
    if (cutWouldPrompt(store)) setPendingCut(true);
    else store.getState().cutSelection();
  }, [store]);

  const requestPaste = useCallback(() => {
    if (pasteWouldPrompt(store)) setPendingPaste(true);
    else store.getState().paste();
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

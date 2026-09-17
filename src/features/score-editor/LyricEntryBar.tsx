/**
 * Typing words under a melody.
 *
 * A property field per syllable would technically work and nobody would use
 * it: a line of lyrics is one syllable per note, in order, and the only usable
 * way to enter them is to type through the line the way you sing it. So this
 * is a bar rather than a field — it takes over one note at a time, and the
 * keys that move it are the ones that already punctuate a sung line.
 *
 * **Space** ends a word and moves on. **Hyphen** ends a syllable *within* a
 * word and moves on, which is what tells the renderer to draw the hyphen and
 * what MusicXML calls `syllabic`. **Enter** commits and stops. **Escape**
 * abandons the syllable in progress. Shift+Space steps back, because a typo
 * three notes ago should not mean starting the line again.
 *
 * The syllable's own join — begin/middle/end — is derived rather than asked
 * for: a writer knows they are in the middle of "beau-ti-ful", and should not
 * also have to say so.
 *
 * **The rules are music_editing's** (`lyricEntryStep`, `applyLyricStep`), shared
 * with the native entry bar — which used to honour a hyphen only at the end of
 * the text while this one honoured it anywhere, so the same keystroke did two
 * things depending on the app. What stays here is the browser's part: which key
 * is which input, the field, and focus.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@sudobility/components';
import type { NoteEvent } from '@sudobility/music_types';
import type { EditorStoreApi, LyricEntryState, LyricInput } from '@/app-library';
import { applyLyricStep, lyricEntryStep, lyricTextAt } from '@/app-library';

export type LyricEntryBarProps = {
  store: EditorStoreApi;
  /** The notes to walk, in tick order. */
  notes: NoteEvent[];
  /** Where to start — the note the caret was on when entry began. */
  startIndex: number;
  onClose: () => void;
};

export function LyricEntryBar({ store, notes, startIndex, onClose }: LyricEntryBarProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(startIndex);
  const [draft, setDraft] = useState('');
  /**
   * Whether the syllable *before* this one ended in a hyphen. A ref: it is read
   * inside the key handler and changing it must not re-render.
   */
  const continuing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const note = notes[index];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /*
    Show what is already written on the note being edited, so walking back over
    a line shows the words rather than blanks.

    Read from the *store*, not from the `notes` prop: that array is a snapshot
    taken when entry began, and every syllable typed since has gone into the
    score without changing it. Stepping back over a word just written showed an
    empty field until this looked at the live score.
  */
  useEffect(() => {
    const id = notes[index]?.id;
    if (!id) return;
    setDraft(lyricTextAt(store, id));
  }, [index, notes, store]);

  if (!note) return null;

  /** The key as an entry input; null for ordinary typing. Shift steps back over a typo. */
  const inputFor = (event: React.KeyboardEvent<HTMLInputElement>): LyricInput | null => {
    if (event.key === ' ' || event.key === 'Tab') {
      if (event.shiftKey) return 'back';
      return event.key === ' ' ? 'space' : 'tab';
    }
    if (event.key === '-') return 'hyphen';
    if (event.key === 'Enter') return 'enter';
    if (event.key === 'Escape') return 'escape';
    return null;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const input = inputFor(event);
    if (input === null) {
      // Everything else is typing, and must reach the field.
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    // Escape closes entry and goes no further, as it always did here.
    if (input === 'escape') event.stopPropagation();
    const state: LyricEntryState = {
      index,
      count: notes.length,
      continuing: continuing.current,
    };
    const step = lyricEntryStep(state, input, draft);
    applyLyricStep(store, notes, step);
    continuing.current = step.state.continuing;
    if (step.close) {
      onClose();
      return;
    }
    setIndex(step.state.index);
  };

  return (
    <div
      className="flex items-center gap-2 border-t border-border px-2 py-1.5"
      role="group"
      aria-label={t('editor.lyricEntry')}
    >
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('editor.lyricNoteOf', { current: index + 1, total: notes.length })}
      </span>
      <Input
        ref={inputRef}
        value={draft}
        aria-label={t('editor.syllable')}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-8 flex-1 px-2 text-sm"
      />
      <span className="shrink-0 text-xs text-muted-foreground">{t('editor.lyricKeysHint')}</span>
      <Button type="button" variant="ghost" onClick={onClose} className="h-8 shrink-0 px-2 text-xs">
        {t('editor.done')}
      </Button>
    </div>
  );
}

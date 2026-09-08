/**
 * Right-click on the score.
 *
 * **This is now the only place cut, copy, paste and delete live.** They were
 * also toolbar buttons, which meant four controls on a permanently visible bar
 * for actions that only ever apply to something already selected — and which
 * could say nothing about *what* they would act on. A menu opened on the thing
 * itself can: it names the object it is about before it offers to change it.
 *
 * The header is the point of that. "Track" / "Bars" / "Notes" in small grey
 * type above the entries, because Delete means three different edits depending
 * on what is selected, and a menu that offers "Delete" with no subject is a
 * menu you have to test to understand.
 *
 * Hand-rolled rather than taken from a component library, because
 * `@sudobility/components` has no menu primitive and a context menu is a small
 * thing: a positioned list that closes on Escape, on a click elsewhere, and on
 * choosing something. It owns those behaviours itself.
 *
 * Entries follow the selection. An action that would do nothing is disabled
 * rather than hidden, so the menu keeps the same shape and the same reading
 * order every time it opens.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@sudobility/components';
import type { SelectionKind } from '@sudobility/music_lib';

export type ScoreContextMenuAction = 'copy' | 'cut' | 'clear' | 'paste' | 'delete' | 'selectAll';

export type ScoreContextMenuProps = {
  /** Viewport coordinates of the press that opened it. */
  x: number;
  y: number;
  /**
   * What the menu is about, or null when nothing is selected.
   *
   * `music_editing`'s own vocabulary, so the menu and the actions cannot
   * disagree about whether a selection is a track or a run of notes.
   */
  kind: SelectionKind | null;
  /** How many bars or notes, for the header's singular/plural. */
  count: number;
  /** Whether the clipboard holds something of the same kind. */
  canPaste: boolean;
  /** False while the transport plays: content is immutable then. */
  canEdit: boolean;
  onAction: (action: ScoreContextMenuAction) => void;
  onClose: () => void;
};

const MENU_WIDTH = 208;

export function ScoreContextMenu({
  x,
  y,
  kind,
  count,
  canPaste,
  canEdit,
  onAction,
  onClose,
}: ScoreContextMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose]);

  const hasSelection = kind !== null;
  /*
    Clear and Delete are different edits, so they are different entries rather
    than one entry and a question. Clear keeps the container and empties it — a
    cleared bar keeps its number and its repeats, a cleared track keeps its
    instrument. Delete removes the container and everything behind it moves up.
  */
  const items: Array<{ action: ScoreContextMenuAction; label: string; enabled: boolean }> = [
    // Copy only reads, so it survives playback — the same exemption the
    // transport lock makes everywhere else.
    { action: 'copy', label: t('editor.copy'), enabled: hasSelection },
    { action: 'cut', label: t('editor.cut'), enabled: canEdit && hasSelection },
    { action: 'clear', label: t('editor.clear'), enabled: canEdit && hasSelection },
    { action: 'delete', label: t('editor.deleteSelection'), enabled: canEdit && hasSelection },
    { action: 'paste', label: t('editor.paste'), enabled: canEdit && canPaste },
    { action: 'selectAll', label: t('editor.selectAllNotes'), enabled: true },
  ];

  /** "Track", "Bar"/"Bars", "Note"/"Notes" — what every entry below acts on. */
  const subject =
    kind === null
      ? null
      : kind === 'track'
        ? t('editor.subjectTrack')
        : kind === 'measures'
          ? t('editor.subjectBars', { count })
          : t('editor.subjectNotes', { count });

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={t('editor.scoreActions')}
      // Kept inside the viewport: a right-click near the right or bottom edge
      // would otherwise open a menu that runs off screen.
      style={{
        left: Math.min(x, window.innerWidth - MENU_WIDTH - 8),
        top: Math.min(y, window.innerHeight - items.length * 34 - 40),
        width: MENU_WIDTH,
      }}
      className="fixed z-50 rounded-md border border-border bg-background py-1 shadow-lg outline-none"
    >
      {/*
        The subject, before the verbs. Not a heading and not clickable — it says
        what the list is about, which is exactly what "Delete" cannot say on its
        own when it means three different edits.
      */}
      {subject === null ? null : (
        <div className="px-3 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">{subject}</div>
      )}
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          disabled={!item.enabled}
          onClick={() => {
            onAction(item.action);
            onClose();
          }}
          className={cn(
            'block w-full px-3 py-1.5 text-left text-sm',
            'hover:bg-muted disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

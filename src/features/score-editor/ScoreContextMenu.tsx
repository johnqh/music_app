/**
 * Right-click on the score.
 *
 * Nothing here is unreachable without it — every entry is also a toolbar button
 * — but right-clicking a note is where people look for cut, copy and delete,
 * and finding nothing there reads as an unfinished editor.
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

export type ScoreContextMenuAction = 'copy' | 'cut' | 'paste' | 'delete' | 'selectAll';

export type ScoreContextMenuProps = {
  /** Viewport coordinates of the press that opened it. */
  x: number;
  y: number;
  hasSelection: boolean;
  hasClipboard: boolean;
  /** False while the transport plays: content is immutable then. */
  canEdit: boolean;
  onAction: (action: ScoreContextMenuAction) => void;
  onClose: () => void;
};

const MENU_WIDTH = 208;

export function ScoreContextMenu({
  x,
  y,
  hasSelection,
  hasClipboard,
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

  const items: Array<{ action: ScoreContextMenuAction; label: string; enabled: boolean }> = [
    { action: 'copy', label: t('editor.copy'), enabled: hasSelection },
    { action: 'cut', label: t('editor.cut'), enabled: canEdit && hasSelection },
    { action: 'paste', label: t('editor.paste'), enabled: canEdit && hasClipboard },
    { action: 'delete', label: t('editor.deleteSelection'), enabled: canEdit && hasSelection },
    { action: 'selectAll', label: t('editor.selectAllNotes'), enabled: true },
  ];

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
        top: Math.min(y, window.innerHeight - items.length * 34 - 16),
        width: MENU_WIDTH,
      }}
      className="fixed z-50 rounded-md border border-border bg-background py-1 shadow-lg outline-none"
    >
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

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
 * What it shows is music_editing's `scoreContextMenuModel`: the entries, their
 * order, which are enabled and the subject header. The native app's long-press
 * sheet draws the same model, so the two cannot come to disagree about what is
 * live during playback or how many bars "4 measure ids" is. This component keeps
 * only what is genuinely the web's — a positioned list that closes on Escape and
 * on a click elsewhere. An action that would do nothing is disabled rather than
 * hidden, so the menu keeps the same shape every time it opens.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import type { ScoreContextAction, ScoreContextMenuModel } from '@/app-library';

export type ScoreContextMenuProps = {
  /** Viewport coordinates of the press that opened it. */
  x: number;
  y: number;
  /** What to show: `scoreContextMenuModel` over the selection as it is now. */
  model: ScoreContextMenuModel;
  onAction: (action: ScoreContextAction) => void;
  onClose: () => void;
};

const MENU_WIDTH = 208;

export function ScoreContextMenu({ x, y, model, onAction, onClose }: ScoreContextMenuProps) {
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

  const { entries, subject } = model;

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={t(model.titleKey)}
      // Kept inside the viewport: a right-click near the right or bottom edge
      // would otherwise open a menu that runs off screen.
      style={{
        left: Math.min(x, window.innerWidth - MENU_WIDTH - 8),
        top: Math.min(y, window.innerHeight - entries.length * 34 - 40),
        width: MENU_WIDTH,
      }}
      className={cn(
        variants.card.default.base(),
        'fixed z-50 rounded-md py-1 shadow-lg outline-none',
      )}
    >
      {/*
        The subject, before the verbs. Not a heading and not clickable — it says
        what the list is about, which is exactly what "Delete" cannot say on its
        own when it means three different edits. Clear and Delete are separate
        entries because they are different edits: Clear keeps the container and
        empties it, Delete removes it and everything behind moves up.
      */}
      {subject === null ? null : (
        <div className="px-3 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">
          {t(subject.key, { count: subject.count })}
        </div>
      )}
      {entries.map((entry) => (
        <button
          key={entry.action}
          type="button"
          role="menuitem"
          disabled={!entry.enabled}
          onClick={() => {
            onAction(entry.action);
            onClose();
          }}
          className={cn(
            // A raw menu item, not the library Button: its variants carry a
            // 44px minimum and the theme's upper-case tracking, neither of
            // which belongs in a menu row.
            'block w-full px-3 py-1.5 text-left text-sm',
            'hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          {t(entry.labelKey)}
        </button>
      ))}
    </div>
  );
}

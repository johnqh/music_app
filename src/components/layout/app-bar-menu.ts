/**
 * The app bar's buttons and its drop-down menus.
 *
 * `useMenu` is the shared behaviour behind every menu in the bar: open state, a
 * ref for the panel, and the outside-click listener that closes it. It is one
 * hook rather than one per menu because the listener is the fiddly part — it
 * has to be attached only while open, and removed on the way out.
 *
 * The classes are here for the reason the toolbar's are: a button sizes itself
 * from its own content, so a row of them comes out ragged unless the height is
 * stated once.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import { ICON_CONTROL_CLASS, TEXT_CONTROL_CLASS } from '@/components/icons/notation-icons';

export const ICON_BUTTON_CLASS = cn(
  ICON_CONTROL_CLASS,
  'rounded-md text-inherit hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40',
);

export const TEXT_BUTTON_CLASS = cn(
  TEXT_CONTROL_CLASS,
  'rounded-md px-3 font-medium text-inherit hover:bg-white/10',
);

export const MENU_CLASS = cn(
  variants.card.default.base(),
  'absolute top-full z-10 mt-1 min-w-[160px] rounded-md py-1 text-left shadow-lg',
);

// No longer prefixed with `variants.button.ghost.default()`: every menu-item
// button below is now the library `Button` with `variant="ghost"`, which
// already supplies those base classes -- this is just the popover-specific
// layout override.
export const MENU_ITEM_CLASS =
  'block w-full justify-start rounded-none whitespace-nowrap px-3 py-1.5 text-left';

/** Open/close + outside-pointerdown-close state for one `role="menu"` popover, factored out since this file owns four of them (Import/Export/Theme/Settings) -- same behavior as `EditorToolbar`'s single articulation menu, just reusable. */
export function useMenu<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return { open, setOpen, ref };
}

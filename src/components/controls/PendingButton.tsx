/**
 * A button that turns into a spinner while the work it started is running.
 *
 * The rule (see CLAUDE.md): a CTA that starts something the reader has to wait
 * for shows that it is waiting, on itself, and cannot be pressed a second time
 * meanwhile. The library `Button` has no loading state of its own, and
 * `ActionButton`'s spinner draws in the primary colour — invisible on a primary
 * button — and carries a nested `role="status"` that becomes part of the
 * button's accessible name. So the spinner here is a ring in `currentColor`,
 * which reads on every variant in both themes, and is hidden from assistive
 * technology: the button says it is busy through `aria-busy`, and its name
 * becomes `pendingLabel` when one is given.
 *
 * `pendingLabel` omitted is for icon buttons: the glyph is replaced by the
 * spinner alone and the `aria-label` stays as it was.
 */
import { forwardRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Button, cn } from '@sudobility/components';
import type { ButtonProps } from '@sudobility/components';

/** The ring itself, for raw `<button>`s that cannot be a `PendingButton`. */
export function ButtonSpinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="button-spinner"
      className={cn(
        'inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

export type PendingButtonProps = ButtonProps & {
  /** True while the work this button started is running. */
  pending?: boolean;
  /** What the button says while pending, e.g. "Saving…". Omit for an icon button. */
  pendingLabel?: ReactNode;
};

export const PendingButton = forwardRef<HTMLButtonElement, PendingButtonProps>(
  function PendingButton(
    { pending = false, pendingLabel, disabled, onClick, children, ...rest },
    ref,
  ) {
    return (
      <Button
        ref={ref}
        {...rest}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        // Disabled already refuses a click; this also refuses one dispatched
        // in the same tick as the first, before the re-render lands.
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (pending) return;
          onClick?.(event);
        }}
      >
        {pending ? (
          pendingLabel === undefined ? (
            <ButtonSpinner />
          ) : (
            <span className="inline-flex items-center gap-2">
              <ButtonSpinner />
              {pendingLabel}
            </span>
          )
        ) : (
          children
        )}
      </Button>
    );
  },
);

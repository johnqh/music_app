/**
 * What the editor route shows while the project in the URL is being fetched.
 *
 * Shown INSTEAD of the editor, not over it. Opening used to happen on the
 * dashboard — a click awaited the whole project, score JSON and the parse of
 * it, and only then navigated — so the wait was spent on a screen with nothing
 * on it to say so. Moving the fetch to the editor fixed that and introduced a
 * worse one: the editor still held the PREVIOUS project, so clicking a project
 * showed another one's music and, in the app bar, another one's name, for as
 * long as the fetch took.
 *
 * An overlay is the wrong shape for that. It covers the sheet and leaves the
 * title, the transport and the inspector mounted over stale data, any of which
 * can be read or leak past the cover. Rendering this instead means there is no
 * stale editor to leak: `AppLayout` mounts when the store holds the project the
 * URL asked for, and not before.
 *
 * Deliberately thinner than `GeneratingOverlay`: that one guards an edit that
 * would be rejected server-side, while this is a network round trip that is
 * usually brief, so it says what is happening and offers nothing to press.
 */
import { Spinner } from '@sudobility/components';
import { useTranslation } from 'react-i18next';

export function ProjectLoading() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="project-loading"
      // The whole screen: this replaces the editor rather than covering it, so
      // there is no offset parent to inset against.
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-theme-surface"
      role="status"
      aria-live="polite"
    >
      {/* Decorative: `Spinner` carries its own role="status", and two nested
          live regions announce twice. The text below says it better. */}
      <div aria-hidden="true">
        <Spinner ariaLabel={t('overlay.openingProject')} size="large" />
      </div>
      <p className="text-sm font-medium text-theme-text-primary">{t('overlay.openingProject')}</p>
    </div>
  );
}

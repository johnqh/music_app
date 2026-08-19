/**
 * A `Link` that prefixes the current language, from the shared library.
 *
 * Wraps the shared component with this app's language configuration, the way
 * `sudojo_app` does. Use it for any in-app destination: writing the prefix by
 * hand is how `/en/credits` ended up hardcoded in two places, sending a reader
 * of any other language back to English.
 */
import { LocalizedLink as SharedLocalizedLink } from '@sudobility/components';
import type { LocalizedLinkProps as SharedLocalizedLinkProps } from '@sudobility/components';
import { isLanguageSupported } from '@/i18n';

type LocalizedLinkProps = Omit<SharedLocalizedLinkProps, 'isLanguageSupported' | 'defaultLanguage'>;

export function LocalizedLink(props: LocalizedLinkProps) {
  return (
    <SharedLocalizedLink
      {...props}
      isLanguageSupported={isLanguageSupported}
      defaultLanguage="en"
    />
  );
}

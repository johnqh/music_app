/**
 * The two footers, chosen by page.
 *
 * `sudojo_app` and `shapeshyft_app` both build a full footer for the home page
 * — grouped link columns under the logo — and a one-line compact footer
 * everywhere else. This app had only the compact one, and passed it through a
 * ternary whose branches were identical (`isHomePage ? footer : footer`), so
 * the full footer never rendered anywhere.
 *
 * Links are language-prefixed, because every route in this app is.
 */
import { useTranslation } from 'react-i18next';
import type { FooterConfig } from '@sudobility/building_blocks';
import { CONSTANTS } from '@/config/constants';
import { LinkWrapper } from '@/components/layout/LinkWrapper';
import { useCurrentLanguage } from '@/hooks/useLocalizedNavigate';

const COPYRIGHT_YEAR = '2026';

export function useFooterConfig(variant: 'full' | 'compact'): FooterConfig {
  const { t } = useTranslation();
  const lang = useCurrentLanguage();

  if (variant === 'compact') {
    return {
      variant: 'compact',
      companyName: CONSTANTS.COMPANY_NAME,
      copyrightYear: COPYRIGHT_YEAR,
      rightsText: t('footer.rights'),
      // As the top bar does, and as `sudojo_app` does in both variants:
      // without it the library renders plain anchors and every footer link
      // reloads the whole app instead of navigating.
      LinkComponent: LinkWrapper,
    };
  }

  return {
    variant: 'full',
    logo: { src: '/logo-96.png', appName: CONSTANTS.APP_NAME },
    companyName: CONSTANTS.COMPANY_NAME,
    copyrightYear: COPYRIGHT_YEAR,
    rightsText: t('footer.rights'),
    description: t('footer.tagline'),
    LinkComponent: LinkWrapper,
    // Grouped the way a visitor arrives at them: make something, see what
    // others made, find material to bring in, then the app's own settings.
    linkSections: [
      {
        title: t('footer.create'),
        links: [{ label: t('nav.projects'), href: `/${lang}/projects` }],
      },
      {
        title: t('nav.community'),
        links: [{ label: t('footer.browseShared'), href: `/${lang}/community` }],
      },
      {
        title: t('nav.resources'),
        links: [{ label: t('footer.findMusic'), href: `/${lang}/resources` }],
      },
      {
        title: t('footer.account'),
        links: [
          { label: t('nav.settings'), href: `/${lang}/settings` },
          { label: t('nav.credits'), href: `/${lang}/credits` },
        ],
      },
    ],
  };
}

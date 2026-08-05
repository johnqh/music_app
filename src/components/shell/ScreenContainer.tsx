/**
 * Route-level page shell (APP.md): AppPageLayout from
 * @sudobility/building_blocks provides the top bar, content area, and
 * footer; PageConfigProvider lets pages override layout via
 * useSetPageConfig. Mounted once as a layout route — never per page.
 *
 * Adopts the library `Button` (library sweep 2) for the sign-out control
 * rendered into `AppPageLayout`'s top bar.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppPageLayout } from '@sudobility/building_blocks';
import type { AppPageProps, FooterConfig, TopBarConfig } from '@sudobility/building_blocks';
import { Button } from '@sudobility/components';
import { PageConfigContext } from '@/context/pageConfigContextDef';
import { usePageConfig } from '@/hooks/usePageConfig';
import { useAuth } from '@/app/AuthContext';
import { CONSTANTS } from '@/config/constants';
import { useCurrentLanguage, useSwitchLanguage } from '@/hooks/useLocalizedNavigate';
import { LANGUAGE_OPTIONS } from '@/config/languages';
import { isLanguageSupported } from '@/i18n';

function ScreenContainerInner({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const lang = useCurrentLanguage();
  const switchLanguage = useSwitchLanguage();
  const { user, signOut } = useAuth();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const isHomePage = pathParts.length <= 1;

  const topBar = useMemo<TopBarConfig>(
    () => ({
      variant: 'base',
      topBarVariant: 'app',
      logo: {
        src: '/favicon.svg',
        alt: CONSTANTS.APP_NAME,
        appName: CONSTANTS.APP_NAME,
        onClick: () => navigate(`/${lang}`),
      },
      menuItems: [
        { id: 'projects', label: t('nav.dashboard'), href: `/${lang}/projects` },
        { id: 'settings', label: t('nav.settings'), href: `/${lang}/settings` },
      ],
      // The top bar has a language selector built in; it was hidden only while
      // English was the sole locale. Its own default list is 16 languages, so
      // it must be given this app's — offering a language with no bundle behind
      // it leaves every string rendering as its raw key.
      languages: LANGUAGE_OPTIONS,
      currentLanguage: lang,
      onLanguageChange: (code: string) => {
        if (isLanguageSupported(code)) switchLanguage(code);
      },
      LinkComponent: Link as never,
      sticky: true,
      ariaLabel: 'Main navigation',
      renderAccountSection: () =>
        user ? (
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5"
            aria-label={t('nav.signOut')}
            onClick={() => void signOut()}
          >
            {t('nav.signOut')}
          </Button>
        ) : null,
    }),
    [t, navigate, lang, switchLanguage, user, signOut],
  );

  const footer = useMemo<FooterConfig>(
    () => ({
      variant: 'compact',
      companyName: CONSTANTS.COMPANY_NAME,
      copyrightYear: '2026',
      rightsText: 'All rights reserved',
    }),
    [],
  );

  const pageConfigOverrides = usePageConfig();
  const page: AppPageProps = {
    // `layoutMode`, not just `maxWidth`: the mode goes into building_blocks'
    // LayoutProvider, which is what the topbar, breadcrumbs and footer read for
    // their own width. Widening only the content area is what left the logo
    // indented 176px while the page's cards started at 32px.
    layoutMode: 'full',
    maxWidth: 'full',
    contentPadding: 'none',
    contentClassName: 'w-full min-w-0',
    ...pageConfigOverrides,
  };

  return (
    <AppPageLayout topBar={topBar} footer={isHomePage ? footer : footer} page={page}>
      {children}
    </AppPageLayout>
  );
}

export function ScreenContainer({ children }: { children: ReactNode }) {
  const [pageConfig, setPageConfig] = useState<Partial<AppPageProps>>({});
  return (
    <PageConfigContext.Provider value={{ pageConfig, setPageConfig }}>
      <ScreenContainerInner>{children}</ScreenContainerInner>
    </PageConfigContext.Provider>
  );
}

/**
 * Route-level page shell (APP.md): AppPageLayout from
 * @sudobility/building_blocks provides the top bar, content area, and
 * footer; PageConfigProvider lets pages override layout via
 * useSetPageConfig. Mounted once as a layout route — never per page.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppPageLayout } from '@sudobility/building_blocks';
import type { AppPageProps, FooterConfig, TopBarConfig } from '@sudobility/building_blocks';
import { cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import { PageConfigContext } from '@/context/pageConfigContextDef';
import { usePageConfig } from '@/hooks/usePageConfig';
import { useAuth } from '@/app/AuthContext';
import { CONSTANTS } from '@/config/constants';
import { useCurrentLanguage } from '@/hooks/useLocalizedNavigate';

function ScreenContainerInner({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const lang = useCurrentLanguage();
  const { user, signOut } = useAuth();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const isHomePage = pathParts.length <= 1;

  const topBar = useMemo<TopBarConfig>(
    () => ({
      variant: 'base',
      topBarVariant: 'app',
      logo: { src: '/favicon.svg', alt: CONSTANTS.APP_NAME, appName: CONSTANTS.APP_NAME, onClick: () => navigate(`/${lang}`) },
      menuItems: [
        { id: 'projects', label: t('nav.dashboard'), href: `/${lang}/projects` },
        { id: 'settings', label: t('nav.settings'), href: `/${lang}/settings` },
      ],
      hideLanguageSelector: true,
      LinkComponent: Link as never,
      sticky: true,
      ariaLabel: 'Main navigation',
      renderAccountSection: () =>
        user ? (
          <button
            type="button"
            className={cn(variants.button.ghost.default(), 'px-3 py-1.5')}
            aria-label={t('nav.signOut')}
            onClick={() => void signOut()}
          >
            {t('nav.signOut')}
          </button>
        ) : null,
    }),
    [t, navigate, lang, user, signOut]
  );

  const footer = useMemo<FooterConfig>(
    () => ({
      variant: 'compact',
      companyName: CONSTANTS.COMPANY_NAME,
      copyrightYear: '2026',
      rightsText: 'All rights reserved',
    }),
    []
  );

  const pageConfigOverrides = usePageConfig();
  const page: AppPageProps = {
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

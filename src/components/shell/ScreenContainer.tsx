/**
 * Route-level page shell (APP.md): `AppPageLayout` from
 * `@sudobility/building_blocks` provides the top bar, content area and footer;
 * `PageConfigProvider` lets pages override layout via `useSetPageConfig`.
 * Mounted once as a layout route — never per page.
 *
 * The bar and the footer are both configuration, built by `useTopBarConfig`
 * and `useFooterConfig`, so this file is only the arrangement — the shape
 * `sudojo_app` uses.
 */
import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppPageLayout } from '@sudobility/building_blocks';
import type { AppPageProps } from '@sudobility/building_blocks';
import { PageConfigContext } from '@/context/pageConfigContextDef';
import { usePageConfig } from '@/hooks/usePageConfig';
import { useFooterConfig } from '@/hooks/useFooterConfig';
import { useTopBarConfig } from '@/hooks/useTopBarConfig';

function ScreenContainerInner({ children }: { children: ReactNode }) {
  const location = useLocation();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const isHomePage = pathParts.length <= 1;

  const topBar = useTopBarConfig();

  // Full on the home page, compact everywhere else — the split both reference
  // apps make.
  const footer = useFooterConfig(isHomePage ? 'full' : 'compact');

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
    <AppPageLayout topBar={topBar} footer={footer} page={page}>
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

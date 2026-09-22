/**
 * Route-level page shell (APP.md): `AppPageLayout` from
 * `@sudobility/building_blocks` provides the top bar, breadcrumbs, content
 * area and footer; pages override layout via `useSetPageConfig` and declare
 * their own breadcrumb trail via `useSetBreadcrumbs`. Mounted once as a
 * layout route — never per page.
 *
 * The bar and the footer are both configuration, built by `useTopBarConfig`
 * and `useFooterConfig`, so this file is only the arrangement — the shape
 * `sudojo_app` uses. Breadcrumbs are opt-in per page rather than derived from
 * the route (unlike `sudojo_app`'s path-segment `BreadcrumbBuilder`): this
 * app's routes are shallow enough that no page has needed one yet, and a
 * generic per-segment walker would produce a meaningless crumb for a segment
 * like `/p` in `/p/:publicId` that is not itself a page anyone navigates to.
 */
import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppPageLayout } from '@sudobility/building_blocks';
import type { AppPageProps, BreadcrumbItem } from '@sudobility/building_blocks';
import { PageConfigContext } from '@/context/pageConfigContextDef';
import { BreadcrumbContext } from '@/context/breadcrumbContextDef';
import { usePageConfig } from '@/hooks/usePageConfig';
import { useBreadcrumbItems } from '@/hooks/useBreadcrumbs';
import { useFooterConfig } from '@/hooks/useFooterConfig';
import { useTopBarConfig } from '@/hooks/useTopBarConfig';
import { LinkWrapper } from '@/components/layout/LinkWrapper';
import type { LanguagePrefStore } from '@/hooks/useLocalizedNavigate';

type ScreenContainerProps = {
  children: ReactNode;
  /** Where a language switch is remembered; defaults to the app-wide store. */
  store?: LanguagePrefStore;
};

function ScreenContainerInner({ children, store }: ScreenContainerProps) {
  const location = useLocation();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const isHomePage = pathParts.length <= 1;

  const topBar = useTopBarConfig(store);

  // Full on the home page, compact everywhere else — the split both reference
  // apps make.
  const footer = useFooterConfig(isHomePage ? 'full' : 'compact');

  const pageConfigOverrides = usePageConfig();
  const breadcrumbItems = useBreadcrumbItems();
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
    <AppPageLayout
      topBar={topBar}
      breadcrumbs={
        breadcrumbItems ? { items: breadcrumbItems, LinkComponent: LinkWrapper } : undefined
      }
      footer={footer}
      page={page}
    >
      {children}
    </AppPageLayout>
  );
}

export function ScreenContainer({ children, store }: ScreenContainerProps) {
  const [pageConfig, setPageConfig] = useState<Partial<AppPageProps>>({});
  const [breadcrumbItems, setBreadcrumbItems] = useState<BreadcrumbItem[] | null>(null);
  return (
    <PageConfigContext.Provider value={{ pageConfig, setPageConfig }}>
      <BreadcrumbContext.Provider value={{ items: breadcrumbItems, setItems: setBreadcrumbItems }}>
        <ScreenContainerInner store={store}>{children}</ScreenContainerInner>
      </BreadcrumbContext.Provider>
    </PageConfigContext.Provider>
  );
}

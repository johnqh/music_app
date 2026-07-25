/**
 * PageConfig context definition (APP.md): pages override the route-level
 * layout (scrollable/maxWidth/padding) via useSetPageConfig; ScreenContainer
 * merges the overrides into AppPageLayout's `page` prop.
 */
import { createContext } from 'react';
import type { AppPageProps } from '@sudobility/building_blocks';

export interface PageConfigContextValue {
  pageConfig: Partial<AppPageProps>;
  setPageConfig: (config: Partial<AppPageProps>) => void;
}

export const PageConfigContext = createContext<PageConfigContextValue>({
  pageConfig: {},
  setPageConfig: () => {},
});

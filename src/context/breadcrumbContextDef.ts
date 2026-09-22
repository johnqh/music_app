/**
 * Breadcrumb context definition (APP.md): a page declares its own trail via
 * `useSetBreadcrumbs`; `ScreenContainer` reads it back and hands it to
 * `AppPageLayout`'s `breadcrumbs` prop. The same shape `PageConfigContext` is
 * — a page-level override, not a route-derived default — because breadcrumbs
 * are opt-in per page here: `null` (nothing set, the default) means no
 * breadcrumb bar at all, which is every existing page's behaviour today.
 */
import { createContext } from 'react';
import type { BreadcrumbItem } from '@sudobility/building_blocks';

export interface BreadcrumbContextValue {
  items: BreadcrumbItem[] | null;
  setItems: (items: BreadcrumbItem[] | null) => void;
}

export const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  items: null,
  setItems: () => {},
});

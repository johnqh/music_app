/**
 * Page-level breadcrumb override (APP.md). `useSetBreadcrumbs` runs in a
 * layout effect so the trail lands before paint; it resets to `null` on
 * unmount, the same lifecycle `useSetPageConfig` has.
 */
import { useContext, useLayoutEffect } from 'react';
import type { BreadcrumbItem } from '@sudobility/building_blocks';
import { BreadcrumbContext } from '@/context/breadcrumbContextDef';

export function useSetBreadcrumbs(items: BreadcrumbItem[] | null): void {
  const { setItems } = useContext(BreadcrumbContext);
  const itemsKey = items ? JSON.stringify(items) : null;
  useLayoutEffect(() => {
    setItems(items);
    return () => setItems(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, setItems]);
}

export function useBreadcrumbItems(): BreadcrumbItem[] | null {
  return useContext(BreadcrumbContext).items;
}

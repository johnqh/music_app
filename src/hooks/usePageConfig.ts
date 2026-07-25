/**
 * Page-level layout override hooks (APP.md). `useSetPageConfig` runs in a
 * layout effect so the config lands before paint; it resets on unmount.
 */
import { useContext, useLayoutEffect } from 'react';
import type { AppPageProps } from '@sudobility/building_blocks';
import { PageConfigContext } from '@/context/pageConfigContextDef';

export function useSetPageConfig(config: Partial<AppPageProps>) {
  const { setPageConfig } = useContext(PageConfigContext);
  const configKey = JSON.stringify(config);
  useLayoutEffect(() => {
    setPageConfig(config);
    return () => setPageConfig({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, setPageConfig]);
}

export function usePageConfig(): Partial<AppPageProps> {
  return useContext(PageConfigContext).pageConfig;
}

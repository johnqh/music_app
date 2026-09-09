/**
 * A React Query provider for component tests.
 *
 * `App.tsx` wraps the whole tree in one, so any component that reaches the
 * server through a hook has a client in production — but a test rendering that
 * component in isolation does not, and the failure is a thrown "No QueryClient
 * set" rather than a missing value, which takes the whole render down.
 *
 * Retries off and no cache between tests: a retrying query turns a deliberate
 * failure into a slow deliberate failure, and a cache shared across tests is a
 * test that passes because of what the previous one fetched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export function withQueryClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createAppStore, testStoreContext } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';

// The store's data comes from RevenueCat and the consumables API; neither
// belongs in a test of when the modal is shown.
vi.mock('@sudobility/consumables_client', () => ({
  useBalance: () => ({ balance: 0, isLoading: false, error: null }),
  useConsumableProducts: () => ({ packages: [], isLoading: false, error: null }),
  usePurchaseCredits: () => ({ purchase: vi.fn(), isPurchasing: false, error: null }),
  setConsumablesUserId: vi.fn(),
}));

vi.mock('@/app/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: null, displayName: null } }),
}));

const { PaywallDialog, PAYWALL_DIALOG } = await import('@/features/credits/PaywallDialog');

function makeStore(): EditorStoreApi {
  return createAppStore({ context: testStoreContext() }) as unknown as EditorStoreApi;
}

describe('PaywallDialog', () => {
  it('stays shut until something raises it', () => {
    const store = makeStore();
    render(
      <MemoryRouter>
        <PaywallDialog store={store} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Out of credits')).not.toBeInTheDocument();
  });

  it('opens on the paywall flag and offers to top up', () => {
    // A refused job sets this flag; the modal is how the refusal is reported.
    const store = makeStore();
    render(
      <MemoryRouter>
        <PaywallDialog store={store} />
      </MemoryRouter>,
    );

    act(() => store.getState().openDialog(PAYWALL_DIALOG));

    expect(screen.getByText('Out of credits')).toBeInTheDocument();
    // Says the work survived, because a modal appearing mid-generation reads
    // like something was lost.
    expect(screen.getByText(/nothing you were working on has been lost/i)).toBeInTheDocument();
  });

  it('closes back through the store, so it cannot reopen on the next render', () => {
    const store = makeStore();
    render(
      <MemoryRouter>
        <PaywallDialog store={store} />
      </MemoryRouter>,
    );
    act(() => store.getState().openDialog(PAYWALL_DIALOG));
    act(() => store.getState().closeDialog(PAYWALL_DIALOG));

    expect(screen.queryByText('Out of credits')).not.toBeInTheDocument();
  });
});

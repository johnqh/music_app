import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CreditsPage } from './CreditsPage';

const hooks = {
  useBalance: vi.fn(),
  useConsumableProducts: vi.fn(),
  usePurchaseCredits: vi.fn(),
};

vi.mock('@sudobility/consumables_client', () => ({
  useBalance: () => hooks.useBalance() as unknown,
  useConsumableProducts: () => hooks.useConsumableProducts() as unknown,
  usePurchaseCredits: () => hooks.usePurchaseCredits() as unknown,
}));

vi.mock('@/app/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.c', displayName: null } }),
}));

function setup(balance: number | null) {
  hooks.useBalance.mockReturnValue({ balance, isLoading: false, error: null });
  hooks.useConsumableProducts.mockReturnValue({
    packages: [
      {
        packageId: 'p10',
        productId: 'scoresmith_credits_10',
        title: '1,000 credits',
        description: null,
        credits: 1000,
        price: 10,
        priceString: '$10.00',
        currencyCode: 'USD',
      },
    ],
    isLoading: false,
    error: null,
  });
  hooks.usePurchaseCredits.mockReturnValue({
    purchase: vi.fn(),
    isPurchasing: false,
    error: null,
  });
  return render(
    <MemoryRouter>
      <CreditsPage />
    </MemoryRouter>,
  );
}

describe('CreditsPage', () => {
  it('shows the balance', () => {
    setup(96);
    expect(screen.getByText(/96/)).toBeInTheDocument();
  });

  it('offers the packages on sale, priced', () => {
    setup(96);
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
  });

  it('explains a credit in the unit a musician thinks in', () => {
    // "Track-measure" is the billing unit and means nothing to a musician;
    // "a bar for one instrument" is the same quantity in words they use.
    setup(96);
    // Said twice on purpose: once in the explainer above the store, and again
    // under each package, which is where someone about to pay is looking.
    expect(screen.getAllByText(/one bar for one instrument/i).length).toBeGreaterThan(0);
  });

  it('shows a zero balance rather than hiding it', () => {
    // Being at zero is exactly when the store matters most.
    setup(0);
    expect(screen.getByText(/Your balance/i)).toBeInTheDocument();
  });
});

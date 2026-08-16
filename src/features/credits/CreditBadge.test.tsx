import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CreditBadge } from './CreditBadge';

const useBalance = vi.fn();
vi.mock('@sudobility/consumables_client', () => ({
  useBalance: () => useBalance() as unknown,
}));

function renderBadge() {
  return render(
    <MemoryRouter>
      <CreditBadge />
    </MemoryRouter>,
  );
}

describe('CreditBadge', () => {
  it('shows the balance', () => {
    useBalance.mockReturnValue({ balance: 96, isLoading: false });
    renderBadge();
    expect(screen.getByText(/96/)).toBeInTheDocument();
  });

  it('links to the store, so running low has somewhere to go', () => {
    useBalance.mockReturnValue({ balance: 96, isLoading: false });
    renderBadge();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/credits');
  });

  it('renders nothing until the balance is known', () => {
    // A badge that flashes "0" while loading reads as "you are out of
    // credits", which is a lie and an alarming one.
    useBalance.mockReturnValue({ balance: null, isLoading: true });
    const { container } = renderBadge();
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps showing a known balance while it refetches', () => {
    // A refetch must not flicker the badge out of the bar: the number it
    // already has is still the best answer available.
    useBalance.mockReturnValue({ balance: 96, isLoading: true });
    renderBadge();
    expect(screen.getByText(/96/)).toBeInTheDocument();
  });

  it('renders nothing when there is no balance to show', () => {
    // Signed out, or the balance never loaded.
    useBalance.mockReturnValue({ balance: null, isLoading: false });
    const { container } = renderBadge();
    expect(container).toBeEmptyDOMElement();
  });
});

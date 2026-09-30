/**
 * The dashboard's list: what is on it, in what order, and for whom.
 *
 * The pages behind each entry have tests of their own; they are stood in for
 * here, so that what is pinned is the list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ siteAdmin: false, showEntities: false }));

vi.mock('@/app/AuthContext', () => ({
  useAuth: () => ({ siteAdmin: mocks.siteAdmin }),
}));
vi.mock('@/config/constants', () => ({
  CONSTANTS: {
    get SHOW_ENTITIES() {
      return mocks.showEntities;
    },
  },
}));
vi.mock('@/hooks/usePageConfig', () => ({ useSetPageConfig: () => undefined }));
vi.mock('@sudobility/entity_client', () => ({
  useCurrentEntity: () => ({ currentEntity: null, entities: [], selectEntity: () => undefined }),
}));
vi.mock('@/features/dashboard/AccountPage', () => ({
  AccountPage: () => <p>account page</p>,
}));
vi.mock('@/features/credits/CreditsPage', () => ({
  CreditsPage: () => <p>credits page</p>,
}));
vi.mock('@/features/credits/CreditsHistoryPage', () => ({
  CreditsHistoryPage: () => <p>history page</p>,
}));
vi.mock('@/features/credits/CreditCouponsPage', () => ({
  CreditCouponManagementPage: () => <p>manage coupons page</p>,
}));
vi.mock('@/features/dashboard/EntityApiKeysPage', () => ({
  EntityApiKeysPage: () => <p>api keys page</p>,
}));
vi.mock('@/features/entities/EntitiesPage', () => ({
  EntitiesPage: ({ section }: { section: string }) => <p>{`entities page: ${section}`}</p>,
}));
/*
  The library's layout chooses between a wide and a narrow form by a media
  query jsdom cannot answer, and hides its list from assistive technology
  once a detail is titled. Neither is what is under test, so the two halves
  are drawn plainly.
*/
vi.mock('@sudobility/components', async (original) => ({
  ...(await original<typeof import('@sudobility/components')>()),
  MasterDetailLayout: ({
    masterContent,
    detailContent,
    detailTitle,
  }: {
    masterContent: React.ReactNode;
    detailContent: React.ReactNode;
    detailTitle?: string;
  }) => (
    <div>
      {masterContent}
      <h1>{detailTitle}</h1>
      {detailContent}
    </div>
  ),
  MasterListItem: ({
    label,
    isSelected,
    onClick,
  }: {
    label: string;
    isSelected: boolean;
    onClick: () => void;
  }) => (
    <button type="button" aria-pressed={isSelected} onClick={onClick}>
      {label}
    </button>
  ),
}));

const { UserDashboardPage } = await import('./UserDashboardPage');

function listed(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Dashboard navigation' });
  return within(nav)
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
}

beforeEach(() => {
  mocks.siteAdmin = false;
  mocks.showEntities = false;
});

describe('UserDashboardPage', () => {
  it('lists the account first, then credits, and neither projects nor coupons', () => {
    // Redeeming a coupon is part of Credits; `CreditsPage.test.tsx` holds it.
    render(<UserDashboardPage />);
    expect(listed()).toEqual(['Account', 'Credits', 'Credit history', 'API keys']);
  });

  it('opens on the account', () => {
    render(<UserDashboardPage />);
    expect(screen.getByText('account page')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeTruthy();
  });

  it('offers coupon management to an administrator, after API keys', () => {
    mocks.siteAdmin = true;
    render(<UserDashboardPage />);
    expect(listed()).toEqual([
      'Account',
      'Credits',
      'Credit history',
      'API keys',
      'Manage coupons',
    ]);
  });

  it('puts the workspace entries last, where workspaces are on', () => {
    mocks.siteAdmin = true;
    mocks.showEntities = true;
    render(<UserDashboardPage />);
    expect(listed().slice(-4)).toEqual(['Manage coupons', 'Workspaces', 'Members', 'Invitations']);
  });

  it('shows the page for whichever entry is chosen', async () => {
    const user = userEvent.setup();
    render(<UserDashboardPage />);
    await user.click(screen.getByRole('button', { name: 'Credit history' }));
    expect(screen.getByText('history page')).toBeTruthy();
    expect(screen.queryByText('account page')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'API keys' }));
    expect(screen.getByText('api keys page')).toBeTruthy();
  });
});

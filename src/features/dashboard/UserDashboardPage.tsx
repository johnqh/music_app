/**
 * The signed-in dashboard: the account, and what it holds.
 *
 * Master and detail, in the order somebody comes here for them: who they are
 * (Account), what they have and how to get more (Credits, which holds the
 * store and the coupon form), the history of it, what speaks for them (API
 * keys), and then what only an administrator or a workspace has.
 *
 * **Projects are not here.** They have a screen of their own, in the top bar,
 * and a second list of them under a second heading was the same page twice.
 */
import { useState } from 'react';
import {
  BuildingOffice2Icon,
  WalletIcon,
  UserCircleIcon,
  ClockIcon,
  UsersIcon,
  EnvelopeIcon,
  TagIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';
import {
  MasterListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sudobility/components';
import { useCurrentEntity } from '@sudobility/entity_client';
import { useTranslation } from 'react-i18next';
import { CreditsPage } from '@/features/credits/CreditsPage';
import { CreditsHistoryPage } from '@/features/credits/CreditsHistoryPage';
import { CreditCouponManagementPage } from '@/features/credits/CreditCouponsPage';
import { EntitiesPage } from '@/features/entities/EntitiesPage';
import { CONSTANTS } from '@/config/constants';
import { useAuth } from '@/app/AuthContext';
import { EntityApiKeysPage } from '@/features/dashboard/EntityApiKeysPage';
import { AccountPage } from '@/features/dashboard/AccountPage';
import { MasterDetailPage } from '@/components/layout/MasterDetailPage';

/**
 * The sections, in the order they are listed. An array, so the order is one
 * statement and the type is read off it.
 */
const DASHBOARD_SECTIONS = [
  'account',
  'credits',
  'history',
  'api-keys',
  'manage-coupons',
  'workspaces',
  'members',
  'invitations',
] as const;
type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

/** What only a site administrator is offered. */
const ADMIN_ONLY: readonly DashboardSection[] = ['manage-coupons'];
/** What is offered only where workspaces are switched on. */
const WORKSPACE_ONLY: readonly DashboardSection[] = ['workspaces', 'members', 'invitations'];

/** A record, so a section added to the list fails to compile without its words. */
const SECTION_COPY: Record<
  DashboardSection,
  { label: string; description: string; icon: typeof WalletIcon }
> = {
  account: {
    label: 'dashboard.account',
    description: 'dashboard.accountDesc',
    icon: UserCircleIcon,
  },
  credits: {
    label: 'dashboard.creditPacks',
    description: 'dashboard.creditPacksDesc',
    icon: WalletIcon,
  },
  history: {
    label: 'dashboard.creditHistory',
    description: 'dashboard.creditHistoryDesc',
    icon: ClockIcon,
  },
  'api-keys': {
    label: 'dashboard.apiKeys',
    description: 'dashboard.apiKeysDesc',
    icon: KeyIcon,
  },
  'manage-coupons': {
    label: 'dashboard.manageCoupons',
    description: 'dashboard.manageCouponsDesc',
    icon: TagIcon,
  },
  workspaces: {
    label: 'dashboard.workspaces',
    description: 'dashboard.workspaceDesc',
    icon: BuildingOffice2Icon,
  },
  members: {
    label: 'dashboard.members',
    description: 'dashboard.membersDesc',
    icon: UsersIcon,
  },
  invitations: {
    label: 'dashboard.invitations',
    description: 'dashboard.invitationsDesc',
    icon: EnvelopeIcon,
  },
};

export function UserDashboardPage() {
  const { t } = useTranslation();
  const { siteAdmin } = useAuth();
  const { currentEntity, entities, selectEntity } = useCurrentEntity();
  const [chosen, setChosen] = useState<DashboardSection>('account');
  const [mobileView, setMobileView] = useState<'navigation' | 'content'>('navigation');

  const sections = DASHBOARD_SECTIONS.filter(
    (id) =>
      (siteAdmin || !ADMIN_ONLY.includes(id)) &&
      (CONSTANTS.SHOW_ENTITIES || !WORKSPACE_ONLY.includes(id)),
  );
  // What is shown is what is listed: a section that stopped being offered —
  // the administrator flag arrives after the page does — falls back to the
  // first, rather than the list naming one thing and the pane showing another.
  const section = sections.includes(chosen) ? chosen : sections[0]!;
  const chooseSection = (id: DashboardSection) => {
    setChosen(id);
    setMobileView('content');
  };

  const detailContent =
    section === 'account' ? (
      <AccountPage />
    ) : section === 'credits' ? (
      <CreditsPage />
    ) : section === 'history' ? (
      <CreditsHistoryPage onPurchaseCredits={() => chooseSection('credits')} />
    ) : section === 'manage-coupons' ? (
      <CreditCouponManagementPage />
    ) : section === 'api-keys' ? (
      <EntityApiKeysPage />
    ) : (
      <EntitiesPage section={section} />
    );

  return (
    <MasterDetailPage
      masterTitle={t('nav.dashboard')}
      masterContent={
        <div className="space-y-4 p-3">
          {CONSTANTS.SHOW_ENTITIES && (
            <div>
              <label
                htmlFor="dashboard-workspace"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                {t('dashboard.workspace')}
              </label>
              <Select value={currentEntity?.entitySlug ?? ''} onValueChange={selectEntity}>
                <SelectTrigger id="dashboard-workspace" className="w-full">
                  <SelectValue placeholder={t('dashboard.selectWorkspace')} />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((entity) => (
                    <SelectItem key={entity.entitySlug} value={entity.entitySlug}>
                      {entity.displayName || entity.entitySlug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <nav aria-label={t('dashboard.navigation')} className="space-y-1">
            {sections.map((id) => (
              <MasterListItem
                key={id}
                isSelected={section === id}
                onClick={() => chooseSection(id)}
                icon={SECTION_COPY[id].icon}
                label={t(SECTION_COPY[id].label)}
                description={t(SECTION_COPY[id].description)}
              />
            ))}
          </nav>
        </div>
      }
      detailContent={detailContent}
      detailTitle={t(SECTION_COPY[section].label)}
      mobileView={mobileView}
      onBackToNavigation={() => setMobileView('navigation')}
      contentKey={section}
    />
  );
}

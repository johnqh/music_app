import { useState } from 'react';
import {
  BuildingOffice2Icon,
  TicketIcon,
  WalletIcon,
  MusicalNoteIcon,
  ClockIcon,
  UsersIcon,
  EnvelopeIcon,
  TagIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';
import {
  MasterDetailLayout,
  MasterListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sudobility/components';
import { useCurrentEntity } from '@sudobility/entity_client';
import { useTranslation } from 'react-i18next';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';
import { CreditsPage } from '@/features/credits/CreditsPage';
import { CreditsHistoryPage } from '@/features/credits/CreditsHistoryPage';
import { CreditCouponsPage } from '@/features/credits/CreditCouponsPage';
import { CreditCouponManagementPage } from '@/features/credits/CreditCouponsPage';
import { EntitiesPage } from '@/features/entities/EntitiesPage';
import { DashboardPage as MusicProjectsPage } from '@/features/projects/DashboardPage';
import { useSetPageConfig } from '@/hooks/usePageConfig';
import { CONSTANTS } from '@/config/constants';
import { useAuth } from '@/app/AuthContext';
import { EntityApiKeysPage } from '@/features/dashboard/EntityApiKeysPage';

type DashboardSection =
  | 'projects'
  | 'workspaces'
  | 'members'
  | 'invitations'
  | 'credits'
  | 'history'
  | 'redeem'
  | 'manage-coupons'
  | 'api-keys';

export function UserDashboardPage() {
  useSetPageConfig({
    layoutMode: 'full',
    maxWidth: 'full',
    contentPadding: 'none',
    scrollable: false,
  });
  const { t } = useTranslation();
  const { siteAdmin } = useAuth();
  const navigate = useLocalizedNavigate();
  const { currentEntity, entities, selectEntity } = useCurrentEntity();
  const [section, setSection] = useState<DashboardSection>('projects');
  const [mobileView, setMobileView] = useState<'navigation' | 'content'>('navigation');
  const allSections: {
    id: DashboardSection;
    label: string;
    description: string;
    icon: typeof MusicalNoteIcon;
  }[] = [
    {
      id: 'workspaces',
      label: t('dashboard.workspaces', 'Workspaces'),
      description: t('dashboard.workspaceDesc', 'Switch and manage entities'),
      icon: BuildingOffice2Icon,
    },
    {
      id: 'members',
      label: t('dashboard.members', 'Members'),
      description: t('dashboard.membersDesc', 'Manage workspace members'),
      icon: UsersIcon,
    },
    {
      id: 'invitations',
      label: t('dashboard.invitations', 'Invitations'),
      description: t('dashboard.invitationsDesc', 'Manage and respond to invitations'),
      icon: EnvelopeIcon,
    },
    {
      id: 'projects',
      label: t('dashboard.projects', 'Projects'),
      description: t('dashboard.projectsDesc', 'Browse your music projects'),
      icon: MusicalNoteIcon,
    },
    ...(CONSTANTS.SHOW_ENTITIES
      ? [
          {
            id: 'api-keys' as const,
            label: t('dashboard.apiKeys', 'API keys'),
            description: t('dashboard.apiKeysDesc', 'Manage keys for this workspace'),
            icon: KeyIcon,
          },
        ]
      : []),
    {
      id: 'credits',
      label: t('dashboard.creditPacks', 'Credits'),
      description: t('dashboard.creditPacksDesc', 'Purchase credit packs'),
      icon: WalletIcon,
    },
    {
      id: 'history',
      label: t('dashboard.creditHistory', 'Credit history'),
      description: t('dashboard.creditHistoryDesc', 'Review credit activity'),
      icon: ClockIcon,
    },
    {
      id: 'redeem',
      label: t('dashboard.redeemCoupon', 'Redeem coupon'),
      description: t('dashboard.redeemCouponDesc', 'Add credits with a coupon'),
      icon: TicketIcon,
    },
    ...(siteAdmin
      ? [
          {
            id: 'manage-coupons' as const,
            label: t('dashboard.manageCoupons', 'Manage Coupons'),
            description: t('dashboard.manageCouponsDesc', 'Create coupons and review redemptions'),
            icon: TagIcon,
          },
        ]
      : []),
  ];
  const sections = CONSTANTS.SHOW_ENTITIES
    ? allSections
    : allSections.filter(
        (item) => item.id !== 'workspaces' && item.id !== 'members' && item.id !== 'invitations',
      );
  const selected = sections.find((item) => item.id === section) ?? sections[0];
  const chooseSection = (id: DashboardSection) => {
    setSection(id);
    setMobileView('content');
  };

  const detailContent =
    section === 'projects' ? (
      <MusicProjectsPage onNavigate={navigate} />
    ) : section === 'credits' ? (
      <CreditsPage onRedeemCoupon={() => chooseSection('redeem')} />
    ) : section === 'history' ? (
      <CreditsHistoryPage onPurchaseCredits={() => chooseSection('credits')} />
    ) : section === 'redeem' ? (
      <CreditCouponsPage />
    ) : section === 'manage-coupons' && siteAdmin ? (
      <CreditCouponManagementPage />
    ) : section === 'api-keys' && CONSTANTS.SHOW_ENTITIES ? (
      <EntityApiKeysPage />
    ) : CONSTANTS.SHOW_ENTITIES &&
      (section === 'workspaces' || section === 'members' || section === 'invitations') ? (
      <EntitiesPage section={section} />
    ) : (
      <MusicProjectsPage onNavigate={navigate} />
    );

  return (
    <div className="h-full min-h-0 w-full min-w-0 flex-1">
      <MasterDetailLayout
        masterTitle={t('dashboard.title', 'Your dashboard')}
        backButtonText={t('dashboard.title', 'Dashboard')}
        masterContent={
          <div className="space-y-4 p-3">
            {CONSTANTS.SHOW_ENTITIES && (
              <div>
                <label
                  htmlFor="dashboard-workspace"
                  className="mb-1.5 block text-xs font-medium text-theme-text-secondary"
                >
                  {t('dashboard.workspace', 'Workspace')}
                </label>
                <Select value={currentEntity?.entitySlug ?? ''} onValueChange={selectEntity}>
                  <SelectTrigger id="dashboard-workspace" className="w-full">
                    <SelectValue placeholder={t('dashboard.selectWorkspace', 'Select workspace')} />
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
            <nav
              aria-label={t('dashboard.navigation', 'Dashboard navigation')}
              className="space-y-1"
            >
              {sections.map((item) => (
                <MasterListItem
                  key={item.id}
                  isSelected={section === item.id}
                  onClick={() => chooseSection(item.id)}
                  icon={item.icon}
                  label={item.label}
                  description={item.description}
                />
              ))}
            </nav>
          </div>
        }
        detailContent={<div className="min-h-[400px]">{detailContent}</div>}
        detailTitle={selected.label}
        masterClassName="min-h-0 overflow-y-auto overscroll-contain"
        detailClassName="min-h-0 overflow-y-auto overscroll-contain"
        detailMaxWidth={1024}
        detailPadding
        mobileView={mobileView}
        onBackToNavigation={() => setMobileView('navigation')}
        masterWidth={280}
        stickyTopOffset={80}
        contentKey={section}
      />
    </div>
  );
}

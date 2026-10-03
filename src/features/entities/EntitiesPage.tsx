import {
  EntityListPage,
  InvitationsPage as SharedInvitationsPage,
  MembersManagementPage,
} from '@sudobility/entity_pages';
import { useCurrentEntity } from '@sudobility/entity_client';
import { useAuth } from '@/app/AuthContext';
import { getAppServices } from '@/config/initialize';

/** These are the same entity management pages used in shapeshyft_app. */
export type EntityDashboardSection = 'workspaces' | 'members' | 'invitations';

export function EntitiesPage({ section = 'workspaces' }: { section?: EntityDashboardSection }) {
  const client = getAppServices().entityClient;
  if (!client) return <p className="p-8">Entity services are unavailable.</p>;
  return <EntityPageContent client={client} section={section} />;
}

function EntityPageContent({
  client,
  section,
}: {
  client: NonNullable<ReturnType<typeof getAppServices>['entityClient']>;
  section: EntityDashboardSection;
}) {
  const { currentEntity, isLoading, selectEntity } = useCurrentEntity();
  const { user } = useAuth();

  if (section === 'workspaces') {
    return (
      <EntityListPage
        client={client}
        onSelectEntity={(entity) => selectEntity(entity.entitySlug)}
      />
    );
  }

  if (section === 'invitations') {
    return (
      // Accepting refreshes this user's workspace list by itself
      // (entity_client's useAcceptInvitation).
      <SharedInvitationsPage client={client} />
    );
  }

  if (isLoading || !currentEntity) {
    return <div className="flex items-center justify-center py-12">Loading workspace…</div>;
  }

  if (!user?.uid) return null;

  return <MembersManagementPage client={client} entity={currentEntity} currentUserId={user.uid} />;
}

import { refreshConsumablesBalance } from '@sudobility/consumables_client';
import { ManageCreditCouponsPage, RedeemCreditCouponPage } from '@sudobility/consumables_pages';
import { useCurrentEntity } from '@sudobility/entity_client';
import { useAuth } from '@/app/AuthContext';
import { getAppServices } from '@/config/initialize';

/** Music-specific wiring for the reusable entity-scoped coupon redemption page. */
export function CreditCouponsPage() {
  const { currentEntity } = useCurrentEntity();
  return (
    <RedeemCreditCouponPage
      client={getAppServices().consumablesApiClient}
      entityName={currentEntity?.displayName || 'selected workspace'}
      onRedeemed={() => refreshConsumablesBalance()}
    />
  );
}

/** Admin authorization and service wiring stay in the app; coupon UI and requests are shared. */
export function CreditCouponManagementPage() {
  const { siteAdmin } = useAuth();
  return (
    <ManageCreditCouponsPage client={getAppServices().consumablesApiClient} isAdmin={siteAdmin} />
  );
}

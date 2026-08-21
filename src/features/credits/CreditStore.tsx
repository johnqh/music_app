/**
 * The credit store, as it appears on its own page.
 *
 * Data, copy and callbacks all come from `useCreditStore`, which the paywall
 * modal shares — so the two cannot drift apart in what a credit is called or
 * what a package costs.
 */
import { CreditStorePage } from '@sudobility/consumables_pages';
import { useCreditStore } from '@/features/credits/useCreditStore';

export function CreditStore() {
  return <CreditStorePage {...useCreditStore()} />;
}

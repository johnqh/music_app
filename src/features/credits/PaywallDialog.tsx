/**
 * What a user sees when a job is refused for want of credits.
 *
 * `POST /jobs` answers 402 when the balance is at or below zero, and that used
 * to surface as an error toast reading like a network failure — which it is
 * not. It is the one API refusal with an obvious remedy, so it opens the store
 * rather than reporting a problem.
 *
 * The dialog itself is `CreditPaywallDialog` from `@sudobility/consumables_pages`,
 * where it is purely presentational: every other product that sells credits
 * hits the same moment, and none of them should hand-roll it. This file is the
 * adapter — it supplies the words (i18n), the payment data (the consumables
 * hooks) and the open/close wiring (`ui-slice`'s `dialogs` map), which is all
 * that is actually specific to Moosiac.
 *
 * Mounted once, above the routes: a refusal can come from the dashboard
 * (generate a whole score) or from inside the editor (generate a track,
 * replace a region), and those sit in different branches of the tree.
 *
 * It deliberately does not retry the refused job afterwards. The job was
 * discarded server-side and the project it would have filled was deleted with
 * it; silently re-submitting after a purchase would spend the credits the user
 * just bought on something they may no longer want.
 */
import { useTranslation } from 'react-i18next';
import { CreditPaywallDialog } from '@sudobility/consumables_pages';
import { useAppStore } from '@/app-library';
import { useCreditStore } from '@/features/credits/useCreditStore';
import type { EditorStoreApi } from '@/app-library';

/** The `dialogs` key, shared by everything that raises the paywall. */
export const PAYWALL_DIALOG = 'paywall';

export type PaywallDialogProps = {
  /** Defaults to the app-wide singleton; tests inject an isolated store. */
  store?: EditorStoreApi;
};

export function PaywallDialog({ store = useAppStore }: PaywallDialogProps) {
  const { t } = useTranslation();
  const open = store((s) => s.dialogs[PAYWALL_DIALOG] === true);
  const close = (): void => store.getState().closeDialog(PAYWALL_DIALOG);
  const storeProps = useCreditStore({ onPurchased: close });

  return (
    <CreditPaywallDialog
      {...storeProps}
      isOpen={open}
      onClose={close}
      labels={{
        ...storeProps.labels,
        // The only copy that is the modal's own: why it appeared, rather than
        // what it contains. The store's own heading is suppressed inside it.
        paywallTitle: t('credits.outOfCreditsTitle'),
        paywallMessage: t('credits.outOfCreditsBody'),
        closeLabel: t('common.closeDialog'),
      }}
    />
  );
}

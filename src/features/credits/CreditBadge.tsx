/**
 * The credit balance in the app bar.
 *
 * Its own subscriber, deliberately: the balance changes on every generation,
 * and reading `useBalance()` in `AppLayout` would re-render the notation canvas
 * and the piano keyboard with it. Same rule as `StatusPosition` and `Timecode`.
 */
import { Link } from 'react-router-dom';
import { useBalance } from '@sudobility/consumables_client';
import { CreditBalanceBadge } from '@sudobility/consumables_pages';

export function CreditBadge() {
  const { balance } = useBalance();

  // Nothing rather than a placeholder: a badge showing "0" before the balance
  // arrives reads as "you are out of credits", which is false and alarming.
  // Signed out, there is no balance to show at all.
  //
  // Deliberately not gated on `isLoading` as well: a refetch leaves the balance
  // known, and hiding it then would flicker the badge out of the bar for no
  // reason a reader could interpret.
  if (balance === null) return null;

  return (
    <Link
      to="/en/credits"
      aria-label={`${balance} credits remaining. Buy more.`}
      className="inline-flex items-center"
    >
      <CreditBalanceBadge balance={balance} isLoading={false} />
    </Link>
  );
}

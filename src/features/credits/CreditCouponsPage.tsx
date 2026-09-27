import { useCallback, useEffect, useState } from 'react';
import { refreshConsumablesBalance } from '@sudobility/consumables_client';
import { useCurrentEntity } from '@sudobility/entity_client';
import { useAuth } from '@/app/AuthContext';
import { getAppServices } from '@/config/initialize';

type ApiResult<T> = { success: boolean; data?: T; error?: string };

const inputClass = 'w-full rounded-md border border-theme-border bg-theme-background px-3 py-2';
const buttonClass =
  'rounded-md bg-theme-primary px-4 py-2 font-medium text-white disabled:opacity-50';

/** Redeem a coupon into the currently selected entity. */
export function CreditCouponsPage() {
  const { currentEntity } = useCurrentEntity();
  const { networkClient, baseUrl } = getAppServices();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    if (!currentEntity) {
      setMessage('Select a workspace before redeeming a coupon.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await networkClient.post<ApiResult<{ balance: number }>>(
        `${baseUrl}/api/v1/consumables/redeem-coupon`,
        { code: code.trim().toUpperCase() },
      );
      if (!response.ok || !response.data?.success) {
        throw new Error(response.data?.error || 'Coupon redemption failed.');
      }
      setCode('');
      await refreshConsumablesBalance();
      setMessage(
        `Coupon redeemed. ${response.data.data?.balance ?? ''} credits available in ${currentEntity.displayName}.`,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Coupon redemption failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Redeem a credit coupon</h1>
        <p className="mt-1 text-theme-text-secondary">
          Credits are added to {currentEntity?.displayName ?? 'the selected workspace'}.
        </p>
      </header>
      <section className="rounded-lg border border-theme-border bg-theme-surface p-5">
        <form onSubmit={redeem} className="flex flex-col gap-3 sm:flex-row">
          <input
            className={inputClass}
            value={code}
            onChange={(event) =>
              setCode(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 8),
              )
            }
            placeholder="8-character code"
            minLength={8}
            maxLength={8}
            pattern="[A-Z0-9]{8}"
            required
          />
          <button className={buttonClass} disabled={busy || code.length !== 8}>
            Redeem
          </button>
        </form>
      </section>
      {message && <p role="status">{message}</p>}
    </main>
  );
}

/** Site-admin coupon creation, list, detail, and redemption history. */
export function CreditCouponManagementPage() {
  const { siteAdmin } = useAuth();
  const { networkClient, baseUrl } = getAppServices();
  const [rows, setRows] = useState<CouponRow[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [credits, setCredits] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCoupons = useCallback(async () => {
    const response = await networkClient.get<ApiResult<CouponRow[]>>(
      `${baseUrl}/api/v1/consumables/coupons/history`,
    );
    if (!response.ok || !response.data?.success) {
      throw new Error(response.data?.error || 'Could not load coupons.');
    }
    setRows(
      [...(response.data.data ?? [])].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    );
  }, [baseUrl, networkClient]);

  useEffect(() => {
    if (siteAdmin) {
      void loadCoupons().catch((cause: unknown) =>
        setMessage(cause instanceof Error ? cause.message : 'Could not load coupons.'),
      );
    }
  }, [siteAdmin, loadCoupons]);

  async function createCoupon(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await networkClient.post<ApiResult<{ code: string }>>(
        `${baseUrl}/api/v1/consumables/coupons`,
        {
          credits: Number(credits),
          expires_at: new Date(expiresAt).toISOString(),
          email: email.trim() || null,
        },
      );
      if (!response.ok || !response.data?.success || !response.data.data) {
        throw new Error(response.data?.error || 'Could not create coupon.');
      }
      const code = response.data.data.code;
      setMessage(`Coupon created: ${code}`);
      setCredits('');
      setExpiresAt('');
      setEmail('');
      await loadCoupons();
      setSelectedCode(code);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not create coupon.');
    } finally {
      setBusy(false);
    }
  }

  if (!siteAdmin) return null;
  const coupons = [...new Map(rows.map((row) => [row.code, row])).values()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const selected = coupons.find((coupon) => coupon.code === selectedCode);
  const redemptionHistory = selected ? rows.filter((row) => row.code === selected.code) : [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Manage Coupons</h1>
        <p className="mt-1 text-theme-text-secondary">
          Create credit coupons and review their redemption history.
        </p>
      </header>
      <section className="rounded-lg border border-theme-border bg-theme-surface p-5">
        <h2 className="text-lg font-semibold">Create a coupon</h2>
        <form onSubmit={createCoupon} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Credits
            <input
              className={inputClass}
              type="number"
              min="1"
              step="1"
              value={credits}
              onChange={(event) => setCredits(event.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            Expires at
            <input
              className={inputClass}
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              required
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Restrict to email (optional)
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className={buttonClass} disabled={busy}>
            Create 8-character coupon
          </button>
        </form>
      </section>
      <section className="rounded-lg border border-theme-border bg-theme-surface p-5">
        <h2 className="text-lg font-semibold">Coupons</h2>
        {coupons.length ? (
          <ul className="mt-3 divide-y divide-theme-border">
            {coupons.map((coupon) => (
              <li key={coupon.code}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-3 text-left hover:text-theme-primary"
                  onClick={() => setSelectedCode(coupon.code)}
                >
                  <span className="font-mono font-medium">{coupon.code}</span>
                  <span className="text-sm text-theme-text-secondary">
                    {coupon.credits} credits · {new Date(coupon.createdAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-theme-text-secondary">No coupons created yet.</p>
        )}
      </section>
      {selected && (
        <section className="rounded-lg border border-theme-border bg-theme-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-mono text-xl font-semibold">{selected.code}</h2>
              <p className="mt-1 text-sm text-theme-text-secondary">Coupon details</p>
            </div>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => setSelectedCode(null)}
            >
              Back to coupons
            </button>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <CouponDetail label="Credits" value={String(selected.credits)} />
            <CouponDetail label="Created" value={new Date(selected.createdAt).toLocaleString()} />
            <CouponDetail label="Expires" value={new Date(selected.expiresAt).toLocaleString()} />
            <CouponDetail label="Target email" value={selected.email || 'Any user'} />
          </dl>
          <h3 className="mt-6 text-lg font-semibold">Redemption history</h3>
          {redemptionHistory[0]?.entityId ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="py-2">Redeemed at</th>
                    <th>Entity ID</th>
                    <th>User ID</th>
                    <th>Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {redemptionHistory
                    .filter((row) => row.entityId)
                    .map((row) => (
                      <tr
                        key={`${row.entityId}-${row.redeemedAt}`}
                        className="border-t border-theme-border"
                      >
                        <td className="py-2">
                          {row.redeemedAt ? new Date(row.redeemedAt).toLocaleString() : '—'}
                        </td>
                        <td>{row.entityId}</td>
                        <td>{row.redeemedByUserId}</td>
                        <td>{row.credits}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-theme-text-secondary">
              This coupon has not been redeemed.
            </p>
          )}
        </section>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}

function CouponDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-theme-text-secondary">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

type CouponRow = {
  code: string;
  credits: number;
  expiresAt: string;
  email: string | null;
  createdAt: string;
  entityId: string | null;
  redeemedByUserId: string | null;
  redeemedAt: string | null;
};

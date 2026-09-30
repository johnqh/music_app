import { useState, type FormEvent } from 'react';
import {
  useCreateApiKey,
  useEntityApiKeys,
  useRevokeApiKey,
  useCurrentEntity,
  type CreatedEntityApiKey,
} from '@sudobility/entity_client';
import { Button, Input } from '@sudobility/components';
import { AS_TYPED_INPUT_CLASS } from '@/components/controls/input-classes';
import { getAppServices } from '@/config/initialize';
import { CONSTANTS } from '@/config/constants';

/** API keys belong to the currently selected entity; the secret is shown once. */
export function EntityApiKeysPage() {
  const { currentEntity, isLoading } = useCurrentEntity();
  const entityClient = getAppServices().entityClient;
  if (!entityClient) throw new Error('Entity client is not configured');
  const slug = currentEntity?.entitySlug ?? null;
  const keys = useEntityApiKeys(entityClient, slug);
  const create = useCreateApiKey(entityClient);
  const revoke = useRevokeApiKey(entityClient);
  const [name, setName] = useState('');
  const [revealed, setRevealed] = useState<CreatedEntityApiKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!slug) return;
    setMessage(null);
    try {
      const key = await create.mutateAsync({
        entitySlug: slug,
        request: { key_name: name.trim() },
      });
      setRevealed(key);
      setName('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create API key.');
    }
  }

  if (isLoading) return <p>Loading your entity…</p>;
  if (!slug)
    return (
      <p role="status">
        {CONSTANTS.SHOW_ENTITIES
          ? 'Select a workspace to manage its API keys.'
          : 'Your personal entity is not available yet.'}
      </p>
    );
  const scopeName = CONSTANTS.SHOW_ENTITIES
    ? currentEntity?.displayName || slug
    : 'your personal entity';
  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="mt-1 text-muted-foreground">
          Keys are associated with {scopeName} and can act on that entity.
        </p>
      </header>
      {(message || create.error || keys.error || revoke.error) && (
        <p role="alert" className="text-sm text-destructive">
          {message || (create.error ?? keys.error ?? revoke.error)?.message}
        </p>
      )}
      {revealed && (
        <section className="space-y-3 border border-warning/30 bg-warning/10 p-4 text-foreground">
          <h2 className="font-semibold">Your new key: {revealed.keyName}</h2>
          <p className="text-sm">Copy this secret now. It cannot be shown again.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all border border-border bg-card p-2 font-mono text-sm text-card-foreground">
              {revealed.key}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(revealed.key)}
            >
              Copy key
            </Button>
            <Button type="button" variant="outline" onClick={() => setRevealed(null)}>
              Hide
            </Button>
          </div>
        </section>
      )}
      <form
        onSubmit={(event) => void submit(event)}
        className="flex flex-wrap items-end gap-3 border border-border p-4"
      >
        <label className="min-w-48 flex-1 text-sm">
          Key name
          {/* A key's name is kept as typed, so it is shown as typed: the
              theme's input is upper case, which would hide the difference. */}
          <Input
            className={`mt-1 ${AS_TYPED_INPUT_CLASS}`}
            maxLength={100}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Production integration"
          />
        </label>
        <Button type="submit" variant="primary" disabled={create.isPending || !name.trim()}>
          {create.isPending ? 'Creating…' : 'Create key'}
        </Button>
      </form>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Entity keys</h2>
        {keys.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading keys…</p>
        ) : keys.data?.length ? (
          <ul className="divide-y divide-border border border-border">
            {keys.data.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="font-medium">{key.keyName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{key.keyPrefix}…</p>
                  <p className="text-xs text-muted-foreground">
                    {key.isActive ? 'Active' : 'Revoked'} · Created{' '}
                    {key.createdAt ? new Date(key.createdAt).toLocaleString() : '—'} · Last used{' '}
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                  </p>
                </div>
                {key.isActive && (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={revoke.isPending}
                    onClick={() =>
                      void revoke
                        .mutateAsync({ entitySlug: slug, keyId: key.id })
                        .catch((error) =>
                          setMessage(
                            error instanceof Error ? error.message : 'Could not revoke API key.',
                          ),
                        )
                    }
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No API keys for this entity yet.</p>
        )}
      </section>
    </main>
  );
}

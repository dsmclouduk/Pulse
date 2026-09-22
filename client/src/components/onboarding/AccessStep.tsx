import { useEffect, useState } from 'react';

import { Badge, Button, Card, CardHeader, Input, Notice, Spinner, StatTile } from '@/components/ui';
import type { DiscoveredTenant, TenantDiscoveryResult } from '@/types';

/**
 * Step 1, at tenant level.
 *
 * Lighthouse delegation is the decision: if a client's tenant reaches Pulse, that client is
 * onboarded and every subscription in the tenant is in scope. Asking again per subscription would
 * re-ask a settled question, and would let a subscription be quietly left unmonitored.
 *
 * Azure never tells us a customer tenant's name, because Lighthouse is ARM-only with no Graph into
 * the customer directory. The name is typed here once.
 */

interface AccessStepProps {
  selectedTenantId: string | null;
  onSelectTenant: (client: { name: string; slug: string | null; tenantId: string } | null) => void;
}

function TenantRow({
  tenant,
  selected,
  onSelect,
  onAdopted
}: Readonly<{
  tenant: DiscoveredTenant;
  selected: boolean;
  onSelect: () => void;
  onAdopted: () => void;
}>) {
  const [name, setName] = useState(tenant.clientName ?? tenant.suggestedClientName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const onboarded = Boolean(tenant.clientSlug);

  async function adopt(): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/onboarding/tenants/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.tenantId, clientName: name.trim() })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Request failed with ${response.status}`);
      }

      onAdopted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not onboard the tenant.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`rounded-md border p-3 ${selected ? 'border-accent bg-accent/5' : 'border-[var(--color-border)] bg-[var(--color-surface)]'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {onboarded ? (
              <p className="truncate text-sm font-semibold text-[var(--color-text)]">{tenant.clientName}</p>
            ) : (
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Client name, e.g. RWK Goodman"
                className="w-64"
              />
            )}
            {tenant.isHomeTenant && <Badge tone="neutral">Synextra</Badge>}
            {onboarded ? <Badge tone="ok">Onboarded</Badge> : <Badge tone="warning">Not named yet</Badge>}
          </div>
          <p className="mt-1 font-mono text-[11px] text-[var(--color-text-tertiary)]">{tenant.tenantId}</p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {onboarded ? (
            <Button size="sm" variant={selected ? 'primary' : 'secondary'} onClick={onSelect}>
              {selected ? 'Selected' : 'Select'}
            </Button>
          ) : (
            <Button size="sm" loading={saving} disabled={name.trim().length < 2} onClick={() => void adopt()}>
              Onboard
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mt-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
      >
        {tenant.subscriptionCount} subscription{tenant.subscriptionCount === 1 ? '' : 's'}, all in scope{' '}
        <span className="text-[var(--color-text-tertiary)]">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
          {tenant.subscriptions.map((subscription) => (
            <li key={subscription.subscriptionId} className="flex flex-wrap items-baseline gap-2 text-xs">
              <span className="text-[var(--color-text)]">{subscription.displayName}</span>
              <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">{subscription.subscriptionId}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AccessStep({ selectedTenantId, onSelectTenant }: Readonly<AccessStepProps>) {
  const [discovery, setDiscovery] = useState<TenantDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/onboarding/tenants', { signal: controller.signal });
        const payload = (await response.json()) as TenantDiscoveryResult & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? `Request failed with ${response.status}`);
        }

        setDiscovery(payload);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not list tenants.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey]);

  const tenants = discovery?.tenants ?? [];
  const delegated = tenants.filter((tenant) => !tenant.isHomeTenant);
  const onboarded = tenants.filter((tenant) => tenant.clientSlug);
  const subscriptions = tenants.reduce((total, tenant) => total + tenant.subscriptionCount, 0);

  if (loading && !discovery) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Spinner /> Asking Azure which tenants Pulse can reach…
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}

      {discovery && !discovery.credentialsConfigured && (
        <Notice tone="warning">Azure credentials are not configured, so Pulse cannot see anything.</Notice>
      )}

      {discovery?.message && discovery.credentialsConfigured && <Notice tone="info">{discovery.message}</Notice>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Tenants reachable" value={tenants.length} />
        <StatTile label="Client tenants" value={delegated.length} hint="via Lighthouse" />
        <StatTile label="Onboarded" value={onboarded.length} />
        <StatTile label="Subscriptions in scope" value={subscriptions} />
      </div>

      <Card>
        <CardHeader
          title="Tenants Pulse can reach"
          description="Lighthouse delegation is the decision. A delegated tenant is in scope, and so is every subscription in it, so there is nothing to opt in per subscription. Azure never reports a customer tenant's name, so it is typed here once."
          actions={
            <Button size="sm" variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>
              Refresh
            </Button>
          }
        />

        {tenants.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No tenants visible. Until Pulse is authorised in a Lighthouse delegation it can only see its own.
          </p>
        ) : (
          <div className="grid gap-2">
            {tenants.map((tenant) => (
              <TenantRow
                key={tenant.tenantId}
                tenant={tenant}
                selected={tenant.tenantId === selectedTenantId}
                onSelect={() =>
                  onSelectTenant(
                    tenant.tenantId === selectedTenantId
                      ? null
                      : { name: tenant.clientName ?? tenant.tenantId, slug: tenant.clientSlug ?? null, tenantId: tenant.tenantId }
                  )
                }
                onAdopted={() => setReloadKey((value) => value + 1)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Missing a client?"
          description="Pulse reaches a tenant only when its Lighthouse delegation authorises the Synextra - Monitoring Reader group."
        />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--color-text-secondary)]">
          <li>Redeploy the delegation with that group added, reusing the offer name so it updates in place.</li>
          <li>Subscriptions reached only by a named admin account in the client tenant stay invisible to Pulse.</li>
        </ol>
        <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">Runbook: docs/onboarding/LIGHTHOUSE.md</p>
      </Card>
    </div>
  );
}

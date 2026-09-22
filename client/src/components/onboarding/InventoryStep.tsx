import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge, Button, Card, CardHeader, Notice, Spinner, StatTile } from '@/components/ui';
import type { InventorySummary } from '@/types';

/**
 * Step 2. Metadata inventory from Azure Resource Graph: what the client has, and what would stop it
 * being monitored. No metric values are stored here; those stay in Azure and are queried when an
 * alert needs diagnosing.
 */

interface InventoryStepProps {
  clientSlug: string | null;
  clientName: string | null;
}

function shortType(resourceType: string): string {
  return resourceType.split('/').slice(1).join('/') || resourceType;
}

export function InventoryStep({ clientSlug, clientName }: Readonly<InventoryStepProps>) {
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Types the baseline covers lead the view; the rest are discovered but are not what onboarding is about.
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientSlug) {
      setSummary(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/onboarding/inventory?clientSlug=${encodeURIComponent(clientSlug)}`);
      const payload = (await response.json()) as InventorySummary & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Request failed with ${response.status}`);
      }

      setSummary(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the inventory.');
    } finally {
      setLoading(false);
    }
  }, [clientSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh(): Promise<void> {
    if (!clientSlug) return;

    setRefreshing(true);
    setError(null);

    try {
      const response = await fetch('/api/onboarding/inventory/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientSlug })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Request failed with ${response.status}`);
      }

      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh the inventory.');
    } finally {
      setRefreshing(false);
    }
  }

  // Hooks must run before any early return, so this sits above the no-client case.
  const rows = useMemo(() => {
    const all = summary?.byType ?? [];
    return showAll ? all : all.filter((row) => row.monitorable);
  }, [summary, showAll]);

  if (!clientSlug) {
    return <Notice tone="warning">Pick a client on the Access step to take an inventory.</Notice>;
  }

  const blockers = (summary?.byType ?? []).filter((row) => row.withoutManagedIdentity > 0);
  const otherCount = (summary?.byType ?? [])
    .filter((row) => !row.monitorable)
    .reduce((total, row) => total + row.count, 0);

  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}

      <Card>
        <CardHeader
          title={`What ${clientName ?? clientSlug} has in Azure`}
          description="Metadata only: id, name, type, resource group, region and tags. Metric values are never stored; they stay in Azure Monitor and are queried when an alert needs diagnosing."
          actions={
            <Button size="sm" variant="secondary" loading={refreshing} onClick={() => void refresh()}>
              {summary?.lastRunAt ? 'Refresh from Azure' : 'Run discovery'}
            </Button>
          }
        />

        {loading && !summary ? (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <Spinner /> Loading…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Monitorable"
              value={summary?.monitorableCount ?? 0}
              hint={`of ${summary?.resourceCount ?? 0} discovered`}
            />
            <StatTile label="Subscriptions" value={summary?.subscriptionCount ?? 0} />
            <StatTile label="Regions in use" value={summary?.regions.length ?? 0} hint={summary?.regions.join(', ')} />
            <StatTile
              label="Blockers"
              value={blockers.reduce((total, row) => total + row.withoutManagedIdentity, 0)}
              tone={blockers.length > 0 ? 'warning' : undefined}
            />
          </div>
        )}

        <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
          {summary?.lastRunAt
            ? `Last run ${new Date(summary.lastRunAt).toLocaleString()}`
            : 'Never run. Discovery reads Azure Resource Graph and needs the subscriptions assigned on the Access step.'}
        </p>
      </Card>

      {blockers.length > 0 && (
        <Card>
          <CardHeader
            title="Blockers"
            description="These would silently produce no alerts rather than fail loudly, which is worse. Worth fixing before the baseline is deployed."
          />
          <ul className="space-y-1 text-sm text-[var(--color-text-secondary)]">
            {blockers.map((row) => (
              <li key={row.resourceType}>
                <Badge tone="warning">{row.withoutManagedIdentity}</Badge>{' '}
                {shortType(row.resourceType)} have no managed identity, so the Azure Monitor Agent cannot be installed and their
                guest rules (disk, heartbeat) will never fire.
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary && summary.byType.length > 0 && (
        <Card>
          <CardHeader
            title={showAll ? 'All resource types' : 'Types the baseline covers'}
            description="Which types exist decides which sections of the baseline are generated. A client with no App Services gets no App Service rules."
            actions={
              otherCount > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? 'Show covered only' : `Show all (${otherCount} not covered)`}
                </Button>
              ) : undefined
            }
          />
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Count</th>
                  <th className="px-4 py-2 font-medium">Regions</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.resourceType} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-[var(--color-text)]" title={row.resourceType}>
                      {shortType(row.resourceType)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[var(--color-text)]">{row.count}</td>
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">{row.regions.join(', ') || '—'}</td>
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                      {row.withoutManagedIdentity > 0 ? `${row.withoutManagedIdentity} without a managed identity` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {summary && summary.resourceCount === 0 && !loading && (
        <Notice tone="info">
          Nothing discovered yet. Run discovery, or check that this client has subscriptions assigned on the Access step.
        </Notice>
      )}
    </div>
  );
}

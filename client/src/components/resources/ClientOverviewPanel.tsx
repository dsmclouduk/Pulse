import { useEffect, useState } from 'react';

import type { AlertSeverity, ClientOverview } from '@/types';
import { Card, CardHeader, Spinner, StatTile } from '@/components/ui';

/**
 * Tenant-level summary shown when the client node at the top of the resource tree is selected.
 * Counts describe what Pulse holds, not the Azure estate: a resource exists here only once it has
 * alerted at least once.
 */

interface ClientOverviewPanelProps {
  clientSlug: string | null;
  refreshKey: string;
}

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  Sev0: 'Sev0 critical',
  Sev1: 'Sev1 error',
  Sev2: 'Sev2 warning',
  Sev3: 'Sev3 informational',
  Sev4: 'Sev4 verbose'
};

const SEVERITY_CHIP: Record<AlertSeverity, string> = {
  Sev0: 'bg-sev-critical',
  Sev1: 'bg-sev-error',
  Sev2: 'bg-sev-warning',
  Sev3: 'bg-sev-warning',
  Sev4: 'bg-sev-warning'
};

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Property({ label, value, mono }: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className={`truncate text-sm text-[var(--color-text)] ${mono ? 'font-mono text-xs' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

export function ClientOverviewPanel({ clientSlug, refreshKey }: Readonly<ClientOverviewPanelProps>) {
  const [overview, setOverview] = useState<ClientOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query = clientSlug ? `?clientSlug=${encodeURIComponent(clientSlug)}` : '';
        const response = await fetch(`/api/resources/client-overview${query}`, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        setOverview((await response.json()) as ClientOverview);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load the client overview.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [clientSlug, refreshKey]);

  if (loading && !overview) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Spinner /> Loading client overview…
        </div>
      </Card>
    );
  }

  if (error || !overview) {
    return (
      <Card>
        <div className="text-sm text-[var(--color-text-secondary)]">{error ?? 'No overview available.'}</div>
      </Card>
    );
  }

  const firingSeverities = (Object.entries(overview.firingBySeverity) as Array<[AlertSeverity, number]>).filter(
    ([, count]) => count > 0
  );

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader
          title={overview.clientName}
          description={overview.tenantName ?? (overview.clientSlug ? 'No tenant recorded' : 'Alerts with no client account')}
        />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Property label="Tenant" value={overview.tenantName ?? '—'} />
          <Property label="Tenant ID" value={overview.tenantId ?? '—'} mono />
          <Property label="Client slug" value={overview.clientSlug ?? '—'} mono />
          <Property label="Onboarding" value={overview.onboardingStatus ?? '—'} />
          <Property label="Status" value={overview.isActive === undefined ? '—' : overview.isActive ? 'Active' : 'Inactive'} />
          <Property label="Added" value={formatDate(overview.createdAt)} />
        </dl>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Subscriptions" value={overview.subscriptions.length} />
        <StatTile label="Resources" value={overview.resourceCount} />
        <StatTile label="Alerts total" value={overview.alertCount} />
        <StatTile label="Last 30 days" value={overview.alertsLast30Days} />
        <StatTile label="Firing" value={overview.firingCount} tone={overview.firingCount > 0 ? 'warning' : undefined} />
        <StatTile label="Resolved" value={overview.resolvedCount} />
      </div>

      {firingSeverities.length > 0 && (
        <Card>
          <CardHeader title="Firing by severity" />
          <div className="flex flex-wrap gap-2">
            {firingSeverities.map(([severity, count]) => (
              <span
                key={severity}
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-white ${SEVERITY_CHIP[severity]}`}
              >
                {SEVERITY_LABEL[severity]}
                <span className="tabular-nums">{count}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Subscriptions"
          description="Registered against this client, plus any seen on alerts. Resource counts are what Pulse holds, not the Azure estate."
        />

        {overview.subscriptions.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No subscriptions recorded yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <th className="px-4 py-2 font-medium">Subscription</th>
                <th className="px-4 py-2 font-medium">ID</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Resources</th>
              </tr>
            </thead>
            <tbody>
              {overview.subscriptions.map((subscription) => (
                <tr key={subscription.externalSubscriptionId} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="truncate px-4 py-2 text-[var(--color-text)]">{subscription.displayName}</td>
                  <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                    {subscription.externalSubscriptionId}
                  </td>
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">{subscription.status ?? 'Seen on alerts'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--color-text)]">{subscription.resourceCount}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Agent activity" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Diagnoses" value={overview.diagnosisCount} />
          <StatTile label="Notes" value={overview.noteCount} />
          <StatTile label="Last alert" value={formatDate(overview.lastAlertAt)} />
          <StatTile label="Data" value={overview.simulatedOnly ? 'Simulated only' : 'Includes live alerts'} />
        </div>
      </Card>
    </div>
  );
}

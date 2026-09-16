import { useMemo, useState } from 'react';

import { Badge, Button, Card, CardHeader, Input, Notice, Spinner, StatTile } from '@/components/ui';
import type { SubscriptionDiscoveryResult } from '@/types';

/**
 * Step 1. The only step wired to live Azure: it lists what Pulse's own identity can actually reach.
 * A subscription in another tenant is visible only through a Lighthouse delegation that authorises
 * Pulse, so an empty list here is the real blocker, not a UI state to hide.
 */

interface AccessStepProps {
  discovery: SubscriptionDiscoveryResult | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  selectedClient: string | null;
  onSelectClient: (client: string | null) => void;
}

export function AccessStep({ discovery, loading, error, onRefresh, selectedClient, onSelectClient }: Readonly<AccessStepProps>) {
  const [search, setSearch] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const subscriptions = discovery?.subscriptions ?? [];

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return subscriptions.filter((subscription) => {
      if (onlyUnassigned && subscription.assignedClientSlug) {
        return false;
      }

      if (!term) {
        return true;
      }

      return (
        subscription.displayName.toLowerCase().includes(term) ||
        subscription.subscriptionId.includes(term) ||
        (subscription.suggestedClientName ?? '').toLowerCase().includes(term) ||
        (subscription.assignedClientName ?? '').toLowerCase().includes(term)
      );
    });
  }, [subscriptions, search, onlyUnassigned]);

  const delegated = subscriptions.filter((subscription) => subscription.isDelegated).length;
  const assigned = subscriptions.filter((subscription) => subscription.assignedClientSlug).length;

  const clients = useMemo(() => {
    const names = new Set<string>();

    for (const subscription of subscriptions) {
      const name = subscription.assignedClientName ?? subscription.suggestedClientName;
      if (name) names.add(name);
    }

    return [...names].sort((left, right) => left.localeCompare(right));
  }, [subscriptions]);

  if (loading && !discovery) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Spinner /> Asking Azure which subscriptions Pulse can reach…
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}

      {discovery && !discovery.credentialsConfigured && (
        <Notice tone="warning">
          Azure credentials are not configured, so Pulse cannot see anything. Set the Azure identity in Settings first.
        </Notice>
      )}

      {discovery?.message && discovery.credentialsConfigured && <Notice tone="info">{discovery.message}</Notice>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Visible to Pulse" value={subscriptions.length} />
        <StatTile label="Delegated" value={delegated} hint="via Lighthouse" />
        <StatTile label="Assigned to a client" value={assigned} />
        <StatTile label="Clients seen" value={clients.length} />
      </div>

      <Card>
        <CardHeader
          title="Subscriptions Pulse can reach"
          description="Client subscriptions appear here once Pulse's identity is authorised in their Lighthouse delegation. Assigning one to a client is what brings it into Pulse."
          actions={
            <Button size="sm" variant="secondary" onClick={onRefresh}>
              Refresh
            </Button>
          }
        />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, client or subscription id…"
            className="min-w-[16rem] flex-1"
          />
          <Button size="sm" variant={onlyUnassigned ? 'primary' : 'secondary'} onClick={() => setOnlyUnassigned((value) => !value)}>
            Unassigned only
          </Button>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            {subscriptions.length === 0
              ? 'No subscriptions visible. Until Pulse is authorised in a Lighthouse delegation it can only see its own tenant.'
              : 'No subscriptions match the filter.'}
          </p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  <th className="px-4 py-2 font-medium">Subscription</th>
                  <th className="px-4 py-2 font-medium">Access</th>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 font-medium">Tenant</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((subscription) => {
                  const client = subscription.assignedClientName ?? subscription.suggestedClientName;
                  const isSelected = client !== undefined && client === selectedClient;

                  return (
                    <tr
                      key={subscription.subscriptionId}
                      className={`border-b border-[var(--color-border)] last:border-0 ${isSelected ? 'bg-accent/5' : ''}`}
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium text-[var(--color-text)]">{subscription.displayName}</div>
                        <div className="font-mono text-[11px] text-[var(--color-text-tertiary)]">{subscription.subscriptionId}</div>
                      </td>
                      <td className="px-4 py-2">
                        {subscription.isDelegated ? (
                          <Badge tone="ok">Lighthouse</Badge>
                        ) : (
                          <Badge tone="neutral">Home tenant</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {subscription.assignedClientName ? (
                          <span className="text-[var(--color-text)]">{subscription.assignedClientName}</span>
                        ) : subscription.suggestedClientName ? (
                          <span className="text-[var(--color-text-secondary)]">
                            {subscription.suggestedClientName} <Badge tone="info">suggested</Badge>
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
                        {subscription.tenantId.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-2 text-right">
                        {client && (
                          <Button size="sm" variant={isSelected ? 'primary' : 'ghost'} onClick={() => onSelectClient(isSelected ? null : client)}>
                            {isSelected ? 'Selected' : 'Onboard'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Not seeing a client?"
          description="Pulse can only reach subscriptions delegated to the Synextra tenant through Azure Lighthouse, with its identity authorised in the delegation."
        />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--color-text-secondary)]">
          <li>
            The delegation must authorise the <span className="font-medium text-[var(--color-text)]">Synextra - Monitoring Reader</span> group,
            which Pulse&apos;s identity belongs to.
          </li>
          <li>Reuse the existing offer name when redeploying, or Azure creates a second delegation alongside the first.</li>
          <li>Subscriptions reached only by a named admin account in the client tenant are invisible to Pulse and always will be.</li>
        </ol>
        <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">Full runbook: docs/onboarding/LIGHTHOUSE.md</p>
      </Card>
    </div>
  );
}

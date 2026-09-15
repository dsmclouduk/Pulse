import { Badge } from '@/components/ui';
import type { ClientAccountSummary } from '@/types';

interface ClientSummaryCardProps {
  client: ClientAccountSummary;
  selected?: boolean;
  onSelect?: () => void;
}

export function ClientSummaryCard({ client, selected = false, onSelect }: Readonly<ClientSummaryCardProps>) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-md border p-3 text-left transition-colors ${
        selected ? 'border-accent bg-accent/5 ring-1 ring-accent/40' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-hover)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{client.name}</p>
          <p className="truncate font-mono text-[11px] text-[var(--color-text-secondary)]">{client.slug}</p>
        </div>
        <Badge tone={client.onboardingStatus === 'ACTIVE' ? 'ok' : 'accent'}>{client.onboardingStatus}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-secondary)]">
        <span>{client.subscriptionCount} subscription{client.subscriptionCount === 1 ? '' : 's'}</span>
        <span>{client.tenantConnectionCount} tenant connection{client.tenantConnectionCount === 1 ? '' : 's'}</span>
        <span className="truncate font-mono">{client.primaryTenantId ?? 'No primary tenant yet'}</span>
      </div>
    </button>
  );
}

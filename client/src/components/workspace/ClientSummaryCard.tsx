import type { ClientAccountSummary } from '@/types';

interface ClientSummaryCardProps {
  client: ClientAccountSummary;
}

export function ClientSummaryCard({ client }: Readonly<ClientSummaryCardProps>) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">{client.name}</p>
          <p className="mt-1 font-mono text-xs text-slate-400">{client.slug}</p>
        </div>
        <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan">
          {client.onboardingStatus}
        </span>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-slate-400">
        <p>{client.subscriptionCount} subscriptions</p>
        <p>{client.tenantConnectionCount} tenant connections</p>
        <p>{client.primaryTenantId ?? 'No primary tenant yet'}</p>
      </div>
    </div>
  );
}
import type { ClientAccountSummary, PlatformIdentitySummary, PlatformIdentityValidationResult } from '@/types';

interface ClientScopeCardProps {
  clients: ClientAccountSummary[];
  selectedClientSlug: string | null;
  onSelectClientSlug: (clientSlug: string | null) => void;
  platformIdentity: PlatformIdentitySummary | null;
  platformValidation: PlatformIdentityValidationResult | null;
  onRefreshClients: () => Promise<void>;
  onValidatePlatformIdentity: () => Promise<void>;
  errorMessage: string | null;
}

function statusTone(isReady: boolean): string {
  return isReady
    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
    : 'border-amber-400/40 bg-amber-500/10 text-amber-100';
}

export function ClientScopeCard({
  clients,
  selectedClientSlug,
  onSelectClientSlug,
  platformIdentity,
  platformValidation,
  onRefreshClients,
  onValidatePlatformIdentity,
  errorMessage
}: Readonly<ClientScopeCardProps>) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">MSP Workspace</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Client scope and platform identity</h2>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onRefreshClients}
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:border-white/20 hover:text-white"
          >
            Refresh clients
          </button>
          <button
            type="button"
            onClick={onValidatePlatformIdentity}
            className="rounded-full border border-cyan/40 bg-cyan/10 px-4 py-2 text-sm font-semibold text-cyan transition hover:border-cyan/60 hover:bg-cyan/15"
          >
            Validate platform identity
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <label className="grid gap-2 text-sm text-slate-200">
          <span>Active client scope</span>
          <select
            value={selectedClientSlug ?? ''}
            onChange={(event) => onSelectClientSlug(event.target.value || null)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
          >
            <option value="">Select a client scope</option>
            {clients.map((client) => (
              <option key={client.id} value={client.slug}>
                {client.name}
              </option>
            ))}
          </select>
        </label>

        <p className="mt-3 text-xs text-slate-400">
          The live feed, SSE subscription, and simulations now run against the selected client scope.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Platform identity</p>
            <p className="mt-2 text-sm text-slate-300">Single cross-tenant platform identity running in App Service.</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusTone(Boolean(platformValidation?.isReady))}`}>
            {platformValidation?.isReady ? 'Validated' : 'Pending'}
          </span>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-slate-400">
          <p>App Service URL: {platformIdentity?.appServiceUrl ?? 'Not configured'}</p>
          <p>Platform tenant ID: {platformIdentity?.platformTenantIdConfigured ? 'Configured' : 'Missing'}</p>
          <p>Platform client ID: {platformIdentity?.platformClientIdConfigured ? 'Configured' : 'Missing'}</p>
          <p>Key Vault URI: {platformIdentity?.keyVaultUriConfigured ? 'Configured' : 'Missing'}</p>
          {platformValidation?.error ? <p className="text-amber-300">{platformValidation.error}</p> : null}
          {platformValidation?.expiresOn ? <p>Token expiry: {new Date(platformValidation.expiresOn).toLocaleString()}</p> : null}
        </div>
      </div>

      {errorMessage ? <p className="text-sm text-amber-300">{errorMessage}</p> : null}
      <p className="text-xs text-slate-500">
        The actual database becomes required when you want the first client, tenant connection, or subscription to persist. Until DATABASE_URL is configured, these onboarding actions will return a clear server error instead of silently faking success.
      </p>
    </div>
  );
}
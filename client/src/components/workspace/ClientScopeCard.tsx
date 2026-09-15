import { Badge, Button, Card, CardHeader, Field, Notice, Select } from '@/components/ui';
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

function ConfigRow({ label, configured, value }: Readonly<{ label: string; configured: boolean; value?: string | null }>) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-1.5 text-xs last:border-b-0">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <span className="flex items-center gap-2">
        {value && <span className="max-w-[220px] truncate font-mono text-[11px] text-[var(--color-text)]">{value}</span>}
        <Badge tone={configured ? 'ok' : 'warning'}>{configured ? 'Configured' : 'Missing'}</Badge>
      </span>
    </div>
  );
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
    <div className="grid content-start gap-4">
      <Card>
        <CardHeader
          eyebrow="MSP workspace"
          title="Client scope"
          description="The live feed, comments and simulations run against the selected client."
          actions={
            <Button size="sm" onClick={() => void onRefreshClients()}>
              Refresh
            </Button>
          }
        />

        <Field label="Active client scope">
          <Select value={selectedClientSlug ?? ''} onChange={(event) => onSelectClientSlug(event.target.value || null)}>
            <option value="">All alerts (in-memory, unscoped)</option>
            {clients.map((client) => (
              <option key={client.id} value={client.slug}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>

        {errorMessage && (
          <Notice tone="warning" className="mt-3">
            {errorMessage}
          </Notice>
        )}
      </Card>

      <Card>
        <CardHeader
          eyebrow="Platform identity"
          title="Cross-tenant platform app"
          description="Single Entra application used for MSP onboarding from App Service."
          actions={
            <>
              <Badge tone={platformValidation?.isReady ? 'ok' : 'neutral'}>{platformValidation?.isReady ? 'Validated' : 'Not validated'}</Badge>
              <Button size="sm" variant="primary" onClick={() => void onValidatePlatformIdentity()}>
                Validate
              </Button>
            </>
          }
        />

        <div>
          <ConfigRow label="App Service URL" configured={Boolean(platformIdentity?.appServiceUrl)} value={platformIdentity?.appServiceUrl} />
          <ConfigRow label="Platform tenant ID" configured={Boolean(platformIdentity?.platformTenantIdConfigured)} />
          <ConfigRow label="Platform client ID" configured={Boolean(platformIdentity?.platformClientIdConfigured)} />
          <ConfigRow label="App object ID" configured={Boolean(platformIdentity?.platformAppObjectIdConfigured)} />
          <ConfigRow label="Key Vault URI" configured={Boolean(platformIdentity?.keyVaultUriConfigured)} />
        </div>

        {platformValidation?.error && (
          <Notice tone="warning" className="mt-3">
            {platformValidation.error}
          </Notice>
        )}
        {platformValidation?.expiresOn && (
          <p className="mt-3 text-[11px] text-[var(--color-text-tertiary)]">Token expiry: {new Date(platformValidation.expiresOn).toLocaleString()}</p>
        )}
      </Card>

      <Notice>
        A database becomes required when the first client, tenant connection or subscription needs to persist. Until <code className="font-mono">DATABASE_URL</code> is
        set, onboarding actions return a clear server error instead of faking success.
      </Notice>
    </div>
  );
}

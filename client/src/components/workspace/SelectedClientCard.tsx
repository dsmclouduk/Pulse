import { useAuthSessionContext } from '@/components/auth/AuthSessionContext';
import { Badge, Button, Card, CardHeader, Field, Input, Notice } from '@/components/ui';
import type { ClientAccountSummary, CreateAzureSubscriptionRequest, CreateTenantConnectionRequest } from '@/types';

interface SelectedClientCardProps {
  client: ClientAccountSummary;
  tenantConnectionFormState: CreateTenantConnectionRequest;
  subscriptionFormState: CreateAzureSubscriptionRequest;
  isSubmitting: boolean;
  lastConsentMessage: string | null;
  onTenantConnectionChange: (nextState: CreateTenantConnectionRequest) => void;
  onSubscriptionChange: (nextState: CreateAzureSubscriptionRequest) => void;
  onAddTenantConnection: () => Promise<void>;
  onAddSubscription: () => Promise<void>;
  onStartTenantConsent: (tenantConnectionId: string) => Promise<void>;
  onValidateTenantConnection: (tenantConnectionId: string) => Promise<void>;
}

function consentTone(status: string): 'ok' | 'warning' | 'neutral' {
  const normalised = status.toUpperCase();
  if (normalised.includes('GRANTED') || normalised.includes('VALIDATED')) return 'ok';
  if (normalised.includes('PENDING')) return 'warning';
  return 'neutral';
}

export function SelectedClientCard({
  client,
  tenantConnectionFormState,
  subscriptionFormState,
  isSubmitting,
  lastConsentMessage,
  onTenantConnectionChange,
  onSubscriptionChange,
  onAddTenantConnection,
  onAddSubscription,
  onStartTenantConsent,
  onValidateTenantConnection
}: Readonly<SelectedClientCardProps>) {
  const { session } = useAuthSessionContext();
  const consentActionsBlocked = Boolean(session?.authRequired && !session.isAuthenticated && !session.devBypassEnabled);

  return (
    <Card>
      <CardHeader
        eyebrow="Selected client"
        title={client.name}
        description={
          <span className="block space-y-1">
            <span className="block font-mono">
              Webhook secret: <span className="select-all">{client.webhookSecret}</span>
            </span>
            <span className="block">
              Action group webhook URL (Azure cannot send custom headers, so the secret travels in the path):
              <code className="ml-1 select-all font-mono text-[11px] text-[var(--color-text)]">
                {`${window.location.origin}/api/webhook/azure-alerts/${client.webhookSecret}`}
              </code>
              <span className="ml-1 text-[var(--color-text-tertiary)]">Replace the host with the public App Service or ngrok URL.</span>
            </span>
          </span>
        }
        actions={<Badge tone="accent">{client.onboardingStatus}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Tenant connections */}
        <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Tenant connections</p>
          <div className="grid gap-3">
            <Field label="Tenant ID">
              <Input
                className="font-mono"
                value={tenantConnectionFormState.tenantId}
                onChange={(event) => onTenantConnectionChange({ ...tenantConnectionFormState, tenantId: event.target.value })}
              />
            </Field>
            <Field label="Tenant display name">
              <Input
                value={tenantConnectionFormState.tenantDisplayName ?? ''}
                onChange={(event) => onTenantConnectionChange({ ...tenantConnectionFormState, tenantDisplayName: event.target.value })}
              />
            </Field>
            <Button size="sm" disabled={isSubmitting || !tenantConnectionFormState.tenantId} onClick={() => void onAddTenantConnection()}>
              Add tenant connection
            </Button>
          </div>

          <div className="mt-4 grid gap-2">
            {(client.tenantConnections ?? []).length === 0 ? (
              <p className="text-xs text-[var(--color-text-tertiary)]">No tenant connections recorded yet.</p>
            ) : (
              client.tenantConnections?.map((connection) => (
                <div key={connection.id} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-[var(--color-text)]">{connection.tenantId}</p>
                      <p className="text-[11px] text-[var(--color-text-secondary)]">{connection.tenantDisplayName ?? 'Unnamed tenant'}</p>
                    </div>
                    <Badge tone={consentTone(connection.consentStatus)}>{connection.consentStatus}</Badge>
                  </div>
                  {connection.lastValidationMessage && <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">{connection.lastValidationMessage}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" disabled={isSubmitting || consentActionsBlocked} onClick={() => void onStartTenantConsent(connection.id)}>
                      Start consent
                    </Button>
                    <Button size="sm" disabled={isSubmitting || consentActionsBlocked} onClick={() => void onValidateTenantConnection(connection.id)}>
                      Validate connection
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {consentActionsBlocked && (
            <Notice tone="warning" className="mt-3">
              Consent actions will require an authenticated MSAL session once auth enforcement is enabled.
            </Notice>
          )}
          {lastConsentMessage && (
            <Notice tone="info" className="mt-3">
              {lastConsentMessage}
            </Notice>
          )}
        </section>

        {/* Azure subscriptions */}
        <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Azure subscriptions</p>
          <div className="grid gap-3">
            <Field label="Subscription ID">
              <Input
                className="font-mono"
                value={subscriptionFormState.externalSubscriptionId}
                onChange={(event) => onSubscriptionChange({ ...subscriptionFormState, externalSubscriptionId: event.target.value })}
              />
            </Field>
            <Field label="Subscription display name">
              <Input value={subscriptionFormState.displayName} onChange={(event) => onSubscriptionChange({ ...subscriptionFormState, displayName: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tenant ID">
                <Input className="font-mono" value={subscriptionFormState.tenantId ?? ''} onChange={(event) => onSubscriptionChange({ ...subscriptionFormState, tenantId: event.target.value })} />
              </Field>
              <Field label="Tenant display name">
                <Input value={subscriptionFormState.tenantDisplayName ?? ''} onChange={(event) => onSubscriptionChange({ ...subscriptionFormState, tenantDisplayName: event.target.value })} />
              </Field>
            </div>
            <Button size="sm" disabled={isSubmitting || !subscriptionFormState.externalSubscriptionId} onClick={() => void onAddSubscription()}>
              Add Azure subscription
            </Button>
          </div>

          <div className="mt-4 grid gap-2">
            {(client.subscriptions ?? []).length === 0 ? (
              <p className="text-xs text-[var(--color-text-tertiary)]">No subscriptions recorded yet.</p>
            ) : (
              client.subscriptions?.map((subscription) => (
                <div key={subscription.id} className="flex items-start justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-[var(--color-text)]">{subscription.externalSubscriptionId}</p>
                    <p className="text-[11px] text-[var(--color-text-secondary)]">{subscription.displayName}</p>
                  </div>
                  <Badge tone="neutral">{subscription.onboardingStatus}</Badge>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </Card>
  );
}

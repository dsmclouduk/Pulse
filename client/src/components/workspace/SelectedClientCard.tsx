import type {
  ClientAccountSummary,
  CreateAzureSubscriptionRequest,
  CreateTenantConnectionRequest
} from '@/types';
import { useAuthSessionContext } from '@/components/auth/AuthSessionContext';

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
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Selected client detail</p>
          <p className="mt-2 text-sm font-semibold text-white">{client.name}</p>
          <p className="mt-1 font-mono text-xs text-slate-400">Webhook secret: {client.webhookSecret}</p>
        </div>
        <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan">
          {client.onboardingStatus}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tenant connections</p>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-2 text-sm text-slate-200">
              <span>Tenant ID</span>
              <input
                value={tenantConnectionFormState.tenantId}
                onChange={(event) => onTenantConnectionChange({ ...tenantConnectionFormState, tenantId: event.target.value })}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan/50"
              />
            </label>
            <label className="grid gap-2 text-sm text-slate-200">
              <span>Tenant display name</span>
              <input
                value={tenantConnectionFormState.tenantDisplayName ?? ''}
                onChange={(event) => onTenantConnectionChange({ ...tenantConnectionFormState, tenantDisplayName: event.target.value })}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
              />
            </label>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onAddTenantConnection}
              className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add tenant connection
            </button>
          </div>

          <div className="mt-4 grid gap-2 text-xs text-slate-400">
            {(client.tenantConnections ?? []).length === 0 ? (
              <p>No tenant connections recorded yet.</p>
            ) : (
              client.tenantConnections?.map((connection) => (
                <div key={connection.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-slate-200">{connection.tenantId}</p>
                  <p>{connection.tenantDisplayName ?? 'Unnamed tenant'}</p>
                  <p>{connection.consentStatus}</p>
                  {connection.lastValidationMessage ? <p className="text-amber-200">{connection.lastValidationMessage}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isSubmitting || consentActionsBlocked}
                      onClick={() => void onStartTenantConsent(connection.id)}
                      className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-semibold text-cyan transition hover:border-cyan/50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Start consent
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting || consentActionsBlocked}
                      onClick={() => void onValidateTenantConnection(connection.id)}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Validate connection
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {consentActionsBlocked ? <p className="mt-3 text-xs text-amber-300">Consent actions will require a real authenticated MSAL session once auth enforcement is enabled.</p> : null}
          {lastConsentMessage ? <p className="mt-3 text-xs text-slate-300">{lastConsentMessage}</p> : null}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Azure subscriptions</p>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-2 text-sm text-slate-200">
              <span>Subscription ID</span>
              <input
                value={subscriptionFormState.externalSubscriptionId}
                onChange={(event) => onSubscriptionChange({ ...subscriptionFormState, externalSubscriptionId: event.target.value })}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan/50"
              />
            </label>
            <label className="grid gap-2 text-sm text-slate-200">
              <span>Subscription display name</span>
              <input
                value={subscriptionFormState.displayName}
                onChange={(event) => onSubscriptionChange({ ...subscriptionFormState, displayName: event.target.value })}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
              />
            </label>
            <label className="grid gap-2 text-sm text-slate-200">
              <span>Tenant ID</span>
              <input
                value={subscriptionFormState.tenantId ?? ''}
                onChange={(event) => onSubscriptionChange({ ...subscriptionFormState, tenantId: event.target.value })}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan/50"
              />
            </label>
            <label className="grid gap-2 text-sm text-slate-200">
              <span>Tenant display name</span>
              <input
                value={subscriptionFormState.tenantDisplayName ?? ''}
                onChange={(event) => onSubscriptionChange({ ...subscriptionFormState, tenantDisplayName: event.target.value })}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
              />
            </label>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onAddSubscription}
              className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add Azure subscription
            </button>
          </div>

          <div className="mt-4 grid gap-2 text-xs text-slate-400">
            {(client.subscriptions ?? []).length === 0 ? (
              <p>No subscriptions recorded yet.</p>
            ) : (
              client.subscriptions?.map((subscription) => (
                <div key={subscription.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-slate-200">{subscription.externalSubscriptionId}</p>
                  <p>{subscription.displayName}</p>
                  <p>{subscription.onboardingStatus}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
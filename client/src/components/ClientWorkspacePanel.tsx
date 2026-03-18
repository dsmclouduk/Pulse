import { useEffect, useState } from 'react';

import { useClientAccounts } from '@/hooks/useClientAccounts';
import type {
  CreateAzureSubscriptionRequest,
  CreateClientAccountRequest,
  CreateTenantConnectionRequest
} from '@/types';
import { BootstrapClientCard } from '@/components/workspace/BootstrapClientCard';
import { ClientScopeCard } from '@/components/workspace/ClientScopeCard';
import { ClientSummaryCard } from '@/components/workspace/ClientSummaryCard';
import { SelectedClientCard } from '@/components/workspace/SelectedClientCard';
import {
  defaultClientFormState,
  defaultSubscriptionFormState,
  defaultTenantConnectionFormState
} from '@/components/workspace/constants';

interface ClientWorkspacePanelProps {
  selectedClientSlug: string | null;
  onSelectClientSlug: (clientSlug: string | null) => void;
}

export function ClientWorkspacePanel({ selectedClientSlug, onSelectClientSlug }: Readonly<ClientWorkspacePanelProps>) {
  const {
    clients,
    platformIdentity,
    platformValidation,
    errorMessage,
    createClientAccount,
    addTenantConnection,
    addAzureSubscription,
    startTenantConnectionConsent,
    validateTenantConnection,
    refreshClients,
    validatePlatformIdentity
  } = useClientAccounts();
  const [formState, setFormState] = useState<CreateClientAccountRequest>(defaultClientFormState);
  const [tenantConnectionFormState, setTenantConnectionFormState] = useState<CreateTenantConnectionRequest>(defaultTenantConnectionFormState);
  const [subscriptionFormState, setSubscriptionFormState] = useState<CreateAzureSubscriptionRequest>(defaultSubscriptionFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastConsentMessage, setLastConsentMessage] = useState<string | null>(null);

  const selectedClient = clients.find((client) => client.slug === selectedClientSlug) ?? null;

  useEffect(() => {
    if (!selectedClientSlug && clients.length > 0) {
      onSelectClientSlug(clients[0].slug);
    }
  }, [clients, onSelectClientSlug, selectedClientSlug]);

  async function handleRefreshClients(): Promise<void> {
    await refreshClients();
  }

  async function handleValidatePlatformIdentity(): Promise<void> {
    await validatePlatformIdentity();
  }

  async function handleCreateClient(): Promise<void> {
    setIsSubmitting(true);

    const createdClient = await createClientAccount({
      ...formState,
      primaryTenantId: formState.primaryTenantId || undefined,
      defaultDomain: formState.defaultDomain || undefined
    });

    if (createdClient) {
      onSelectClientSlug(createdClient.slug);
      setFormState(defaultClientFormState);
    }

    setLastConsentMessage(null);

    setIsSubmitting(false);
  }

  async function handleAddTenantConnection(): Promise<void> {
    if (!selectedClient) {
      return;
    }

    setIsSubmitting(true);

    const updatedClient = await addTenantConnection(selectedClient.id, {
      tenantId: tenantConnectionFormState.tenantId,
      tenantDisplayName: tenantConnectionFormState.tenantDisplayName || undefined
    });

    if (updatedClient) {
      setTenantConnectionFormState(defaultTenantConnectionFormState);
    }

    setLastConsentMessage(null);

    setIsSubmitting(false);
  }

  async function handleAddSubscription(): Promise<void> {
    if (!selectedClient) {
      return;
    }

    setIsSubmitting(true);

    const updatedClient = await addAzureSubscription(selectedClient.id, {
      externalSubscriptionId: subscriptionFormState.externalSubscriptionId,
      displayName: subscriptionFormState.displayName,
      tenantId: subscriptionFormState.tenantId || undefined,
      tenantDisplayName: subscriptionFormState.tenantDisplayName || undefined
    });

    if (updatedClient) {
      setSubscriptionFormState(defaultSubscriptionFormState);
    }

    setLastConsentMessage(null);

    setIsSubmitting(false);
  }

  async function handleStartTenantConsent(tenantConnectionId: string): Promise<void> {
    if (!selectedClient) {
      return;
    }

    setIsSubmitting(true);

    const result = await startTenantConnectionConsent(selectedClient.id, tenantConnectionId);

    if (result?.action.launchUrl) {
      window.open(result.action.launchUrl, '_blank', 'noopener,noreferrer');
    }

    setLastConsentMessage(result?.action.message ?? null);

    setIsSubmitting(false);
  }

  async function handleValidateTenantConnection(tenantConnectionId: string): Promise<void> {
    if (!selectedClient) {
      return;
    }

    setIsSubmitting(true);

    const result = await validateTenantConnection(selectedClient.id, tenantConnectionId);
    setLastConsentMessage(result?.action.message ?? null);

    setIsSubmitting(false);
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-panel">
      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <ClientScopeCard
          clients={clients}
          selectedClientSlug={selectedClientSlug}
          onSelectClientSlug={onSelectClientSlug}
          platformIdentity={platformIdentity}
          platformValidation={platformValidation}
          onRefreshClients={handleRefreshClients}
          onValidatePlatformIdentity={handleValidatePlatformIdentity}
          errorMessage={errorMessage}
        />

        <div className="grid gap-4">
          <BootstrapClientCard
            formState={formState}
            isSubmitting={isSubmitting}
            onChange={setFormState}
            onSubmit={handleCreateClient}
          />

          <div className="grid gap-3">
            {clients.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                No client accounts found yet. Create the first onboarded client to enable a scoped live feed.
              </div>
            ) : (
              clients.map((client) => <ClientSummaryCard key={client.id} client={client} />)
            )}
          </div>

          {selectedClient ? (
            <SelectedClientCard
              client={selectedClient}
              tenantConnectionFormState={tenantConnectionFormState}
              subscriptionFormState={subscriptionFormState}
              isSubmitting={isSubmitting}
              lastConsentMessage={lastConsentMessage}
              onTenantConnectionChange={setTenantConnectionFormState}
              onSubscriptionChange={setSubscriptionFormState}
              onAddTenantConnection={handleAddTenantConnection}
              onAddSubscription={handleAddSubscription}
              onStartTenantConsent={handleStartTenantConsent}
              onValidateTenantConnection={handleValidateTenantConnection}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

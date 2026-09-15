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
import { EmptyState } from '@/components/ui';

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
    if (!selectedClient) return;

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
    if (!selectedClient) return;

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
    if (!selectedClient) return;

    setIsSubmitting(true);

    const result = await startTenantConnectionConsent(selectedClient.id, tenantConnectionId);

    if (result?.action.launchUrl) {
      window.open(result.action.launchUrl, '_blank', 'noopener,noreferrer');
    }

    setLastConsentMessage(result?.action.message ?? null);
    setIsSubmitting(false);
  }

  async function handleValidateTenantConnection(tenantConnectionId: string): Promise<void> {
    if (!selectedClient) return;

    setIsSubmitting(true);

    const result = await validateTenantConnection(selectedClient.id, tenantConnectionId);
    setLastConsentMessage(result?.action.message ?? null);

    setIsSubmitting(false);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <ClientScopeCard
        clients={clients}
        selectedClientSlug={selectedClientSlug}
        onSelectClientSlug={onSelectClientSlug}
        platformIdentity={platformIdentity}
        platformValidation={platformValidation}
        onRefreshClients={refreshClients}
        onValidatePlatformIdentity={validatePlatformIdentity}
        errorMessage={errorMessage}
      />

      <div className="grid content-start gap-4">
        <BootstrapClientCard formState={formState} isSubmitting={isSubmitting} onChange={setFormState} onSubmit={handleCreateClient} />

        <div className="grid gap-3 md:grid-cols-2">
          {clients.length === 0 ? (
            <EmptyState className="md:col-span-2">No client accounts yet. Create the first onboarded client to enable a scoped live feed.</EmptyState>
          ) : (
            clients.map((client) => (
              <ClientSummaryCard key={client.id} client={client} selected={client.slug === selectedClientSlug} onSelect={() => onSelectClientSlug(client.slug)} />
            ))
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
  );
}

import { useEffect, useState } from 'react';

import type {
  ClientAccountSummary,
  CreateClientAccountRequest,
  CreateAzureSubscriptionRequest,
  CreateTenantConnectionRequest,
  PlatformIdentitySummary,
  PlatformIdentityValidationResult,
  TenantConnectionActionResult
} from '@/types';

interface UseClientAccountsState {
  clients: ClientAccountSummary[];
  platformIdentity: PlatformIdentitySummary | null;
  platformValidation: PlatformIdentityValidationResult | null;
  isLoading: boolean;
  errorMessage: string | null;
  refreshClients: () => Promise<void>;
  createClientAccount: (input: CreateClientAccountRequest) => Promise<ClientAccountSummary | null>;
  addTenantConnection: (clientAccountId: string, input: CreateTenantConnectionRequest) => Promise<ClientAccountSummary | null>;
  addAzureSubscription: (clientAccountId: string, input: CreateAzureSubscriptionRequest) => Promise<ClientAccountSummary | null>;
  startTenantConnectionConsent: (clientAccountId: string, tenantConnectionId: string) => Promise<TenantConnectionActionResult | null>;
  validateTenantConnection: (clientAccountId: string, tenantConnectionId: string) => Promise<TenantConnectionActionResult | null>;
  validatePlatformIdentity: () => Promise<void>;
}

export function useClientAccounts(): UseClientAccountsState {
  const [clients, setClients] = useState<ClientAccountSummary[]>([]);
  const [platformIdentity, setPlatformIdentity] = useState<PlatformIdentitySummary | null>(null);
  const [platformValidation, setPlatformValidation] = useState<PlatformIdentityValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize(): Promise<void> {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [clientsResponse, platformIdentityResponse] = await Promise.all([
        fetch('/api/admin/clients'),
        fetch('/api/admin/platform-identity')
      ]);

      if (!clientsResponse.ok) {
        throw new Error(`Failed to load clients: ${clientsResponse.status}`);
      }

      if (!platformIdentityResponse.ok) {
        throw new Error(`Failed to load platform identity: ${platformIdentityResponse.status}`);
      }

      setClients((await clientsResponse.json()) as ClientAccountSummary[]);
      setPlatformIdentity((await platformIdentityResponse.json()) as PlatformIdentitySummary);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load MSP bootstrap data.');
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshClients(): Promise<void> {
    try {
      const response = await fetch('/api/admin/clients');

      if (!response.ok) {
        throw new Error(`Failed to refresh clients: ${response.status}`);
      }

      setClients((await response.json()) as ClientAccountSummary[]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh clients.');
    }
  }

  async function createClientAccount(input: CreateClientAccountRequest): Promise<ClientAccountSummary | null> {
    try {
      setErrorMessage(null);

      const response = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      });

      const payload = (await response.json()) as ClientAccountSummary | { error: string };

      if (!response.ok) {
        throw new Error('error' in payload ? payload.error : `Failed to create client: ${response.status}`);
      }

      const nextClient = payload as ClientAccountSummary;
      setClients((currentClients) => [nextClient, ...currentClients.filter((client) => client.id !== nextClient.id)]);
      return nextClient;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create client.');
      return null;
    }
  }

  async function addTenantConnection(
    clientAccountId: string,
    input: CreateTenantConnectionRequest
  ): Promise<ClientAccountSummary | null> {
    try {
      setErrorMessage(null);

      const response = await fetch(`/api/admin/clients/${encodeURIComponent(clientAccountId)}/tenant-connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      });

      const payload = (await response.json()) as ClientAccountSummary | { error: string };

      if (!response.ok) {
        throw new Error('error' in payload ? payload.error : `Failed to add tenant connection: ${response.status}`);
      }

      const nextClient = payload as ClientAccountSummary;
      setClients((currentClients) => currentClients.map((client) => (client.id === nextClient.id ? nextClient : client)));
      return nextClient;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add tenant connection.');
      return null;
    }
  }

  async function addAzureSubscription(
    clientAccountId: string,
    input: CreateAzureSubscriptionRequest
  ): Promise<ClientAccountSummary | null> {
    try {
      setErrorMessage(null);

      const response = await fetch(`/api/admin/clients/${encodeURIComponent(clientAccountId)}/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      });

      const payload = (await response.json()) as ClientAccountSummary | { error: string };

      if (!response.ok) {
        throw new Error('error' in payload ? payload.error : `Failed to add Azure subscription: ${response.status}`);
      }

      const nextClient = payload as ClientAccountSummary;
      setClients((currentClients) => currentClients.map((client) => (client.id === nextClient.id ? nextClient : client)));
      return nextClient;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add Azure subscription.');
      return null;
    }
  }

  async function startTenantConnectionConsent(
    clientAccountId: string,
    tenantConnectionId: string
  ): Promise<TenantConnectionActionResult | null> {
    try {
      setErrorMessage(null);

      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(clientAccountId)}/tenant-connections/${encodeURIComponent(tenantConnectionId)}/consent/start`,
        { method: 'POST' }
      );

      const payload = (await response.json()) as TenantConnectionActionResult | { error: string };

      if (!response.ok) {
        throw new Error('error' in payload ? payload.error : `Failed to start tenant consent: ${response.status}`);
      }

      const result = payload as TenantConnectionActionResult;
      setClients((currentClients) => currentClients.map((client) => (client.id === result.client.id ? result.client : client)));
      return result;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start tenant consent.');
      return null;
    }
  }

  async function validateTenantConnection(
    clientAccountId: string,
    tenantConnectionId: string
  ): Promise<TenantConnectionActionResult | null> {
    try {
      setErrorMessage(null);

      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(clientAccountId)}/tenant-connections/${encodeURIComponent(tenantConnectionId)}/validate`,
        { method: 'POST' }
      );

      const payload = (await response.json()) as TenantConnectionActionResult | { error: string };

      if (!response.ok) {
        throw new Error('error' in payload ? payload.error : `Failed to validate tenant connection: ${response.status}`);
      }

      const result = payload as TenantConnectionActionResult;
      setClients((currentClients) => currentClients.map((client) => (client.id === result.client.id ? result.client : client)));
      return result;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to validate tenant connection.');
      return null;
    }
  }

  async function validatePlatformIdentity(): Promise<void> {
    try {
      setErrorMessage(null);

      const response = await fetch('/api/admin/platform-identity/validate');
      if (!response.ok) {
        throw new Error(`Platform validation failed: ${response.status}`);
      }

      setPlatformValidation((await response.json()) as PlatformIdentityValidationResult);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to validate platform identity.');
    }
  }

  return {
    clients,
    platformIdentity,
    platformValidation,
    isLoading,
    errorMessage,
    refreshClients,
    createClientAccount,
    addTenantConnection,
    addAzureSubscription,
    startTenantConnectionConsent,
    validateTenantConnection,
    validatePlatformIdentity
  };
}

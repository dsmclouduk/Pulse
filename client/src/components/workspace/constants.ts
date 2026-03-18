import type {
  CreateAzureSubscriptionRequest,
  CreateClientAccountRequest,
  CreateTenantConnectionRequest
} from '@/types';

export const defaultClientFormState: CreateClientAccountRequest = {
  name: 'Contoso Managed Services',
  slug: 'contoso-managed-services',
  description: 'Initial MSP onboarding record for a managed customer.',
  primaryTenantId: '',
  defaultDomain: '',
  subscriptions: []
};

export const defaultTenantConnectionFormState: CreateTenantConnectionRequest = {
  tenantId: '',
  tenantDisplayName: ''
};

export const defaultSubscriptionFormState: CreateAzureSubscriptionRequest = {
  externalSubscriptionId: '',
  displayName: '',
  tenantId: '',
  tenantDisplayName: ''
};
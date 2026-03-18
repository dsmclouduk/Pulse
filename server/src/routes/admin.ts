import { Router } from 'express';

import type {
  CreateClientAccountRequest,
  CreateAzureSubscriptionRequest,
  CreateTenantConnectionRequest
} from '../../../shared/types.js';
import {
  addAzureSubscription,
  addTenantConnection,
  createClientAccount,
  getPlatformIdentitySummary,
  listClientAccounts,
  startTenantConnectionConsent,
  validateTenantConnection
} from '../lib/onboarding.js';
import { validatePlatformIdentity } from '../lib/platformIdentity.js';

export const adminRouter = Router();

function isCreateAzureSubscriptionRequest(value: unknown): value is CreateAzureSubscriptionRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CreateAzureSubscriptionRequest>;
  return Boolean(candidate.externalSubscriptionId && candidate.displayName);
}

function isCreateClientAccountRequest(value: unknown): value is CreateClientAccountRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CreateClientAccountRequest>;
  const subscriptionsValid = candidate.subscriptions === undefined
    || (Array.isArray(candidate.subscriptions) && candidate.subscriptions.every(isCreateAzureSubscriptionRequest));

  return Boolean(candidate.name && candidate.slug && subscriptionsValid);
}

function isCreateTenantConnectionRequest(value: unknown): value is CreateTenantConnectionRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CreateTenantConnectionRequest>;
  return Boolean(candidate.tenantId);
}

adminRouter.get('/platform-identity', (_request, response) => {
  response.json(getPlatformIdentitySummary());
});

adminRouter.get('/platform-identity/validate', async (_request, response) => {
  const validation = await validatePlatformIdentity();
  response.json(validation);
});

adminRouter.get('/clients', async (_request, response) => {
  const clients = await listClientAccounts();
  response.json(clients);
});

adminRouter.post('/clients', async (request, response) => {
  if (!isCreateClientAccountRequest(request.body)) {
    response.status(400).json({ error: 'Invalid client onboarding payload.' });
    return;
  }

  try {
    const client = await createClientAccount(request.body);
    response.status(201).json(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create client account.';
    response.status(400).json({ error: message });
  }
});

adminRouter.post('/clients/:clientAccountId/tenant-connections', async (request, response) => {
  if (!isCreateTenantConnectionRequest(request.body)) {
    response.status(400).json({ error: 'Invalid tenant connection payload.' });
    return;
  }

  try {
    const client = await addTenantConnection(request.params.clientAccountId, request.body);
    response.status(201).json(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add tenant connection.';
    response.status(400).json({ error: message });
  }
});

adminRouter.post('/clients/:clientAccountId/subscriptions', async (request, response) => {
  if (!isCreateAzureSubscriptionRequest(request.body)) {
    response.status(400).json({ error: 'Invalid subscription onboarding payload.' });
    return;
  }

  try {
    const client = await addAzureSubscription(request.params.clientAccountId, request.body);
    response.status(201).json(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add Azure subscription.';
    response.status(400).json({ error: message });
  }
});

adminRouter.post('/clients/:clientAccountId/tenant-connections/:tenantConnectionId/consent/start', async (request, response) => {
  try {
    const result = await startTenantConnectionConsent(request.params.clientAccountId, request.params.tenantConnectionId);
    response.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start tenant consent flow.';
    response.status(400).json({ error: message });
  }
});

adminRouter.post('/clients/:clientAccountId/tenant-connections/:tenantConnectionId/validate', async (request, response) => {
  try {
    const result = await validateTenantConnection(request.params.clientAccountId, request.params.tenantConnectionId);
    response.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to validate tenant connection.';
    response.status(400).json({ error: message });
  }
});

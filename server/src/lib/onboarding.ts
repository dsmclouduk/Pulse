import { randomBytes } from 'node:crypto';

import type {
  ClientAccountSummary,
  CreateClientAccountRequest,
  CreateAzureSubscriptionRequest,
  CreateTenantConnectionRequest,
  PlatformIdentitySummary,
  TenantConnectionActionResult,
  TenantConnectionSummary
} from '../../../shared/types.js';
import { createConsentStartSummary, createConsentValidationSummary } from './consentWorkflow.js';
import { prisma } from './prisma.js';

function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function createWebhookSecret(): string {
  return randomBytes(24).toString('hex');
}

function mapTenantConnectionSummary(connection: {
  id: string;
  tenantId: string;
  tenantDisplayName: string | null;
  consentStatus: string;
  validatedSubscriptionCount: number;
  lastValidatedAt: Date | null;
  lastValidationMessage: string | null;
}): TenantConnectionSummary {
  return {
    id: connection.id,
    tenantId: connection.tenantId,
    tenantDisplayName: connection.tenantDisplayName,
    consentStatus: connection.consentStatus,
    validatedSubscriptionCount: connection.validatedSubscriptionCount,
    lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null,
    lastValidationMessage: connection.lastValidationMessage ?? undefined
  };
}

function mapClientAccountSummary(client: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  primaryTenantId: string | null;
  defaultDomain: string | null;
  onboardingStatus: string;
  webhookSecret: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  azureSubscriptions: Array<{
    id: string;
    externalSubscriptionId: string;
    displayName: string;
    tenantId: string | null;
    status: string;
    onboardingStatus: string;
  }>;
  tenantConnections: Array<{
    id: string;
    tenantId: string;
    tenantDisplayName: string | null;
    consentStatus: string;
    validatedSubscriptionCount: number;
    lastValidatedAt: Date | null;
    lastValidationMessage: string | null;
  }>;
}): ClientAccountSummary {
  return {
    id: client.id,
    slug: client.slug,
    name: client.name,
    description: client.description ?? undefined,
    primaryTenantId: client.primaryTenantId,
    defaultDomain: client.defaultDomain,
    onboardingStatus: client.onboardingStatus,
    webhookSecret: client.webhookSecret,
    isActive: client.isActive,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    subscriptionCount: client.azureSubscriptions.length,
    tenantConnectionCount: client.tenantConnections.length,
    subscriptions: client.azureSubscriptions.map((subscription) => ({
      id: subscription.id,
      externalSubscriptionId: subscription.externalSubscriptionId,
      displayName: subscription.displayName,
      tenantId: subscription.tenantId,
      status: subscription.status,
      onboardingStatus: subscription.onboardingStatus
    })),
    tenantConnections: client.tenantConnections.map(mapTenantConnectionSummary)
  };
}

export function getPlatformIdentitySummary(): PlatformIdentitySummary {
  return {
    authMode: 'federated-service-principal',
    appServiceUrl: process.env.APP_SERVICE_URL ?? null,
    platformTenantIdConfigured: Boolean(process.env.AZURE_PLATFORM_TENANT_ID),
    platformClientIdConfigured: Boolean(process.env.AZURE_PLATFORM_CLIENT_ID),
    platformAppObjectIdConfigured: Boolean(process.env.AZURE_PLATFORM_APP_OBJECT_ID),
    keyVaultUriConfigured: Boolean(process.env.AZURE_KEY_VAULT_URI)
  };
}

async function requireClientAccount(clientAccountId: string) {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required before client onboarding can use Prisma persistence.');
  }

  return prisma.clientAccount.findUniqueOrThrow({
    where: {
      id: clientAccountId
    }
  });
}

async function fetchClientAccountSummary(clientAccountId: string): Promise<ClientAccountSummary> {
  const client = await prisma.clientAccount.findUniqueOrThrow({
    where: {
      id: clientAccountId
    },
    include: {
      azureSubscriptions: {
        orderBy: {
          displayName: 'asc'
        }
      },
      tenantConnections: {
        orderBy: {
          tenantId: 'asc'
        },
        select: {
          id: true,
          tenantId: true,
          tenantDisplayName: true,
          consentStatus: true,
          validatedSubscriptionCount: true,
          lastValidatedAt: true,
          lastValidationMessage: true
        }
      }
    }
  });

  return mapClientAccountSummary(client);
}

async function requireTenantConnection(clientAccountId: string, tenantConnectionId: string) {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required before tenant consent workflow can use Prisma persistence.');
  }

  return prisma.tenantConnection.findFirstOrThrow({
    where: {
      id: tenantConnectionId,
      clientAccountId
    }
  });
}

export async function listClientAccounts(): Promise<ClientAccountSummary[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const clients = await prisma.clientAccount.findMany({
    orderBy: {
      createdAt: 'desc'
    },
    include: {
      azureSubscriptions: {
        orderBy: {
          displayName: 'asc'
        }
      },
      tenantConnections: {
        orderBy: {
          tenantId: 'asc'
        },
        select: {
          id: true,
          tenantId: true,
          tenantDisplayName: true,
          consentStatus: true,
          validatedSubscriptionCount: true,
          lastValidatedAt: true,
          lastValidationMessage: true
        }
      }
    }
  });

  return clients.map(mapClientAccountSummary);
}

export async function createClientAccount(input: CreateClientAccountRequest): Promise<ClientAccountSummary> {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required before client onboarding can use Prisma persistence.');
  }

  const subscriptions = input.subscriptions ?? [];
  const uniqueTenantMap = new Map<string, { tenantId: string; tenantDisplayName?: string }>();

  for (const subscription of subscriptions) {
    if (subscription.tenantId && !uniqueTenantMap.has(subscription.tenantId)) {
      uniqueTenantMap.set(subscription.tenantId, {
        tenantId: subscription.tenantId,
        tenantDisplayName: subscription.tenantDisplayName
      });
    }
  }

  if (input.primaryTenantId && !uniqueTenantMap.has(input.primaryTenantId)) {
    uniqueTenantMap.set(input.primaryTenantId, {
      tenantId: input.primaryTenantId
    });
  }

  const client = await prisma.$transaction(async (transaction) => {
    const createdClient = await transaction.clientAccount.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        primaryTenantId: input.primaryTenantId,
        defaultDomain: input.defaultDomain,
        onboardingStatus: uniqueTenantMap.size > 0 ? 'PENDING_CONSENT' : 'PENDING_CONFIGURATION',
        webhookSecret: createWebhookSecret()
      }
    });

    const tenantConnections = uniqueTenantMap.size > 0
      ? await Promise.all(
          [...uniqueTenantMap.values()].map((tenant) =>
            transaction.tenantConnection.create({
              data: {
                clientAccountId: createdClient.id,
                tenantId: tenant.tenantId,
                tenantDisplayName: tenant.tenantDisplayName,
                consentStatus: 'PENDING'
              }
            })
          )
        )
      : [];

    const tenantConnectionByTenantId = new Map(tenantConnections.map((connection) => [connection.tenantId, connection.id]));

    if (subscriptions.length > 0) {
      await Promise.all(
        subscriptions.map((subscription) =>
          transaction.azureSubscription.create({
            data: {
              clientAccountId: createdClient.id,
              tenantConnectionId: subscription.tenantId ? tenantConnectionByTenantId.get(subscription.tenantId) : undefined,
              externalSubscriptionId: subscription.externalSubscriptionId,
              displayName: subscription.displayName,
              tenantId: subscription.tenantId,
              status: 'PENDING',
              onboardingStatus: 'PENDING_CONSENT',
              defaultWebhookSecret: createdClient.webhookSecret
            }
          })
        )
      );
    }

    return transaction.clientAccount.findUniqueOrThrow({
      where: {
        id: createdClient.id
      },
      include: {
        azureSubscriptions: {
          orderBy: {
            displayName: 'asc'
          }
        },
        tenantConnections: {
          orderBy: {
            tenantId: 'asc'
          },
          select: {
            id: true,
            tenantId: true,
            tenantDisplayName: true,
            consentStatus: true,
            validatedSubscriptionCount: true,
            lastValidatedAt: true,
            lastValidationMessage: true
          }
        }
      }
    });
  });

  return mapClientAccountSummary(client);
}

export async function addTenantConnection(
  clientAccountId: string,
  input: CreateTenantConnectionRequest
): Promise<ClientAccountSummary> {
  await requireClientAccount(clientAccountId);

  await prisma.tenantConnection.upsert({
    where: {
      clientAccountId_tenantId: {
        clientAccountId,
        tenantId: input.tenantId
      }
    },
    create: {
      clientAccountId,
      tenantId: input.tenantId,
      tenantDisplayName: input.tenantDisplayName,
      consentStatus: 'PENDING'
    },
    update: {
      tenantDisplayName: input.tenantDisplayName,
      consentStatus: 'PENDING',
      lastValidationMessage: null
    }
  });

  await prisma.clientAccount.update({
    where: {
      id: clientAccountId
    },
    data: {
      onboardingStatus: 'PENDING_CONSENT'
    }
  });

  return fetchClientAccountSummary(clientAccountId);
}

export async function addAzureSubscription(
  clientAccountId: string,
  input: CreateAzureSubscriptionRequest
): Promise<ClientAccountSummary> {
  const client = await requireClientAccount(clientAccountId);

  let tenantConnectionId: string | undefined;

  if (input.tenantId) {
    const tenantConnection = await prisma.tenantConnection.upsert({
      where: {
        clientAccountId_tenantId: {
          clientAccountId,
          tenantId: input.tenantId
        }
      },
      create: {
        clientAccountId,
        tenantId: input.tenantId,
        tenantDisplayName: input.tenantDisplayName,
        consentStatus: 'PENDING'
      },
      update: {
        tenantDisplayName: input.tenantDisplayName ?? undefined
      }
    });

    tenantConnectionId = tenantConnection.id;
  }

  await prisma.azureSubscription.upsert({
    where: {
      externalSubscriptionId: input.externalSubscriptionId
    },
    create: {
      clientAccountId,
      tenantConnectionId,
      externalSubscriptionId: input.externalSubscriptionId,
      displayName: input.displayName,
      tenantId: input.tenantId,
      status: 'PENDING',
      onboardingStatus: 'PENDING_CONSENT',
      defaultWebhookSecret: client.webhookSecret
    },
    update: {
      clientAccountId,
      tenantConnectionId,
      displayName: input.displayName,
      tenantId: input.tenantId,
      status: 'PENDING',
      onboardingStatus: 'PENDING_CONSENT',
      defaultWebhookSecret: client.webhookSecret
    }
  });

  await prisma.clientAccount.update({
    where: {
      id: clientAccountId
    },
    data: {
      onboardingStatus: 'PENDING_CONSENT'
    }
  });

  return fetchClientAccountSummary(clientAccountId);
}

export async function startTenantConnectionConsent(
  clientAccountId: string,
  tenantConnectionId: string
): Promise<TenantConnectionActionResult> {
  const tenantConnection = await requireTenantConnection(clientAccountId, tenantConnectionId);
  const action = createConsentStartSummary(tenantConnection.id, tenantConnection.tenantId);

  await prisma.tenantConnection.update({
    where: {
      id: tenantConnection.id
    },
    data: {
      consentStatus: action.consentStatus,
      lastValidationMessage: action.message
    }
  });

  return {
    client: await fetchClientAccountSummary(clientAccountId),
    action
  };
}

export async function validateTenantConnection(
  clientAccountId: string,
  tenantConnectionId: string
): Promise<TenantConnectionActionResult> {
  await requireTenantConnection(clientAccountId, tenantConnectionId);

  const platformReady = Boolean(process.env.APP_SERVICE_URL && process.env.AZURE_PLATFORM_CLIENT_ID);
  const action = createConsentValidationSummary(tenantConnectionId, platformReady);

  await prisma.tenantConnection.update({
    where: {
      id: tenantConnectionId
    },
    data: {
      consentStatus: action.consentStatus,
      lastValidatedAt: new Date(),
      lastValidationMessage: action.message
    }
  });

  return {
    client: await fetchClientAccountSummary(clientAccountId),
    action
  };
}

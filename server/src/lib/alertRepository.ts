import type { AlertEvent, AzureCommonAlertSchema } from '../../../shared/types.js';
import {
  clearAlerts,
  getAlerts as getMemoryAlerts,
  getMemoryAlertById,
  upsertAlert as upsertMemoryAlert
} from './alertStore.js';
import { prisma } from './prisma.js';

const ALERT_LIMIT = 500;

export interface AlertQueryFilters {
  clientAccountId?: string;
  clientSlug?: string;
  subscriptionId?: string;
}

export interface PersistAlertOptions {
  clientSlug?: string;
  webhookSecret?: string;
}

interface ResolvedAlertScope {
  clientAccountId?: string;
  clientSlug?: string;
  webhookSecretMatched: boolean;
}

function isPersistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function extractProviderType(resourceId: string | undefined): string {
  if (!resourceId) {
    return 'Unknown';
  }

  const parts = resourceId.split('/').filter(Boolean);
  const providersIndex = parts.findIndex((part) => part.toLowerCase() === 'providers');

  if (providersIndex === -1 || providersIndex + 2 >= parts.length) {
    return 'Unknown';
  }

  const providerNamespace = parts[providersIndex + 1];
  const resourceType = parts[providersIndex + 2];
  return `${providerNamespace}/${resourceType}`;
}

function mapStoredAlert(record: {
  externalAlertId: string;
  clientAccountId: string;
  clientSlugSnapshot: string | null;
  ruleName: string;
  severity: string;
  status: string;
  signalType: string;
  resourceIdsJson: string;
  resourceGroup: string | null;
  subscriptionExternalId: string | null;
  firedAt: Date;
  resolvedAt: Date | null;
  receivedAt: Date;
  lagMs: number;
  metricName: string | null;
  metricValue: number | null;
  threshold: number | null;
  description: string | null;
  isSimulated: boolean;
}): AlertEvent {
  return {
    id: record.externalAlertId,
    clientAccountId: record.clientAccountId,
    clientSlug: record.clientSlugSnapshot ?? undefined,
    ruleName: record.ruleName,
    severity: record.severity as AlertEvent['severity'],
    status: record.status as AlertEvent['status'],
    signalType: record.signalType as AlertEvent['signalType'],
    resourceIds: JSON.parse(record.resourceIdsJson) as string[],
    resourceGroup: record.resourceGroup ?? undefined,
    subscriptionId: record.subscriptionExternalId ?? undefined,
    firedAt: record.firedAt.toISOString(),
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    receivedAt: record.receivedAt.toISOString(),
    lagMs: record.lagMs,
    metricName: record.metricName ?? undefined,
    metricValue: record.metricValue ?? undefined,
    threshold: record.threshold ?? undefined,
    description: record.description ?? undefined,
    isSimulated: record.isSimulated
  };
}

async function resolveAlertScope(alert: AlertEvent, options: PersistAlertOptions): Promise<ResolvedAlertScope> {
  if (!isPersistenceConfigured()) {
    return {
      clientAccountId: undefined,
      clientSlug: options.clientSlug,
      webhookSecretMatched: false
    };
  }

  if (options.clientSlug) {
    const client = await prisma.clientAccount.findUnique({
      where: {
        slug: options.clientSlug
      }
    });

    return {
      clientAccountId: client?.id,
      clientSlug: client?.slug,
      webhookSecretMatched: false
    };
  }

  if (options.webhookSecret) {
    const client = await prisma.clientAccount.findFirst({
      where: {
        webhookSecret: options.webhookSecret
      }
    });

    return {
      clientAccountId: client?.id,
      clientSlug: client?.slug,
      webhookSecretMatched: Boolean(client)
    };
  }

  return {
    clientAccountId: undefined,
    clientSlug: undefined,
    webhookSecretMatched: false
  };
}

export async function canAuthorizeWebhookSecret(receivedSecret: string | undefined): Promise<boolean> {
  if (!receivedSecret) {
    return false;
  }

  if (process.env.WEBHOOK_SECRET && receivedSecret === process.env.WEBHOOK_SECRET) {
    return true;
  }

  if (!isPersistenceConfigured()) {
    return false;
  }

  const matchingClient = await prisma.clientAccount.findFirst({
    where: {
      webhookSecret: receivedSecret
    },
    select: {
      id: true
    }
  });

  return Boolean(matchingClient);
}

export async function persistAlert(
  alert: AlertEvent,
  rawPayload: AzureCommonAlertSchema,
  options: PersistAlertOptions = {}
): Promise<AlertEvent> {
  const scope = await resolveAlertScope(alert, options);
  const scopedAlert: AlertEvent = {
    ...alert,
    clientAccountId: scope.clientAccountId,
    clientSlug: scope.clientSlug
  };

  if (!isPersistenceConfigured() || !scope.clientAccountId) {
    upsertMemoryAlert(scopedAlert);
    return scopedAlert;
  }

  const clientAccountId = scope.clientAccountId;
  const primaryResourceId = alert.resourceIds[0];

  const persistedAlert = await prisma.$transaction(async (transaction) => {
    let subscription = null;

    if (alert.subscriptionId) {
      subscription = await transaction.azureSubscription.findFirst({
        where: {
          clientAccountId,
          externalSubscriptionId: alert.subscriptionId
        }
      });

      if (!subscription) {
        subscription = await transaction.azureSubscription.create({
          data: {
            clientAccountId,
            externalSubscriptionId: alert.subscriptionId,
            displayName: alert.subscriptionId,
            tenantId: null,
            status: 'DISCOVERED',
            onboardingStatus: 'DISCOVERED_BY_ALERT'
          }
        });
      }
    }

    let resource = null;

    if (primaryResourceId) {
      const resourcePathSegments = primaryResourceId.split('/').filter(Boolean);

      resource = await transaction.resource.findUnique({
        where: {
          resourceId: primaryResourceId
        }
      });

      if (!resource) {
        resource = await transaction.resource.create({
          data: {
            clientAccountId,
            azureSubscriptionId: subscription?.id,
            resourceId: primaryResourceId,
            providerType: extractProviderType(primaryResourceId),
            displayName: resourcePathSegments.at(-1) ?? primaryResourceId,
            resourceGroup: alert.resourceGroup,
            status: 'DISCOVERED'
          }
        });
      }
    }

    return transaction.alertEventRecord.upsert({
      where: {
        clientAccountId_externalAlertId: {
          clientAccountId,
          externalAlertId: alert.id
        }
      },
      create: {
        externalAlertId: alert.id,
        clientAccountId,
        clientSlugSnapshot: scope.clientSlug,
        azureSubscriptionId: subscription?.id,
        subscriptionExternalId: alert.subscriptionId,
        resourceIdRef: resource?.id,
        resourceIdsJson: JSON.stringify(alert.resourceIds),
        ruleName: alert.ruleName,
        severity: alert.severity,
        signalType: alert.signalType,
        status: alert.status,
        firedAt: new Date(alert.firedAt),
        resolvedAt: alert.resolvedAt ? new Date(alert.resolvedAt) : null,
        receivedAt: new Date(alert.receivedAt),
        lagMs: alert.lagMs,
        resourceGroup: alert.resourceGroup,
        metricName: alert.metricName,
        metricValue: alert.metricValue,
        threshold: alert.threshold,
        description: alert.description,
        rawPayloadJson: JSON.stringify(rawPayload),
        isSimulated: alert.isSimulated
      },
      update: {
        clientSlugSnapshot: scope.clientSlug,
        azureSubscriptionId: subscription?.id,
        subscriptionExternalId: alert.subscriptionId,
        resourceIdRef: resource?.id,
        resourceIdsJson: JSON.stringify(alert.resourceIds),
        ruleName: alert.ruleName,
        severity: alert.severity,
        signalType: alert.signalType,
        status: alert.status,
        firedAt: new Date(alert.firedAt),
        resolvedAt: alert.resolvedAt ? new Date(alert.resolvedAt) : null,
        receivedAt: new Date(alert.receivedAt),
        lagMs: alert.lagMs,
        resourceGroup: alert.resourceGroup,
        metricName: alert.metricName,
        metricValue: alert.metricValue,
        threshold: alert.threshold,
        description: alert.description,
        rawPayloadJson: JSON.stringify(rawPayload),
        isSimulated: alert.isSimulated
      }
    });
  });

  return mapStoredAlert(persistedAlert);
}

export async function listAlerts(filters: AlertQueryFilters = {}): Promise<AlertEvent[]> {
  if (!isPersistenceConfigured()) {
    const alerts = getMemoryAlerts();
    return alerts.filter((alert) => {
      if (filters.clientAccountId && alert.clientAccountId !== filters.clientAccountId) {
        return false;
      }

      if (filters.clientSlug && alert.clientSlug !== filters.clientSlug) {
        return false;
      }

      if (filters.subscriptionId && alert.subscriptionId !== filters.subscriptionId) {
        return false;
      }

      return true;
    });
  }

  const persistedAlerts = await prisma.alertEventRecord.findMany({
    where: {
      clientAccountId: filters.clientAccountId,
      clientSlugSnapshot: filters.clientSlug,
      subscriptionExternalId: filters.subscriptionId
    },
    orderBy: {
      receivedAt: 'desc'
    },
    take: ALERT_LIMIT
  });

  if (persistedAlerts.length === 0) {
    return getMemoryAlerts().filter((alert) => {
      if (filters.clientAccountId && alert.clientAccountId !== filters.clientAccountId) {
        return false;
      }

      if (filters.clientSlug && alert.clientSlug !== filters.clientSlug) {
        return false;
      }

      if (filters.subscriptionId && alert.subscriptionId !== filters.subscriptionId) {
        return false;
      }

      return true;
    });
  }

  return persistedAlerts.map(mapStoredAlert);
}

function matchesQueryFilters(alert: AlertEvent, filters: AlertQueryFilters): boolean {
  if (filters.clientAccountId && alert.clientAccountId !== filters.clientAccountId) {
    return false;
  }

  if (filters.clientSlug && alert.clientSlug !== filters.clientSlug) {
    return false;
  }

  if (filters.subscriptionId && alert.subscriptionId !== filters.subscriptionId) {
    return false;
  }

  return true;
}

export async function getAlertById(alertId: string, filters: AlertQueryFilters = {}): Promise<AlertEvent | null> {
  const memoryAlert = getMemoryAlertById(alertId);

  if (memoryAlert && matchesQueryFilters(memoryAlert, filters)) {
    return memoryAlert;
  }

  if (!isPersistenceConfigured()) {
    return null;
  }

  const record = await prisma.alertEventRecord.findFirst({
    where: {
      externalAlertId: alertId,
      clientAccountId: filters.clientAccountId,
      clientSlugSnapshot: filters.clientSlug,
      subscriptionExternalId: filters.subscriptionId
    },
    orderBy: {
      receivedAt: 'desc'
    }
  });

  return record ? mapStoredAlert(record) : null;
}

export function clearMemoryAlerts(): void {
  clearAlerts();
}

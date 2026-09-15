import type {
  AlertEvent,
  AlertSeverity,
  ClientOverview,
  ClientSubscriptionSummary,
  ResourceSummary
} from '../../../../shared/types.js';
import { listAlerts, type AlertQueryFilters } from '../alertRepository.js';
import { listRecentComments } from '../comments/commentRepository.js';
import { prisma } from '../prisma.js';
import { indexComments, summariseResources } from './resourceSummary.js';

/**
 * Tenant-level summary shown when the top of the resource tree is selected: who the client is, which
 * subscriptions Pulse knows about, and how their alerts have behaved. Counts come from the alerts and
 * resources Pulse actually holds — this is not an Azure inventory.
 */

const COMMENT_SCAN_LIMIT = 2000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isPersistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function emptySeverityCounts(): Record<AlertSeverity, number> {
  return { Sev0: 0, Sev1: 0, Sev2: 0, Sev3: 0, Sev4: 0 };
}

interface ClientRecord {
  name: string;
  onboardingStatus: string;
  isActive: boolean;
  createdAt: Date;
  primaryTenantId: string | null;
  tenantName?: string;
  subscriptions: Array<{
    externalSubscriptionId: string;
    displayName: string;
    tenantId: string | null;
    status: string;
    onboardingStatus: string;
  }>;
}

async function loadClientRecord(clientSlug: string): Promise<ClientRecord | null> {
  if (!isPersistenceConfigured()) {
    return null;
  }

  const client = await prisma.clientAccount.findUnique({
    where: { slug: clientSlug },
    select: {
      name: true,
      onboardingStatus: true,
      isActive: true,
      createdAt: true,
      primaryTenantId: true,
      tenantConnections: { select: { tenantId: true, tenantDisplayName: true } },
      azureSubscriptions: {
        select: {
          externalSubscriptionId: true,
          displayName: true,
          tenantId: true,
          status: true,
          onboardingStatus: true
        },
        orderBy: { displayName: 'asc' }
      }
    }
  });

  if (!client) {
    return null;
  }

  const connection =
    client.tenantConnections.find((entry) => entry.tenantId === client.primaryTenantId) ?? client.tenantConnections[0];

  return {
    name: client.name,
    onboardingStatus: client.onboardingStatus,
    isActive: client.isActive,
    createdAt: client.createdAt,
    primaryTenantId: client.primaryTenantId ?? connection?.tenantId ?? null,
    tenantName: connection?.tenantDisplayName ?? undefined,
    subscriptions: client.azureSubscriptions
  };
}

/** Pure: folds alerts and resources into the overview counters. */
export function summariseClient(
  alerts: AlertEvent[],
  resources: ResourceSummary[],
  diagnosisCount: number,
  noteCount: number,
  now: number
): Pick<
  ClientOverview,
  | 'resourceCount'
  | 'alertCount'
  | 'firingCount'
  | 'resolvedCount'
  | 'alertsLast30Days'
  | 'firingBySeverity'
  | 'lastAlertAt'
  | 'diagnosisCount'
  | 'noteCount'
  | 'simulatedOnly'
> {
  const firingBySeverity = emptySeverityCounts();
  let firingCount = 0;
  let alertsLast30Days = 0;
  let lastAlertAt: string | null = null;

  for (const alert of alerts) {
    if (alert.status === 'Fired') {
      firingCount += 1;
      firingBySeverity[alert.severity] += 1;
    }

    if (now - new Date(alert.firedAt).getTime() <= THIRTY_DAYS_MS) {
      alertsLast30Days += 1;
    }

    if (!lastAlertAt || alert.firedAt > lastAlertAt) {
      lastAlertAt = alert.firedAt;
    }
  }

  return {
    resourceCount: resources.length,
    alertCount: alerts.length,
    firingCount,
    resolvedCount: alerts.length - firingCount,
    alertsLast30Days,
    firingBySeverity,
    lastAlertAt,
    diagnosisCount,
    noteCount,
    simulatedOnly: alerts.length > 0 && alerts.every((alert) => alert.isSimulated)
  };
}

/**
 * `clientSlug` absent means the unscoped bucket (alerts that never resolved to a client account):
 * the counters still work, there is simply no onboarding record behind them.
 */
export async function getClientOverview(clientSlug: string | undefined, filters: AlertQueryFilters = {}): Promise<ClientOverview> {
  const scopedFilters: AlertQueryFilters = { ...filters, clientSlug };

  const [alerts, comments, record] = await Promise.all([
    listAlerts(scopedFilters),
    listRecentComments(COMMENT_SCAN_LIMIT, scopedFilters),
    clientSlug ? loadClientRecord(clientSlug) : Promise.resolve(null)
  ]);

  const scopedAlerts = clientSlug ? alerts : alerts.filter((alert) => !alert.clientSlug);
  const index = indexComments(comments);
  const resources = summariseResources(scopedAlerts, index);

  const diagnosisCount = comments.filter((comment) => comment.kind === 'diagnosis').length;
  const noteCount = comments.filter((comment) => comment.kind === 'note').length;

  const resourceCountBySubscription = new Map<string, number>();

  for (const resource of resources) {
    if (resource.subscriptionId) {
      resourceCountBySubscription.set(resource.subscriptionId, (resourceCountBySubscription.get(resource.subscriptionId) ?? 0) + 1);
    }
  }

  const subscriptions: ClientSubscriptionSummary[] = (record?.subscriptions ?? []).map((subscription) => ({
    externalSubscriptionId: subscription.externalSubscriptionId,
    displayName: subscription.displayName,
    tenantId: subscription.tenantId ?? undefined,
    status: subscription.status,
    onboardingStatus: subscription.onboardingStatus,
    resourceCount: resourceCountBySubscription.get(subscription.externalSubscriptionId) ?? 0
  }));

  // Subscriptions seen on alerts but never registered still deserve a row, or the count would lie.
  for (const [subscriptionId, resourceCount] of resourceCountBySubscription) {
    if (!subscriptions.some((entry) => entry.externalSubscriptionId === subscriptionId)) {
      subscriptions.push({
        externalSubscriptionId: subscriptionId,
        displayName: subscriptionId,
        resourceCount
      });
    }
  }

  return {
    clientSlug: clientSlug ?? null,
    clientName: record?.name ?? (clientSlug ?? 'Unscoped alerts'),
    tenantId: record?.primaryTenantId ?? undefined,
    tenantName: record?.tenantName,
    onboardingStatus: record?.onboardingStatus,
    isActive: record?.isActive,
    createdAt: record?.createdAt.toISOString(),
    subscriptions: subscriptions.sort((left, right) => right.resourceCount - left.resourceCount),
    ...summariseClient(scopedAlerts, resources, diagnosisCount, noteCount, Date.now())
  };
}

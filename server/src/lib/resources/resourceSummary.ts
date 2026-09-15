import type {
  AlertComment,
  AlertEvent,
  AlertSeverity,
  ResourceHistory,
  ResourceHistoryEntry,
  ResourceLastDiagnosis,
  ResourceSummary
} from '../../../../shared/types.js';
import { listAlerts, type AlertQueryFilters } from '../alertRepository.js';
import { listRecentComments } from '../comments/commentRepository.js';
import { applyScopeNames, loadScopeDirectory } from './scopeDirectory.js';

const SEVERITY_RANK: Record<AlertSeverity, number> = { Sev0: 0, Sev1: 1, Sev2: 2, Sev3: 3, Sev4: 4 };
const COMMENT_SCAN_LIMIT = 2000;

export function resourceNameFromId(resourceId: string): string {
  const parts = resourceId.split('/').filter(Boolean);
  return parts.at(-1) ?? resourceId;
}

/**
 * Azure is inconsistent about casing: alert payloads carry lower-cased ARM paths while our own
 * simulated ids use the canonical form, so the raw string cannot be used as a grouping key or the
 * same type appears twice. Always return the lower-cased type and pair it with a display label.
 */
export function resourceTypeFromId(resourceId: string): string {
  const parts = resourceId.split('/').filter(Boolean);
  const providersIndex = parts.findIndex((part) => part.toLowerCase() === 'providers');

  if (providersIndex === -1 || providersIndex + 2 >= parts.length) {
    return 'unknown';
  }

  return `${parts[providersIndex + 1]}/${parts[providersIndex + 2]}`.toLowerCase();
}

/** Display names for the types the baseline covers; anything else falls back to the raw segment. */
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  'microsoft.compute/virtualmachines': 'Virtual machines',
  'microsoft.compute/virtualmachinescalesets': 'VM scale sets',
  'microsoft.hybridcompute/machines': 'Arc servers',
  'microsoft.web/sites': 'App Services',
  'microsoft.web/serverfarms': 'App Service plans',
  'microsoft.sql/servers': 'SQL servers',
  'microsoft.sql/servers/databases': 'SQL databases',
  'microsoft.sql/servers/elasticpools': 'SQL elastic pools',
  'microsoft.storage/storageaccounts': 'Storage accounts',
  'microsoft.keyvault/vaults': 'Key vaults',
  'microsoft.containerservice/managedclusters': 'AKS clusters',
  'microsoft.network/applicationgateways': 'Application gateways',
  'microsoft.network/loadbalancers': 'Load balancers',
  'microsoft.network/virtualnetworkgateways': 'VPN gateways',
  'microsoft.network/azurefirewalls': 'Azure firewalls',
  'microsoft.network/publicipaddresses': 'Public IP addresses',
  'microsoft.documentdb/databaseaccounts': 'Cosmos DB accounts',
  'microsoft.cache/redis': 'Redis caches',
  'microsoft.servicebus/namespaces': 'Service Bus namespaces',
  'microsoft.recoveryservices/vaults': 'Recovery Services vaults',
  'microsoft.operationalinsights/workspaces': 'Log Analytics workspaces',
  'microsoft.insights/components': 'Application Insights',
  unknown: 'Other resources'
};

export function resourceTypeLabelFor(resourceType: string): string {
  const known = RESOURCE_TYPE_LABELS[resourceType.toLowerCase()];

  if (known) {
    return known;
  }

  const last = resourceType.split('/').at(-1) ?? resourceType;
  return last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
}

function firstLine(body: string): string {
  return (
    body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('**Urgency')) ?? ''
  ).slice(0, 240);
}

export function toLastDiagnosis(comment: AlertComment): ResourceLastDiagnosis {
  return {
    alertId: comment.alertId,
    commentId: comment.id,
    createdAt: comment.createdAt,
    urgency: comment.metadata?.urgency,
    pattern: comment.metadata?.trend?.pattern,
    summary: firstLine(comment.body),
    provider: comment.metadata?.provider
  };
}

export interface CommentIndex {
  latestDiagnosisByAlert: Map<string, AlertComment>;
  noteCountByAlert: Map<string, number>;
}

export function indexComments(comments: AlertComment[]): CommentIndex {
  const latestDiagnosisByAlert = new Map<string, AlertComment>();
  const noteCountByAlert = new Map<string, number>();

  for (const comment of comments) {
    if (comment.kind === 'diagnosis') {
      const existing = latestDiagnosisByAlert.get(comment.alertId);
      if (!existing || comment.createdAt > existing.createdAt) {
        latestDiagnosisByAlert.set(comment.alertId, comment);
      }
    } else if (comment.kind === 'note') {
      noteCountByAlert.set(comment.alertId, (noteCountByAlert.get(comment.alertId) ?? 0) + 1);
    }
  }

  return { latestDiagnosisByAlert, noteCountByAlert };
}

/** Pure: groups alerts by primary resource id into resource summaries, newest alert first. */
export function summariseResources(alerts: AlertEvent[], comments: CommentIndex): ResourceSummary[] {
  const byResource = new Map<string, AlertEvent[]>();

  for (const alert of alerts) {
    const resourceId = alert.resourceIds[0];
    if (!resourceId) continue;
    (byResource.get(resourceId) ?? byResource.set(resourceId, []).get(resourceId))!.push(alert);
  }

  const summaries: ResourceSummary[] = [];

  for (const [resourceId, group] of byResource) {
    const sorted = [...group].sort((left, right) => new Date(right.firedAt).getTime() - new Date(left.firedAt).getTime());
    const firing = sorted.filter((alert) => alert.status === 'Fired');
    const highest = firing.reduce<AlertSeverity | null>(
      (best, alert) => (best === null || SEVERITY_RANK[alert.severity] < SEVERITY_RANK[best] ? alert.severity : best),
      null
    );

    let lastDiagnosis: ResourceLastDiagnosis | null = null;
    let noteCount = 0;

    for (const alert of sorted) {
      noteCount += comments.noteCountByAlert.get(alert.id) ?? 0;
      const diagnosis = comments.latestDiagnosisByAlert.get(alert.id);
      if (diagnosis && (!lastDiagnosis || diagnosis.createdAt > lastDiagnosis.createdAt)) {
        lastDiagnosis = toLastDiagnosis(diagnosis);
      }
    }

    const last = sorted[0];

    summaries.push({
      resourceId,
      name: resourceNameFromId(resourceId),
      resourceType: resourceTypeFromId(resourceId),
      resourceTypeLabel: resourceTypeLabelFor(resourceTypeFromId(resourceId)),
      resourceGroup: last.resourceGroup,
      subscriptionId: last.subscriptionId,
      clientSlug: last.clientSlug,
      firstSeenAt: sorted[sorted.length - 1].firedAt,
      lastAlertAt: last.firedAt,
      alertCount: sorted.length,
      firingCount: firing.length,
      resolvedCount: sorted.length - firing.length,
      highestFiringSeverity: highest,
      lastAlert: {
        id: last.id,
        ruleName: last.ruleName,
        severity: last.severity,
        status: last.status,
        metricName: last.metricName,
        metricValue: last.metricValue,
        threshold: last.threshold,
        firedAt: last.firedAt
      },
      noteCount,
      lastDiagnosis,
      isSimulated: sorted.every((alert) => alert.isSimulated)
    });
  }

  return summaries.sort((left, right) => new Date(right.lastAlertAt).getTime() - new Date(left.lastAlertAt).getTime());
}

export async function listResourceSummaries(filters: AlertQueryFilters = {}): Promise<ResourceSummary[]> {
  const [alerts, comments, directory] = await Promise.all([
    listAlerts(filters),
    listRecentComments(COMMENT_SCAN_LIMIT, filters),
    loadScopeDirectory()
  ]);

  return applyScopeNames(summariseResources(alerts, indexComments(comments)), directory);
}

export async function getResourceHistory(resourceId: string, filters: AlertQueryFilters = {}): Promise<ResourceHistory> {
  const [alerts, comments] = await Promise.all([listAlerts(filters), listRecentComments(COMMENT_SCAN_LIMIT, filters)]);
  const index = indexComments(comments);
  const own = alerts
    .filter((alert) => alert.resourceIds[0] === resourceId)
    .sort((left, right) => new Date(right.firedAt).getTime() - new Date(left.firedAt).getTime());

  const entries: ResourceHistoryEntry[] = own.map((alert) => {
    const diagnosis = index.latestDiagnosisByAlert.get(alert.id);
    return {
      alert,
      diagnosis: diagnosis ? toLastDiagnosis(diagnosis) : null,
      noteCount: index.noteCountByAlert.get(alert.id) ?? 0,
      durationMs: alert.resolvedAt ? new Date(alert.resolvedAt).getTime() - new Date(alert.firedAt).getTime() : null
    };
  });

  return {
    resource: summariseResources(own, index)[0] ?? null,
    entries
  };
}

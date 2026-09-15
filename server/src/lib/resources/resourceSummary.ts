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

const SEVERITY_RANK: Record<AlertSeverity, number> = { Sev0: 0, Sev1: 1, Sev2: 2, Sev3: 3, Sev4: 4 };
const COMMENT_SCAN_LIMIT = 2000;

export function resourceNameFromId(resourceId: string): string {
  const parts = resourceId.split('/').filter(Boolean);
  return parts.at(-1) ?? resourceId;
}

export function resourceTypeFromId(resourceId: string): string {
  const parts = resourceId.split('/').filter(Boolean);
  const providersIndex = parts.findIndex((part) => part.toLowerCase() === 'providers');

  if (providersIndex === -1 || providersIndex + 2 >= parts.length) {
    return 'unknown';
  }

  return `${parts[providersIndex + 1]}/${parts[providersIndex + 2]}`;
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
  const [alerts, comments] = await Promise.all([listAlerts(filters), listRecentComments(COMMENT_SCAN_LIMIT, filters)]);
  return summariseResources(alerts, indexComments(comments));
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

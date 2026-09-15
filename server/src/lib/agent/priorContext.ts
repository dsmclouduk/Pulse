import type { AlertComment, AlertEvent, PriorAlertContext, PriorAlertReference } from '../../../../shared/types.js';
import { listAlerts } from '../alertRepository.js';
import { listRecentComments } from '../comments/commentRepository.js';
import { indexComments, resourceNameFromId, resourceTypeFromId } from '../resources/resourceSummary.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SAME_RESOURCE = 5;
const MAX_SIMILAR = 5;
const MAX_NOTES = 3;
const NOTE_LENGTH = 200;

function firstLine(body: string): string {
  return (
    body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('**Urgency')) ?? ''
  ).slice(0, 240);
}

function toReference(alert: AlertEvent, diagnosis: AlertComment | undefined, notes: AlertComment[]): PriorAlertReference {
  return {
    alertId: alert.id,
    ruleName: alert.ruleName,
    resourceName: resourceNameFromId(alert.resourceIds[0] ?? ''),
    clientSlug: alert.clientSlug,
    firedAt: alert.firedAt,
    resolvedAt: alert.resolvedAt,
    severity: alert.severity,
    metricName: alert.metricName,
    metricValue: alert.metricValue,
    diagnosisSummary: diagnosis ? firstLine(diagnosis.body) : undefined,
    diagnosisUrgency: diagnosis?.metadata?.urgency,
    trendPattern: diagnosis?.metadata?.trend?.pattern,
    notes: notes
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_NOTES)
      .map((note) => note.body.replace(/\s+/g, ' ').trim().slice(0, NOTE_LENGTH))
  };
}

/**
 * Earlier alerts the agent should know about: previous alerts on the same resource (recurrence),
 * and similar alerts on the same resource type anywhere, across clients, so a resolution noted
 * for one client can inform another. Operator notes are untrusted text and are sanitised in the prompt.
 */
export async function buildPriorContext(alert: AlertEvent, now: Date = new Date()): Promise<PriorAlertContext> {
  // Deliberately unscoped: cross-client similarity is the point. Only summaries and notes travel, never raw payloads.
  const [alerts, comments] = await Promise.all([listAlerts({}), listRecentComments(2000, {})]);
  const index = indexComments(comments);
  const notesByAlert = new Map<string, AlertComment[]>();

  for (const comment of comments) {
    if (comment.kind === 'note') {
      (notesByAlert.get(comment.alertId) ?? notesByAlert.set(comment.alertId, []).get(comment.alertId))!.push(comment);
    }
  }

  const resourceId = alert.resourceIds[0];
  const resourceType = resourceTypeFromId(resourceId ?? '').toLowerCase();
  const metric = alert.metricName?.toLowerCase();
  const others = alerts
    .filter((candidate) => candidate.id !== alert.id)
    .sort((left, right) => new Date(right.firedAt).getTime() - new Date(left.firedAt).getTime());

  const sameResource = others.filter((candidate) => resourceId && candidate.resourceIds[0] === resourceId);
  const similar = others.filter(
    (candidate) =>
      candidate.resourceIds[0] !== resourceId &&
      resourceTypeFromId(candidate.resourceIds[0] ?? '').toLowerCase() === resourceType &&
      (metric ? candidate.metricName?.toLowerCase() === metric : candidate.ruleName === alert.ruleName)
  );

  const withContext = (candidate: AlertEvent) =>
    toReference(candidate, index.latestDiagnosisByAlert.get(candidate.id), notesByAlert.get(candidate.id) ?? []);

  return {
    sameResource: sameResource.slice(0, MAX_SAME_RESOURCE).map(withContext),
    // Prefer similar alerts that carry a diagnosis or a note; they are the ones with something to teach.
    similar: similar
      .filter((candidate) => index.latestDiagnosisByAlert.has(candidate.id) || notesByAlert.has(candidate.id))
      .slice(0, MAX_SIMILAR)
      .map(withContext),
    sameResourceCount30d: sameResource.filter((candidate) => now.getTime() - new Date(candidate.firedAt).getTime() <= 30 * DAY_MS).length
  };
}

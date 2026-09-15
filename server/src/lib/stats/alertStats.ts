import type {
  AlertComment,
  AlertEnrichmentStatus,
  AlertEvent,
  AlertSeverity,
  AlertStats,
  DiagnosisUrgency,
  TrendPattern
} from '../../../../shared/types.js';
import { listAlerts, type AlertQueryFilters } from '../alertRepository.js';
import { listRecentComments } from '../comments/commentRepository.js';
import { listStatuses } from '../enrichment/enrichmentStatusStore.js';
import { indexComments, summariseResources } from '../resources/resourceSummary.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVERITIES: AlertSeverity[] = ['Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'];
const URGENCIES: DiagnosisUrgency[] = ['immediate', 'soon', 'planned', 'informational'];
const PATTERNS: TrendPattern[] = ['rapid-fill', 'steady-growth', 'declining', 'volatile', 'flat', 'insufficient-data'];

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Pure computation so it can be unit-tested and reused for per-client dashboards. */
export function computeAlertStats(
  alerts: AlertEvent[],
  comments: AlertComment[],
  statuses: AlertEnrichmentStatus[],
  now: Date = new Date(),
  clientSlug?: string
): AlertStats {
  const nowMs = now.getTime();
  const index = indexComments(comments);
  const resources = summariseResources(alerts, index);

  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, { firing: 0, total: 0 }])) as AlertStats['bySeverity'];
  const byUrgency = Object.fromEntries(URGENCIES.map((urgency) => [urgency, 0])) as AlertStats['byUrgency'];
  const byPattern = Object.fromEntries(PATTERNS.map((pattern) => [pattern, 0])) as AlertStats['byPattern'];
  const ruleCounts = new Map<string, { count: number; firing: number }>();
  const lags: number[] = [];
  const resolutionTimes: number[] = [];
  const perDayMap = new Map<string, { fired: number; resolved: number }>();

  for (let offset = 6; offset >= 0; offset -= 1) {
    perDayMap.set(new Date(nowMs - offset * DAY_MS).toISOString().slice(0, 10), { fired: 0, resolved: 0 });
  }

  let firing = 0;
  let simulated = 0;
  let fired24h = 0;
  let resolved24h = 0;

  for (const alert of alerts) {
    bySeverity[alert.severity].total += 1;
    if (alert.status === 'Fired') {
      firing += 1;
      bySeverity[alert.severity].firing += 1;
    }
    if (alert.isSimulated) simulated += 1;

    lags.push(alert.lagMs);

    const firedMs = new Date(alert.firedAt).getTime();
    if (nowMs - firedMs <= DAY_MS) fired24h += 1;

    const firedDay = alert.firedAt.slice(0, 10);
    const dayBucket = perDayMap.get(firedDay);
    if (dayBucket) dayBucket.fired += 1;

    if (alert.resolvedAt) {
      const resolvedMs = new Date(alert.resolvedAt).getTime();
      if (nowMs - resolvedMs <= DAY_MS) resolved24h += 1;
      if (resolvedMs >= firedMs) resolutionTimes.push(resolvedMs - firedMs);
      const resolvedBucket = perDayMap.get(alert.resolvedAt.slice(0, 10));
      if (resolvedBucket) resolvedBucket.resolved += 1;
    }

    const rule = ruleCounts.get(alert.ruleName) ?? { count: 0, firing: 0 };
    rule.count += 1;
    if (alert.status === 'Fired') rule.firing += 1;
    ruleCounts.set(alert.ruleName, rule);

    const diagnosis = index.latestDiagnosisByAlert.get(alert.id);
    if (diagnosis?.metadata?.urgency) byUrgency[diagnosis.metadata.urgency] += 1;
    if (diagnosis?.metadata?.trend?.pattern) byPattern[diagnosis.metadata.trend.pattern] += 1;
  }

  const alertIds = new Set(alerts.map((alert) => alert.id));
  const relevantStatuses = statuses.filter((status) => alertIds.has(status.alertId));
  let ruleBased = 0;
  let llm = 0;

  for (const alert of alerts) {
    const diagnosis = index.latestDiagnosisByAlert.get(alert.id);
    if (!diagnosis) continue;
    if (diagnosis.metadata?.isFallback) ruleBased += 1;
    else llm += 1;
  }

  return {
    generatedAt: now.toISOString(),
    clientSlug,
    totals: {
      alerts: alerts.length,
      firing,
      resolved: alerts.length - firing,
      resources: resources.length,
      simulated
    },
    bySeverity,
    byUrgency,
    byPattern,
    last24h: { fired: fired24h, resolved: resolved24h },
    lag: {
      averageMs: average(lags),
      p95Ms: percentile(lags, 95),
      over30sCount: lags.filter((lag) => lag > 30_000).length
    },
    meanTimeToResolveMs: average(resolutionTimes),
    perDay: [...perDayMap.entries()].map(([date, counts]) => ({ date, ...counts })),
    topResources: resources
      .slice()
      .sort((left, right) => right.alertCount - left.alertCount || right.firingCount - left.firingCount)
      .slice(0, 8)
      .map(({ resourceId, name, resourceType, alertCount, firingCount, highestFiringSeverity }) => ({
        resourceId,
        name,
        resourceType,
        alertCount,
        firingCount,
        highestFiringSeverity
      })),
    topRules: [...ruleCounts.entries()]
      .map(([ruleName, counts]) => ({ ruleName, ...counts }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 8),
    enrichment: {
      diagnosed: ruleBased + llm,
      ruleBased,
      llm,
      failed: relevantStatuses.filter((status) => status.state === 'failed').length,
      active: relevantStatuses.filter((status) => ['queued', 'fetching-history', 'analysing', 'diagnosing'].includes(status.state)).length
    }
  };
}

export async function getAlertStats(filters: AlertQueryFilters = {}): Promise<AlertStats> {
  const [alerts, comments] = await Promise.all([listAlerts(filters), listRecentComments(2000, filters)]);
  return computeAlertStats(alerts, comments, listStatuses(), new Date(), filters.clientSlug);
}

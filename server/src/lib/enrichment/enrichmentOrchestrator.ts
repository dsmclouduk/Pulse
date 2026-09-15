import type {
  AlertEnrichmentDetail,
  AlertEnrichmentStatus,
  AlertEvent,
  MetricHistoryResult,
  TrendAnalysis
} from '../../../../shared/types.js';
import type { AgentDiagnosis } from '../agent/agentProvider.js';
import { agentAuthorName, renderDiagnosisMarkdown } from '../agent/formatDiagnosisComment.js';
import { resolveAgentProvider } from '../agent/resolveAgentProvider.js';
import type { AlertQueryFilters } from '../alertRepository.js';
import { downsamplePoints } from '../analysis/downsample.js';
import { analyseTrend, valueAt, pickValue } from '../analysis/trendAnalysis.js';
import { addComment, listComments } from '../comments/commentRepository.js';
import { resolveHistoryProvider } from '../metrics/historyProviders.js';
import { broadcastComment } from '../sseRegistry.js';
import { getEnrichmentConfig } from './enrichmentConfig.js';
import {
  getHistory,
  getStatus,
  isInflight,
  lastCompletedAt,
  markCompleted,
  markInflight,
  setHistory,
  setStatus
} from './enrichmentStatusStore.js';
import { planMetricHistory } from './metricRequestPlanner.js';

const MAX_POINTS_PER_SERIES = 400;
const HOUR_MS = 60 * 60 * 1000;

export interface EnrichmentOptions {
  trigger: 'ingest' | 'rerun';
  force?: boolean;
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [enrichment] ${message}`);
}

function baseStatus(alert: AlertEvent, options: EnrichmentOptions): AlertEnrichmentStatus {
  const now = new Date().toISOString();

  return {
    alertId: alert.id,
    clientAccountId: alert.clientAccountId,
    clientSlug: alert.clientSlug,
    subscriptionId: alert.subscriptionId,
    state: 'queued',
    trigger: options.trigger,
    startedAt: now,
    updatedAt: now,
    completedAt: null
  };
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);

  if (minutes < 1) {
    return 'under a minute';
  }

  if (minutes < 120) {
    return `${minutes} min`;
  }

  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

async function postStatusComment(alert: AlertEvent, body: string, trigger: EnrichmentOptions['trigger']): Promise<void> {
  const comment = await addComment({
    alert,
    author: { kind: 'system', name: 'Pulse' },
    kind: 'status',
    body,
    metadata: { enrichmentTrigger: trigger }
  });
  broadcastComment(comment);
}

/**
 * Decides whether to enrich and kicks off the pipeline without awaiting it.
 * Returns false when the alert was skipped (disabled, already running, cooling down, resolved).
 */
export function scheduleEnrichment(alert: AlertEvent, options: EnrichmentOptions): boolean {
  const config = getEnrichmentConfig();

  if (!config.enabled) {
    return false;
  }

  if (isInflight(alert.id)) {
    log(`skip alert=${alert.id} reason=inflight`);
    return false;
  }

  if (alert.status === 'Resolved') {
    void handleResolved(alert, options, config.onResolved);
    return false;
  }

  const completed = lastCompletedAt(alert.id);

  if (!options.force && !alert.isSimulated && completed !== null && Date.now() - completed < config.cooldownMs) {
    log(`skip alert=${alert.id} reason=cooldown remainingMs=${config.cooldownMs - (Date.now() - completed)}`);
    return false;
  }

  const run = runEnrichment(alert, options).catch((error) => {
    log(`unexpected failure alert=${alert.id}: ${error instanceof Error ? error.message : String(error)}`);
  });

  markInflight(alert.id, run);
  return true;
}

async function handleResolved(alert: AlertEvent, options: EnrichmentOptions, mode: 'note' | 'skip'): Promise<void> {
  const status = setStatus({
    ...baseStatus(alert, options),
    state: 'skipped',
    completedAt: new Date().toISOString(),
    message: 'Alert resolved; no diagnosis required.'
  });

  if (mode === 'skip') {
    return;
  }

  try {
    const firedMs = new Date(alert.firedAt).getTime();
    const resolvedMs = alert.resolvedAt ? new Date(alert.resolvedAt).getTime() : Date.now();
    const duration = formatDuration(Math.max(0, resolvedMs - firedMs));

    await postStatusComment(
      alert,
      `Resolved after ${duration} (rule "${alert.ruleName}").${alert.metricValue !== undefined ? ` Last reported value ${alert.metricValue}.` : ''}`,
      options.trigger
    );
  } catch (error) {
    log(`resolved note failed alert=${status.alertId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function overrideRecentDeltas(trend: TrendAnalysis, zoom: MetricHistoryResult | undefined): TrendAnalysis {
  const series = zoom?.series[0];

  if (!series || series.points.length < 2) {
    return trend;
  }

  const points = series.points
    .map((point) => ({ t: new Date(point.timestamp).getTime(), v: pickValue(point, series.aggregation) }))
    .filter((point): point is { t: number; v: number } => point.v !== undefined && Number.isFinite(point.t))
    .sort((left, right) => left.t - right.t);

  if (points.length < 2) {
    return trend;
  }

  const last = points[points.length - 1];
  const sixHoursAgo = valueAt(points, last.t - 6 * HOUR_MS);
  const dayAgo = valueAt(points, last.t - 24 * HOUR_MS);

  return {
    ...trend,
    delta6h: sixHoursAgo === null ? trend.delta6h : Math.round((last.v - sixHoursAgo) * 100) / 100,
    delta24h: dayAgo === null ? trend.delta24h : Math.round((last.v - dayAgo) * 100) / 100,
    recentRatePerDay: dayAgo === null ? trend.recentRatePerDay : Math.round((last.v - dayAgo) * 100) / 100
  };
}

export async function runEnrichment(alert: AlertEvent, options: EnrichmentOptions): Promise<void> {
  const config = getEnrichmentConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();

  let status = setStatus(baseStatus(alert, options));

  try {
    // 1. Fetch history.
    const plan = planMetricHistory(alert, config);
    status = setStatus({ ...status, state: 'fetching-history', message: plan.reason });

    const settled = await Promise.allSettled(
      plan.requests.map((request) => resolveHistoryProvider(request.source).fetchHistory(request, { signal: controller.signal }))
    );

    const history: MetricHistoryResult[] = settled.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : {
            request: plan.requests[index],
            provider: plan.requests[index].source,
            fetchedAt: new Date().toISOString(),
            status: 'error',
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
            series: []
          }
    );

    setHistory(alert.id, history);

    const primary = plan.primaryIndex >= 0 ? history[plan.primaryIndex] : undefined;
    const zoom = history.find((result) => result.request.label === 'zoom' && result.status === 'ready');
    const historySource = primary?.request.source ?? 'none';

    // 2. Analyse.
    status = setStatus({ ...status, state: 'analysing', historySource });

    let trend: TrendAnalysis | null = null;

    if (primary?.status === 'ready' && primary.series[0]) {
      trend = analyseTrend(primary.series[0], {
        ceiling: primary.request.ceiling,
        threshold: alert.threshold
      });
      trend = overrideRecentDeltas(trend, zoom);
    }

    // 3. Diagnose.
    const { primary: agent, fallback } = resolveAgentProvider();
    status = setStatus({
      ...status,
      state: 'diagnosing',
      trend,
      agentProvider: agent.name,
      agentModel: agent.name === 'anthropic' ? config.agentModel : undefined
    });

    let diagnosis: AgentDiagnosis;

    try {
      diagnosis = await agent.diagnose({ alert, trend, history }, { signal: controller.signal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`agent ${agent.name} failed alert=${alert.id}: ${reason}`);

      if (agent.name === fallback.name) {
        throw error;
      }

      await postStatusComment(alert, `LLM diagnosis failed (${reason}). Fell back to the rule-based diagnosis.`, options.trigger);
      diagnosis = await fallback.diagnose({ alert, trend, history }, { signal: controller.signal });
    }

    const body = renderDiagnosisMarkdown(diagnosis, trend, alert);
    const comment = await addComment({
      alert,
      author: { kind: 'agent', name: agentAuthorName(diagnosis.provider) },
      kind: 'diagnosis',
      body,
      metadata: {
        provider: diagnosis.provider,
        model: diagnosis.model,
        isFallback: diagnosis.isFallback,
        confidence: diagnosis.confidence,
        urgency: diagnosis.urgency,
        recommendedActions: diagnosis.recommendedActions,
        trend: trend
          ? {
              pattern: trend.pattern,
              slopePerDay: trend.slopePerDay,
              delta6h: trend.delta6h,
              delta24h: trend.delta24h,
              last: trend.last,
              projectedDaysToCeiling: trend.projectedDaysToCeiling,
              suggestedUrgency: trend.suggestedUrgency
            }
          : undefined,
        usage: diagnosis.usage,
        durationMs: Date.now() - startedAt,
        enrichmentTrigger: options.trigger
      }
    });

    broadcastComment(comment);

    setStatus({
      ...status,
      state: 'complete',
      completedAt: new Date().toISOString(),
      message: undefined,
      agentProvider: diagnosis.provider,
      agentModel: diagnosis.model,
      urgency: diagnosis.urgency,
      diagnosisCommentId: comment.id
    });

    markCompleted(alert.id);
    log(
      `complete alert=${alert.id} pattern=${trend?.pattern ?? 'none'} urgency=${diagnosis.urgency} provider=${diagnosis.provider} source=${historySource} ${Date.now() - startedAt}ms`
    );
  } catch (error) {
    const reason = controller.signal.aborted
      ? `timed out after ${config.timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);

    log(`failed alert=${alert.id}: ${reason}`);

    setStatus({
      ...status,
      state: 'failed',
      completedAt: new Date().toISOString(),
      message: reason
    });

    try {
      await postStatusComment(alert, `Enrichment failed: ${reason}`, options.trigger);
    } catch (commentError) {
      log(`failure note failed alert=${alert.id}: ${commentError instanceof Error ? commentError.message : String(commentError)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function getEnrichmentDetail(alertId: string, filters: AlertQueryFilters = {}): Promise<AlertEnrichmentDetail | null> {
  const status = getStatus(alertId);

  if (!status) {
    return null;
  }

  const history = getHistory(alertId).map((result) => ({
    ...result,
    series: result.series.map((series) => ({
      ...series,
      points: downsamplePoints(series.points, MAX_POINTS_PER_SERIES)
    }))
  }));

  return {
    ...status,
    history,
    comments: await listComments(alertId, filters)
  };
}

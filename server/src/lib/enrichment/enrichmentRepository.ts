import type {
  AlertEnrichmentStatus,
  DiagnosisUrgency,
  EnrichmentState,
  MetricHistoryResult,
  MetricHistorySource,
  TrendAnalysis
} from '../../../../shared/types.js';
import { prisma } from '../prisma.js';

/**
 * Persists finished enrichment runs to Prisma `AlertEnrichment` so status, trend and history survive
 * a restart. Mirrors commentRepository: only alerts that belong to a client account are stored;
 * everything else stays in memory. In-flight states are never written, so a crash mid-run cannot
 * leave a row stuck in "fetching-history".
 */

const TERMINAL_STATES: ReadonlySet<EnrichmentState> = new Set<EnrichmentState>(['complete', 'failed', 'skipped']);

export interface StoredEnrichment {
  status: AlertEnrichmentStatus;
  history: MetricHistoryResult[];
}

function isPersistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function isTerminalState(state: EnrichmentState): boolean {
  return TERMINAL_STATES.has(state);
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

interface StoredEnrichmentRow {
  externalAlertId: string;
  clientAccountId: string;
  state: string;
  trigger: string;
  historySource: string | null;
  agentProvider: string | null;
  agentModel: string | null;
  urgency: string | null;
  message: string | null;
  trendJson: string | null;
  historyJson: string | null;
  diagnosisCommentId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  alertEvent?: { clientSlugSnapshot: string | null; subscriptionExternalId: string | null } | null;
}

export function mapStoredEnrichment(row: StoredEnrichmentRow): StoredEnrichment {
  const status: AlertEnrichmentStatus = {
    alertId: row.externalAlertId,
    clientAccountId: row.clientAccountId,
    clientSlug: row.alertEvent?.clientSlugSnapshot ?? undefined,
    subscriptionId: row.alertEvent?.subscriptionExternalId ?? undefined,
    state: row.state as EnrichmentState,
    trigger: row.trigger === 'rerun' ? 'rerun' : 'ingest',
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    message: row.message ?? undefined,
    historySource: (row.historySource ?? undefined) as MetricHistorySource | undefined,
    agentProvider: row.agentProvider ?? undefined,
    agentModel: row.agentModel ?? undefined,
    urgency: (row.urgency ?? undefined) as DiagnosisUrgency | undefined,
    trend: parseJson<TrendAnalysis>(row.trendJson) ?? null,
    diagnosisCommentId: row.diagnosisCommentId ?? undefined
  };

  return { status, history: parseJson<MetricHistoryResult[]>(row.historyJson) ?? [] };
}

/** Upserts the run for its alert. Returns false when the alert itself is not persisted (memory-only). */
export async function persistEnrichment(status: AlertEnrichmentStatus, history: MetricHistoryResult[]): Promise<boolean> {
  const clientAccountId = status.clientAccountId;

  if (!isPersistenceConfigured() || !clientAccountId) {
    return false;
  }

  const alertRecord = await prisma.alertEventRecord.findUnique({
    where: {
      clientAccountId_externalAlertId: {
        clientAccountId,
        externalAlertId: status.alertId
      }
    },
    select: { id: true }
  });

  if (!alertRecord) {
    return false;
  }

  const data = {
    externalAlertId: status.alertId,
    clientAccountId,
    state: status.state,
    trigger: status.trigger,
    historySource: status.historySource ?? null,
    agentProvider: status.agentProvider ?? null,
    agentModel: status.agentModel ?? null,
    urgency: status.urgency ?? null,
    message: status.message ?? null,
    trendJson: status.trend ? JSON.stringify(status.trend) : null,
    historyJson: history.length > 0 ? JSON.stringify(history) : null,
    diagnosisCommentId: status.diagnosisCommentId ?? null,
    startedAt: new Date(status.startedAt),
    completedAt: status.completedAt ? new Date(status.completedAt) : null
  };

  await prisma.alertEnrichment.upsert({
    where: { alertEventRecordId: alertRecord.id },
    create: { alertEventRecordId: alertRecord.id, ...data },
    update: data
  });

  return true;
}

/** Most recent runs, oldest first, so callers can replay them into an LRU-style store. */
export async function loadRecentEnrichments(limit: number): Promise<StoredEnrichment[]> {
  if (!isPersistenceConfigured()) {
    return [];
  }

  const rows = await prisma.alertEnrichment.findMany({
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: {
      alertEvent: { select: { clientSlugSnapshot: true, subscriptionExternalId: true } }
    }
  });

  return rows.reverse().map(mapStoredEnrichment);
}

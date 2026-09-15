import type { AlertEnrichmentStatus, MetricHistoryResult } from '../../../../shared/types.js';
import { broadcastEnrichment } from '../sseRegistry.js';

const MAX_TRACKED_ALERTS = 200;

const statusByAlert = new Map<string, AlertEnrichmentStatus>();
const historyByAlert = new Map<string, MetricHistoryResult[]>();
const inflight = new Map<string, Promise<void>>();
const completedAt = new Map<string, number>();

function touch<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key);
  map.set(key, value);

  if (map.size > MAX_TRACKED_ALERTS) {
    const oldest = map.keys().next().value;

    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
}

export function getStatus(alertId: string): AlertEnrichmentStatus | undefined {
  return statusByAlert.get(alertId);
}

/** Stores the status, then broadcasts it to SSE clients in the alert's scope. */
export function setStatus(status: AlertEnrichmentStatus): AlertEnrichmentStatus {
  const stamped: AlertEnrichmentStatus = { ...status, updatedAt: new Date().toISOString() };
  touch(statusByAlert, status.alertId, stamped);
  broadcastEnrichment(stamped);
  return stamped;
}

export function isInflight(alertId: string): boolean {
  return inflight.has(alertId);
}

export function markInflight(alertId: string, promise: Promise<void>): void {
  inflight.set(alertId, promise);
  void promise.finally(() => {
    inflight.delete(alertId);
  });
}

export function lastCompletedAt(alertId: string): number | null {
  return completedAt.get(alertId) ?? null;
}

export function markCompleted(alertId: string): void {
  touch(completedAt, alertId, Date.now());
}

export function setHistory(alertId: string, history: MetricHistoryResult[]): void {
  touch(historyByAlert, alertId, history);
}

export function getHistory(alertId: string): MetricHistoryResult[] {
  return historyByAlert.get(alertId) ?? [];
}

export function getActiveEnrichmentCount(): number {
  return inflight.size;
}

export function listStatuses(): AlertEnrichmentStatus[] {
  return [...statusByAlert.values()];
}

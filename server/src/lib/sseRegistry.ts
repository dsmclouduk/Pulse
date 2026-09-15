import type { Response } from 'express';

import type { AlertComment, AlertEnrichmentStatus, AlertEvent, SSEMessage } from '../../../shared/types.js';

export interface AlertScope {
  clientAccountId?: string;
  clientSlug?: string;
  subscriptionId?: string;
}

interface SSEClientRegistration {
  response: Response;
  filters?: AlertScope;
}

const sseClients = new Map<string, SSEClientRegistration>();

function writeMessage(response: Response, message: SSEMessage): void {
  response.write(`data: ${JSON.stringify(message)}\n\n`);
}

/**
 * Tenant scoping shared by alerts, comments and enrichment status. Every broadcast payload
 * carries a snapshot of the alert's scope so the same filter applies to all three.
 */
export function matchesScope(scope: AlertScope, filters: AlertScope | undefined): boolean {
  if (!filters) {
    return true;
  }

  if (filters.clientAccountId && scope.clientAccountId !== filters.clientAccountId) {
    return false;
  }

  if (filters.clientSlug && scope.clientSlug !== filters.clientSlug) {
    return false;
  }

  if (filters.subscriptionId && scope.subscriptionId !== filters.subscriptionId) {
    return false;
  }

  return true;
}

function broadcastMessage(scope: AlertScope, message: SSEMessage): void {
  for (const client of sseClients.values()) {
    if (!matchesScope(scope, client.filters)) {
      continue;
    }

    writeMessage(client.response, message);
  }
}

export function registerClient(clientId: string, response: Response, filters?: AlertScope): void {
  sseClients.set(clientId, { response, filters });
}

export function unregisterClient(clientId: string): void {
  sseClients.delete(clientId);
}

export function sendInit(clientId: string, alerts: AlertEvent[]): void {
  const client = sseClients.get(clientId);

  if (!client) {
    return;
  }

  writeMessage(client.response, { type: 'init', alerts });
}

export function broadcast(alert: AlertEvent): void {
  broadcastMessage(alert, { type: 'alert', alert });
}

export function broadcastComment(comment: AlertComment): void {
  broadcastMessage(comment, { type: 'comment', comment });
}

/** Enrichment status events never carry history points; the client fetches those on demand. */
export function broadcastEnrichment(status: AlertEnrichmentStatus): void {
  const trimmed: AlertEnrichmentStatus = status.trend
    ? { ...status, trend: { ...status.trend, anomalies: status.trend.anomalies.slice(0, 5) } }
    : status;

  broadcastMessage(status, { type: 'enrichment', enrichment: trimmed });
}

export function sendPing(clientId: string): void {
  const client = sseClients.get(clientId);

  if (!client) {
    return;
  }

  client.response.write(': ping\n\n');
}

export function getClientCount(): number {
  return sseClients.size;
}

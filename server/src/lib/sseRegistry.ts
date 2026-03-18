import type { Response } from 'express';

import type { AlertEvent, SSEMessage } from '../../../shared/types.js';

interface SSEClientRegistration {
  response: Response;
  filters?: {
    clientAccountId?: string;
    clientSlug?: string;
    subscriptionId?: string;
  };
}

const sseClients = new Map<string, SSEClientRegistration>();

function writeMessage(response: Response, message: SSEMessage): void {
  response.write(`data: ${JSON.stringify(message)}\n\n`);
}

function matchesFilters(alert: AlertEvent, filters: SSEClientRegistration['filters']): boolean {
  if (!filters) {
    return true;
  }

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

export function registerClient(
  clientId: string,
  response: Response,
  filters?: SSEClientRegistration['filters']
): void {
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
  for (const client of sseClients.values()) {
    if (!matchesFilters(alert, client.filters)) {
      continue;
    }

    writeMessage(client.response, { type: 'alert', alert });
  }
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

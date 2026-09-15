import { useCallback, useEffect, useRef, useState } from 'react';

import { upsertAlert } from '@/lib/alerts';
import type { AlertComment, AlertEnrichmentStatus, AlertEvent, SSEMessage } from '@/types';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export type CommentsByAlert = Record<string, AlertComment[]>;
export type EnrichmentByAlert = Record<string, AlertEnrichmentStatus>;

export interface AlertStreamState {
  alerts: AlertEvent[];
  connectionStatus: ConnectionStatus;
  lastReceivedAt: string | null;
  commentsByAlert: CommentsByAlert;
  enrichmentByAlert: EnrichmentByAlert;
  /** Merge comments fetched on demand (e.g. when a drawer opens) into the shared state. */
  mergeComments: (comments: AlertComment[]) => void;
}

interface UseAlertStreamOptions {
  clientSlug: string | null;
}

interface EnrichmentSummaryResponse {
  active: number;
  enabled: boolean;
  statuses: AlertEnrichmentStatus[];
}

const RECENT_COMMENT_LIMIT = 300;

function sortComments(comments: AlertComment[]): AlertComment[] {
  return [...comments].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

function upsertComment(current: CommentsByAlert, comment: AlertComment): CommentsByAlert {
  const existing = current[comment.alertId] ?? [];
  const next = sortComments([...existing.filter((entry) => entry.id !== comment.id), comment]);
  return { ...current, [comment.alertId]: next };
}

function groupComments(comments: AlertComment[]): CommentsByAlert {
  const grouped: CommentsByAlert = {};

  for (const comment of comments) {
    (grouped[comment.alertId] ??= []).push(comment);
  }

  for (const alertId of Object.keys(grouped)) {
    grouped[alertId] = sortComments(grouped[alertId]);
  }

  return grouped;
}

export function useAlertStream({ clientSlug }: Readonly<UseAlertStreamOptions>): AlertStreamState {
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');
  const [lastReceivedAt, setLastReceivedAt] = useState<string | null>(null);
  const [commentsByAlert, setCommentsByAlert] = useState<CommentsByAlert>({});
  const [enrichmentByAlert, setEnrichmentByAlert] = useState<EnrichmentByAlert>({});
  const retryAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isStoppedRef = useRef(false);

  const scopeParams = clientSlug ? `clientSlug=${encodeURIComponent(clientSlug)}` : '';

  useEffect(() => {
    isStoppedRef.current = false;
    retryAttemptRef.current = 0;
    setAlerts([]);
    setLastReceivedAt(null);
    setCommentsByAlert({});
    setEnrichmentByAlert({});

    void fetchInitialState();
    connect();

    return () => {
      isStoppedRef.current = true;

      if (reconnectTimerRef.current !== null) {
        globalThis.clearTimeout(reconnectTimerRef.current);
      }

      eventSourceRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSlug]);

  async function fetchInitialState(): Promise<void> {
    try {
      const [alertsResponse, commentsResponse, enrichmentResponse] = await Promise.all([
        fetch(`/api/alerts${scopeParams ? `?${scopeParams}` : ''}`),
        fetch(`/api/alerts/comments/recent?limit=${RECENT_COMMENT_LIMIT}${scopeParams ? `&${scopeParams}` : ''}`),
        fetch('/api/alerts/enrichment/summary')
      ]);

      if (!alertsResponse.ok) {
        throw new Error(`Failed to load alerts: ${alertsResponse.status}`);
      }

      const nextAlerts = (await alertsResponse.json()) as AlertEvent[];
      setAlerts(nextAlerts);
      setLastReceivedAt(nextAlerts[0]?.receivedAt ?? null);

      if (commentsResponse.ok) {
        const recent = (await commentsResponse.json()) as AlertComment[];
        setCommentsByAlert((current) => {
          const merged = { ...current };

          for (const [alertId, comments] of Object.entries(groupComments(recent))) {
            const existing = merged[alertId] ?? [];
            const byId = new Map(existing.map((comment) => [comment.id, comment]));

            for (const comment of comments) {
              byId.set(comment.id, comment);
            }

            merged[alertId] = sortComments([...byId.values()]);
          }

          return merged;
        });
      }

      if (enrichmentResponse.ok) {
        const summary = (await enrichmentResponse.json()) as EnrichmentSummaryResponse;
        const alertIds = new Set(nextAlerts.map((alert) => alert.id));
        setEnrichmentByAlert((current) => {
          const merged = { ...current };

          for (const status of summary.statuses) {
            if (alertIds.has(status.alertId)) {
              merged[status.alertId] = status;
            }
          }

          return merged;
        });
      }
    } catch {
      setConnectionStatus('disconnected');
    }
  }

  function connect(): void {
    if (isStoppedRef.current) {
      return;
    }

    setConnectionStatus(retryAttemptRef.current === 0 ? 'reconnecting' : 'disconnected');

    const eventSource = new EventSource(`/api/alerts/stream${scopeParams ? `?${scopeParams}` : ''}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      retryAttemptRef.current = 0;
      setConnectionStatus('connected');
    };

    eventSource.onmessage = (event) => {
      const message = JSON.parse(event.data) as SSEMessage;

      switch (message.type) {
        case 'init':
          if (message.alerts) {
            setAlerts(message.alerts);
            setLastReceivedAt(message.alerts[0]?.receivedAt ?? null);
          }
          break;
        case 'alert':
          if (message.alert) {
            const alert = message.alert;
            setAlerts((currentAlerts) => upsertAlert(currentAlerts, alert));
            setLastReceivedAt(alert.receivedAt);
          }
          break;
        case 'comment':
          if (message.comment) {
            const comment = message.comment;
            setCommentsByAlert((current) => upsertComment(current, comment));
          }
          break;
        case 'enrichment':
          if (message.enrichment) {
            const status = message.enrichment;
            setEnrichmentByAlert((current) => ({ ...current, [status.alertId]: status }));
          }
          break;
        default:
          break;
      }
    };

    eventSource.onerror = () => {
      eventSource.close();

      if (isStoppedRef.current) {
        return;
      }

      scheduleReconnect();
    };
  }

  function scheduleReconnect(): void {
    const retryDelay = Math.min(1000 * 2 ** retryAttemptRef.current, 30000);
    retryAttemptRef.current += 1;
    setConnectionStatus('reconnecting');

    reconnectTimerRef.current = globalThis.setTimeout(() => {
      void fetchInitialState();
      connect();
    }, retryDelay);
  }

  const mergeComments = useCallback((comments: AlertComment[]) => {
    if (comments.length === 0) {
      return;
    }

    setCommentsByAlert((current) => {
      let next = current;

      for (const comment of comments) {
        next = upsertComment(next, comment);
      }

      return next;
    });
  }, []);

  return {
    alerts,
    connectionStatus,
    lastReceivedAt,
    commentsByAlert,
    enrichmentByAlert,
    mergeComments
  };
}

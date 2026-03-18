import { useEffect, useRef, useState } from 'react';

import { upsertAlert } from '@/lib/alerts';
import type { AlertEvent, SSEMessage } from '@/types';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

interface AlertStreamState {
  alerts: AlertEvent[];
  connectionStatus: ConnectionStatus;
  lastReceivedAt: string | null;
}

interface UseAlertStreamOptions {
  clientSlug: string | null;
}

export function useAlertStream({ clientSlug }: Readonly<UseAlertStreamOptions>): AlertStreamState {
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');
  const [lastReceivedAt, setLastReceivedAt] = useState<string | null>(null);
  const retryAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isStoppedRef = useRef(false);

  useEffect(() => {
    isStoppedRef.current = false;
    retryAttemptRef.current = 0;
    setAlerts([]);
    setLastReceivedAt(null);

    void fetchInitialAlerts();
    connect();

    return () => {
      isStoppedRef.current = true;

      if (reconnectTimerRef.current !== null) {
        globalThis.clearTimeout(reconnectTimerRef.current);
      }

      eventSourceRef.current?.close();
    };
  }, [clientSlug]);

  async function fetchInitialAlerts(): Promise<void> {
    try {
      const params = clientSlug ? `?clientSlug=${encodeURIComponent(clientSlug)}` : '';
      const response = await fetch(`/api/alerts${params}`);

      if (!response.ok) {
        throw new Error(`Failed to load alerts: ${response.status}`);
      }

      const nextAlerts = (await response.json()) as AlertEvent[];
      setAlerts(nextAlerts);
      setLastReceivedAt(nextAlerts[0]?.receivedAt ?? null);
    } catch {
      setConnectionStatus('disconnected');
    }
  }

  function connect(): void {
    if (isStoppedRef.current) {
      return;
    }

    setConnectionStatus(retryAttemptRef.current === 0 ? 'reconnecting' : 'disconnected');

    const params = clientSlug ? `?clientSlug=${encodeURIComponent(clientSlug)}` : '';
    const eventSource = new EventSource(`/api/alerts/stream${params}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      retryAttemptRef.current = 0;
      setConnectionStatus('connected');
    };

    eventSource.onmessage = (event) => {
      const message = JSON.parse(event.data) as SSEMessage;

      if (message.type === 'init' && message.alerts) {
        setAlerts(message.alerts);
        setLastReceivedAt(message.alerts[0]?.receivedAt ?? null);
        return;
      }

      if (message.type === 'alert' && message.alert) {
        setAlerts((currentAlerts) => upsertAlert(currentAlerts, message.alert as AlertEvent));
        setLastReceivedAt(message.alert.receivedAt);
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
      void fetchInitialAlerts();
      connect();
    }, retryDelay);
  }

  return {
    alerts,
    connectionStatus,
    lastReceivedAt
  };
}

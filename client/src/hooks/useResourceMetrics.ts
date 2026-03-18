import { useEffect, useState } from 'react';

import type { ResourceMetricsContext } from '@/types';

interface UseResourceMetricsOptions {
  resourceId?: string;
  metricName?: string;
}

interface UseResourceMetricsState {
  context: ResourceMetricsContext | null;
  isLoading: boolean;
}

export function useResourceMetrics({ resourceId, metricName }: Readonly<UseResourceMetricsOptions>): UseResourceMetricsState {
  const [context, setContext] = useState<ResourceMetricsContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!resourceId) {
      setContext(null);
      setIsLoading(false);
      return;
    }

    const nextResourceId = resourceId;
    const abortController = new AbortController();

    async function loadMetrics(): Promise<void> {
      setIsLoading(true);

      try {
        const queryParams = new URLSearchParams();
        queryParams.set('resourceId', nextResourceId);
        if (metricName) {
          queryParams.set('metricName', metricName);
        }

        const response = await fetch(`/api/metrics/context?${queryParams.toString()}`, {
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`Metrics request failed: ${response.status}`);
        }

        const payload = (await response.json()) as ResourceMetricsContext;
        setContext(payload);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setContext({
          resourceId: nextResourceId,
          fetchedAt: null,
          timespan: null,
          interval: null,
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load metrics context.',
          isStale: false,
          series: []
        });
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadMetrics();

    const refreshHandle = globalThis.setInterval(() => {
      void loadMetrics();
    }, 60_000);

    return () => {
      abortController.abort();
      globalThis.clearInterval(refreshHandle);
    };
  }, [resourceId, metricName]);

  return {
    context,
    isLoading
  };
}

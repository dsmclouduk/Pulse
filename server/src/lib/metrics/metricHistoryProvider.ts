import type { MetricHistoryRequest, MetricHistoryResult, MetricHistorySource } from '../../../../shared/types.js';

export interface FetchHistoryOptions {
  signal: AbortSignal;
}

export interface MetricHistoryProvider {
  readonly source: MetricHistorySource;
  isAvailable(): boolean;
  fetchHistory(request: MetricHistoryRequest, options: FetchHistoryOptions): Promise<MetricHistoryResult>;
}

/** Provider used when no history source applies. Always returns an "unavailable" result. */
export const noneProvider: MetricHistoryProvider = {
  source: 'none',
  isAvailable: () => true,
  fetchHistory: async (request) => ({
    request,
    provider: 'none',
    fetchedAt: new Date().toISOString(),
    status: 'unavailable',
    message: request.filter ?? 'No metric history source is available for this alert.',
    series: []
  })
};

export function unavailableResult(request: MetricHistoryRequest, provider: string, message: string): MetricHistoryResult {
  return {
    request,
    provider,
    fetchedAt: new Date().toISOString(),
    status: 'unavailable',
    message,
    series: []
  };
}

export function errorResult(request: MetricHistoryRequest, provider: string, error: unknown): MetricHistoryResult {
  return {
    request,
    provider,
    fetchedAt: new Date().toISOString(),
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
    series: []
  };
}

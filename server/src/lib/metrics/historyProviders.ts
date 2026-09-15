import type { MetricHistorySource } from '../../../../shared/types.js';
import { armMetricsProvider } from './armMetricsProvider.js';
import { logAnalyticsProvider } from './logAnalyticsProvider.js';
import type { MetricHistoryProvider } from './metricHistoryProvider.js';
import { noneProvider } from './metricHistoryProvider.js';
import { syntheticProvider } from './syntheticProvider.js';

const providers: Record<MetricHistorySource, MetricHistoryProvider> = {
  arm: armMetricsProvider,
  'log-analytics': logAnalyticsProvider,
  synthetic: syntheticProvider,
  none: noneProvider
};

export function resolveHistoryProvider(source: MetricHistorySource): MetricHistoryProvider {
  return providers[source] ?? noneProvider;
}

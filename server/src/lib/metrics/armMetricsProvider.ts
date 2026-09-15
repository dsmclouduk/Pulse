import type { MetricHistoryRequest, MetricHistoryResult, MetricSeries } from '../../../../shared/types.js';
import { isAzureMetricsConfigured } from '../azureAuth.js';
import { queryArmMetrics } from '../metricsService.js';
import type { MetricHistoryProvider } from './metricHistoryProvider.js';
import { errorResult, unavailableResult } from './metricHistoryProvider.js';

function lastValue(series: MetricSeries): number {
  const point = series.points[series.points.length - 1];
  return point?.average ?? point?.maximum ?? point?.total ?? Number.NEGATIVE_INFINITY;
}

/**
 * Chooses the series that best matches the requested dimensions; otherwise, for percentage
 * metrics, the series with the highest latest value (the worst disk / busiest instance),
 * and for anything else the series with the most points.
 */
function selectSeries(series: MetricSeries[], request: MetricHistoryRequest): MetricSeries | undefined {
  if (series.length === 0) {
    return undefined;
  }

  if (request.dimensions) {
    const wanted = Object.values(request.dimensions).map((value) => value.toLowerCase());
    const matched = series.find((entry) => wanted.every((value) => entry.displayName.toLowerCase().includes(value)));

    if (matched) {
      return matched;
    }
  }

  if (request.ceiling === 100) {
    return series.reduce((best, current) => (lastValue(current) > lastValue(best) ? current : best), series[0]);
  }

  return series.reduce((best, current) => (current.points.length > best.points.length ? current : best), series[0]);
}

export const armMetricsProvider: MetricHistoryProvider = {
  source: 'arm',
  isAvailable: () => isAzureMetricsConfigured(),
  fetchHistory: async (request, options): Promise<MetricHistoryResult> => {
    if (!isAzureMetricsConfigured()) {
      return unavailableResult(request, 'arm', 'Azure credentials are not configured.');
    }

    try {
      const result = await queryArmMetrics({
        resourceId: request.resourceId,
        metricName: request.metricName,
        namespace: request.namespace,
        aggregation: request.aggregation ?? 'Average',
        timespan: request.timespan,
        interval: request.interval,
        filter: request.filter,
        signal: options.signal
      });

      const selected = selectSeries(result.series, request);
      const fetchedAt = new Date().toISOString();

      if (!selected || selected.points.length === 0) {
        return {
          request,
          provider: 'arm',
          fetchedAt,
          status: 'empty',
          message: selected?.errorMessage ?? 'Azure Monitor returned no data points for this metric and timespan.',
          series: selected ? [selected] : []
        };
      }

      return {
        request,
        provider: 'arm',
        fetchedAt,
        status: 'ready',
        derivation: `Azure Monitor ${request.metricName} (${request.aggregation ?? 'Average'}) at ${result.interval ?? request.interval}${result.series.length > 1 ? `, ${result.series.length} dimension series returned, showing ${selected.displayName}` : ''}`,
        series: [selected]
      };
    } catch (error) {
      return errorResult(request, 'arm', error);
    }
  }
};

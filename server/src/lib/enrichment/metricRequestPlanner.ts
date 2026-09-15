import type { AlertEvent, MetricHistoryRequest } from '../../../../shared/types.js';
import { isAzureMetricsConfigured, isLogAnalyticsConfigured } from '../azureAuth.js';
import { hasSyntheticHistory } from '../metrics/syntheticProvider.js';
import type { EnrichmentConfig } from './enrichmentConfig.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface MetricHistoryPlan {
  requests: MetricHistoryRequest[];
  /** Index into `requests` of the series the trend analysis should run on. -1 when none. */
  primaryIndex: number;
  reason: string;
}

const DISK_METRIC_PATTERN = /disk|free ?space|used ?space|logical ?disk|% ?free/i;
const PERCENT_METRIC_PATTERN = /percent|%|cpu|disk|memory/i;

export function isDiskMetric(metricName: string | undefined): boolean {
  return Boolean(metricName && DISK_METRIC_PATTERN.test(metricName));
}

export function isPercentMetric(metricName: string | undefined): boolean {
  return Boolean(metricName && PERCENT_METRIC_PATTERN.test(metricName));
}

export function extractResourceType(resourceId: string | undefined): string | null {
  if (!resourceId) {
    return null;
  }

  const parts = resourceId.split('/').filter(Boolean);
  const providersIndex = parts.findIndex((part) => part.toLowerCase() === 'providers');

  if (providersIndex === -1 || providersIndex + 2 >= parts.length) {
    return null;
  }

  return `${parts[providersIndex + 1]}/${parts[providersIndex + 2]}`.toLowerCase();
}

function timespan(endMs: number, durationMs: number): { start: string; end: string } {
  return {
    start: new Date(endMs - durationMs).toISOString(),
    end: new Date(endMs).toISOString()
  };
}

function buildArmFilter(dimensions: Record<string, string> | undefined): string | undefined {
  if (!dimensions) {
    return undefined;
  }

  const clauses = Object.entries(dimensions)
    .filter(([name, value]) => name && value)
    .map(([name, value]) => `${name} eq '${value.replace(/'/g, "''")}'`);

  return clauses.length > 0 ? clauses.join(' and ') : undefined;
}

export function planMetricHistory(alert: AlertEvent, config: EnrichmentConfig, now: Date = new Date()): MetricHistoryPlan {
  const resourceId = alert.resourceIds[0];
  const metricName = alert.metricName;
  const nowMs = now.getTime();
  const resourceType = extractResourceType(resourceId);
  const isVm = resourceType === 'microsoft.compute/virtualmachines';
  const percentCeiling = isPercentMetric(metricName) ? 100 : undefined;

  // 1 + 2. Simulated alerts always use the synthetic provider so the demo works offline.
  if (alert.isSimulated) {
    const synthetic: MetricHistoryRequest = {
      alertId: alert.id,
      resourceId: resourceId ?? 'simulated',
      source: 'synthetic',
      metricName: metricName ?? 'Simulated metric',
      timespan: timespan(nowMs, config.historyDays * DAY_MS),
      interval: 'P1D',
      ceiling: percentCeiling,
      label: 'long-term'
    };

    return {
      requests: [synthetic],
      primaryIndex: 0,
      reason: hasSyntheticHistory(alert.id)
        ? 'Simulated alert with registered synthetic history.'
        : 'Simulated alert without a registered history spec; a default synthetic series will be generated.'
    };
  }

  // 3 + 4. VM disk alerts come from guest metrics, which live in Log Analytics (VM Insights).
  if (isVm && isDiskMetric(metricName) && resourceId) {
    if (!isLogAnalyticsConfigured()) {
      return {
        requests: [
          {
            alertId: alert.id,
            resourceId,
            source: 'none',
            metricName: metricName ?? 'Disk % Used',
            timespan: timespan(nowMs, config.historyDays * DAY_MS),
            interval: 'P1D',
            ceiling: 100,
            label: 'long-term',
            filter:
              'Disk history for VMs comes from Log Analytics (VM Insights). Set LOG_ANALYTICS_WORKSPACE_ID and the Azure credentials to enable it.'
          }
        ],
        primaryIndex: -1,
        reason: 'VM disk alert but Log Analytics is not configured.'
      };
    }

    return {
      requests: [
        {
          alertId: alert.id,
          resourceId,
          source: 'log-analytics',
          metricName: 'FreeSpacePercentage',
          namespace: 'LogicalDisk',
          dimensions: alert.dimensions,
          timespan: timespan(nowMs, config.historyDays * DAY_MS),
          interval: 'P1D',
          ceiling: 100,
          label: 'long-term'
        },
        {
          alertId: alert.id,
          resourceId,
          source: 'log-analytics',
          metricName: 'FreeSpacePercentage',
          namespace: 'LogicalDisk',
          dimensions: alert.dimensions,
          timespan: timespan(nowMs, 7 * DAY_MS),
          interval: 'PT1H',
          ceiling: 100,
          label: 'zoom'
        }
      ],
      primaryIndex: 0,
      reason: 'VM disk alert; querying VM Insights LogicalDisk free space from Log Analytics.'
    };
  }

  // 5. Platform metric alerts go to the ARM metrics API.
  if (alert.signalType === 'Metric' && metricName && resourceId) {
    if (!isAzureMetricsConfigured()) {
      return {
        requests: [
          {
            alertId: alert.id,
            resourceId,
            source: 'none',
            metricName,
            timespan: timespan(nowMs, 7 * DAY_MS),
            interval: 'PT1H',
            ceiling: percentCeiling,
            label: 'long-term',
            filter: 'Azure Monitor metrics are unavailable until AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET are set.'
          }
        ],
        primaryIndex: -1,
        reason: 'Metric alert but Azure credentials are not configured.'
      };
    }

    const filter = buildArmFilter(alert.dimensions);

    return {
      requests: [
        {
          alertId: alert.id,
          resourceId,
          source: 'arm',
          metricName,
          filter,
          dimensions: alert.dimensions,
          timespan: timespan(nowMs, 7 * DAY_MS),
          interval: 'PT1H',
          ceiling: percentCeiling,
          label: 'long-term'
        },
        {
          alertId: alert.id,
          resourceId,
          source: 'arm',
          metricName,
          filter,
          dimensions: alert.dimensions,
          timespan: timespan(nowMs, 6 * HOUR_MS),
          interval: 'PT5M',
          ceiling: percentCeiling,
          label: 'zoom'
        }
      ],
      primaryIndex: 0,
      reason: 'Platform metric alert; querying Azure Monitor metrics (7 days hourly plus 6 hour zoom).'
    };
  }

  // 6. Nothing we can query.
  return {
    requests: [],
    primaryIndex: -1,
    reason: `No metric history source for signalType=${alert.signalType} metric=${metricName ?? 'none'}.`
  };
}

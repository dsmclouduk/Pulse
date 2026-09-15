import type { MetricHistoryRequest, MetricHistoryResult, MetricPoint, MetricSeries } from '../../../../shared/types.js';
import { getAzureToken, isLogAnalyticsConfigured, LOG_ANALYTICS_RESOURCE } from '../azureAuth.js';
import { buildDiskFreeSpaceQuery } from './kql.js';
import type { MetricHistoryProvider } from './metricHistoryProvider.js';
import { errorResult, unavailableResult } from './metricHistoryProvider.js';

interface LogAnalyticsQueryResponse {
  tables?: Array<{
    name: string;
    columns: Array<{ name: string; type: string }>;
    rows: unknown[][];
  }>;
  error?: { code?: string; message?: string };
}

interface DiskRow {
  timestamp: string;
  mount: string;
  freePct: number;
  minFreePct: number;
  maxFreePct: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseRows(response: LogAnalyticsQueryResponse): DiskRow[] {
  const table = response.tables?.[0];

  if (!table) {
    return [];
  }

  const columnIndex = new Map(table.columns.map((column, index) => [column.name, index]));
  const timeIndex = columnIndex.get('TimeGenerated');
  const mountIndex = columnIndex.get('Mount');
  const freeIndex = columnIndex.get('FreePct');
  const minIndex = columnIndex.get('MinFreePct');
  const maxIndex = columnIndex.get('MaxFreePct');

  if (timeIndex === undefined || freeIndex === undefined) {
    return [];
  }

  const rows: DiskRow[] = [];

  for (const row of table.rows) {
    const freePct = Number(row[freeIndex]);

    if (!Number.isFinite(freePct)) {
      continue;
    }

    rows.push({
      timestamp: String(row[timeIndex]),
      mount: mountIndex === undefined ? '' : String(row[mountIndex] ?? ''),
      freePct,
      minFreePct: minIndex === undefined ? freePct : Number(row[minIndex]) || freePct,
      maxFreePct: maxIndex === undefined ? freePct : Number(row[maxIndex]) || freePct
    });
  }

  return rows;
}

/** When the alert did not name a mount, pick the fullest disk (lowest latest free %). */
function chooseMount(rows: DiskRow[], requested: string | undefined): string {
  if (requested) {
    const match = rows.find((row) => row.mount.toLowerCase() === requested.toLowerCase());

    if (match) {
      return match.mount;
    }
  }

  const latestByMount = new Map<string, DiskRow>();

  for (const row of rows) {
    const existing = latestByMount.get(row.mount);

    if (!existing || row.timestamp > existing.timestamp) {
      latestByMount.set(row.mount, row);
    }
  }

  let worst: DiskRow | undefined;

  for (const row of latestByMount.values()) {
    if (!worst || row.freePct < worst.freePct) {
      worst = row;
    }
  }

  return worst?.mount ?? '';
}

export const logAnalyticsProvider: MetricHistoryProvider = {
  source: 'log-analytics',
  isAvailable: () => isLogAnalyticsConfigured(),
  fetchHistory: async (request, options): Promise<MetricHistoryResult> => {
    if (!isLogAnalyticsConfigured()) {
      return unavailableResult(
        request,
        'log-analytics',
        'Log Analytics needs the Azure credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET).'
      );
    }

    const workspaceId = process.env.LOG_ANALYTICS_WORKSPACE_ID ?? '';
    const days = Math.max(
      1,
      Math.ceil((new Date(request.timespan.end).getTime() - new Date(request.timespan.start).getTime()) / DAY_MS)
    );
    const binSize = request.interval === 'PT1H' ? '1h' : '1d';
    const mountId = request.dimensions?.mountId ?? request.dimensions?.Mount ?? request.dimensions?.mount;
    const query = buildDiskFreeSpaceQuery({ resourceId: request.resourceId, mountId, days, binSize });

    try {
      const token = await getAzureToken(LOG_ANALYTICS_RESOURCE);
      // Resource-context query: the VM's ARM path is the scope, so Pulse needs only read access on
      // the resource and no workspace id. Workspaces set to "resource permissions only" refuse the
      // workspace-context form entirely, which is the common case for VM Insights.
      const url = request.resourceId
        ? `https://api.loganalytics.io/v1${request.resourceId}/query`
        : `https://api.loganalytics.io/v1/workspaces/${encodeURIComponent(workspaceId)}/query`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, timespan: `P${days}D` }),
        signal: options.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Log Analytics query failed: ${response.status} ${response.statusText} ${text}`.trim());
      }

      const payload = (await response.json()) as LogAnalyticsQueryResponse;

      if (payload.error) {
        throw new Error(`Log Analytics error ${payload.error.code ?? ''}: ${payload.error.message ?? 'unknown'}`.trim());
      }

      const rows = parseRows(payload);
      const fetchedAt = new Date().toISOString();

      if (rows.length === 0) {
        return {
          request,
          provider: 'log-analytics',
          fetchedAt,
          status: 'empty',
          message: 'No InsightsMetrics LogicalDisk rows for this VM. Check that VM Insights (Azure Monitor Agent) is enabled and reporting to this workspace.',
          series: []
        };
      }

      const mount = chooseMount(rows, mountId);
      const points: MetricPoint[] = rows
        .filter((row) => row.mount === mount)
        .map((row) => ({
          timestamp: row.timestamp,
          average: Math.round((100 - row.freePct) * 100) / 100,
          minimum: Math.round((100 - row.maxFreePct) * 100) / 100,
          maximum: Math.round((100 - row.minFreePct) * 100) / 100
        }));

      const series: MetricSeries = {
        metricName: 'Disk % Used',
        displayName: `Disk % Used${mount ? ` [${mount}]` : ''}`,
        description: 'Derived from VM Insights LogicalDisk FreeSpacePercentage.',
        unit: 'Percent',
        aggregation: 'Average',
        namespace: 'LogicalDisk',
        points
      };

      return {
        request,
        provider: 'log-analytics',
        fetchedAt,
        status: 'ready',
        derivation: `used% = 100 - FreeSpacePercentage from InsightsMetrics, ${binSize} bins${mount ? `, mount ${mount}` : ''}${mountId ? '' : ' (fullest disk selected)'}`,
        series: [series]
      };
    } catch (error) {
      return errorResult(request, 'log-analytics', error);
    }
  }
};

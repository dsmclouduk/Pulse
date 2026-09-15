import type {
  MetricAggregation,
  MetricPoint,
  MetricSeries,
  ResourceMetricsContext
} from '../../../shared/types.js';
import { getAzureManagementToken, isAzureMetricsConfigured } from './azureAuth.js';

const METRICS_API_VERSION = '2023-10-01';
const DEFAULT_INTERVAL = 'PT5M';
const DEFAULT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;
const CACHE_FRESHNESS_MS = 55 * 1000;
const MAX_SERIES = 3;

interface MetricDefinitionResponse {
  value?: MetricDefinition[];
}

interface MetricDefinition {
  name: {
    value: string;
    localizedValue?: string;
  };
  namespace?: string;
  unit?: string;
  primaryAggregationType?: string;
  supportedAggregationTypes?: string[];
}

interface MetricsApiResponse {
  timespan?: string;
  interval?: string;
  value?: Array<{
    displayDescription?: string;
    unit?: string;
    errorCode?: string;
    errorMessage?: string;
    name: {
      value: string;
      localizedValue?: string;
    };
    timeseries?: Array<{
      metadatavalues?: Array<{ name: { value: string; localizedValue?: string }; value: string }>;
      data?: Array<{
        timeStamp: string;
        average?: number;
        minimum?: number;
        maximum?: number;
        total?: number;
        count?: number;
      }>;
    }>;
  }>;
}

type MetricsApiTimeseries = NonNullable<NonNullable<MetricsApiResponse['value']>[number]['timeseries']>[number];
type MetricsApiPoint = NonNullable<MetricsApiTimeseries['data']>[number];

interface ResourceMetricsOptions {
  forceRefresh?: boolean;
  preferredMetricName?: string;
}

/** Parameterised ARM metrics query, shared by the context poller and the alert-history provider. */
export interface ArmMetricsQuery {
  resourceId: string;
  metricName: string;
  namespace?: string;
  aggregation: MetricAggregation;
  timespan: { start: string; end: string };
  interval: string;
  /** OData $filter for dimensions, e.g. `LUN eq '0'`. */
  filter?: string;
  signal?: AbortSignal;
}

export interface ArmMetricsQueryResult {
  /** One series per dimension combination returned by Azure. */
  series: MetricSeries[];
  interval: string | null;
  timespan: string | null;
}

const watchedResourceIds = new Set<string>();
const metricsCache = new Map<string, ResourceMetricsContext>();
const inflightRefreshes = new Map<string, Promise<ResourceMetricsContext>>();

let pollingHandle: ReturnType<typeof globalThis.setInterval> | null = null;
let hasLoggedDisabledState = false;

const preferredMetricNamesByResourceType: Record<string, string[]> = {
  'microsoft.compute/virtualmachines': [
    'Percentage CPU',
    'Available Memory Bytes',
    'Network In Total',
    'Network Out Total'
  ],
  'microsoft.compute/virtualmachinescalesets': [
    'Percentage CPU',
    'Network In Total',
    'Network Out Total'
  ],
  'microsoft.web/sites': ['AverageResponseTime', 'Requests', 'CpuTime', 'MemoryWorkingSet'],
  'microsoft.sql/servers/databases': ['cpu_percent', 'dtu_consumption_percent', 'physical_data_read_percent'],
  'microsoft.storage/storageaccounts': ['UsedCapacity', 'Ingress', 'Egress', 'Transactions']
};

const commonMetricPreferences = ['Percentage CPU', 'Requests', 'AverageResponseTime', 'Network In Total', 'Network Out Total'];

function buildContext(overrides: Partial<ResourceMetricsContext> & Pick<ResourceMetricsContext, 'resourceId' | 'status'>): ResourceMetricsContext {
  return {
    fetchedAt: null,
    timespan: null,
    interval: null,
    message: undefined,
    isStale: false,
    series: [],
    ...overrides
  };
}

function normaliseAggregation(value: string | undefined): MetricAggregation {
  const normalised = value?.trim().toLowerCase();

  switch (normalised) {
    case 'minimum':
      return 'Minimum';
    case 'maximum':
      return 'Maximum';
    case 'total':
      return 'Total';
    case 'count':
      return 'Count';
    case 'average':
    default:
      return 'Average';
  }
}

function toAggregationQueryValue(aggregation: MetricAggregation): string {
  return aggregation.toLowerCase();
}

function extractResourceType(resourceId: string): string | null {
  const parts = resourceId.split('/').filter(Boolean);
  const providersIndex = parts.findIndex((part) => part.toLowerCase() === 'providers');

  if (providersIndex === -1 || providersIndex + 2 >= parts.length) {
    return null;
  }

  const providerNamespace = parts[providersIndex + 1].toLowerCase();
  const resourceTypes: string[] = [];

  for (let index = providersIndex + 2; index < parts.length; index += 2) {
    const candidate = parts[index];

    if (candidate.toLowerCase() === 'providers') {
      break;
    }

    resourceTypes.push(candidate.toLowerCase());
  }

  return [providerNamespace, ...resourceTypes].join('/');
}

function chooseMetricDefinitions(
  definitions: MetricDefinition[],
  resourceId: string,
  preferredMetricName?: string
): MetricDefinition[] {
  const resourceType = extractResourceType(resourceId);
  const requestedNames = [
    preferredMetricName,
    ...(resourceType ? preferredMetricNamesByResourceType[resourceType] ?? [] : []),
    ...commonMetricPreferences
  ].filter((value): value is string => Boolean(value));

  const selectedDefinitions: MetricDefinition[] = [];
  const usedMetricNames = new Set<string>();

  for (const metricName of requestedNames) {
    const definition = definitions.find(
      (candidate) => candidate.name.value.toLowerCase() === metricName.toLowerCase() && !usedMetricNames.has(candidate.name.value)
    );

    if (!definition) {
      continue;
    }

    selectedDefinitions.push(definition);
    usedMetricNames.add(definition.name.value);

    if (selectedDefinitions.length === MAX_SERIES) {
      return selectedDefinitions;
    }
  }

  for (const definition of definitions) {
    if (usedMetricNames.has(definition.name.value)) {
      continue;
    }

    const supportedAggregations = definition.supportedAggregationTypes ?? [];
    if (supportedAggregations.length === 0 && !definition.primaryAggregationType) {
      continue;
    }

    selectedDefinitions.push(definition);
    usedMetricNames.add(definition.name.value);

    if (selectedDefinitions.length === MAX_SERIES) {
      break;
    }
  }

  return selectedDefinitions;
}

function chooseAggregation(definition: MetricDefinition): MetricAggregation {
  const supported = new Set((definition.supportedAggregationTypes ?? []).map((value) => normaliseAggregation(value)));

  if (supported.has('Average')) {
    return 'Average';
  }

  if (supported.has('Total')) {
    return 'Total';
  }

  if (supported.has('Maximum')) {
    return 'Maximum';
  }

  if (supported.has('Minimum')) {
    return 'Minimum';
  }

  if (supported.has('Count')) {
    return 'Count';
  }

  return normaliseAggregation(definition.primaryAggregationType);
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const accessToken = await getAzureManagementToken();
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    signal
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Azure Monitor request failed: ${response.status} ${response.statusText} ${responseText}`.trim());
  }

  return (await response.json()) as T;
}

async function fetchMetricDefinitions(resourceId: string): Promise<MetricDefinition[]> {
  const definitionsUrl = new URL(`https://management.azure.com${resourceId}/providers/microsoft.insights/metricDefinitions`);
  definitionsUrl.searchParams.set('api-version', METRICS_API_VERSION);

  const response = await fetchJson<MetricDefinitionResponse>(definitionsUrl.toString());
  return response.value ?? [];
}

function mapPoints(timeseries: MetricsApiTimeseries | undefined): MetricPoint[] {
  return (timeseries?.data ?? []).map((point: MetricsApiPoint) => ({
    timestamp: point.timeStamp,
    average: point.average,
    minimum: point.minimum,
    maximum: point.maximum,
    total: point.total,
    count: point.count
  }));
}

function dimensionLabel(timeseries: MetricsApiTimeseries): string {
  const values = timeseries.metadatavalues ?? [];

  if (values.length === 0) {
    return '';
  }

  return ` [${values.map((entry) => `${entry.name.value}=${entry.value}`).join(', ')}]`;
}

/**
 * Runs a single ARM metrics query and returns every dimension series Azure hands back.
 * Callers decide which series matters; the poller keeps the largest, the alert-history
 * provider matches on dimensions.
 */
export async function queryArmMetrics(query: ArmMetricsQuery): Promise<ArmMetricsQueryResult> {
  const metricsUrl = new URL(`https://management.azure.com${query.resourceId}/providers/microsoft.insights/metrics`);

  metricsUrl.searchParams.set('api-version', METRICS_API_VERSION);
  metricsUrl.searchParams.set('metricnames', query.metricName);
  metricsUrl.searchParams.set('timespan', `${query.timespan.start}/${query.timespan.end}`);
  metricsUrl.searchParams.set('interval', query.interval);
  metricsUrl.searchParams.set('aggregation', toAggregationQueryValue(query.aggregation));
  metricsUrl.searchParams.set('AutoAdjustTimegrain', 'true');

  if (query.namespace) {
    metricsUrl.searchParams.set('metricnamespace', query.namespace);
  }

  if (query.filter) {
    metricsUrl.searchParams.set('$filter', query.filter);
  }

  const response = await fetchJson<MetricsApiResponse>(metricsUrl.toString(), query.signal);
  const metric = response.value?.[0];
  const timeseriesList = metric?.timeseries ?? [];

  const series: MetricSeries[] = (timeseriesList.length > 0 ? timeseriesList : [undefined]).map((timeseries) => ({
    metricName: metric?.name.value ?? query.metricName,
    displayName: `${metric?.name.localizedValue ?? metric?.name.value ?? query.metricName}${timeseries ? dimensionLabel(timeseries) : ''}`,
    description: metric?.displayDescription,
    unit: metric?.unit ?? 'Unspecified',
    aggregation: query.aggregation,
    namespace: query.namespace,
    points: mapPoints(timeseries),
    errorCode: metric?.errorCode,
    errorMessage: metric?.errorMessage
  }));

  return {
    series,
    interval: response.interval ?? null,
    timespan: response.timespan ?? null
  };
}

function pickLargestSeries(series: MetricSeries[]): MetricSeries | undefined {
  return series.reduce<MetricSeries | undefined>((best, current) => {
    return (current.points.length ?? 0) > (best?.points.length ?? 0) ? current : best;
  }, series[0]);
}

async function fetchMetricSeries(resourceId: string, definition: MetricDefinition): Promise<MetricSeries> {
  const now = new Date();
  const start = new Date(now.getTime() - DEFAULT_LOOKBACK_MS);
  const aggregation = chooseAggregation(definition);

  const result = await queryArmMetrics({
    resourceId,
    metricName: definition.name.value,
    namespace: definition.namespace,
    aggregation,
    timespan: { start: start.toISOString(), end: now.toISOString() },
    interval: DEFAULT_INTERVAL
  });

  const best = pickLargestSeries(result.series);

  return {
    metricName: best?.metricName ?? definition.name.value,
    displayName: definition.name.localizedValue ?? definition.name.value,
    description: best?.description,
    unit: best?.unit && best.unit !== 'Unspecified' ? best.unit : definition.unit ?? 'Unspecified',
    aggregation,
    namespace: definition.namespace,
    points: best?.points ?? [],
    errorCode: best?.errorCode,
    errorMessage: best?.errorMessage
  };
}

function hasFreshCache(context: ResourceMetricsContext, preferredMetricName?: string): boolean {
  const fetchedAt = context.fetchedAt ? new Date(context.fetchedAt).getTime() : 0;
  const hasPreferredMetric = !preferredMetricName
    || context.series.some((series) => series.metricName.toLowerCase() === preferredMetricName.toLowerCase());

  return hasPreferredMetric && fetchedAt > 0 && Date.now() - fetchedAt < CACHE_FRESHNESS_MS;
}

async function refreshMetricsContext(resourceId: string, preferredMetricName?: string): Promise<ResourceMetricsContext> {
  const definitions = await fetchMetricDefinitions(resourceId);
  const selectedDefinitions = chooseMetricDefinitions(definitions, resourceId, preferredMetricName);

  if (selectedDefinitions.length === 0) {
    return buildContext({
      resourceId,
      status: 'error',
      message: 'No compatible Azure Monitor metrics were found for this resource.'
    });
  }

  const series = await Promise.all(selectedDefinitions.map((definition) => fetchMetricSeries(resourceId, definition)));
  const now = new Date();
  const start = new Date(now.getTime() - DEFAULT_LOOKBACK_MS);

  return {
    resourceId,
    fetchedAt: now.toISOString(),
    timespan: `${start.toISOString()}/${now.toISOString()}`,
    interval: DEFAULT_INTERVAL,
    status: 'ready',
    message: undefined,
    isStale: false,
    series
  };
}

async function pollWatchedResources(): Promise<void> {
  if (!isAzureMetricsConfigured() || watchedResourceIds.size === 0) {
    return;
  }

  await Promise.allSettled(
    [...watchedResourceIds].map(async (resourceId) => {
      try {
        await getResourceMetricsContext(resourceId, { forceRefresh: true });
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [metrics] Failed to refresh ${resourceId}`, error);
      }
    })
  );
}

export function registerWatchedResourceIds(resourceIds: string[]): void {
  for (const resourceId of resourceIds) {
    if (resourceId) {
      watchedResourceIds.add(resourceId);
    }
  }
}

export function startMetricsPolling(): void {
  if (!isAzureMetricsConfigured()) {
    if (!hasLoggedDisabledState) {
      console.log(`[${new Date().toISOString()}] [metrics] Azure metrics polling disabled. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET to enable it.`);
      hasLoggedDisabledState = true;
    }
    return;
  }

  if (pollingHandle) {
    return;
  }

  pollingHandle = globalThis.setInterval(() => {
    void pollWatchedResources();
  }, POLL_INTERVAL_MS);

  void pollWatchedResources();
}

export async function getResourceMetricsContext(
  resourceId: string,
  options: ResourceMetricsOptions = {}
): Promise<ResourceMetricsContext> {
  if (!resourceId) {
    return buildContext({
      resourceId,
      status: 'error',
      message: 'A resource ID is required to query Azure metrics.'
    });
  }

  registerWatchedResourceIds([resourceId]);

  if (!isAzureMetricsConfigured()) {
    return buildContext({
      resourceId,
      status: 'disabled',
      message: 'Metrics polling is disabled until Azure credentials are configured.'
    });
  }

  const cachedContext = metricsCache.get(resourceId);
  if (!options.forceRefresh && cachedContext && hasFreshCache(cachedContext, options.preferredMetricName)) {
    return { ...cachedContext, isStale: false };
  }

  const inflightRefresh = inflightRefreshes.get(resourceId);
  if (inflightRefresh !== undefined) {
    return inflightRefresh;
  }

  const refreshPromise = refreshMetricsContext(resourceId, options.preferredMetricName)
    .then((context) => {
      metricsCache.set(resourceId, context);
      return context;
    })
    .catch((error) => {
      const failedContext = buildContext({
        resourceId,
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to retrieve Azure metrics.'
      });

      metricsCache.set(resourceId, failedContext);
      return failedContext;
    })
    .finally(() => {
      inflightRefreshes.delete(resourceId);
    });

  inflightRefreshes.set(resourceId, refreshPromise);
  return refreshPromise;
}

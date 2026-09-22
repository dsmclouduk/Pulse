import { AZURE_MANAGEMENT_RESOURCE, getAzureToken, isAzureMetricsConfigured } from '../azureAuth.js';

/**
 * Metadata inventory from Azure Resource Graph.
 *
 * Metadata only, by design: id, name, type, resource group, region, tags and whether a VM has a
 * managed identity. No metric values and no log rows ever land here. Those stay in Azure Monitor and
 * Log Analytics and are queried when an alert needs diagnosing, which is the line Pulse does not cross.
 */

const RESOURCE_GRAPH_URL = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01';
const PAGE_SIZE = 1000;
/** A guard against an unexpectedly huge estate rather than a real limit. */
const MAX_PAGES = 50;

export interface DiscoveredResource {
  /** Lower-cased ARM path: the stable key, because Azure varies the casing by API. */
  resourceId: string;
  /** Canonical casing as Resource Graph reported it. */
  resourceIdDisplay: string;
  name: string;
  /** Lower-cased ARM type. */
  resourceType: string;
  resourceGroup: string | null;
  subscriptionId: string;
  location: string | null;
  kind: string | null;
  tags: Record<string, string>;
  /** Null for types where it is meaningless; false on a VM blocks the monitoring agent. */
  hasManagedIdentity: boolean | null;
}

export interface InventoryResult {
  resources: DiscoveredResource[];
  /** True when MAX_PAGES stopped us before Azure ran out of results. */
  truncated: boolean;
}

interface ResourceGraphRow {
  id?: string;
  name?: string;
  type?: string;
  resourceGroup?: string;
  subscriptionId?: string;
  location?: string;
  kind?: string;
  tags?: Record<string, unknown> | null;
  identityType?: string | null;
}

/**
 * Projecting `identity.type` lets one query answer "which VMs cannot take the agent" without a
 * second pass. Resource Graph returns null rather than failing when a type has no identity.
 */
export const INVENTORY_QUERY = [
  'Resources',
  '| project id, name, type, resourceGroup, subscriptionId, location, kind, tags, identityType = tostring(identity.type)',
  '| order by id asc'
].join('\n');

function normaliseTags(tags: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!tags) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(tags)) {
    if (value !== null && value !== undefined) {
      result[key] = String(value);
    }
  }

  return result;
}

export function mapResourceGraphRow(row: ResourceGraphRow): DiscoveredResource | null {
  if (!row.id || !row.type) {
    return null;
  }

  return {
    resourceId: row.id.toLowerCase(),
    resourceIdDisplay: row.id,
    name: row.name ?? row.id.split('/').at(-1) ?? row.id,
    resourceType: row.type.toLowerCase(),
    resourceGroup: row.resourceGroup ?? null,
    subscriptionId: row.subscriptionId ?? '',
    location: row.location ?? null,
    kind: row.kind ?? null,
    tags: normaliseTags(row.tags),
    // Only meaningful where an identity can exist; absent identityType means none is assigned.
    hasManagedIdentity: row.identityType === undefined ? null : Boolean(row.identityType && row.identityType !== 'None')
  };
}

/** Queries Resource Graph across the given subscriptions, following skipToken to the end. */
export async function queryInventory(subscriptionIds: string[], signal?: AbortSignal): Promise<InventoryResult> {
  if (!isAzureMetricsConfigured()) {
    throw new Error('Azure credentials are not configured.');
  }

  if (subscriptionIds.length === 0) {
    return { resources: [], truncated: false };
  }

  const token = await getAzureToken(AZURE_MANAGEMENT_RESOURCE);
  const resources: DiscoveredResource[] = [];
  let skipToken: string | undefined;
  let pages = 0;

  do {
    const response = await fetch(RESOURCE_GRAPH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriptions: subscriptionIds,
        query: INVENTORY_QUERY,
        options: { resultFormat: 'objectArray', $top: PAGE_SIZE, ...(skipToken ? { $skipToken: skipToken } : {}) }
      }),
      signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resource Graph returned ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
    }

    const payload = (await response.json()) as { data?: ResourceGraphRow[]; $skipToken?: string };

    for (const row of payload.data ?? []) {
      const mapped = mapResourceGraphRow(row);

      if (mapped) {
        resources.push(mapped);
      }
    }

    skipToken = payload.$skipToken;
    pages += 1;
  } while (skipToken && pages < MAX_PAGES);

  return { resources, truncated: Boolean(skipToken) };
}

/**
 * Types where the Azure Monitor Agent runs, so a missing managed identity actually blocks monitoring.
 * Everywhere else the absence of an identity is normal and reporting it would be noise.
 */
const AGENT_CAPABLE_TYPES = new Set([
  'microsoft.compute/virtualmachines',
  'microsoft.compute/virtualmachinescalesets',
  'microsoft.hybridcompute/machines'
]);

export function agentCanRunOn(resourceType: string): boolean {
  return AGENT_CAPABLE_TYPES.has(resourceType.toLowerCase());
}

export interface InventorySummaryRow {
  resourceType: string;
  count: number;
  regions: string[];
  /** Only counted where the agent runs: elsewhere an identity is not expected. */
  withoutManagedIdentity: number;
  /** True when this type can take the agent, so the count above means something. */
  agentCapable: boolean;
}

/** Pure: folds resources into the per-type view the onboarding wizard shows. */
export function summariseInventory(resources: readonly DiscoveredResource[]): InventorySummaryRow[] {
  const byType = new Map<string, { count: number; regions: Set<string>; withoutIdentity: number }>();

  for (const resource of resources) {
    const entry = byType.get(resource.resourceType) ?? { count: 0, regions: new Set<string>(), withoutIdentity: 0 };

    entry.count += 1;

    if (resource.location) {
      entry.regions.add(resource.location);
    }

    if (resource.hasManagedIdentity === false && agentCanRunOn(resource.resourceType)) {
      entry.withoutIdentity += 1;
    }

    byType.set(resource.resourceType, entry);
  }

  return [...byType.entries()]
    .map(([resourceType, entry]) => ({
      resourceType,
      count: entry.count,
      regions: [...entry.regions].sort((left, right) => left.localeCompare(right)),
      withoutManagedIdentity: entry.withoutIdentity,
      agentCapable: agentCanRunOn(resourceType)
    }))
    .sort((left, right) => right.count - left.count || left.resourceType.localeCompare(right.resourceType));
}

/** Distinct regions in use, which is what the generator needs for multi-resource metric rules. */
export function regionsInUse(resources: readonly DiscoveredResource[]): string[] {
  return [...new Set(resources.map((resource) => resource.location).filter((region): region is string => Boolean(region)))].sort(
    (left, right) => left.localeCompare(right)
  );
}

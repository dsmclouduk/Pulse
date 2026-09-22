import { prisma } from '../prisma.js';
import type { DiscoveredResource } from './resourceGraph.js';

/**
 * Stores the metadata inventory. Rows are upserted by the lower-cased ARM path, which is the same
 * key the alert pipeline uses, so a resource discovered by Resource Graph and one that has alerted
 * are the same row rather than two.
 *
 * A resource that disappears is marked stale rather than deleted: its alert history still points at
 * it, and "this used to exist" is information worth keeping.
 */

export interface InventoryWriteResult {
  created: number;
  updated: number;
  stale: number;
}

function isPersistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function saveInventory(
  clientAccountId: string,
  subscriptionIds: readonly string[],
  resources: readonly DiscoveredResource[]
): Promise<InventoryWriteResult> {
  if (!isPersistenceConfigured()) {
    return { created: 0, updated: 0, stale: 0 };
  }

  const seenAt = new Date();

  const subscriptions = await prisma.azureSubscription.findMany({
    where: { externalSubscriptionId: { in: [...subscriptionIds] } },
    select: { id: true, externalSubscriptionId: true }
  });

  const subscriptionRowId = new Map(subscriptions.map((row) => [row.externalSubscriptionId, row.id]));

  let created = 0;
  let updated = 0;

  for (const resource of resources) {
    const data = {
      clientAccountId,
      azureSubscriptionId: subscriptionRowId.get(resource.subscriptionId),
      resourceIdDisplay: resource.resourceIdDisplay,
      providerType: resource.resourceType,
      displayName: resource.name,
      resourceGroup: resource.resourceGroup,
      region: resource.location,
      kind: resource.kind,
      tagsJson: Object.keys(resource.tags).length > 0 ? JSON.stringify(resource.tags) : null,
      hasManagedIdentity: resource.hasManagedIdentity,
      discoverySource: 'inventory',
      status: 'DISCOVERED',
      lastSeenAt: seenAt
    };

    const result = await prisma.resource.upsert({
      where: { resourceId: resource.resourceId },
      create: { resourceId: resource.resourceId, ...data },
      update: data,
      select: { createdAt: true, updatedAt: true }
    });

    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created += 1;
    } else {
      updated += 1;
    }
  }

  // Anything this client owns that Resource Graph did not return has gone from Azure. Alert-derived
  // rows are left alone: they were never claimed to be a live inventory.
  const stale = await prisma.resource.updateMany({
    where: {
      clientAccountId,
      discoverySource: 'inventory',
      status: { not: 'STALE' },
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: seenAt } }]
    },
    data: { status: 'STALE' }
  });

  return { created, updated, stale: stale.count };
}

export interface StoredResource {
  resourceId: string;
  name: string;
  resourceType: string;
  resourceGroup: string | null;
  region: string | null;
  tags: Record<string, string>;
  hasManagedIdentity: boolean | null;
  discoverySource: string;
  status: string;
  lastSeenAt: string | null;
}

export async function listInventory(clientAccountId: string): Promise<StoredResource[]> {
  if (!isPersistenceConfigured()) {
    return [];
  }

  const rows = await prisma.resource.findMany({
    // Stale rows are kept so alert history still resolves, but they are not part of the estate any
    // more and counting them inflates every number on the onboarding screens.
    where: { clientAccountId, status: { not: 'STALE' } },
    orderBy: [{ providerType: 'asc' }, { displayName: 'asc' }]
  });

  return rows.map((row) => ({
    resourceId: row.resourceIdDisplay ?? row.resourceId,
    name: row.displayName,
    resourceType: row.providerType,
    resourceGroup: row.resourceGroup,
    region: row.region,
    tags: parseTags(row.tagsJson),
    hasManagedIdentity: row.hasManagedIdentity,
    discoverySource: row.discoverySource,
    status: row.status,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null
  }));
}

function parseTags(value: string | null): Record<string, string> {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return {};
  }
}

/** When the inventory for this client last ran, so staleness is visible rather than assumed. */
export async function lastInventoryRun(clientAccountId: string): Promise<string | null> {
  if (!isPersistenceConfigured()) {
    return null;
  }

  const latest = await prisma.resource.findFirst({
    where: { clientAccountId, discoverySource: 'inventory' },
    orderBy: { lastSeenAt: 'desc' },
    select: { lastSeenAt: true }
  });

  return latest?.lastSeenAt?.toISOString() ?? null;
}

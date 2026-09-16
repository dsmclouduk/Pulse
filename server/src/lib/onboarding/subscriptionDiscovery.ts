import type { DiscoveredSubscription } from '../../../../shared/types.js';
import { AZURE_MANAGEMENT_RESOURCE, getAzureToken, isAzureMetricsConfigured } from '../azureAuth.js';
import { prisma } from '../prisma.js';

/**
 * Lists the subscriptions Pulse's own identity can reach. Delegated (Lighthouse) subscriptions come
 * back alongside the home tenant's, distinguished by their own tenantId. Nothing is written here:
 * assigning a subscription to a client is a deliberate step, not a side effect of discovery.
 *
 * Lighthouse is ARM-only, so the customer's tenant *name* is never available. It is typed into Pulse.
 */

interface ArmSubscription {
  subscriptionId: string;
  displayName: string;
  state: string;
  tenantId: string;
  managedByTenants?: Array<{ tenantId: string }>;
}

function isPersistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Synextra names subscriptions "<Client> - Landing Zone - Corp - CSP", so the text before the first
 * separator is a good first guess at the client. A suggestion only; a human confirms it.
 */
export function suggestClientName(displayName: string): string | undefined {
  const [head] = displayName.split(/\s+[-–—]\s+/);
  const trimmed = head?.trim();

  if (!trimmed || trimmed.length < 2 || trimmed.length > 60 || trimmed === displayName.trim()) {
    return undefined;
  }

  return trimmed;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function listDiscoveredSubscriptions(): Promise<DiscoveredSubscription[]> {
  if (!isAzureMetricsConfigured()) {
    return [];
  }

  const token = await getAzureToken(AZURE_MANAGEMENT_RESOURCE);
  const response = await fetch('https://management.azure.com/subscriptions?api-version=2022-12-01', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw new Error(`Azure returned ${response.status} ${response.statusText} listing subscriptions.`);
  }

  const payload = (await response.json()) as { value?: ArmSubscription[] };
  const homeTenantId = process.env.AZURE_TENANT_ID ?? '';

  const assigned = isPersistenceConfigured()
    ? await prisma.azureSubscription.findMany({
        select: { externalSubscriptionId: true, clientAccount: { select: { slug: true, name: true } } }
      })
    : [];

  const assignedById = new Map(assigned.map((row) => [row.externalSubscriptionId, row.clientAccount]));

  return (payload.value ?? []).map((subscription) => {
    const existing = assignedById.get(subscription.subscriptionId);

    return {
      subscriptionId: subscription.subscriptionId,
      displayName: subscription.displayName,
      state: subscription.state,
      tenantId: subscription.tenantId,
      // A subscription in another tenant that we can see at all is reached through Lighthouse.
      isDelegated: subscription.tenantId !== homeTenantId,
      managedByTenantIds: (subscription.managedByTenants ?? []).map((entry) => entry.tenantId),
      assignedClientSlug: existing?.slug,
      assignedClientName: existing?.name,
      suggestedClientName: existing ? undefined : suggestClientName(subscription.displayName)
    };
  });
}

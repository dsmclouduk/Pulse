import type { DiscoveredSubscription, DiscoveredTenant } from '../../../../shared/types.js';
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

/**
 * Tenants, not subscriptions, are the unit of onboarding.
 *
 * Delegation is the decision: if a tenant's subscriptions reach Pulse through Lighthouse, that
 * client is onboarded and every one of its subscriptions is in scope. Asking again per subscription
 * would be asking a question already answered, and would let a subscription be silently left out.
 *
 * Lighthouse is ARM-only with no Graph into the customer tenant, so Azure never tells us a tenant's
 * name. It is typed into Pulse once and stored on the client account.
 */
export async function listDiscoveredTenants(): Promise<DiscoveredTenant[]> {
  const subscriptions = await listDiscoveredSubscriptions();
  const homeTenantId = process.env.AZURE_TENANT_ID ?? '';

  const clientsByTenant = isPersistenceConfigured()
    ? await prisma.clientAccount.findMany({
        where: { primaryTenantId: { not: null } },
        select: { slug: true, name: true, primaryTenantId: true }
      })
    : [];

  const clientForTenant = new Map(clientsByTenant.map((client) => [client.primaryTenantId ?? '', client]));
  const byTenant = new Map<string, DiscoveredSubscription[]>();

  for (const subscription of subscriptions) {
    byTenant.set(subscription.tenantId, [...(byTenant.get(subscription.tenantId) ?? []), subscription]);
  }

  return [...byTenant.entries()]
    .map(([tenantId, tenantSubscriptions]) => {
      const client = clientForTenant.get(tenantId);
      // Fall back to a name already recorded against one of its subscriptions, then to the prefix.
      const fromSubscription = tenantSubscriptions.find((subscription) => subscription.assignedClientName)?.assignedClientName;
      const suggested = tenantSubscriptions.map((subscription) => subscription.suggestedClientName).find(Boolean);

      return {
        tenantId,
        isHomeTenant: tenantId === homeTenantId,
        clientSlug: client?.slug,
        clientName: client?.name ?? fromSubscription,
        suggestedClientName: client || fromSubscription ? undefined : suggested,
        subscriptionCount: tenantSubscriptions.length,
        subscriptions: tenantSubscriptions
      };
    })
    .sort((left, right) => {
      // Synextra's own tenant last: it is infrastructure, not a client.
      if (left.isHomeTenant !== right.isHomeTenant) return left.isHomeTenant ? 1 : -1;
      return (left.clientName ?? left.tenantId).localeCompare(right.clientName ?? right.tenantId);
    });
}

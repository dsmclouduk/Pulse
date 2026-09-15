import type { ResourceSummary } from '../../../../shared/types.js';
import { prisma } from '../prisma.js';

/**
 * Display names for the scopes an alert carries. Alerts only ever carry identifiers (a client slug,
 * a subscription GUID), so the Resources tree would otherwise show "synextra-test" and
 * "f4d4f9e6…" rather than "Synextra Test" and "Synextra - Landing Zone - Corp - CSP".
 *
 * Read-only and cached briefly: onboarding records change rarely, resource lists are requested often.
 */

const CACHE_TTL_MS = 30_000;

export interface ScopeNames {
  clientName?: string;
  tenantId?: string;
  tenantName?: string;
  subscriptionName?: string;
}

export interface ScopeDirectory {
  byClientSlug: Map<string, ScopeNames>;
  bySubscriptionId: Map<string, ScopeNames>;
}

const EMPTY: ScopeDirectory = { byClientSlug: new Map(), bySubscriptionId: new Map() };

let cache: { at: number; directory: ScopeDirectory } | null = null;

function isPersistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function clearScopeDirectoryCache(): void {
  cache = null;
}

export async function loadScopeDirectory(): Promise<ScopeDirectory> {
  if (!isPersistenceConfigured()) {
    return EMPTY;
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.directory;
  }

  const [clients, subscriptions] = await Promise.all([
    prisma.clientAccount.findMany({
      select: {
        slug: true,
        name: true,
        primaryTenantId: true,
        tenantConnections: { select: { tenantId: true, tenantDisplayName: true } }
      }
    }),
    prisma.azureSubscription.findMany({
      select: {
        externalSubscriptionId: true,
        displayName: true,
        tenantId: true,
        tenantConnection: { select: { tenantDisplayName: true } },
        clientAccount: { select: { slug: true, name: true } }
      }
    })
  ]);

  const directory: ScopeDirectory = { byClientSlug: new Map(), bySubscriptionId: new Map() };

  for (const client of clients) {
    // Prefer the connection matching the client's primary tenant, else the only one it has.
    const connection =
      client.tenantConnections.find((entry) => entry.tenantId === client.primaryTenantId) ?? client.tenantConnections[0];

    directory.byClientSlug.set(client.slug, {
      clientName: client.name,
      tenantId: client.primaryTenantId ?? connection?.tenantId ?? undefined,
      tenantName: connection?.tenantDisplayName ?? undefined
    });
  }

  for (const subscription of subscriptions) {
    const fromClient = subscription.clientAccount ? directory.byClientSlug.get(subscription.clientAccount.slug) : undefined;

    directory.bySubscriptionId.set(subscription.externalSubscriptionId, {
      clientName: subscription.clientAccount?.name ?? fromClient?.clientName,
      tenantId: subscription.tenantId ?? fromClient?.tenantId ?? undefined,
      tenantName: subscription.tenantConnection?.tenantDisplayName ?? fromClient?.tenantName ?? undefined,
      subscriptionName: subscription.displayName
    });
  }

  cache = { at: Date.now(), directory };
  return directory;
}

/** Pure: fills display names on summaries from the directory, leaving unknown scopes untouched. */
export function applyScopeNames(summaries: ResourceSummary[], directory: ScopeDirectory): ResourceSummary[] {
  if (directory.byClientSlug.size === 0 && directory.bySubscriptionId.size === 0) {
    return summaries;
  }

  return summaries.map((summary) => {
    const fromClient = summary.clientSlug ? directory.byClientSlug.get(summary.clientSlug) : undefined;
    const fromSubscription = summary.subscriptionId ? directory.bySubscriptionId.get(summary.subscriptionId) : undefined;

    const clientName = fromClient?.clientName ?? fromSubscription?.clientName;
    const tenantId = fromClient?.tenantId ?? fromSubscription?.tenantId;
    const tenantName = fromClient?.tenantName ?? fromSubscription?.tenantName;
    const subscriptionName = fromSubscription?.subscriptionName;

    if (!clientName && !tenantId && !tenantName && !subscriptionName) {
      return summary;
    }

    return { ...summary, clientName, tenantId, tenantName, subscriptionName };
  });
}

import { Router } from 'express';

import type { AlertQueryFilters } from '../lib/alertRepository.js';
import { getClientOverview } from '../lib/resources/clientOverview.js';
import { getResourceHistory, listResourceSummaries } from '../lib/resources/resourceSummary.js';

/**
 * Resources are derived from alerts. Pulse is not an inventory: a resource exists here only if it
 * has alerted at least once. Resource IDs are ARM paths, so they travel as query parameters.
 */
export const resourcesRouter = Router();

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function filtersFromQuery(query: Record<string, unknown>): AlertQueryFilters {
  return {
    clientAccountId: queryString(query.clientAccountId),
    clientSlug: queryString(query.clientSlug),
    subscriptionId: queryString(query.subscriptionId)
  };
}

resourcesRouter.get('/', async (request, response) => {
  response.json(await listResourceSummaries(filtersFromQuery(request.query)));
});

/** Tenant-level summary for the top of the resource tree. No clientSlug means the unscoped bucket. */
resourcesRouter.get('/client-overview', async (request, response) => {
  const filters = filtersFromQuery(request.query);
  response.json(await getClientOverview(queryString(request.query.clientSlug), { ...filters, clientSlug: undefined }));
});

resourcesRouter.get('/history', async (request, response) => {
  const resourceId = queryString(request.query.resourceId);

  if (!resourceId) {
    response.status(400).json({ error: 'resourceId query parameter is required.' });
    return;
  }

  response.json(await getResourceHistory(resourceId, filtersFromQuery(request.query)));
});

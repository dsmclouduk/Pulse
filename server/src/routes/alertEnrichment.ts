import { Router } from 'express';

import type { CreateAlertCommentRequest } from '../../../shared/types.js';
import { getAlertById, type AlertQueryFilters } from '../lib/alertRepository.js';
import { addComment, listComments, listRecentComments } from '../lib/comments/commentRepository.js';
import { getEnrichmentConfig } from '../lib/enrichment/enrichmentConfig.js';
import { getEnrichmentDetail, scheduleEnrichment } from '../lib/enrichment/enrichmentOrchestrator.js';
import { getActiveEnrichmentCount, getStatus, isInflight, listStatuses } from '../lib/enrichment/enrichmentStatusStore.js';
import { broadcastComment } from '../lib/sseRegistry.js';

/**
 * Comment and enrichment endpoints. Alert IDs are ARM paths (with slashes), so they travel as
 * query parameters or JSON body fields, never as path segments. Same convention as /api/metrics/context.
 */
export const alertEnrichmentRouter = Router();

const MAX_COMMENT_BODY = 8000;
const DEFAULT_RECENT_LIMIT = 200;

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

function isCreateCommentRequest(payload: unknown): payload is CreateAlertCommentRequest {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Partial<CreateAlertCommentRequest>;
  return typeof candidate.alertId === 'string' && candidate.alertId.length > 0 && typeof candidate.body === 'string';
}

alertEnrichmentRouter.get('/comments/recent', async (request, response) => {
  const rawLimit = Number.parseInt(queryString(request.query.limit) ?? '', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : DEFAULT_RECENT_LIMIT;

  response.json(await listRecentComments(limit, filtersFromQuery(request.query)));
});

alertEnrichmentRouter.get('/comments', async (request, response) => {
  const alertId = queryString(request.query.alertId);

  if (!alertId) {
    response.status(400).json({ error: 'alertId query parameter is required.' });
    return;
  }

  response.json(await listComments(alertId, filtersFromQuery(request.query)));
});

alertEnrichmentRouter.post('/comments', async (request, response) => {
  if (!isCreateCommentRequest(request.body)) {
    response.status(400).json({ error: 'alertId and body are required.' });
    return;
  }

  const body = request.body.body.trim();

  if (body.length === 0 || body.length > MAX_COMMENT_BODY) {
    response.status(400).json({ error: `Comment body must be between 1 and ${MAX_COMMENT_BODY} characters.` });
    return;
  }

  const alert = await getAlertById(request.body.alertId, { clientSlug: request.body.clientSlug });

  if (!alert) {
    response.status(404).json({ error: 'Alert not found.' });
    return;
  }

  // Until Phase 4 auth lands the author is whatever the client says, defaulting to "Operator".
  const authorName = request.body.authorName?.trim().slice(0, 80) || 'Operator';

  const comment = await addComment({
    alert,
    author: { kind: 'user', name: authorName },
    kind: 'note',
    body
  });

  broadcastComment(comment);
  console.log(`[${comment.createdAt}] [comments] note added alert=${alert.id} author=${authorName}`);
  response.status(201).json(comment);
});

alertEnrichmentRouter.get('/enrichment/summary', (_request, response) => {
  const statuses = listStatuses();

  response.json({
    active: getActiveEnrichmentCount(),
    enabled: getEnrichmentConfig().enabled,
    statuses: statuses.map(({ trend: _trend, ...rest }) => rest)
  });
});

alertEnrichmentRouter.get('/enrichment', async (request, response) => {
  const alertId = queryString(request.query.alertId);

  if (!alertId) {
    response.status(400).json({ error: 'alertId query parameter is required.' });
    return;
  }

  const detail = await getEnrichmentDetail(alertId, filtersFromQuery(request.query));

  if (!detail) {
    response.status(404).json({ error: 'No enrichment has run for this alert.', alertId });
    return;
  }

  response.json(detail);
});

alertEnrichmentRouter.post('/enrichment/rerun', async (request, response) => {
  const payload = (request.body ?? {}) as { alertId?: unknown; clientSlug?: unknown };
  const alertId = typeof payload.alertId === 'string' ? payload.alertId : undefined;
  const clientSlug = typeof payload.clientSlug === 'string' ? payload.clientSlug : undefined;

  if (!alertId) {
    response.status(400).json({ error: 'alertId is required.' });
    return;
  }

  if (!getEnrichmentConfig().enabled) {
    response.status(503).json({ error: 'Enrichment is disabled (PULSE_ENRICHMENT_ENABLED=false).' });
    return;
  }

  const alert = await getAlertById(alertId, { clientSlug });

  if (!alert) {
    response.status(404).json({ error: 'Alert not found.' });
    return;
  }

  if (isInflight(alertId)) {
    response.status(409).json({ error: 'Enrichment is already running for this alert.', status: getStatus(alertId) });
    return;
  }

  const scheduled = scheduleEnrichment({ ...alert, status: 'Fired' }, { trigger: 'rerun', force: true });

  if (!scheduled) {
    response.status(409).json({ error: 'Enrichment could not be scheduled.', status: getStatus(alertId) });
    return;
  }

  console.log(`[${new Date().toISOString()}] [enrichment] rerun requested alert=${alertId}`);
  response.status(202).json(getStatus(alertId));
});

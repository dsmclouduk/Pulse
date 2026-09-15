import { Router } from 'express';

import { getAlertStats } from '../lib/stats/alertStats.js';

export const statsRouter = Router();

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Dashboard counters derived from the alert store; nothing here is persisted separately. */
statsRouter.get('/', async (request, response) => {
  response.json(
    await getAlertStats({
      clientAccountId: queryString(request.query.clientAccountId),
      clientSlug: queryString(request.query.clientSlug),
      subscriptionId: queryString(request.query.subscriptionId)
    })
  );
});

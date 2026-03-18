import { Router } from 'express';

import { listAlerts } from '../lib/alertRepository.js';

export const alertsRouter = Router();

alertsRouter.get('/', async (request, response) => {
  const clientAccountId = typeof request.query.clientAccountId === 'string' ? request.query.clientAccountId : undefined;
  const clientSlug = typeof request.query.clientSlug === 'string' ? request.query.clientSlug : undefined;
  const subscriptionId = typeof request.query.subscriptionId === 'string' ? request.query.subscriptionId : undefined;

  response.json(
    await listAlerts({
      clientAccountId,
      clientSlug,
      subscriptionId
    })
  );
});

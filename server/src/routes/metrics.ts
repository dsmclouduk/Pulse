import { Router } from 'express';

import { getResourceMetricsContext } from '../lib/metricsService.js';

export const metricsRouter = Router();

metricsRouter.get('/context', async (request, response) => {
  const resourceId = typeof request.query.resourceId === 'string' ? request.query.resourceId : '';
  const metricName = typeof request.query.metricName === 'string' ? request.query.metricName : undefined;

  const context = await getResourceMetricsContext(resourceId, { preferredMetricName: metricName });
  response.json(context);
});

import { Router } from 'express';

import type { SimulateAlertRequest } from '../../../shared/types.js';
import { buildSimulatedAzurePayload } from '../lib/normalise.js';
import { processAzureAlertPayload } from '../lib/processAlert.js';

export const simulateRouter = Router();

function isSimulateAlertRequest(payload: unknown): payload is SimulateAlertRequest {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const maybePayload = payload as Partial<SimulateAlertRequest>;

  return Boolean(maybePayload.ruleName && maybePayload.severity && maybePayload.status && maybePayload.resourceId);
}

simulateRouter.post('/alert', (request, response) => {
  if (process.env.NODE_ENV === 'production') {
    response.status(404).json({ error: 'Simulation endpoint is disabled in production.' });
    return;
  }

  if (!isSimulateAlertRequest(request.body)) {
    response.status(400).json({ error: 'Invalid simulation payload.' });
    return;
  }

  const payload = buildSimulatedAzurePayload(request.body);

  void processAzureAlertPayload(payload, 'simulate', true, {
    clientSlug: request.body.clientSlug
  })
    .then((alert) => {
      response.status(201).json(alert);
    })
    .catch((error) => {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Simulation failed.'
      });
    });
});

import { Router } from 'express';

import { canAuthorizeWebhookSecret } from '../lib/alertRepository.js';
import { isAzureCommonAlertSchema } from '../lib/normalise.js';
import { processAzureAlertPayload } from '../lib/processAlert.js';

export const webhookRouter = Router();

webhookRouter.post('/azure-alerts', async (request, response) => {
  const receivedSecret = request.header('x-webhook-secret');

  if (!(await canAuthorizeWebhookSecret(receivedSecret))) {
    response.status(401).json({ error: 'Unauthorized webhook request.' });
    return;
  }

  response.status(200).json({ accepted: true });

  setImmediate(async () => {
    if (!isAzureCommonAlertSchema(request.body)) {
      console.error(`[${new Date().toISOString()}] [webhook] Invalid Azure Common Alert Schema payload.`);
      return;
    }

    try {
      await processAzureAlertPayload(request.body, 'webhook', false, {
        webhookSecret: receivedSecret
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [webhook] Failed to process alert`, error);
    }
  });
});

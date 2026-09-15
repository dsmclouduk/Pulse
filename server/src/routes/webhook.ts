import { Router, type Request, type Response } from 'express';

import { canAuthorizeWebhookSecret } from '../lib/alertRepository.js';
import { isAzureCommonAlertSchema } from '../lib/normalise.js';
import { processAzureAlertPayload } from '../lib/processAlert.js';

export const webhookRouter = Router();

/**
 * Azure action-group Webhook actions cannot send custom headers; credentials can only travel in
 * the URI. Real action groups therefore post to `/azure-alerts/<webhookSecret>`. The header form
 * (`x-webhook-secret`) is kept for manual and ngrok testing. The secret is never logged.
 */
async function handleAzureAlert(request: Request, response: Response, receivedSecret: string | undefined, source: 'header' | 'url'): Promise<void> {
  if (!(await canAuthorizeWebhookSecret(receivedSecret))) {
    console.warn(`[${new Date().toISOString()}] [webhook] Rejected request (${source} credential invalid or missing).`);
    response.status(401).json({ error: 'Unauthorized webhook request.' });
    return;
  }

  // ACK immediately: action groups retry on slow or failing responses and mute the endpoint after repeated failures.
  response.status(200).json({ accepted: true });

  setImmediate(async () => {
    if (!isAzureCommonAlertSchema(request.body)) {
      console.error(`[${new Date().toISOString()}] [webhook] Invalid Azure Common Alert Schema payload (${source}).`);
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
}

webhookRouter.post('/azure-alerts', (request, response) => {
  void handleAzureAlert(request, response, request.header('x-webhook-secret'), 'header');
});

webhookRouter.post('/azure-alerts/:webhookToken', (request, response) => {
  const token = typeof request.params.webhookToken === 'string' ? request.params.webhookToken : undefined;
  void handleAzureAlert(request, response, token, 'url');
});

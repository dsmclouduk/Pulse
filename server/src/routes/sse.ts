import { randomUUID } from 'node:crypto';
import { Router } from 'express';

import { listAlerts } from '../lib/alertRepository.js';
import { registerClient, sendInit, sendPing, unregisterClient } from '../lib/sseRegistry.js';

export const sseRouter = Router();

sseRouter.get('/stream', async (request, response) => {
  const clientId = randomUUID();
  const clientAccountId = typeof request.query.clientAccountId === 'string' ? request.query.clientAccountId : undefined;
  const clientSlug = typeof request.query.clientSlug === 'string' ? request.query.clientSlug : undefined;
  const subscriptionId = typeof request.query.subscriptionId === 'string' ? request.query.subscriptionId : undefined;

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  registerClient(clientId, response, {
    clientAccountId,
    clientSlug,
    subscriptionId
  });
  sendInit(
    clientId,
    await listAlerts({
      clientAccountId,
      clientSlug,
      subscriptionId
    })
  );

  const keepAliveTimer = setInterval(() => {
    sendPing(clientId);
  }, 15000);

  response.on('close', () => {
    clearInterval(keepAliveTimer);
    unregisterClient(clientId);
    response.end();
  });
});

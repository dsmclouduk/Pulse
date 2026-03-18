import type { AlertEvent, AzureCommonAlertSchema } from '../../../shared/types.js';
import { persistAlert } from './alertRepository.js';
import { registerWatchedResourceIds } from './metricsService.js';
import { normaliseAzureAlert } from './normalise.js';
import { broadcast } from './sseRegistry.js';

interface ProcessAzureAlertOptions {
  clientSlug?: string;
  webhookSecret?: string;
}

export async function processAzureAlertPayload(
  payload: AzureCommonAlertSchema,
  routeLabel: string,
  isSimulated: boolean,
  options: ProcessAzureAlertOptions = {}
): Promise<AlertEvent> {
  const receivedAt = new Date().toISOString();
  const alert = normaliseAzureAlert(payload, receivedAt, isSimulated);
  const persistedAlert = await persistAlert(alert, payload, options);

  registerWatchedResourceIds(persistedAlert.resourceIds);
  broadcast(persistedAlert);

  console.log(
    `[${receivedAt}] [${routeLabel}] rule=${persistedAlert.ruleName} severity=${persistedAlert.severity} status=${persistedAlert.status} lagMs=${persistedAlert.lagMs} client=${persistedAlert.clientSlug ?? 'unscoped'}`
  );

  return persistedAlert;
}

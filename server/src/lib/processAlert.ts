import type { AlertEvent, AzureCommonAlertSchema } from '../../../shared/types.js';
import { persistAlert } from './alertRepository.js';
import { scheduleEnrichment } from './enrichment/enrichmentOrchestrator.js';
import { registerWatchedResourceIds } from './metricsService.js';
import { normaliseAzureAlert } from './normalise.js';
import { broadcast } from './sseRegistry.js';

interface ProcessAzureAlertOptions {
  clientSlug?: string;
  webhookSecret?: string;
  /** Skip the fire-and-forget enrichment pipeline (metrics history + diagnosis). */
  skipEnrichment?: boolean;
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

  if (!options.skipEnrichment) {
    // Never awaited: the webhook has already been ACKed and the simulate route must return promptly.
    const scheduled = scheduleEnrichment(persistedAlert, { trigger: 'ingest' });

    if (scheduled) {
      console.log(`[${receivedAt}] [${routeLabel}] enrichment queued alert=${persistedAlert.id}`);
    }
  }

  return persistedAlert;
}

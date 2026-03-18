import { createHash } from 'node:crypto';

import type { AlertEvent, AzureCommonAlertSchema, SimulateAlertRequest } from '../../../shared/types.js';

function parseNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractResourceMetadata(resourceId: string | undefined): { subscriptionId?: string; resourceGroup?: string } {
  if (!resourceId) {
    return {};
  }

  const parts = resourceId.split('/').filter(Boolean);
  const subscriptionIndex = parts.findIndex((part) => part.toLowerCase() === 'subscriptions');
  const resourceGroupIndex = parts.findIndex((part) => part.toLowerCase() === 'resourcegroups');

  return {
    subscriptionId: subscriptionIndex !== -1 ? parts[subscriptionIndex + 1] : undefined,
    resourceGroup: resourceGroupIndex !== -1 ? parts[resourceGroupIndex + 1] : undefined
  };
}

export function isAzureCommonAlertSchema(payload: unknown): payload is AzureCommonAlertSchema {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const maybePayload = payload as Partial<AzureCommonAlertSchema>;

  return maybePayload.schemaId === 'azureMonitorCommonAlertSchema' && Boolean(maybePayload.data?.essentials?.alertId);
}

export function normaliseAzureAlert(payload: AzureCommonAlertSchema, receivedAt: string, isSimulated: boolean): AlertEvent {
  const { essentials, alertContext } = payload.data;
  const primaryCondition = alertContext?.condition?.allOf?.[0];
  const firedAt = essentials.firedDateTime;
  const lagMs = new Date(receivedAt).getTime() - new Date(firedAt).getTime();
  const primaryResourceId = essentials.alertTargetIDs[0];
  const { subscriptionId, resourceGroup } = extractResourceMetadata(primaryResourceId);

  return {
    id: essentials.alertId,
    ruleName: essentials.alertRule,
    severity: essentials.severity,
    status: essentials.monitorCondition,
    signalType: essentials.signalType,
    resourceIds: essentials.alertTargetIDs,
    resourceGroup,
    subscriptionId,
    firedAt,
    resolvedAt: essentials.resolvedDateTime,
    receivedAt,
    lagMs,
    metricName: primaryCondition?.metricName,
    metricValue: parseNumber(primaryCondition?.metricValue),
    threshold: parseNumber(primaryCondition?.threshold),
    description: alertContext?.description ?? essentials.description,
    isSimulated
  };
}

function createSimulatedAlertId(input: SimulateAlertRequest): string {
  const hash = createHash('sha1');
  hash.update(`${input.ruleName}|${input.resourceId}`);
  return `simulated:${hash.digest('hex')}`;
}

export function buildSimulatedAzurePayload(input: SimulateAlertRequest): AzureCommonAlertSchema {
  const now = new Date().toISOString();

  return {
    schemaId: 'azureMonitorCommonAlertSchema',
    data: {
      essentials: {
        alertId: createSimulatedAlertId(input),
        alertRule: input.ruleName,
        severity: input.severity,
        signalType: 'Metric',
        monitorCondition: input.status,
        alertTargetIDs: [input.resourceId],
        firedDateTime: now,
        resolvedDateTime: input.status === 'Resolved' ? now : null,
        description: input.description
      },
      alertContext: {
        description: input.description,
        condition: {
          allOf: [
            {
              metricName: input.metricName,
              operator: 'GreaterThan',
              threshold: input.threshold,
              metricValue: input.metricValue
            }
          ]
        }
      }
    }
  };
}

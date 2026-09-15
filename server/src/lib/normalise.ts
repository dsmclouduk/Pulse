import { createHash, randomBytes } from 'node:crypto';

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

/**
 * A log alert only reports the dimensions its rule splits on. When a disk rule pins the mount in its
 * query text instead of splitting by it, the payload names the resource but not the drive, so read
 * the mount back out of the query the rule author wrote. Azure never tells us the OS layout, and we
 * never ask the guest: the mount is either a dimension or it is in the rule's own KQL.
 */
export function extractMountFromQuery(searchQuery: string | undefined): string | undefined {
  if (!searchQuery) {
    return undefined;
  }

  const match = /Mount\s*=~?=?\s*"([^"]{1,64})"/i.exec(searchQuery) ?? /mountId"\]\s*==\s*"([^"]{1,64})"/i.exec(searchQuery);
  return match?.[1];
}

function extractDimensions(
  dimensions: Array<{ name: string; value: string }> | undefined
): Record<string, string> | undefined {
  if (!dimensions || dimensions.length === 0) {
    return undefined;
  }

  const result: Record<string, string> = {};

  for (const dimension of dimensions) {
    if (dimension?.name && dimension.value !== undefined) {
      result[dimension.name] = String(dimension.value);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function isAzureCommonAlertSchema(payload: unknown): payload is AzureCommonAlertSchema {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const maybePayload = payload as Partial<AzureCommonAlertSchema>;

  return maybePayload.schemaId === 'azureMonitorCommonAlertSchema' && Boolean(maybePayload.data?.essentials?.alertId);
}

function withMount(
  dimensions: Record<string, string> | undefined,
  mount: string | undefined
): Record<string, string> | undefined {
  if (!mount) {
    return dimensions;
  }

  // A real dimension always wins: it is what Azure actually evaluated.
  if (dimensions && (dimensions.Mount ?? dimensions.mount ?? dimensions.mountId)) {
    return dimensions;
  }

  return { ...(dimensions ?? {}), Mount: mount };
}

export function normaliseAzureAlert(payload: AzureCommonAlertSchema, receivedAt: string, isSimulated: boolean): AlertEvent {
  const { essentials, alertContext } = payload.data;
  const primaryCondition = alertContext?.condition?.allOf?.[0];
  const firedAt = essentials.firedDateTime;
  // Lag measures how long the event we just received took to reach us. A Resolved payload keeps the
  // original firedDateTime, so measuring from it would report the whole incident duration as lag.
  const eventAt = essentials.monitorCondition === 'Resolved' ? (essentials.resolvedDateTime ?? firedAt) : firedAt;
  const lagMs = new Date(receivedAt).getTime() - new Date(eventAt).getTime();
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
    // Log alerts carry the aggregated column name rather than a platform metric name.
    metricName: primaryCondition?.metricName ?? primaryCondition?.metricMeasureColumn,
    metricValue: parseNumber(primaryCondition?.metricValue),
    threshold: parseNumber(primaryCondition?.threshold),
    operator: primaryCondition?.operator,
    description: alertContext?.description ?? essentials.description,
    isSimulated,
    dimensions: withMount(extractDimensions(primaryCondition?.dimensions), extractMountFromQuery(primaryCondition?.searchQuery))
  };
}

/**
 * Simulated alert ids are deterministic on rule + resource so Fired → Resolved upserts one row.
 * `unique` (or an explicit `nonce`) salts the hash so repeated fires create distinct alerts.
 */
export function createSimulatedAlertId(input: SimulateAlertRequest): string {
  const hash = createHash('sha1');
  const nonce = input.nonce ?? (input.unique ? randomBytes(6).toString('hex') : '');
  const salt = nonce ? `|${nonce}` : '';
  hash.update(`${input.ruleName}|${input.resourceId}${salt}`);
  return `simulated:${hash.digest('hex')}`;
}

function resolveFiredAt(requested: string | undefined, now: Date): string {
  if (!requested) {
    return now.toISOString();
  }

  const parsed = new Date(requested);

  if (!Number.isFinite(parsed.getTime())) {
    return now.toISOString();
  }

  // Clamp to now so lagMs can never go negative.
  return parsed.getTime() > now.getTime() ? now.toISOString() : parsed.toISOString();
}

export function buildSimulatedAzurePayload(input: SimulateAlertRequest, alertId: string = createSimulatedAlertId(input)): AzureCommonAlertSchema {
  const now = new Date();
  const firedAt = resolveFiredAt(input.firedAt, now);
  const dimensions = input.dimensions
    ? Object.entries(input.dimensions).map(([name, value]) => ({ name, value }))
    : undefined;

  return {
    schemaId: 'azureMonitorCommonAlertSchema',
    data: {
      essentials: {
        alertId,
        alertRule: input.ruleName,
        severity: input.severity,
        signalType: input.signalType ?? 'Metric',
        monitorCondition: input.status,
        alertTargetIDs: [input.resourceId],
        firedDateTime: firedAt,
        resolvedDateTime: input.status === 'Resolved' ? now.toISOString() : null,
        description: input.description
      },
      alertContext: {
        description: input.description,
        condition: {
          allOf: [
            {
              metricName: input.metricName,
              operator: input.operator ?? 'GreaterThan',
              threshold: input.threshold,
              metricValue: input.metricValue,
              dimensions
            }
          ]
        }
      }
    }
  };
}

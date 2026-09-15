import { Router } from 'express';

import type { AlertSeverity, AlertStatus, SignalType, SimulateAlertRequest, SyntheticHistorySpec } from '../../../shared/types.js';
import { registerSyntheticHistory } from '../lib/metrics/syntheticProvider.js';
import { buildSimulatedAzurePayload, createSimulatedAlertId } from '../lib/normalise.js';
import { processAzureAlertPayload } from '../lib/processAlert.js';
import { applyScenarioPreset, isSimulateScenario, listScenarioPresets } from '../lib/simulation/scenarios.js';

export const simulateRouter = Router();

const SEVERITIES: readonly AlertSeverity[] = ['Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'];
const STATUSES: readonly AlertStatus[] = ['Fired', 'Resolved'];
const SIGNAL_TYPES: readonly SignalType[] = ['Metric', 'Log', 'ActivityLog'];
const HISTORY_PATTERNS: readonly SyntheticHistorySpec['pattern'][] = ['steady-growth', 'rapid-fill', 'flat', 'sawtooth'];

interface ValidationResult {
  ok: boolean;
  error?: string;
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function validateSyntheticHistory(value: unknown): ValidationResult {
  if (value === undefined) {
    return { ok: true };
  }

  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'syntheticHistory must be an object.' };
  }

  const spec = value as Partial<SyntheticHistorySpec>;

  if (!spec.pattern || !HISTORY_PATTERNS.includes(spec.pattern)) {
    return { ok: false, error: `syntheticHistory.pattern must be one of ${HISTORY_PATTERNS.join(', ')}.` };
  }

  for (const field of ['days', 'startPercent', 'endPercent', 'noise', 'jumpHoursAgo', 'periodDays'] as const) {
    if (!isOptionalNumber(spec[field])) {
      return { ok: false, error: `syntheticHistory.${field} must be a number.` };
    }
  }

  if (spec.days !== undefined && (spec.days < 1 || spec.days > 366)) {
    return { ok: false, error: 'syntheticHistory.days must be between 1 and 366.' };
  }

  return { ok: true };
}

/** Hand-rolled validation (no zod in this repo). Enum values are checked, not just truthiness. */
function validateSimulateRequest(payload: unknown): ValidationResult & { request?: SimulateAlertRequest } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const candidate = payload as Record<string, unknown>;

  if (candidate.scenario !== undefined && !isSimulateScenario(candidate.scenario)) {
    return { ok: false, error: 'Unknown scenario.' };
  }

  const withPreset = applyScenarioPreset({
    ...(candidate as unknown as SimulateAlertRequest),
    ruleName: typeof candidate.ruleName === 'string' ? candidate.ruleName : '',
    severity: candidate.severity as AlertSeverity,
    status: (candidate.status as AlertStatus) ?? 'Fired',
    resourceId: typeof candidate.resourceId === 'string' ? candidate.resourceId : ''
  });

  if (!withPreset.ruleName.trim()) {
    return { ok: false, error: 'ruleName is required.' };
  }

  if (!withPreset.resourceId.trim().startsWith('/')) {
    return { ok: false, error: 'resourceId is required and must be an ARM resource path.' };
  }

  if (!SEVERITIES.includes(withPreset.severity)) {
    return { ok: false, error: `severity must be one of ${SEVERITIES.join(', ')}.` };
  }

  if (!STATUSES.includes(withPreset.status)) {
    return { ok: false, error: `status must be one of ${STATUSES.join(', ')}.` };
  }

  if (withPreset.signalType !== undefined && !SIGNAL_TYPES.includes(withPreset.signalType)) {
    return { ok: false, error: `signalType must be one of ${SIGNAL_TYPES.join(', ')}.` };
  }

  if (!isOptionalNumber(withPreset.metricValue) || !isOptionalNumber(withPreset.threshold)) {
    return { ok: false, error: 'metricValue and threshold must be numbers.' };
  }

  if (
    !isOptionalString(withPreset.metricName) ||
    !isOptionalString(withPreset.description) ||
    !isOptionalString(withPreset.clientSlug) ||
    !isOptionalString(withPreset.firedAt) ||
    !isOptionalString(withPreset.nonce) ||
    !isOptionalString(withPreset.operator)
  ) {
    return { ok: false, error: 'String fields must be strings.' };
  }

  if (!isOptionalBoolean(withPreset.unique) || !isOptionalBoolean(withPreset.skipEnrichment)) {
    return { ok: false, error: 'unique and skipEnrichment must be booleans.' };
  }

  if (withPreset.dimensions !== undefined) {
    if (!withPreset.dimensions || typeof withPreset.dimensions !== 'object' || Array.isArray(withPreset.dimensions)) {
      return { ok: false, error: 'dimensions must be an object of string values.' };
    }

    if (!Object.values(withPreset.dimensions).every((value) => typeof value === 'string')) {
      return { ok: false, error: 'dimensions values must be strings.' };
    }
  }

  const historyValidation = validateSyntheticHistory(withPreset.syntheticHistory);

  if (!historyValidation.ok) {
    return historyValidation;
  }

  return { ok: true, request: withPreset };
}

simulateRouter.get('/scenarios', (_request, response) => {
  response.json(listScenarioPresets());
});

simulateRouter.post('/alert', (request, response) => {
  if (process.env.NODE_ENV === 'production') {
    response.status(404).json({ error: 'Simulation endpoint is disabled in production.' });
    return;
  }

  const validation = validateSimulateRequest(request.body);

  if (!validation.ok || !validation.request) {
    response.status(400).json({ error: validation.error ?? 'Invalid simulation payload.' });
    return;
  }

  const simulateRequest = validation.request;
  const alertId = createSimulatedAlertId(simulateRequest);

  // Register synthetic history before the pipeline runs so enrichment can find it.
  if (simulateRequest.syntheticHistory && simulateRequest.status === 'Fired') {
    const metricName = simulateRequest.metricName ?? 'Simulated metric';
    const isPercent = /percent|%|disk|cpu|memory/i.test(metricName);

    registerSyntheticHistory(
      alertId,
      {
        ...simulateRequest.syntheticHistory,
        endPercent: simulateRequest.syntheticHistory.endPercent ?? simulateRequest.metricValue
      },
      {
        metricName,
        unit: isPercent ? 'Percent' : 'Count',
        resourceId: simulateRequest.resourceId
      }
    );
  }

  const payload = buildSimulatedAzurePayload(simulateRequest, alertId);

  void processAzureAlertPayload(payload, 'simulate', true, {
    clientSlug: simulateRequest.clientSlug,
    skipEnrichment: simulateRequest.skipEnrichment
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

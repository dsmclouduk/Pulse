import type { SimulateAlertRequest, SimulateScenario, SyntheticHistorySpec } from '../../../../shared/types.js';

export interface ScenarioPreset {
  id: SimulateScenario;
  label: string;
  description: string;
  defaults: Pick<SimulateAlertRequest, 'ruleName' | 'severity' | 'metricName' | 'metricValue' | 'threshold' | 'description' | 'dimensions'>;
  syntheticHistory?: SyntheticHistorySpec;
}

export const SCENARIO_PRESETS: Record<Exclude<SimulateScenario, 'custom'>, ScenarioPreset> = {
  'disk-steady-growth': {
    id: 'disk-steady-growth',
    label: 'Disk: steady growth (90 days)',
    description: 'OS disk has crept up ~0.4 pts/day for three months and has just crossed 95%.',
    defaults: {
      ruleName: 'Disk C: used space > 95%',
      severity: 'Sev2',
      metricName: 'Disk % Used',
      metricValue: 95.3,
      threshold: 95,
      description: 'Logical disk C: used space exceeded 95% (VM Insights).',
      dimensions: { mountId: 'C:' }
    },
    syntheticHistory: { pattern: 'steady-growth', days: 90, startPercent: 59, endPercent: 95.3, noise: 0.6 }
  },
  'disk-rapid-fill': {
    id: 'disk-rapid-fill',
    label: 'Disk: rapid fill (6 hours)',
    description: 'Disk sat flat at ~55% for months, then filled 40 pts in six hours.',
    defaults: {
      ruleName: 'Disk D: used space > 90%',
      severity: 'Sev1',
      metricName: 'Disk % Used',
      metricValue: 96.1,
      threshold: 90,
      description: 'Logical disk D: used space exceeded 90% (VM Insights).',
      dimensions: { mountId: 'D:' }
    },
    syntheticHistory: { pattern: 'rapid-fill', days: 90, startPercent: 55, endPercent: 96.1, noise: 0.5, jumpHoursAgo: 6 }
  },
  'disk-flat': {
    id: 'disk-flat',
    label: 'Disk: flat at the threshold',
    description: 'Disk has hovered around 94–96% for months; the alert flaps on noise.',
    defaults: {
      ruleName: 'Disk C: used space > 95%',
      severity: 'Sev3',
      metricName: 'Disk % Used',
      metricValue: 95.2,
      threshold: 95,
      description: 'Logical disk C: used space exceeded 95% (VM Insights).',
      dimensions: { mountId: 'C:' }
    },
    syntheticHistory: { pattern: 'flat', days: 90, startPercent: 95, endPercent: 95.2, noise: 0.7 }
  },
  'cpu-sawtooth': {
    id: 'cpu-sawtooth',
    label: 'CPU: weekly sawtooth',
    description: 'CPU oscillates between 30% and 95% on a weekly batch cycle.',
    defaults: {
      ruleName: 'High CPU > 90%',
      severity: 'Sev2',
      metricName: 'Percentage CPU',
      metricValue: 94.8,
      threshold: 90,
      description: 'Percentage CPU exceeded 90% for 15 minutes.'
    },
    syntheticHistory: { pattern: 'sawtooth', days: 30, startPercent: 30, endPercent: 94.8, noise: 3, periodDays: 7 }
  },
  'memory-leak': {
    id: 'memory-leak',
    label: 'Memory: slow leak (14 days)',
    description: 'Committed memory climbs steadily since the last deployment two weeks ago.',
    defaults: {
      ruleName: 'Memory used > 90%',
      severity: 'Sev2',
      metricName: 'Memory % Used',
      metricValue: 91.5,
      threshold: 90,
      description: 'Committed memory exceeded 90% of total.'
    },
    syntheticHistory: { pattern: 'steady-growth', days: 14, startPercent: 48, endPercent: 91.5, noise: 1.2 }
  }
};

export function isSimulateScenario(value: unknown): value is SimulateScenario {
  return value === 'custom' || (typeof value === 'string' && value in SCENARIO_PRESETS);
}

/** Fills missing request fields from the scenario preset. Explicit request fields always win. */
export function applyScenarioPreset(request: SimulateAlertRequest): SimulateAlertRequest {
  if (!request.scenario || request.scenario === 'custom') {
    return request;
  }

  const preset = SCENARIO_PRESETS[request.scenario];
  const defaults = preset.defaults;

  return {
    ...request,
    ruleName: request.ruleName || defaults.ruleName,
    severity: request.severity || defaults.severity,
    metricName: request.metricName ?? defaults.metricName,
    metricValue: request.metricValue ?? defaults.metricValue,
    threshold: request.threshold ?? defaults.threshold,
    description: request.description ?? defaults.description,
    dimensions: request.dimensions ?? defaults.dimensions,
    syntheticHistory: request.syntheticHistory ?? preset.syntheticHistory
  };
}

export function listScenarioPresets(): ScenarioPreset[] {
  return Object.values(SCENARIO_PRESETS);
}

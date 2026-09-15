import { createHash } from 'node:crypto';

import type {
  MetricHistoryRequest,
  MetricHistoryResult,
  MetricPoint,
  MetricSeries,
  SyntheticHistorySpec
} from '../../../../shared/types.js';
import type { MetricHistoryProvider } from './metricHistoryProvider.js';

const MAX_REGISTERED = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface SyntheticHistoryContext {
  metricName: string;
  unit: string;
  resourceId: string;
}

interface RegisteredSynthetic {
  spec: SyntheticHistorySpec;
  context: SyntheticHistoryContext;
}

const registry = new Map<string, RegisteredSynthetic>();

export const SYNTHETIC_DEFAULTS = {
  days: 90,
  startPercent: 55,
  endPercent: 95,
  noise: 0.8,
  jumpHoursAgo: 6,
  periodDays: 7
} as const;

export type ResolvedSyntheticSpec = Required<SyntheticHistorySpec>;

export function resolveSyntheticSpec(spec: SyntheticHistorySpec, fallbackEnd?: number): ResolvedSyntheticSpec {
  return {
    pattern: spec.pattern,
    days: spec.days ?? SYNTHETIC_DEFAULTS.days,
    startPercent: spec.startPercent ?? SYNTHETIC_DEFAULTS.startPercent,
    endPercent: spec.endPercent ?? fallbackEnd ?? SYNTHETIC_DEFAULTS.endPercent,
    noise: spec.noise ?? SYNTHETIC_DEFAULTS.noise,
    jumpHoursAgo: spec.jumpHoursAgo ?? SYNTHETIC_DEFAULTS.jumpHoursAgo,
    periodDays: spec.periodDays ?? SYNTHETIC_DEFAULTS.periodDays
  };
}

export function registerSyntheticHistory(alertId: string, spec: SyntheticHistorySpec, context: SyntheticHistoryContext): void {
  registry.delete(alertId);
  registry.set(alertId, { spec, context });

  if (registry.size > MAX_REGISTERED) {
    const oldest = registry.keys().next().value;

    if (oldest !== undefined) {
      registry.delete(oldest);
    }
  }
}

export function hasSyntheticHistory(alertId: string): boolean {
  return registry.has(alertId);
}

export function getSyntheticHistory(alertId: string): RegisteredSynthetic | undefined {
  return registry.get(alertId);
}

/** Small deterministic PRNG (mulberry32) so a rerun for the same alert produces the same series. */
function createRandom(seed: string): () => number {
  const digest = createHash('sha1').update(seed).digest();
  let state = digest.readUInt32LE(0);

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Generates a synthetic series ending at `now`. Daily points across the full window plus hourly
 * points for the last 24 hours so short-range deltas are meaningful.
 */
export function generateSyntheticSeries(
  spec: ResolvedSyntheticSpec,
  seed: string,
  now: Date,
  metricName: string,
  unit: string
): MetricSeries {
  const random = createRandom(seed);
  const nowMs = now.getTime();
  const startMs = nowMs - spec.days * DAY_MS;
  const isPercent = unit === 'Percent';
  const upper = isPercent ? 100 : Number.POSITIVE_INFINITY;

  const timestamps: number[] = [];

  for (let day = spec.days; day >= 1; day -= 1) {
    timestamps.push(nowMs - day * DAY_MS);
  }

  for (let hour = 23; hour >= 0; hour -= 1) {
    timestamps.push(nowMs - hour * HOUR_MS);
  }

  const range = spec.endPercent - spec.startPercent;

  const baseValue = (t: number): number => {
    const progress = (t - startMs) / (nowMs - startMs);

    switch (spec.pattern) {
      case 'steady-growth':
        return spec.startPercent + range * progress;
      case 'flat':
        return spec.startPercent;
      case 'sawtooth': {
        const periodMs = spec.periodDays * DAY_MS;
        const phase = ((t - startMs) % periodMs) / periodMs;
        const triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
        return spec.startPercent + range * triangle;
      }
      case 'rapid-fill': {
        const jumpStart = nowMs - spec.jumpHoursAgo * HOUR_MS;

        if (t < jumpStart) {
          return spec.startPercent;
        }

        const jumpProgress = (t - jumpStart) / (nowMs - jumpStart);
        // Ease-in so the fill accelerates, which is what a runaway log or dump looks like.
        return spec.startPercent + range * jumpProgress ** 1.5;
      }
    }
  };

  const points: MetricPoint[] = timestamps.map((t, index) => {
    const isLast = index === timestamps.length - 1;
    const noise = isLast ? 0 : gaussian(random) * spec.noise;
    const value = clamp(baseValue(t) + noise, 0, upper);

    return {
      timestamp: new Date(t).toISOString(),
      average: Math.round(value * 100) / 100,
      minimum: Math.round(clamp(value - Math.abs(noise) / 2, 0, upper) * 100) / 100,
      maximum: Math.round(clamp(value + Math.abs(noise) / 2, 0, upper) * 100) / 100
    };
  });

  return {
    metricName,
    displayName: `${metricName} (synthetic ${spec.pattern})`,
    description: `Synthetic ${spec.pattern} history generated for a simulated alert.`,
    unit,
    aggregation: 'Average',
    namespace: 'pulse.synthetic',
    points
  };
}

export const syntheticProvider: MetricHistoryProvider = {
  source: 'synthetic',
  isAvailable: () => true,
  fetchHistory: async (request: MetricHistoryRequest): Promise<MetricHistoryResult> => {
    const registered = registry.get(request.alertId);
    const fetchedAt = new Date().toISOString();

    if (!registered) {
      return {
        request,
        provider: 'synthetic',
        fetchedAt,
        status: 'unavailable',
        message: 'No synthetic history registered for this simulated alert.',
        series: []
      };
    }

    const spec = resolveSyntheticSpec(registered.spec);
    const end = new Date(request.timespan.end);
    const series = generateSyntheticSeries(spec, request.alertId, end, registered.context.metricName, registered.context.unit);

    return {
      request,
      provider: 'synthetic',
      fetchedAt,
      status: 'ready',
      derivation: `Synthetic ${spec.pattern} series: ${spec.startPercent} → ${spec.endPercent} over ${spec.days} days`,
      series: [series]
    };
  }
};

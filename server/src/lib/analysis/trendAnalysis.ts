import type {
  DiagnosisUrgency,
  MetricAggregation,
  MetricPoint,
  MetricSeries,
  TrendAnalysis,
  TrendAnomaly,
  TrendPattern
} from '../../../../shared/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Classification thresholds, expressed in percent-of-ceiling units.
 * Metrics with a different ceiling are scaled by ceiling/100 before comparison.
 */
export const TREND_THRESHOLDS = {
  rapidFillDelta6h: 10,
  rapidFillDelta24h: 20,
  rapidFillDelta24hMin: 5,
  rapidFillRecentRateMultiplier: 10,
  steadySlopePerDay: 0.1,
  steadyRSquared: 0.6,
  volatileStdDev: 5,
  volatileRSquared: 0.3,
  anomalyMinUnits: 2,
  anomalySigmaMultiplier: 3,
  nearCeilingPercent: 95,
  immediateDays: 7,
  soonDays: 30
} as const;

export interface TrendOptions {
  ceiling?: number;
  /** Alert threshold, used to judge whether a flat metric is sitting at the limit. */
  threshold?: number;
  now?: Date;
}

interface CleanPoint {
  t: number;
  v: number;
}

export function pickValue(point: MetricPoint, aggregation: MetricAggregation): number | undefined {
  switch (aggregation) {
    case 'Average':
      return point.average ?? point.maximum ?? point.total;
    case 'Maximum':
      return point.maximum ?? point.average;
    case 'Minimum':
      return point.minimum ?? point.average;
    case 'Total':
      return point.total ?? point.average;
    case 'Count':
      return point.count ?? point.total;
  }
}

function cleanSeries(series: MetricSeries): CleanPoint[] {
  const byTime = new Map<number, number>();

  for (const point of series.points) {
    const value = pickValue(point, series.aggregation);
    const time = new Date(point.timestamp).getTime();

    if (value === undefined || !Number.isFinite(value) || !Number.isFinite(time)) {
      continue;
    }

    byTime.set(time, value);
  }

  return [...byTime.entries()].map(([t, v]) => ({ t, v })).sort((left, right) => left.t - right.t);
}

/**
 * Value at a given time: linear interpolation when the time falls between two points,
 * the nearest earlier point when it does not, null when the time precedes the series.
 */
export function valueAt(points: CleanPoint[], tMs: number): number | null {
  if (points.length === 0 || tMs < points[0].t) {
    return null;
  }

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];

    if (point.t === tMs) {
      return point.v;
    }

    if (point.t > tMs) {
      const previous = points[index - 1];
      const ratio = (tMs - previous.t) / (point.t - previous.t);
      return previous.v + (point.v - previous.v) * ratio;
    }
  }

  return points[points.length - 1].v;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatSigned(value: number, decimals = 1): string {
  const rounded = round(value, decimals);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function insufficient(series: MetricSeries, points: CleanPoint[], ceiling: number | null): TrendAnalysis {
  const first = points[0]?.v ?? 0;
  const last = points[points.length - 1]?.v ?? first;

  return {
    metricName: series.metricName,
    unit: series.unit,
    windowStart: points[0] ? new Date(points[0].t).toISOString() : '',
    windowEnd: points[points.length - 1] ? new Date(points[points.length - 1].t).toISOString() : '',
    pointCount: points.length,
    spanDays: points.length >= 2 ? round((points[points.length - 1].t - points[0].t) / DAY_MS, 2) : 0,
    first,
    last,
    min: points.length ? Math.min(...points.map((point) => point.v)) : 0,
    max: points.length ? Math.max(...points.map((point) => point.v)) : 0,
    mean: points.length ? points.reduce((sum, point) => sum + point.v, 0) / points.length : 0,
    slopePerDay: 0,
    intercept: first,
    rSquared: 0,
    residualStdDev: 0,
    delta6h: null,
    delta24h: null,
    delta7d: null,
    recentRatePerDay: null,
    ceiling,
    projectedDaysToCeiling: null,
    projectedCeilingDate: null,
    recentProjectedDaysToCeiling: null,
    pattern: 'insufficient-data',
    suggestedUrgency: 'informational',
    anomalies: [],
    notes: [`Only ${points.length} usable data point${points.length === 1 ? '' : 's'}; trend cannot be determined.`]
  };
}

export function analyseTrend(series: MetricSeries, options: TrendOptions = {}): TrendAnalysis {
  const now = options.now ?? new Date();
  const ceiling = options.ceiling ?? null;
  const points = cleanSeries(series);

  if (points.length < 3) {
    return insufficient(series, points, ceiling);
  }

  const startT = points[0].t;
  const endT = points[points.length - 1].t;
  const spanDays = (endT - startT) / DAY_MS;

  if (spanDays <= 0) {
    return insufficient(series, points, ceiling);
  }

  // Ordinary least squares with x in days since first point.
  const xs = points.map((point) => (point.t - startT) / DAY_MS);
  const ys = points.map((point) => point.v);
  const n = points.length;
  const xMean = xs.reduce((sum, x) => sum + x, 0) / n;
  const yMean = ys.reduce((sum, y) => sum + y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let sst = 0;

  for (let index = 0; index < n; index += 1) {
    sxy += (xs[index] - xMean) * (ys[index] - yMean);
    sxx += (xs[index] - xMean) ** 2;
    sst += (ys[index] - yMean) ** 2;
  }

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = yMean - slope * xMean;

  let ssRes = 0;
  const residuals: number[] = [];

  for (let index = 0; index < n; index += 1) {
    const residual = ys[index] - (intercept + slope * xs[index]);
    residuals.push(residual);
    ssRes += residual ** 2;
  }

  const rSquared = sst === 0 ? 0 : Math.max(0, 1 - ssRes / sst);
  const residualStdDev = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

  const last = points[n - 1].v;
  const first = points[0].v;
  const nowT = Math.max(now.getTime(), endT);

  const delta = (windowMs: number): number | null => {
    const previous = valueAt(points, nowT - windowMs);
    return previous === null ? null : last - previous;
  };

  const delta6h = delta(6 * HOUR_MS);
  const delta24h = delta(24 * HOUR_MS);
  const delta7d = delta(7 * DAY_MS);
  const recentRatePerDay = delta24h;

  // Anomalies: residuals beyond max(3σ, 2 units), newest first, max 5.
  const anomalyLimit = Math.max(
    TREND_THRESHOLDS.anomalySigmaMultiplier * residualStdDev,
    TREND_THRESHOLDS.anomalyMinUnits * (ceiling ? ceiling / 100 : 1)
  );
  const anomalies: TrendAnomaly[] = [];

  for (let index = n - 1; index >= 0 && anomalies.length < 5; index -= 1) {
    if (Math.abs(residuals[index]) > anomalyLimit) {
      anomalies.push({
        timestamp: new Date(points[index].t).toISOString(),
        value: round(points[index].v),
        expected: round(intercept + slope * xs[index]),
        zScore: residualStdDev === 0 ? 0 : round(residuals[index] / residualStdDev)
      });
    }
  }

  // Projection to ceiling.
  let projectedDaysToCeiling: number | null = null;
  let projectedCeilingDate: string | null = null;
  let recentProjectedDaysToCeiling: number | null = null;

  if (ceiling !== null) {
    if (slope > 0.01 && last < ceiling) {
      projectedDaysToCeiling = round((ceiling - last) / slope, 1);
      projectedCeilingDate = new Date(nowT + projectedDaysToCeiling * DAY_MS).toISOString();
    }

    if (recentRatePerDay !== null && recentRatePerDay > 0.5 && last < ceiling) {
      recentProjectedDaysToCeiling = round((ceiling - last) / recentRatePerDay, 1);
    }
  }

  // Scale thresholds when the metric is not a percentage.
  const scale = ceiling ? ceiling / 100 : 1;
  const t = TREND_THRESHOLDS;

  // A rapid fill must take the metric into new territory. A sawtooth that swings back to a
  // previous peak is volatility, not a fill, even though its 24 h delta is large.
  const priorPoints = points.filter((point) => point.t < nowT - 24 * HOUR_MS);
  const priorMax = priorPoints.length > 0 ? Math.max(...priorPoints.map((point) => point.v)) : null;
  const isNewHigh = priorMax === null || last > priorMax + 0.5 * scale;

  let pattern: TrendPattern;

  if (
    isNewHigh &&
    ((delta6h !== null && delta6h >= t.rapidFillDelta6h * scale) ||
      (delta24h !== null && delta24h >= t.rapidFillDelta24h * scale) ||
      (delta24h !== null &&
        delta24h >= t.rapidFillDelta24hMin * scale &&
        recentRatePerDay !== null &&
        recentRatePerDay >= t.rapidFillRecentRateMultiplier * Math.max(Math.abs(slope), 0.05 * scale)))
  ) {
    pattern = 'rapid-fill';
  } else if (slope >= t.steadySlopePerDay * scale && rSquared >= t.steadyRSquared) {
    pattern = 'steady-growth';
  } else if (slope <= -t.steadySlopePerDay * scale && rSquared >= t.steadyRSquared) {
    pattern = 'declining';
  } else if (residualStdDev > t.volatileStdDev * scale && rSquared < t.volatileRSquared) {
    pattern = 'volatile';
  } else {
    pattern = 'flat';
  }

  const nearLimit =
    (ceiling !== null && last >= (t.nearCeilingPercent / 100) * ceiling) ||
    (options.threshold !== undefined && last >= options.threshold);

  let suggestedUrgency: DiagnosisUrgency;

  switch (pattern) {
    case 'rapid-fill':
      suggestedUrgency = 'immediate';
      break;
    case 'steady-growth':
      if (projectedDaysToCeiling !== null && projectedDaysToCeiling <= t.immediateDays) {
        suggestedUrgency = 'immediate';
      } else if (projectedDaysToCeiling !== null && projectedDaysToCeiling <= t.soonDays) {
        suggestedUrgency = 'soon';
      } else {
        suggestedUrgency = 'planned';
      }
      break;
    case 'flat':
    case 'volatile':
      suggestedUrgency = nearLimit ? 'soon' : 'planned';
      break;
    case 'declining':
      suggestedUrgency = 'informational';
      break;
  }

  const unitLabel = series.unit === 'Percent' ? ' pts' : ` ${series.unit}`;
  const notes: string[] = [];
  const spanLabel = spanDays >= 2 ? `${Math.round(spanDays)} days` : `${round(spanDays * 24, 0)} hours`;

  notes.push(
    `Changed ${formatSigned(last - first)}${unitLabel} over ${spanLabel} (${formatSigned(slope, 2)}/day, r²=${round(rSquared, 3)})`
  );

  if (delta6h !== null) {
    notes.push(`Last 6 h: ${formatSigned(delta6h)}${unitLabel}`);
  }

  if (delta24h !== null) {
    notes.push(`Last 24 h: ${formatSigned(delta24h)}${unitLabel}`);
  }

  if (delta7d !== null) {
    notes.push(`Last 7 d: ${formatSigned(delta7d)}${unitLabel}`);
  }

  if (projectedDaysToCeiling !== null && projectedCeilingDate) {
    notes.push(
      `At ${round(slope, 2)}/day, reaches ${ceiling}${series.unit === 'Percent' ? '%' : ''} in ~${Math.round(projectedDaysToCeiling)} days (${projectedCeilingDate.slice(0, 10)})`
    );
  }

  if (recentProjectedDaysToCeiling !== null && pattern === 'rapid-fill') {
    const eta =
      recentProjectedDaysToCeiling < 1
        ? `~${Math.max(1, Math.round(recentProjectedDaysToCeiling * 24))} hours`
        : `~${round(recentProjectedDaysToCeiling, 1)} days`;
    notes.push(`At the current 24 h rate, reaches ${ceiling}${series.unit === 'Percent' ? '%' : ''} in ${eta}`);
  }

  if (anomalies.length > 0) {
    notes.push(`${anomalies.length} anomalous reading${anomalies.length === 1 ? '' : 's'} outside the trend band`);
  }

  return {
    metricName: series.metricName,
    unit: series.unit,
    windowStart: new Date(startT).toISOString(),
    windowEnd: new Date(endT).toISOString(),
    pointCount: n,
    spanDays: round(spanDays, 2),
    first: round(first),
    last: round(last),
    min: round(Math.min(...ys)),
    max: round(Math.max(...ys)),
    mean: round(yMean),
    slopePerDay: round(slope, 4),
    intercept: round(intercept),
    rSquared: round(rSquared, 3),
    residualStdDev: round(residualStdDev, 3),
    delta6h: delta6h === null ? null : round(delta6h),
    delta24h: delta24h === null ? null : round(delta24h),
    delta7d: delta7d === null ? null : round(delta7d),
    recentRatePerDay: recentRatePerDay === null ? null : round(recentRatePerDay),
    ceiling,
    projectedDaysToCeiling,
    projectedCeilingDate,
    recentProjectedDaysToCeiling,
    pattern,
    suggestedUrgency,
    anomalies,
    notes
  };
}

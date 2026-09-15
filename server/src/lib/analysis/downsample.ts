import type { MetricPoint } from '../../../../shared/types.js';

const NUMERIC_FIELDS = ['average', 'minimum', 'maximum', 'total', 'count'] as const;

/**
 * Bucket-average downsampling. Keeps the first and last point exact and averages the
 * numeric fields inside each bucket so charts stay faithful without shipping thousands of points.
 */
export function downsamplePoints(points: MetricPoint[], maxPoints: number): MetricPoint[] {
  if (points.length <= maxPoints || maxPoints < 2) {
    return points;
  }

  const sorted = [...points].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
  const bucketSize = sorted.length / maxPoints;
  const result: MetricPoint[] = [];

  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(sorted.length, Math.floor((bucket + 1) * bucketSize));

    if (start >= end) {
      continue;
    }

    const slice = sorted.slice(start, end);
    const midpoint = slice[Math.floor(slice.length / 2)];
    const aggregated: MetricPoint = { timestamp: midpoint.timestamp };

    for (const field of NUMERIC_FIELDS) {
      const values = slice.map((point) => point[field]).filter((value): value is number => typeof value === 'number');

      if (values.length > 0) {
        if (field === 'minimum') {
          aggregated[field] = Math.min(...values);
        } else if (field === 'maximum') {
          aggregated[field] = Math.max(...values);
        } else {
          aggregated[field] = values.reduce((sum, value) => sum + value, 0) / values.length;
        }
      }
    }

    result.push(aggregated);
  }

  result[0] = sorted[0];
  result[result.length - 1] = sorted[sorted.length - 1];

  return result;
}

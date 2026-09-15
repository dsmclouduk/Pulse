import type { SyntheticHistorySpec } from '@/types';

export interface PreviewPoint {
  x: number;
  y: number;
}

/**
 * Client-side preview of a synthetic history spec, for sparklines on the Simulate page.
 * Mirrors the server generator's shapes (without noise) so the card matches what will be analysed.
 */
export function previewSyntheticSeries(spec: SyntheticHistorySpec, points = 60): PreviewPoint[] {
  const days = spec.days ?? 90;
  const start = spec.startPercent ?? 55;
  const end = spec.endPercent ?? 95;
  const range = end - start;
  const result: PreviewPoint[] = [];

  for (let index = 0; index < points; index += 1) {
    const progress = index / (points - 1);
    let value: number;

    switch (spec.pattern) {
      case 'steady-growth':
        value = start + range * progress;
        break;
      case 'flat':
        value = start;
        break;
      case 'sawtooth': {
        const periodDays = spec.periodDays ?? 7;
        const phase = ((progress * days) % periodDays) / periodDays;
        const triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
        value = start + range * triangle;
        break;
      }
      case 'rapid-fill': {
        const jumpFraction = (spec.jumpHoursAgo ?? 6) / 24 / days;
        const jumpStart = 1 - Math.max(jumpFraction, 0.06);
        value = progress < jumpStart ? start : start + range * ((progress - jumpStart) / (1 - jumpStart)) ** 1.5;
        break;
      }
      default:
        value = start;
    }

    result.push({ x: progress, y: Math.max(0, Math.min(100, value)) });
  }

  return result;
}

/** Builds an SVG path for a sparkline in a width × height box. */
export function sparklinePath(points: PreviewPoint[], width: number, height: number, padding = 2): string {
  if (points.length === 0) {
    return '';
  }

  const ys = points.map((point) => point.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;

  return points
    .map((point, index) => {
      const x = padding + point.x * (width - padding * 2);
      const y = height - padding - ((point.y - minY) / span) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

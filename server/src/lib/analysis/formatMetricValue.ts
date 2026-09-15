/**
 * Human wording for metric values. Trend notes are read by engineers under pressure, so they say
 * "Increased by 2.3 GB over 2 hours" rather than "Changed +2469606195.2 Bytes (+421.20/day,
 * r²=0.987)". The statistics stay on the TrendAnalysis object for the chart and the model; they do
 * not belong in a sentence.
 */

const BYTE_UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Bytes as the largest unit that keeps the number readable, e.g. 2469606195 → "2.3 GB". */
export function formatBytes(bytes: number): string {
  const magnitude = Math.abs(bytes);

  if (magnitude < 1024) {
    return `${round(bytes, 0)} bytes`;
  }

  let value = bytes;
  let index = 0;

  while (Math.abs(value) >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${round(value, Math.abs(value) < 10 ? 2 : 1)} ${BYTE_UNITS[index]}`;
}

function formatSeconds(seconds: number): string {
  const magnitude = Math.abs(seconds);

  if (magnitude < 1) {
    return `${round(seconds * 1000, 0)} ms`;
  }

  if (magnitude < 90) {
    return `${round(seconds, 1)} s`;
  }

  if (magnitude < 5400) {
    return `${round(seconds / 60, 1)} minutes`;
  }

  return `${round(seconds / 3600, 1)} hours`;
}

/**
 * An absolute reading, e.g. "87.1%", "2.3 GB", "412 requests". Used for "is at X" phrasing.
 */
export function formatMetricValue(value: number, unit: string): string {
  switch (unit) {
    case 'Percent':
      return `${round(value)}%`;
    case 'Bytes':
      return formatBytes(value);
    case 'BytesPerSecond':
      return `${formatBytes(value)}/s`;
    case 'Seconds':
      return formatSeconds(value);
    case 'MilliSeconds':
      return formatSeconds(value / 1000);
    case 'Count':
    case 'Unspecified':
    case '':
      return `${round(value)}`;
    case 'CountPerSecond':
      return `${round(value)}/s`;
    default:
      return `${round(value)} ${unit}`;
  }
}

/**
 * A change, worded as a magnitude without a sign: "2.3 GB", "35.1 percentage points". Pair it with
 * `changeVerb` so the sentence reads "Increased by 2.3 GB" rather than "Changed +2.3 GB".
 */
export function formatMetricDelta(delta: number, unit: string): string {
  const magnitude = Math.abs(delta);

  if (unit === 'Percent') {
    const rounded = round(magnitude);
    return `${rounded} percentage point${rounded === 1 ? '' : 's'}`;
  }

  return formatMetricValue(magnitude, unit);
}

/** "increased" / "decreased" / "unchanged", with a dead band so noise does not read as movement. */
export function changeVerb(delta: number, epsilon = 0.05): 'increased' | 'decreased' | 'unchanged' {
  if (Math.abs(delta) < epsilon) {
    return 'unchanged';
  }

  return delta > 0 ? 'increased' : 'decreased';
}

/** "up" / "down", for the shorter window notes. */
export function changeDirection(delta: number, epsilon = 0.05): 'up' | 'down' | 'flat' {
  if (Math.abs(delta) < epsilon) {
    return 'flat';
  }

  return delta > 0 ? 'up' : 'down';
}

/** "2 hours", "3 days" — a span in the largest unit that stays a small whole number. */
export function formatSpan(days: number): string {
  if (days < 1 / 24) {
    const minutes = Math.max(1, Math.round(days * 24 * 60));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  if (days < 2) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const wholeDays = Math.round(days);
  return `${wholeDays} day${wholeDays === 1 ? '' : 's'}`;
}

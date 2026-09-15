import type { AlertEvent, AlertSeverity } from '@/types';

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function upsertAlert(currentAlerts: AlertEvent[], nextAlert: AlertEvent): AlertEvent[] {
  const withoutPrevious = currentAlerts.filter((alert) => alert.id !== nextAlert.id);
  return [nextAlert, ...withoutPrevious].sort(
    (left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime()
  );
}

export function formatLag(lagMs: number): string {
  if (lagMs < 1000) {
    return `${lagMs}ms`;
  }

  return `${(lagMs / 1000).toFixed(1)}s`;
}

/** Lag badge colours per CLAUDE.md: green < 5 s, amber 5–30 s, red > 30 s. Theme-neutral tokens. */
export function getLagTone(lagMs: number): string {
  if (lagMs < 5000) {
    return 'border-sev-ok/40 bg-sev-ok/10 text-sev-ok';
  }

  if (lagMs <= 30000) {
    return 'border-sev-warning/50 bg-sev-warning/15 text-yellow-700 dark:text-sev-warning';
  }

  return 'border-sev-critical/40 bg-sev-critical/10 text-sev-critical';
}

export function getSeverityTone(severity: AlertSeverity, status: AlertEvent['status']): string {
  if (status === 'Resolved') {
    return 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100';
  }

  switch (severity) {
    case 'Sev0':
    case 'Sev1':
      return 'border-rose-400/40 bg-rose-500/15 text-rose-100';
    case 'Sev2':
      return 'border-amber-400/40 bg-amber-500/15 text-amber-100';
    case 'Sev3':
      return 'border-yellow-400/40 bg-yellow-500/15 text-yellow-100';
    case 'Sev4':
      return 'border-sky-400/40 bg-sky-500/15 text-sky-100';
  }
}

export function formatAbsoluteTime(value: string | null | undefined): string {
  if (!value) {
    return 'Not available';
  }

  return new Date(value).toLocaleString();
}

export function formatRelativeTime(value: string): string {
  const diffMs = new Date(value).getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);

  if (Math.abs(diffSeconds) < 60) {
    return relativeFormatter.format(diffSeconds, 'second');
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return relativeFormatter.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return relativeFormatter.format(diffDays, 'day');
}

export function shortenResourceId(resourceId: string | undefined): string {
  if (!resourceId) {
    return 'Unknown resource';
  }

  const parts = resourceId.split('/').filter(Boolean);

  if (parts.length <= 4) {
    return resourceId;
  }

  return parts.at(-1) ?? resourceId;
}

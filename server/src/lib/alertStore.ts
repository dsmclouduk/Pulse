import type { AlertEvent } from '../../../shared/types.js';

const MAX_ALERTS = 500;

const alerts: AlertEvent[] = [];

export function getAlerts(): AlertEvent[] {
  return [...alerts];
}

export function upsertAlert(alert: AlertEvent): AlertEvent[] {
  const existingIndex = alerts.findIndex((entry) => entry.id === alert.id);

  if (existingIndex !== -1) {
    alerts.splice(existingIndex, 1);
  }

  alerts.unshift(alert);

  if (alerts.length > MAX_ALERTS) {
    alerts.length = MAX_ALERTS;
  }

  return getAlerts();
}

export function getAlertStoreSize(): number {
  return alerts.length;
}

export function clearAlerts(): void {
  alerts.length = 0;
}

import type { AlertEvent, AlertSeverity, AlertStatus, SignalType } from '@/types';

export type SortField = 'severity' | 'reportedAt' | 'resource' | 'datapoint' | 'alertValue' | 'threshold' | 'alertRule';

export interface AlertFilters {
  searchText: string;
  severities: Set<AlertSeverity>;
  statuses: Set<AlertStatus>;
  signalTypes: Set<SignalType>;
  showSimulated: boolean;
  timeRange: 'all' | '1h' | '6h' | '24h';
  sortBy: SortField;
  sortDirection: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: AlertFilters = {
  searchText: '',
  severities: new Set(),
  statuses: new Set(),
  signalTypes: new Set(),
  showSimulated: true,
  timeRange: 'all',
  sortBy: 'reportedAt',
  sortDirection: 'desc',
};

const SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  Sev0: 0,
  Sev1: 1,
  Sev2: 2,
  Sev3: 3,
  Sev4: 4,
};

export function getSeverityWeight(severity: AlertSeverity): number {
  return SEVERITY_WEIGHT[severity];
}

export function matchesSearch(alert: AlertEvent, searchText: string): boolean {
  if (!searchText) return true;

  const lower = searchText.toLowerCase();
  return (
    alert.ruleName.toLowerCase().includes(lower) ||
    (alert.metricName?.toLowerCase().includes(lower) ?? false) ||
    (alert.description?.toLowerCase().includes(lower) ?? false) ||
    (alert.resourceGroup?.toLowerCase().includes(lower) ?? false) ||
    alert.resourceIds.some((id) => id.toLowerCase().includes(lower))
  );
}

function withinTimeRange(alert: AlertEvent, timeRange: AlertFilters['timeRange']): boolean {
  if (timeRange === 'all') return true;

  const hoursMap = { '1h': 1, '6h': 6, '24h': 24 };
  const cutoff = Date.now() - hoursMap[timeRange] * 60 * 60 * 1000;
  return new Date(alert.firedAt).getTime() >= cutoff;
}

export function applyFilters(alerts: AlertEvent[], filters: AlertFilters): AlertEvent[] {
  return alerts.filter((alert) => {
    if (!matchesSearch(alert, filters.searchText)) return false;
    if (filters.severities.size > 0 && !filters.severities.has(alert.severity)) return false;
    if (filters.statuses.size > 0 && !filters.statuses.has(alert.status)) return false;
    if (filters.signalTypes.size > 0 && !filters.signalTypes.has(alert.signalType)) return false;
    if (!filters.showSimulated && alert.isSimulated) return false;
    if (!withinTimeRange(alert, filters.timeRange)) return false;
    return true;
  });
}

function getSortValue(alert: AlertEvent, field: SortField): string | number {
  switch (field) {
    case 'severity':
      return SEVERITY_WEIGHT[alert.severity];
    case 'reportedAt':
      return new Date(alert.firedAt).getTime();
    case 'resource':
      return alert.resourceIds[0]?.toLowerCase() ?? '';
    case 'datapoint':
      return alert.metricName?.toLowerCase() ?? '';
    case 'alertValue':
      return alert.metricValue ?? 0;
    case 'threshold':
      return alert.threshold ?? 0;
    case 'alertRule':
      return alert.ruleName.toLowerCase();
  }
}

export function applySorting(alerts: AlertEvent[], sortBy: SortField, direction: 'asc' | 'desc'): AlertEvent[] {
  const sorted = [...alerts].sort((a, b) => {
    const aVal = getSortValue(a, sortBy);
    const bVal = getSortValue(b, sortBy);

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return aVal - bVal;
    }

    return String(aVal).localeCompare(String(bVal));
  });

  return direction === 'desc' ? sorted.reverse() : sorted;
}

export function filterAndSort(alerts: AlertEvent[], filters: AlertFilters): AlertEvent[] {
  const filtered = applyFilters(alerts, filters);
  return applySorting(filtered, filters.sortBy, filters.sortDirection);
}

export function getActiveFilterCount(filters: AlertFilters): number {
  let count = 0;
  if (filters.searchText) count += 1;
  if (filters.severities.size > 0) count += 1;
  if (filters.statuses.size > 0) count += 1;
  if (filters.signalTypes.size > 0) count += 1;
  if (!filters.showSimulated) count += 1;
  if (filters.timeRange !== 'all') count += 1;
  return count;
}

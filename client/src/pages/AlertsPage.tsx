import { useEffect, useMemo, useState } from 'react';

import type { AlertEvent, AlertSeverity } from '@/types';
import type { ConnectionStatus } from '@/hooks/useAlertStream';
import type { SidebarSeverityLevel } from '@/components/layout/Sidebar';
import { AlertToolbar } from '@/components/alerts/AlertToolbar';
import { AlertChart } from '@/components/alerts/AlertChart';
import { AlertTabBar } from '@/components/alerts/AlertTabBar';
import { AlertTable } from '@/components/alerts/AlertTable';
import { AlertDetailPanel } from '@/components/alerts/AlertDetailPanel';
import { DEFAULT_FILTERS, filterAndSort, type AlertFilters, type SortField } from '@/lib/alertFilters';

interface AlertsPageProps {
  alerts: AlertEvent[];
  connectionStatus: ConnectionStatus;
  lastReceivedAt: string | null;
  selectedClientSlug: string | null;
  sidebarSeverityFilter: SidebarSeverityLevel | null;
  onClearSidebarFilter: () => void;
}

const SEVERITY_LEVEL_MAP: Record<SidebarSeverityLevel, AlertSeverity[]> = {
  critical: ['Sev0'],
  error: ['Sev1'],
  warning: ['Sev2', 'Sev3', 'Sev4'],
};

const DEFAULT_DETAIL_HEIGHT = 280;

export function AlertsPage({ alerts, sidebarSeverityFilter, onClearSidebarFilter }: Readonly<AlertsPageProps>) {
  const [filters, setFilters] = useState<AlertFilters>({ ...DEFAULT_FILTERS });
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [detailHeight, setDetailHeight] = useState(DEFAULT_DETAIL_HEIGHT);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Sync sidebar severity filter into the toolbar filters
  useEffect(() => {
    if (sidebarSeverityFilter === null) {
      setFilters((prev) => ({ ...prev, severities: new Set(), statuses: new Set() }));
      return;
    }

    const sevs = SEVERITY_LEVEL_MAP[sidebarSeverityFilter];
    setFilters((prev) => ({
      ...prev,
      severities: new Set(sevs),
      statuses: new Set(),
    }));
  }, [sidebarSeverityFilter]);

  const processedAlerts = useMemo(() => filterAndSort(alerts, filters), [alerts, filters]);
  const selectedAlert = processedAlerts.find((a) => a.id === selectedAlertId) ?? null;

  function handleSort(field: SortField) {
    setFilters((prev) => ({
      ...prev,
      sortBy: field,
      sortDirection: prev.sortBy === field && prev.sortDirection === 'desc' ? 'asc' : 'desc',
    }));
  }

  function handleSelectAlert(alert: AlertEvent) {
    setSelectedAlertId((prev) => (prev === alert.id ? null : alert.id));
  }

  function handleFiltersChange(next: AlertFilters) {
    onClearSidebarFilter();
    setFilters(next);
  }

  function handleAction(action: string) {
    console.log(`[Pulse] Action "${action}" on ${checkedIds.size} alerts:`, [...checkedIds]);
    setCheckedIds(new Set());
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar — actions, search, filters, severity toggles */}
      <AlertToolbar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        totalCount={alerts.length}
        filteredCount={processedAlerts.length}
        checkedCount={checkedIds.size}
        onAction={handleAction}
        onClearChecked={() => setCheckedIds(new Set())}
      />

      {/* Time series chart */}
      <AlertChart alerts={alerts} />

      {/* Tab bar */}
      <AlertTabBar alertCount={processedAlerts.length} />

      {/* Alert table */}
      <AlertTable
        alerts={processedAlerts}
        selectedAlertId={selectedAlertId}
        onSelectAlert={handleSelectAlert}
        sortBy={filters.sortBy}
        sortDirection={filters.sortDirection}
        onSort={handleSort}
        totalCount={alerts.length}
        checkedIds={checkedIds}
        onCheckedIdsChange={setCheckedIds}
      />

      {/* Bottom detail panel */}
      <AlertDetailPanel
        alert={selectedAlert}
        onClose={() => setSelectedAlertId(null)}
        height={detailHeight}
        onHeightChange={setDetailHeight}
      />
    </div>
  );
}

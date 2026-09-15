import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { AlertEvent, AlertSeverity } from '@/types';
import type { ConnectionStatus } from '@/hooks/useAlertStream';
import type { SidebarSeverityLevel } from '@/components/layout/Sidebar';
import { AlertToolbar } from '@/components/alerts/AlertToolbar';
import { AlertChart } from '@/components/alerts/AlertChart';
import { AlertTabBar } from '@/components/alerts/AlertTabBar';
import { AlertTable } from '@/components/alerts/AlertTable';
import { AlertDetailPanel } from '@/components/alerts/AlertDetailPanel';
import { useAlertData } from '@/context/AlertDataContext';
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
  warning: ['Sev2', 'Sev3', 'Sev4']
};

const DEFAULT_DETAIL_HEIGHT = 360;

export function AlertsPage({ alerts, sidebarSeverityFilter, onClearSidebarFilter }: Readonly<AlertsPageProps>) {
  const [filters, setFilters] = useState<AlertFilters>({ ...DEFAULT_FILTERS });
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [detailHeight, setDetailHeight] = useState(DEFAULT_DETAIL_HEIGHT);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  const [requestedTab, setRequestedTab] = useState<'overview' | 'metrics' | 'diagnosis' | undefined>(undefined);
  const { mergeComments } = useAlertData();

  // Deep link: /alerts?alert=<id>&tab=metrics opens that alert's drawer on a tab (used by the Simulate page).
  useEffect(() => {
    const requested = searchParams.get('alert');
    const tab = searchParams.get('tab');

    if (requested) {
      setSelectedAlertId(requested);
      setRequestedTab(tab === 'metrics' || tab === 'diagnosis' ? tab : 'overview');
      setFilters((prev) => ({ ...prev, showSimulated: true }));
      const next = new URLSearchParams(searchParams);
      next.delete('alert');
      next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (sidebarSeverityFilter === null) {
      setFilters((prev) => ({ ...prev, severities: new Set(), statuses: new Set() }));
      return;
    }

    const sevs = SEVERITY_LEVEL_MAP[sidebarSeverityFilter];
    setFilters((prev) => ({
      ...prev,
      severities: new Set(sevs),
      statuses: new Set()
    }));
  }, [sidebarSeverityFilter]);

  const processedAlerts = useMemo(() => filterAndSort(alerts, filters), [alerts, filters]);
  const selectedAlert = alerts.find((a) => a.id === selectedAlertId) ?? null;

  function handleSort(field: SortField) {
    setFilters((prev) => ({
      ...prev,
      sortBy: field,
      sortDirection: prev.sortBy === field && prev.sortDirection === 'desc' ? 'asc' : 'desc'
    }));
  }

  function handleSelectAlert(alert: AlertEvent) {
    setRequestedTab(undefined);
    setSelectedAlertId((prev) => (prev === alert.id ? null : alert.id));
  }

  function handleFiltersChange(next: AlertFilters) {
    onClearSidebarFilter();
    setFilters(next);
  }

  async function addNoteToChecked(): Promise<void> {
    const body = window.prompt(`Add a note to ${checkedIds.size} alert${checkedIds.size === 1 ? '' : 's'}:`);

    if (!body?.trim()) {
      return;
    }

    const targets = alerts.filter((alert) => checkedIds.has(alert.id));

    await Promise.all(
      targets.map(async (alert) => {
        try {
          const response = await fetch('/api/alerts/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alertId: alert.id, body: body.trim(), clientSlug: alert.clientSlug })
          });

          if (response.ok) {
            mergeComments([await response.json()]);
          }
        } catch (error) {
          console.error('[Pulse] Failed to add note', alert.id, error);
        }
      })
    );
  }

  async function rerunChecked(): Promise<void> {
    const targets = alerts.filter((alert) => checkedIds.has(alert.id));

    await Promise.all(
      targets.map((alert) =>
        fetch('/api/alerts/enrichment/rerun', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alertId: alert.id, clientSlug: alert.clientSlug })
        }).catch((error) => console.error('[Pulse] Failed to re-run enrichment', alert.id, error))
      )
    );
  }

  function handleAction(action: string) {
    if (action === 'note') {
      void addNoteToChecked();
    } else if (action === 'rerun') {
      void rerunChecked();
    } else {
      console.log(`[Pulse] Action "${action}" is not implemented yet (${checkedIds.size} alerts).`);
    }

    setCheckedIds(new Set());
  }

  async function handleRefire(alert: AlertEvent): Promise<void> {
    try {
      const response = await fetch('/api/simulate/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleName: alert.ruleName,
          severity: alert.severity,
          status: 'Fired',
          resourceId: alert.resourceIds[0],
          metricName: alert.metricName,
          metricValue: alert.metricValue,
          threshold: alert.threshold,
          description: alert.description,
          dimensions: alert.dimensions,
          clientSlug: alert.clientSlug,
          unique: true,
          syntheticHistory: alert.metricName && /disk/i.test(alert.metricName) ? { pattern: 'steady-growth', endPercent: alert.metricValue } : { pattern: 'flat', startPercent: alert.metricValue, endPercent: alert.metricValue }
        })
      });

      if (response.ok) {
        const created = (await response.json()) as AlertEvent;
        setSelectedAlertId(created.id);
      }
    } catch (error) {
      console.error('[Pulse] Re-fire failed', error);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <AlertToolbar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        totalCount={alerts.length}
        filteredCount={processedAlerts.length}
        checkedCount={checkedIds.size}
        onAction={handleAction}
        onClearChecked={() => setCheckedIds(new Set())}
      />

      <AlertChart alerts={alerts} />

      <AlertTabBar alertCount={processedAlerts.length} />

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

      <AlertDetailPanel
        alert={selectedAlert}
        initialTab={requestedTab}
        onClose={() => setSelectedAlertId(null)}
        height={detailHeight}
        onHeightChange={setDetailHeight}
        onRefire={(alert) => void handleRefire(alert)}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { AlertEvent, AlertSeverity } from '@/types';
import type { ConnectionStatus } from '@/hooks/useAlertStream';
import type { SidebarSeverityLevel } from '@/components/layout/Sidebar';
import { AlertToolbar } from '@/components/alerts/AlertToolbar';
import { AlertTabBar } from '@/components/alerts/AlertTabBar';
import { AlertTable, DEFAULT_PINNED_WIDTH } from '@/components/alerts/AlertTable';
import { AlertDetailPanel, isDetailTab, type DetailTab } from '@/components/alerts/AlertDetailPanel';
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

/** The flyout never covers less than this much of the page, even if the pinned columns are dragged wide. */
const MIN_FLYOUT_WIDTH = 520;

export function AlertsPage({ alerts, sidebarSeverityFilter, onClearSidebarFilter }: Readonly<AlertsPageProps>) {
  const [filters, setFilters] = useState<AlertFilters>({ ...DEFAULT_FILTERS });
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [pinnedWidth, setPinnedWidth] = useState(DEFAULT_PINNED_WIDTH);
  const [searchParams, setSearchParams] = useSearchParams();
  // Lives here rather than in the flyout so the chosen tab persists as you click through alerts.
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const { mergeComments } = useAlertData();

  // Deep link: /alerts?alert=<id>&tab=metrics opens that alert's flyout on a tab (used by the Simulate page).
  useEffect(() => {
    const requested = searchParams.get('alert');
    const tab = searchParams.get('tab');

    if (requested) {
      setSelectedAlertId(requested);
      if (isDetailTab(tab)) {
        setActiveTab(tab);
      }
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

  /** Clicking a row opens the flyout for it (keeping the current tab); clicking the open row toggles it closed. */
  function handleSelectAlert(alert: AlertEvent) {
    setSelectedAlertId((prev) => (prev === alert.id ? null : alert.id));
  }

  const closeFlyout = useCallback(() => setSelectedAlertId(null), []);

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
          syntheticHistory:
            alert.metricName && /disk/i.test(alert.metricName)
              ? { pattern: 'steady-growth', endPercent: alert.metricValue }
              : { pattern: 'flat', startPercent: alert.metricValue, endPercent: alert.metricValue }
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

      {/* Table region. The flyout overlays the right-hand side, leaving the pinned Resource +
          Severity columns visible so rows can be clicked through. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
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
          onPinnedWidthChange={setPinnedWidth}
        />

        {selectedAlert && (
          <div
            className="absolute inset-y-0 right-0 z-20"
            style={{ left: pinnedWidth, minWidth: MIN_FLYOUT_WIDTH }}
          >
            <AlertDetailPanel alert={selectedAlert} activeTab={activeTab} onTabChange={setActiveTab} onClose={closeFlyout} onRefire={(alert) => void handleRefire(alert)} />
          </div>
        )}
      </div>
    </div>
  );
}

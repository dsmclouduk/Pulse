import { useCallback, useEffect, useRef, useState } from 'react';

import { AlertCommentsTab } from '@/components/alerts/AlertCommentsTab';
import { AlertMetricsTab } from '@/components/alerts/AlertMetricsTab';
import { EnrichmentStatePill, UrgencyBadge } from '@/components/alerts/EnrichmentBadges';
import { LagBadge } from '@/components/alerts/LagBadge';
import { SeverityIndicator } from '@/components/alerts/SeverityIndicator';
import { Badge, Button } from '@/components/ui';
import { useAlertComments, useAlertEnrichment, useLatestDiagnosis } from '@/context/AlertDataContext';
import { formatAbsoluteTime, formatRelativeTime, shortenResourceId } from '@/lib/alerts';
import type { AlertEvent } from '@/types';

type Tab = 'overview' | 'metrics' | 'diagnosis';

interface AlertDetailPanelProps {
  alert: AlertEvent | null;
  /** Tab to open when a new alert is selected (deep links). Defaults to overview. */
  initialTab?: Tab;
  onClose: () => void;
  height: number;
  onHeightChange: (height: number) => void;
  onRefire?: (alert: AlertEvent) => void;
}

function DetailRow({ label, value, mono = false }: Readonly<{ label: string; value: string | number | null | undefined; mono?: boolean }>) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <tr className="border-b border-[var(--color-border)] last:border-b-0">
      <td className="whitespace-nowrap px-3 py-1.5 align-top text-xs font-medium text-[var(--color-text-secondary)]">{label}</td>
      <td className={`px-3 py-1.5 text-xs text-[var(--color-text)] ${mono ? 'break-all font-mono' : ''}`}>{value}</td>
    </tr>
  );
}

function AgentSummaryStrip({ alert }: Readonly<{ alert: AlertEvent }>) {
  const diagnosis = useLatestDiagnosis(alert.id);
  const status = useAlertEnrichment(alert.id);

  if (!diagnosis?.metadata?.urgency) {
    if (status && ['queued', 'fetching-history', 'analysing', 'diagnosing'].includes(status.state)) {
      return (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-accent/5 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          <EnrichmentStatePill status={status} />
          <span>Pulse Agent is pulling metric history and analysing the trend…</span>
        </div>
      );
    }

    return null;
  }

  const summary = diagnosis.body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('**Urgency'));

  return (
    <div className="flex items-start gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2">
      <UrgencyBadge urgency={diagnosis.metadata.urgency} className="mt-0.5" />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--color-text)]">{summary}</p>
      <span className="whitespace-nowrap text-[11px] text-[var(--color-text-tertiary)]">{diagnosis.author.name}</span>
    </div>
  );
}

function OverviewTab({ alert }: Readonly<{ alert: AlertEvent }>) {
  const dimensions = alert.dimensions
    ? Object.entries(alert.dimensions)
        .map(([name, value]) => `${name}=${value}`)
        .join(', ')
    : undefined;

  return (
    <div className="flex flex-col">
      <AgentSummaryStrip alert={alert} />
      <div className="flex flex-col gap-4 p-3 lg:flex-row lg:gap-6">
        <table className="min-w-0 flex-1 border-collapse text-sm">
          <tbody>
            <DetailRow label="Datapoint" value={alert.metricName} />
            <DetailRow label="Resource" value={shortenResourceId(alert.resourceIds[0])} />
            <DetailRow label="Resource ID" value={alert.resourceIds[0]} mono />
            <DetailRow label="Dimensions" value={dimensions} mono />
            <DetailRow label="Signal Type" value={alert.signalType} />
            <DetailRow label="Resource Group" value={alert.resourceGroup} />
            <DetailRow label="Subscription" value={alert.subscriptionId} mono />
            <DetailRow label="Client" value={alert.clientSlug} />
            <DetailRow label="Description" value={alert.description} />
          </tbody>
        </table>

        <table className="min-w-0 flex-1 border-collapse text-sm">
          <tbody>
            <DetailRow label="Alert ID" value={alert.id} mono />
            <DetailRow label="Fired At" value={`${formatAbsoluteTime(alert.firedAt)} (${formatRelativeTime(alert.firedAt)})`} />
            {alert.resolvedAt && (
              <DetailRow label="Resolved At" value={`${formatAbsoluteTime(alert.resolvedAt)} (${formatRelativeTime(alert.resolvedAt)})`} />
            )}
            <DetailRow label="Received At" value={formatAbsoluteTime(alert.receivedAt)} />
            <DetailRow label="Webhook Lag" value={`${alert.lagMs} ms`} mono />
            <DetailRow label="Alert Value" value={alert.metricValue} mono />
            <DetailRow label="Threshold" value={alert.threshold !== undefined && alert.threshold !== null ? `> ${alert.threshold}` : undefined} mono />
            {alert.isSimulated && <DetailRow label="Simulated" value="Yes" />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AlertDetailPanel({ alert, initialTab, onClose, height, onHeightChange, onRefire }: Readonly<AlertDetailPanelProps>) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'overview');
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const enrichment = useAlertEnrichment(alert?.id);
  const comments = useAlertComments(alert?.id);
  const lastAlertIdRef = useRef<string | null>(null);
  const lastInitialTabRef = useRef<Tab | undefined>(undefined);

  // Reset the tab when a different alert is opened, and honour a deep-linked tab even if the
  // alert data arrived before the deep link was parsed.
  useEffect(() => {
    if (!alert) {
      return;
    }

    if (alert.id !== lastAlertIdRef.current) {
      lastAlertIdRef.current = alert.id;
      setActiveTab(initialTab ?? 'overview');
    } else if (initialTab && initialTab !== lastInitialTabRef.current) {
      setActiveTab(initialTab);
    }

    lastInitialTabRef.current = initialTab;
  }, [alert, initialTab]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startHeight: height };

      function handleMouseMove(moveEvent: MouseEvent) {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - moveEvent.clientY;
        const newHeight = Math.max(160, Math.min(dragRef.current.startHeight + delta, window.innerHeight * 0.8));
        onHeightChange(newHeight);
      }

      function handleMouseUp() {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      }

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [height, onHeightChange]
  );

  if (!alert) return null;

  const diagnosisCount = comments.length;

  const tabs: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'diagnosis', label: 'Diagnosis', badge: diagnosisCount }
  ];

  return (
    <div className="flex flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)]" style={{ height }}>
      {/* Drag handle */}
      <div
        role="separator"
        tabIndex={0}
        className="flex h-1.5 cursor-row-resize items-center justify-center hover:bg-accent/20"
        onMouseDown={handleMouseDown}
      >
        <div className="h-0.5 w-8 rounded-full bg-[var(--color-text-tertiary)]" />
      </div>

      {/* Header bar */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
        <SeverityIndicator severity={alert.severity} status={alert.status} />
        <span className="hidden max-w-[220px] truncate text-xs font-medium text-[var(--color-text)] md:inline" title={alert.ruleName}>
          {alert.ruleName}
        </span>
        <LagBadge lagMs={alert.lagMs} />
        <EnrichmentStatePill status={enrichment} />
        {alert.isSimulated && <Badge tone="neutral">SIM</Badge>}
        <span className="hidden text-xs text-[var(--color-text-tertiary)] lg:inline">{formatAbsoluteTime(alert.firedAt)}</span>

        <div className="flex-1" />

        {alert.isSimulated && onRefire && (
          <Button size="sm" variant="ghost" onClick={() => onRefire(alert)} title="Fire this simulated alert again as a new alert">
            Re-fire
          </Button>
        )}

        {/* Tabs */}
        <div className="flex items-center">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="rounded-full bg-[var(--color-header)] px-1.5 text-[10px] text-[var(--color-text-secondary)]">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l8 8M11 3 3 11" />
          </svg>
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && <OverviewTab alert={alert} />}
        {activeTab === 'metrics' && <AlertMetricsTab alert={alert} />}
        {activeTab === 'diagnosis' && <AlertCommentsTab alert={alert} />}
      </div>
    </div>
  );
}

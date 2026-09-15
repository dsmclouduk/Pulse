import { useEffect } from 'react';

import { AlertCommentsTab, isDiagnosisThread } from '@/components/alerts/AlertCommentsTab';
import { AlertHistoryTab } from '@/components/alerts/AlertHistoryTab';
import { AlertMetricsTab } from '@/components/alerts/AlertMetricsTab';
import { EnrichmentStatePill, UrgencyBadge } from '@/components/alerts/EnrichmentBadges';
import { LagBadge } from '@/components/alerts/LagBadge';
import { SeverityIndicator } from '@/components/alerts/SeverityIndicator';
import { Badge, Button } from '@/components/ui';
import { useAlertComments, useAlertEnrichment, useLatestDiagnosis } from '@/context/AlertDataContext';
import { formatAbsoluteTime, formatRelativeTime, shortenResourceId } from '@/lib/alerts';
import type { AlertEvent } from '@/types';

export type DetailTab = 'overview' | 'metrics' | 'diagnosis' | 'comments' | 'history';

export function isDetailTab(value: string | null): value is DetailTab {
  return value === 'overview' || value === 'metrics' || value === 'diagnosis' || value === 'comments' || value === 'history';
}

interface AlertDetailPanelProps {
  alert: AlertEvent;
  /** Controlled by the page so the chosen tab persists when clicking through alerts. */
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onClose: () => void;
  onRefire?: (alert: AlertEvent) => void;
  /** Open another alert (used by the History tab). */
  onSelectAlert?: (alertId: string) => void;
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
      <div className="flex flex-col gap-4 p-3 xl:flex-row xl:gap-6">
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

/**
 * Right-hand flyout for the selected alert. The parent positions it so its left edge aligns with
 * the end of the pinned Resource + Severity columns, so rows stay clickable while it is open.
 */
export function AlertDetailPanel({ alert, activeTab, onTabChange, onClose, onRefire, onSelectAlert }: Readonly<AlertDetailPanelProps>) {
  const enrichment = useAlertEnrichment(alert.id);
  const comments = useAlertComments(alert.id);

  // Escape closes the flyout.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const diagnosisCount = comments.filter(isDiagnosisThread).length;
  const noteCount = comments.filter((comment) => comment.kind === 'note').length;

  const tabs: Array<{ id: DetailTab; label: string; badge?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'diagnosis', label: 'Diagnosis', badge: diagnosisCount },
    { id: 'comments', label: 'Comments', badge: noteCount },
    { id: 'history', label: 'History' }
  ];

  return (
    <aside
      className="flex h-full flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.35)]"
      aria-label="Alert detail"
    >
      {/* Title row */}
      <div className="flex items-start gap-3 border-b border-[var(--color-border)] px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityIndicator severity={alert.severity} status={alert.status} />
            <h2 className="truncate text-sm font-semibold text-[var(--color-text)]" title={alert.ruleName}>
              {alert.ruleName}
            </h2>
            {alert.isSimulated && <Badge tone="neutral">SIM</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span className="font-medium text-[var(--color-text)]" title={alert.resourceIds[0]}>
              {shortenResourceId(alert.resourceIds[0])}
            </span>
            <span className="text-[var(--color-text-tertiary)]">·</span>
            <span title={formatAbsoluteTime(alert.firedAt)}>fired {formatRelativeTime(alert.firedAt)}</span>
            <LagBadge lagMs={alert.lagMs} withLabel />
            <EnrichmentStatePill status={enrichment} />
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          {alert.isSimulated && onRefire && (
            <Button size="sm" variant="ghost" onClick={() => onRefire(alert)} title="Fire this simulated alert again as a new alert">
              Re-fire
            </Button>
          )}
          <button
            onClick={onClose}
            className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 3l8 8M11 3 3 11" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-[var(--color-border)] px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="rounded-full bg-[var(--color-header)] px-1.5 text-[10px] text-[var(--color-text-secondary)]">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'overview' && <OverviewTab alert={alert} />}
        {activeTab === 'metrics' && <AlertMetricsTab alert={alert} />}
        {activeTab === 'diagnosis' && <AlertCommentsTab alert={alert} mode="diagnosis" />}
        {activeTab === 'comments' && <AlertCommentsTab alert={alert} mode="comments" />}
        {activeTab === 'history' && <AlertHistoryTab alert={alert} onSelectAlert={onSelectAlert} />}
      </div>
    </aside>
  );
}

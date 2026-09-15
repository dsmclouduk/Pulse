import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { UrgencyBadge } from '@/components/alerts/EnrichmentBadges';
import { LagBadge } from '@/components/alerts/LagBadge';
import { SeverityIndicator } from '@/components/alerts/SeverityIndicator';
import { MetricContextPanel } from '@/components/MetricContextPanel';
import { Badge, Button, EmptyState, Notice, Spinner, StatTile } from '@/components/ui';
import { useAlertData } from '@/context/AlertDataContext';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/alerts';
import type { ResourceHistory, ResourceSummary } from '@/types';

export type ResourceTab = 'overview' | 'alerts' | 'metrics';

interface ResourceDetailPanelProps {
  resource: ResourceSummary;
  activeTab: ResourceTab;
  onTabChange: (tab: ResourceTab) => void;
  onClose: () => void;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '< 1 min';
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function Row({ label, value, mono = false }: Readonly<{ label: string; value: string | number | null | undefined; mono?: boolean }>) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <tr className="border-b border-[var(--color-border)] last:border-b-0">
      <td className="whitespace-nowrap px-3 py-1.5 align-top text-xs font-medium text-[var(--color-text-secondary)]">{label}</td>
      <td className={`px-3 py-1.5 text-xs text-[var(--color-text)] ${mono ? 'break-all font-mono' : ''}`}>{value}</td>
    </tr>
  );
}

function useResourceHistory(resource: ResourceSummary): { history: ResourceHistory | null; error: string | null } {
  const { alerts, commentsByAlert } = useAlertData();
  const [history, setHistory] = useState<ResourceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshKey = `${resource.resourceId}|${alerts.length}|${alerts[0]?.status ?? ''}|${Object.keys(commentsByAlert).length}`;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ resourceId: resource.resourceId });
    if (resource.clientSlug) params.set('clientSlug', resource.clientSlug);

    fetch(`/api/resources/history?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load history (${response.status})`);
        setHistory((await response.json()) as ResourceHistory);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Failed to load history.');
      });

    return () => controller.abort();
  }, [refreshKey, resource.resourceId, resource.clientSlug]);

  return { history, error };
}

function OverviewTab({ resource, history }: Readonly<{ resource: ResourceSummary; history: ResourceHistory | null }>) {
  const resolved = history?.entries.filter((entry) => entry.durationMs !== null) ?? [];
  const mttr = resolved.length === 0 ? null : resolved.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0) / resolved.length;
  const rules = new Map<string, number>();
  for (const entry of history?.entries ?? []) {
    rules.set(entry.alert.ruleName, (rules.get(entry.alert.ruleName) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Alerts" value={resource.alertCount} hint={`since ${formatAbsoluteTime(resource.firstSeenAt).split(',')[0]}`} tone={resource.alertCount >= 3 ? 'warning' : 'neutral'} />
        <StatTile label="Firing now" value={resource.firingCount} tone={resource.firingCount > 0 ? 'critical' : 'ok'} />
        <StatTile label="Mean time to resolve" value={formatDuration(mttr)} hint={`${resolved.length} resolved`} />
        <StatTile label="Notes" value={resource.noteCount} hint="operator comments" />
      </div>

      {resource.lastDiagnosis && (
        <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
            <span className="font-semibold text-[var(--color-text)]">Latest diagnosis</span>
            {resource.lastDiagnosis.urgency && <UrgencyBadge urgency={resource.lastDiagnosis.urgency} />}
            {resource.lastDiagnosis.pattern && <Badge tone="neutral">{resource.lastDiagnosis.pattern.replace('-', ' ')}</Badge>}
            <span className="ml-auto">{formatRelativeTime(resource.lastDiagnosis.createdAt)}</span>
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-text)]">{resource.lastDiagnosis.summary}</p>
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
        <table className="min-w-0 flex-1 border-collapse text-sm">
          <tbody>
            <Row label="Name" value={resource.name} />
            <Row label="Type" value={resource.resourceType} mono />
            <Row label="Resource group" value={resource.resourceGroup} />
            <Row label="Subscription" value={resource.subscriptionId} mono />
            <Row label="Client" value={resource.clientSlug ?? 'Unscoped'} />
            <Row label="Resource ID" value={resource.resourceId} mono />
          </tbody>
        </table>
        <table className="min-w-0 flex-1 border-collapse text-sm">
          <tbody>
            <Row label="First alert" value={formatAbsoluteTime(resource.firstSeenAt)} />
            <Row label="Last alert" value={`${formatAbsoluteTime(resource.lastAlertAt)} (${formatRelativeTime(resource.lastAlertAt)})`} />
            <Row label="Last rule" value={resource.lastAlert.ruleName} />
            <Row label="Last value" value={resource.lastAlert.metricValue !== undefined ? `${resource.lastAlert.metricName ?? ''} ${resource.lastAlert.metricValue}${resource.lastAlert.threshold !== undefined ? ` (threshold ${resource.lastAlert.threshold})` : ''}` : undefined} />
            <Row label="Rules seen" value={[...rules.entries()].map(([rule, count]) => `${rule} ×${count}`).join(', ')} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AlertsTab({ history, error }: Readonly<{ history: ResourceHistory | null; error: string | null }>) {
  const navigate = useNavigate();

  if (error) {
    return (
      <Notice tone="error" className="m-3">
        {error}
      </Notice>
    );
  }

  if (!history) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-[var(--color-text-secondary)]">
        <Spinner size={12} /> Loading alerts…
      </div>
    );
  }

  if (history.entries.length === 0) {
    return <EmptyState className="m-3">No alerts recorded for this resource.</EmptyState>;
  }

  return (
    <ol className="divide-y divide-[var(--color-border)]">
      {history.entries.map((entry) => (
        <li key={entry.alert.id}>
          <button
            type="button"
            onClick={() => navigate(`/alerts?alert=${encodeURIComponent(entry.alert.id)}`)}
            className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-[var(--color-hover)]"
            title="Open in the alert feed"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <SeverityIndicator severity={entry.alert.severity} status={entry.alert.status} />
              <span className="font-medium text-[var(--color-text)]">{entry.alert.ruleName}</span>
              <LagBadge lagMs={entry.alert.lagMs} />
              {entry.alert.isSimulated && <Badge tone="neutral">SIM</Badge>}
              <span className="ml-auto text-[var(--color-text-tertiary)]" title={formatAbsoluteTime(entry.alert.firedAt)}>
                {formatRelativeTime(entry.alert.firedAt)} · {entry.durationMs === null ? 'still firing' : formatDuration(entry.durationMs)}
              </span>
            </div>
            <div className="flex flex-wrap items-start gap-2 text-[11px] text-[var(--color-text-secondary)]">
              {entry.alert.metricName && (
                <span>
                  {entry.alert.metricName}
                  {entry.alert.metricValue !== undefined ? ` = ${entry.alert.metricValue}` : ''}
                  {entry.alert.threshold !== undefined ? ` (threshold ${entry.alert.threshold})` : ''}
                </span>
              )}
              {entry.diagnosis?.urgency && <UrgencyBadge urgency={entry.diagnosis.urgency} />}
              {entry.diagnosis && <span className="line-clamp-2 min-w-0 flex-1">{entry.diagnosis.summary}</span>}
              {entry.noteCount > 0 && (
                <Badge tone="accent">
                  {entry.noteCount} note{entry.noteCount === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Right-hand flyout for a resource: overview stats, its alert history, and live Azure Monitor metrics. */
export function ResourceDetailPanel({ resource, activeTab, onTabChange, onClose }: Readonly<ResourceDetailPanelProps>) {
  const navigate = useNavigate();
  const { history, error } = useResourceHistory(resource);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const tabs: Array<{ id: ResourceTab; label: string; badge?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'alerts', label: 'Alerts', badge: resource.alertCount },
    { id: 'metrics', label: 'Metrics' }
  ];

  return (
    <aside className="flex h-full flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.35)]" aria-label="Resource detail">
      <div className="flex items-start gap-3 border-b border-[var(--color-border)] px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {resource.highestFiringSeverity ? <SeverityIndicator severity={resource.highestFiringSeverity} status="Fired" /> : <SeverityIndicator severity="Sev4" status="Resolved" />}
            <h2 className="truncate text-sm font-semibold text-[var(--color-text)]" title={resource.resourceId}>
              {resource.name}
            </h2>
            {resource.isSimulated && <Badge tone="neutral">SIM</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span>{resource.resourceType.split('/').pop()}</span>
            {resource.resourceGroup && (
              <>
                <span className="text-[var(--color-text-tertiary)]">·</span>
                <span>{resource.resourceGroup}</span>
              </>
            )}
            <span className="text-[var(--color-text-tertiary)]">·</span>
            <span>{resource.clientSlug ?? 'unscoped'}</span>
            {resource.lastDiagnosis?.urgency && <UrgencyBadge urgency={resource.lastDiagnosis.urgency} />}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/alerts?resource=${encodeURIComponent(resource.resourceId)}`)}>
            Open in feed
          </Button>
          <button onClick={onClose} className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]" title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 3l8 8M11 3 3 11" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex items-center border-b border-[var(--color-border)] px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && <span className="rounded-full bg-[var(--color-header)] px-1.5 text-[10px] text-[var(--color-text-secondary)]">{tab.badge}</span>}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'overview' && <OverviewTab resource={resource} history={history} />}
        {activeTab === 'alerts' && <AlertsTab history={history} error={error} />}
        {activeTab === 'metrics' && (
          <div className="p-3">
            {resource.isSimulated ? (
              <Notice>Simulated resources have no live Azure metrics. Open an alert's Metrics tab for the synthetic history the agent analysed.</Notice>
            ) : (
              <MetricContextPanel resourceId={resource.resourceId} metricName={resource.lastAlert.metricName} />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

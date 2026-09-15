import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { UrgencyBadge } from '@/components/alerts/EnrichmentBadges';
import { LagBadge } from '@/components/alerts/LagBadge';
import { SeverityIndicator } from '@/components/alerts/SeverityIndicator';
import { Badge, EmptyState, Notice, Spinner, StatTile } from '@/components/ui';
import { useAlertData } from '@/context/AlertDataContext';
import { formatAbsoluteTime, formatRelativeTime, shortenResourceId } from '@/lib/alerts';
import type { AlertEvent, ResourceHistory } from '@/types';

interface AlertHistoryTabProps {
  alert: AlertEvent;
  onSelectAlert?: (alertId: string) => void;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return 'still firing';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

/** Previous alerts on the same resource, with their diagnoses and note counts, oldest at the bottom. */
export function AlertHistoryTab({ alert, onSelectAlert }: Readonly<AlertHistoryTabProps>) {
  const navigate = useNavigate();
  const { alerts, commentsByAlert } = useAlertData();
  const [history, setHistory] = useState<ResourceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resourceId = alert.resourceIds[0];

  const refreshKey = `${resourceId}|${alert.clientSlug ?? ''}|${alerts.length}|${Object.keys(commentsByAlert).length}`;

  useEffect(() => {
    if (!resourceId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ resourceId });
    if (alert.clientSlug) params.set('clientSlug', alert.clientSlug);

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
  }, [refreshKey, resourceId, alert.clientSlug]);

  if (!resourceId) {
    return <Notice className="m-3">This alert has no resource ID, so there is no history to show.</Notice>;
  }

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
        <Spinner size={12} /> Loading resource history…
      </div>
    );
  }

  const summary = history.resource;
  const others = history.entries.filter((entry) => entry.alert.id !== alert.id);
  const recurring = summary ? summary.alertCount >= 3 : false;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-[var(--color-text)]" title={resourceId}>
            {shortenResourceId(resourceId)}
          </p>
          <p className="text-[11px] text-[var(--color-text-secondary)]">
            {summary ? `First alert ${formatAbsoluteTime(summary.firstSeenAt)}` : 'No history yet'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/alerts?resource=${encodeURIComponent(resourceId)}`)}
          className="text-xs font-medium text-accent hover:text-accent-light"
        >
          Filter feed to this resource
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Alerts" value={summary.alertCount} hint={recurring ? 'Recurring' : undefined} tone={recurring ? 'warning' : 'neutral'} />
          <StatTile label="Firing now" value={summary.firingCount} tone={summary.firingCount > 0 ? 'critical' : 'ok'} />
          <StatTile label="Notes" value={summary.noteCount} hint="operator comments" />
          <StatTile
            label="Last diagnosis"
            value={summary.lastDiagnosis?.urgency ? <UrgencyBadge urgency={summary.lastDiagnosis.urgency} /> : '—'}
            hint={summary.lastDiagnosis?.pattern?.replace('-', ' ')}
          />
        </div>
      )}

      {recurring && (
        <Notice tone="warning">
          This resource keeps alerting. The agent is given the earlier diagnoses and any operator notes so it can reference what was tried before.
        </Notice>
      )}

      {others.length === 0 ? (
        <EmptyState>No earlier alerts for this resource. History builds up as alerts arrive.</EmptyState>
      ) : (
        <ol className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {others.map((entry) => (
            <li key={entry.alert.id}>
              <button
                type="button"
                onClick={() => onSelectAlert?.(entry.alert.id)}
                className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-[var(--color-hover)]"
                title="Open this alert"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <SeverityIndicator severity={entry.alert.severity} status={entry.alert.status} />
                  <span className="font-medium text-[var(--color-text)]">{entry.alert.ruleName}</span>
                  <LagBadge lagMs={entry.alert.lagMs} />
                  {entry.alert.isSimulated && <Badge tone="neutral">SIM</Badge>}
                  <span className="ml-auto text-[var(--color-text-tertiary)]" title={formatAbsoluteTime(entry.alert.firedAt)}>
                    {formatRelativeTime(entry.alert.firedAt)} · {formatDuration(entry.durationMs)}
                  </span>
                </div>
                <div className="flex flex-wrap items-start gap-2 text-[11px] text-[var(--color-text-secondary)]">
                  {entry.alert.metricName && (
                    <span>
                      {entry.alert.metricName} {entry.alert.metricValue !== undefined ? `= ${entry.alert.metricValue}` : ''}
                      {entry.alert.threshold !== undefined ? ` (threshold ${entry.alert.threshold})` : ''}
                    </span>
                  )}
                  {entry.diagnosis?.urgency && <UrgencyBadge urgency={entry.diagnosis.urgency} />}
                  {entry.diagnosis && <span className="line-clamp-2 min-w-0 flex-1">{entry.diagnosis.summary}</span>}
                  {entry.noteCount > 0 && <Badge tone="accent">{entry.noteCount} note{entry.noteCount === 1 ? '' : 's'}</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

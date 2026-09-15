import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { UrgencyBadge } from '@/components/alerts/EnrichmentBadges';
import { SeverityIndicator } from '@/components/alerts/SeverityIndicator';
import { Badge, Button, EmptyState, Input, Notice, Spinner } from '@/components/ui';
import { useAlertData } from '@/context/AlertDataContext';
import { formatRelativeTime } from '@/lib/alerts';
import type { ResourceSummary } from '@/types';

interface ResourcesPageProps {
  clientSlug: string | null;
}

type SortKey = 'lastAlertAt' | 'alertCount' | 'firingCount' | 'name';

function shortType(resourceType: string): string {
  const parts = resourceType.split('/');
  return parts[parts.length - 1] ?? resourceType;
}

/**
 * Resources are derived from alerts: anything that has ever alerted appears here, with its history.
 * Pulse is not an inventory; Azure remains the source of truth for what exists and its metrics.
 */
export function ResourcesPage({ clientSlug }: Readonly<ResourcesPageProps>) {
  const navigate = useNavigate();
  const { alerts, commentsByAlert } = useAlertData();
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyFiring, setOnlyFiring] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('lastAlertAt');

  // Re-fetch whenever the live alert or comment state changes so the table stays current.
  const refreshKey = `${clientSlug ?? ''}|${alerts.length}|${alerts[0]?.id ?? ''}|${alerts[0]?.status ?? ''}|${Object.keys(commentsByAlert).length}`;

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      setError(null);

      try {
        const params = clientSlug ? `?clientSlug=${encodeURIComponent(clientSlug)}` : '';
        const response = await fetch(`/api/resources${params}`, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Failed to load resources (${response.status})`);
        }

        setResources((await response.json()) as ResourceSummary[]);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load resources.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [refreshKey, clientSlug]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = resources.filter((resource) => {
      if (onlyFiring && resource.firingCount === 0) return false;
      if (!term) return true;
      return (
        resource.name.toLowerCase().includes(term) ||
        resource.resourceType.toLowerCase().includes(term) ||
        (resource.resourceGroup ?? '').toLowerCase().includes(term) ||
        resource.lastAlert.ruleName.toLowerCase().includes(term)
      );
    });

    return filtered.sort((left, right) => {
      switch (sortKey) {
        case 'name':
          return left.name.localeCompare(right.name);
        case 'alertCount':
          return right.alertCount - left.alertCount;
        case 'firingCount':
          return right.firingCount - left.firingCount || right.alertCount - left.alertCount;
        default:
          return new Date(right.lastAlertAt).getTime() - new Date(left.lastAlertAt).getTime();
      }
    });
  }, [resources, search, onlyFiring, sortKey]);

  const totals = useMemo(
    () => ({
      resources: resources.length,
      firing: resources.filter((resource) => resource.firingCount > 0).length,
      alerts: resources.reduce((sum, resource) => sum + resource.alertCount, 0)
    }),
    [resources]
  );

  function openResource(resource: ResourceSummary) {
    navigate(`/alerts?resource=${encodeURIComponent(resource.resourceId)}`);
  }

  const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border)] whitespace-nowrap select-none';
  const td = 'px-3 py-2 border-b border-[var(--color-border)] text-sm align-middle';

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <div className="text-xs text-[var(--color-text-secondary)]">
          <span className="font-semibold text-[var(--color-text)]">{totals.resources}</span> resources have alerted
          <span className="mx-1.5 text-[var(--color-text-tertiary)]">·</span>
          <span className="font-semibold text-[var(--color-text)]">{totals.firing}</span> currently firing
          <span className="mx-1.5 text-[var(--color-text-tertiary)]">·</span>
          <span className="font-semibold text-[var(--color-text)]">{totals.alerts}</span> alerts total
        </div>
        <div className="flex-1" />
        <Input placeholder="Search resource, type, group or rule…" value={search} onChange={(event) => setSearch(event.target.value)} className="max-w-xs" />
        <Button size="sm" variant={onlyFiring ? 'primary' : 'secondary'} onClick={() => setOnlyFiring((value) => !value)}>
          {onlyFiring ? '✓ ' : ''}Firing only
        </Button>
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="h-7 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-xs text-[var(--color-text)] focus:border-accent focus:outline-none"
        >
          <option value="lastAlertAt">Sort: latest alert</option>
          <option value="alertCount">Sort: most alerts</option>
          <option value="firingCount">Sort: most firing</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        {error && (
          <Notice tone="error" className="m-4">
            {error}
          </Notice>
        )}
        {isLoading && resources.length === 0 && (
          <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-text-secondary)]">
            <Spinner /> Loading resources…
          </div>
        )}
        {!isLoading && visible.length === 0 && (
          <EmptyState className="m-6">
            {resources.length === 0 ? 'No resource has alerted yet. Resources appear here the first time an alert arrives for them.' : 'No resources match the current filter.'}
          </EmptyState>
        )}

        {visible.length > 0 && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-[var(--color-header)]">
              <tr>
                <th className={th}>Resource</th>
                <th className={th}>Type</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Alerts</th>
                <th className={`${th} text-right`}>Firing</th>
                <th className={th}>Last alert</th>
                <th className={th}>Last diagnosis</th>
                <th className={`${th} text-right`}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((resource) => (
                <tr
                  key={resource.resourceId}
                  onClick={() => openResource(resource)}
                  className="cursor-pointer bg-[var(--color-surface)] transition-colors hover:bg-[var(--color-hover)]"
                  title={resource.resourceId}
                >
                  <td className={`${td} font-medium text-[var(--color-text)]`}>
                    <div className="flex items-center gap-2">
                      <span>{resource.name}</span>
                      {resource.isSimulated && <Badge tone="neutral">SIM</Badge>}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-tertiary)]">
                      {resource.resourceGroup ?? '—'}
                      {resource.clientSlug ? ` · ${resource.clientSlug}` : ''}
                    </div>
                  </td>
                  <td className={`${td} text-[var(--color-text-secondary)]`}>{shortType(resource.resourceType)}</td>
                  <td className={td}>
                    {resource.highestFiringSeverity ? (
                      <SeverityIndicator severity={resource.highestFiringSeverity} status="Fired" />
                    ) : (
                      <SeverityIndicator severity="Sev4" status="Resolved" />
                    )}
                  </td>
                  <td className={`${td} text-right font-mono text-xs`}>{resource.alertCount}</td>
                  <td className={`${td} text-right font-mono text-xs ${resource.firingCount > 0 ? 'text-sev-critical' : 'text-[var(--color-text-tertiary)]'}`}>{resource.firingCount}</td>
                  <td className={`${td} text-[var(--color-text-secondary)]`}>
                    <div className="truncate" title={resource.lastAlert.ruleName}>
                      {resource.lastAlert.ruleName}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-tertiary)]">{formatRelativeTime(resource.lastAlertAt)}</div>
                  </td>
                  <td className={td}>
                    {resource.lastDiagnosis ? (
                      <div className="flex items-start gap-2">
                        {resource.lastDiagnosis.urgency && <UrgencyBadge urgency={resource.lastDiagnosis.urgency} className="mt-0.5" />}
                        <span className="line-clamp-2 max-w-md text-xs text-[var(--color-text-secondary)]" title={resource.lastDiagnosis.summary}>
                          {resource.lastDiagnosis.summary}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--color-text-tertiary)]">—</span>
                    )}
                  </td>
                  <td className={`${td} text-right font-mono text-xs text-[var(--color-text-secondary)]`}>{resource.noteCount || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

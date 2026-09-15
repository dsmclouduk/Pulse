import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { UrgencyDot } from '@/components/alerts/EnrichmentBadges';
import { SeverityIndicator } from '@/components/alerts/SeverityIndicator';
import { Badge, Card, CardHeader, EmptyState, Notice, Spinner, StatTile } from '@/components/ui';
import { useAlertData } from '@/context/AlertDataContext';
import { formatLag } from '@/lib/alerts';
import type { AlertSeverity, AlertStats, DiagnosisUrgency } from '@/types';

interface DashboardPageProps {
  clientSlug: string | null;
}

const SEVERITY_LABEL: Record<AlertSeverity, string> = { Sev0: 'Critical', Sev1: 'Error', Sev2: 'Warning', Sev3: 'Warning', Sev4: 'Warning' };
const URGENCY_ORDER: DiagnosisUrgency[] = ['immediate', 'soon', 'planned', 'informational'];

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '< 1 min';
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function shortType(resourceType: string): string {
  return resourceType.split('/').pop() ?? resourceType;
}

/** Client-filterable counters computed from the alert store; nothing here is stored separately. */
export function DashboardPage({ clientSlug }: Readonly<DashboardPageProps>) {
  const navigate = useNavigate();
  const { alerts, commentsByAlert, enrichmentByAlert } = useAlertData();
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshKey = `${clientSlug ?? ''}|${alerts.length}|${alerts[0]?.id ?? ''}|${alerts[0]?.status ?? ''}|${Object.keys(commentsByAlert).length}|${Object.values(enrichmentByAlert).filter((status) => status.state === 'complete').length}`;

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/stats${clientSlug ? `?clientSlug=${encodeURIComponent(clientSlug)}` : ''}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load stats (${response.status})`);
        setStats((await response.json()) as AlertStats);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Failed to load stats.');
      });

    return () => controller.abort();
  }, [refreshKey, clientSlug]);

  if (error) {
    return (
      <div className="p-6">
        <Notice tone="error">{error}</Notice>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-text-secondary)]">
        <Spinner /> Loading dashboard…
      </div>
    );
  }

  const severityRows = (['Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'] as AlertSeverity[]).map((severity) => ({
    severity,
    label: `${severity} ${SEVERITY_LABEL[severity]}`,
    firing: stats.bySeverity[severity].firing,
    resolved: stats.bySeverity[severity].total - stats.bySeverity[severity].firing
  }));

  const perDay = stats.perDay.map((day) => ({ ...day, label: day.date.slice(5) }));
  const diagnosedTotal = URGENCY_ORDER.reduce((sum, urgency) => sum + stats.byUrgency[urgency], 0);

  return (
    <div className="w-full space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{clientSlug ? `Dashboard · ${clientSlug}` : 'Dashboard · all clients'}</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Counts are derived live from the alert store. Pick a client in the top bar to scope everything on this page.</p>
        </div>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">Updated {new Date(stats.generatedAt).toLocaleTimeString()}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatTile label="Firing now" value={stats.totals.firing} tone={stats.totals.firing > 0 ? 'critical' : 'ok'} hint={`${stats.totals.alerts} alerts total`} />
        <StatTile label="Fired 24 h" value={stats.last24h.fired} hint={`${stats.last24h.resolved} resolved`} />
        <StatTile label="Resources" value={stats.totals.resources} hint="that have alerted" />
        <StatTile label="Mean time to resolve" value={formatDuration(stats.meanTimeToResolveMs)} />
        <StatTile label="Avg webhook lag" value={stats.lag.averageMs === null ? '—' : formatLag(stats.lag.averageMs)} hint={stats.lag.p95Ms === null ? undefined : `p95 ${formatLag(stats.lag.p95Ms)}`} tone={stats.lag.over30sCount > 0 ? 'warning' : 'neutral'} />
        <StatTile label="Lag > 30 s" value={stats.lag.over30sCount} tone={stats.lag.over30sCount > 0 ? 'critical' : 'neutral'} />
        <StatTile label="Immediate" value={stats.byUrgency.immediate} tone={stats.byUrgency.immediate > 0 ? 'critical' : 'neutral'} hint="agent urgency" />
        <StatTile label="Diagnosed" value={stats.enrichment.diagnosed} hint={`${stats.enrichment.llm} LLM · ${stats.enrichment.ruleBased} rules${stats.enrichment.failed ? ` · ${stats.enrichment.failed} failed` : ''}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader eyebrow="Last 7 days" title="Alerts fired and resolved per day" />
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perDay} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 12, color: 'var(--color-text)' }} />
                <Bar dataKey="fired" name="Fired" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Bar dataKey="resolved" name="Resolved" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader eyebrow="By severity" title="Firing vs resolved" />
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={severityRows} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 24 }}>
                <CartesianGrid stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={90} tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 12, color: 'var(--color-text)' }} />
                <Bar dataKey="firing" name="Firing" stackId="a" fill="#f97316" />
                <Bar dataKey="resolved" name="Resolved" stackId="a" fill="#94a3b8" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader eyebrow="Agent" title="Diagnosis urgency" description={diagnosedTotal === 0 ? 'No diagnoses yet.' : `${diagnosedTotal} alerts diagnosed`} />
          {diagnosedTotal === 0 ? (
            <EmptyState>Fire an alert and the agent's urgency split appears here.</EmptyState>
          ) : (
            <div className="space-y-2">
              {URGENCY_ORDER.map((urgency) => {
                const count = stats.byUrgency[urgency];
                const pct = diagnosedTotal === 0 ? 0 : Math.round((count / diagnosedTotal) * 100);
                return (
                  <div key={urgency} className="flex items-center gap-3 text-xs">
                    <span className="flex w-28 items-center gap-1.5 capitalize text-[var(--color-text-secondary)]">
                      <UrgencyDot urgency={urgency} /> {urgency}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-[var(--color-header)]">
                      <div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-16 text-right font-mono text-[var(--color-text)]">
                      {count} <span className="text-[var(--color-text-tertiary)]">({pct}%)</span>
                    </span>
                  </div>
                );
              })}
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                {Object.entries(stats.byPattern)
                  .filter(([, count]) => count > 0)
                  .map(([pattern, count]) => (
                    <Badge key={pattern} tone="neutral">
                      {pattern.replace('-', ' ')} {count}
                    </Badge>
                  ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader eyebrow="Noisiest" title="Top resources" description="Click to open the resource's alerts." />
          {stats.topResources.length === 0 ? (
            <EmptyState>No alerts yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {stats.topResources.map((resource) => (
                <li key={resource.resourceId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/alerts?resource=${encodeURIComponent(resource.resourceId)}`)}
                    className="flex w-full items-center gap-3 py-1.5 text-left text-xs hover:bg-[var(--color-hover)]"
                  >
                    {resource.highestFiringSeverity ? <SeverityIndicator severity={resource.highestFiringSeverity} status="Fired" /> : <SeverityIndicator severity="Sev4" status="Resolved" />}
                    <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text)]">{resource.name}</span>
                    <span className="text-[var(--color-text-tertiary)]">{shortType(resource.resourceType)}</span>
                    <span className="w-20 text-right font-mono text-[var(--color-text-secondary)]">
                      {resource.alertCount} alert{resource.alertCount === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader eyebrow="Rules" title="Top alert rules" />
          {stats.topRules.length === 0 ? (
            <EmptyState>No alerts yet.</EmptyState>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {stats.topRules.map((rule) => (
                <div key={rule.ruleName} className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-[var(--color-text)]" title={rule.ruleName}>
                    {rule.ruleName}
                  </span>
                  <span className="font-mono text-[var(--color-text-secondary)]">{rule.count}</span>
                  {rule.firing > 0 && <Badge tone="critical">{rule.firing} firing</Badge>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

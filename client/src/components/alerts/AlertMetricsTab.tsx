import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { MetricContextPanel } from '@/components/MetricContextPanel';
import { UrgencyBadge } from '@/components/alerts/EnrichmentBadges';
import { Badge, EmptyState, Notice, Spinner, StatTile } from '@/components/ui';
import { useAlertEnrichment } from '@/context/AlertDataContext';
import type { AlertEnrichmentDetail, AlertEvent, MetricAggregation, MetricHistoryResult, MetricPoint, TrendAnalysis } from '@/types';

interface AlertMetricsTabProps {
  alert: AlertEvent;
}

const aggregationField: Record<MetricAggregation, keyof MetricPoint> = {
  Average: 'average',
  Minimum: 'minimum',
  Maximum: 'maximum',
  Total: 'total',
  Count: 'count'
};

interface ChartPoint {
  t: number;
  value?: number;
  projected?: number;
}

function pointValue(point: MetricPoint, aggregation: MetricAggregation): number | undefined {
  const value = point[aggregationField[aggregation]];
  return typeof value === 'number' ? value : point.average;
}

function formatValue(value: number | undefined, unit: string): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  if (unit === 'Percent') return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
}

function formatSigned(value: number | null, unit: string): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}${unit === 'Percent' ? ' pts' : ''}`;
}

function patternLabel(pattern: TrendAnalysis['pattern']): { label: string; tone: 'critical' | 'error' | 'warning' | 'info' | 'ok' | 'neutral' } {
  switch (pattern) {
    case 'rapid-fill':
      return { label: 'Rapid fill', tone: 'critical' };
    case 'steady-growth':
      return { label: 'Steady growth', tone: 'error' };
    case 'volatile':
      return { label: 'Volatile', tone: 'warning' };
    case 'declining':
      return { label: 'Declining', tone: 'ok' };
    case 'flat':
      return { label: 'Flat', tone: 'info' };
    default:
      return { label: 'Insufficient data', tone: 'neutral' };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PROJECTION_DAYS = 30;

/** Only a steady trend earns a projection line; a rapid fill or noisy series would mislead. */
function shouldProject(trend: TrendAnalysis | null | undefined): trend is TrendAnalysis {
  return Boolean(trend && trend.pattern === 'steady-growth' && trend.projectedCeilingDate && trend.ceiling !== null);
}

function buildChartData(result: MetricHistoryResult, trend: TrendAnalysis | null | undefined, includeProjection: boolean): ChartPoint[] {
  const series = result.series[0];

  if (!series) return [];

  const data: ChartPoint[] = series.points
    .map((point) => ({ t: new Date(point.timestamp).getTime(), value: pointValue(point, series.aggregation) }))
    .filter((point) => Number.isFinite(point.t))
    .sort((left, right) => left.t - right.t);

  if (includeProjection && shouldProject(trend) && trend.ceiling !== null && trend.projectedCeilingDate && data.length > 0) {
    const last = data[data.length - 1];
    const projectedEnd = new Date(trend.projectedCeilingDate).getTime();
    const cappedEnd = Math.min(projectedEnd, last.t + MAX_PROJECTION_DAYS * DAY_MS);
    const cappedValue =
      cappedEnd === projectedEnd ? trend.ceiling : (last.value ?? trend.last) + trend.slopePerDay * ((cappedEnd - last.t) / DAY_MS);

    data[data.length - 1] = { ...last, projected: last.value };
    data.push({ t: cappedEnd, projected: Math.min(trend.ceiling, cappedValue) });
  }

  return data;
}

function HistoryChart({
  result,
  alert,
  trend,
  includeProjection
}: Readonly<{ result: MetricHistoryResult; alert: AlertEvent; trend: TrendAnalysis | null | undefined; includeProjection: boolean }>) {
  const series = result.series[0];
  const data = useMemo(() => buildChartData(result, trend, includeProjection), [result, trend, includeProjection]);
  const unit = series?.unit ?? '';
  const firedAtMs = new Date(alert.firedAt).getTime();
  const isLongRange = data.length > 1 && data[data.length - 1].t - data[0].t > 3 * 24 * 60 * 60 * 1000;

  const formatTick = (value: number) =>
    isLongRange
      ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      : new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const yDomain: [number | string, number | string] = unit === 'Percent' ? [0, 100] : ['auto', 'auto'];

  return (
    <div className="h-full min-h-[190px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTick}
            tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={yDomain}
            tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(value: number) => (unit === 'Percent' ? `${Math.round(value)}%` : formatValue(value, unit))}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              color: 'var(--color-text)',
              fontSize: 12
            }}
            labelFormatter={(label) => new Date(Number(label)).toLocaleString('en-GB')}
            formatter={(value: number, name: string) => [formatValue(value, unit), name === 'projected' ? 'Projected' : series?.displayName ?? 'Value']}
          />
          {alert.threshold !== undefined && alert.threshold !== null && (
            <ReferenceLine y={alert.threshold} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `Threshold ${alert.threshold}`, position: 'insideTopRight', fill: '#ef4444', fontSize: 10 }} />
          )}
          {includeProjection && shouldProject(trend) && trend.ceiling !== null && (
            <ReferenceLine y={trend.ceiling} stroke="var(--color-text-tertiary)" strokeDasharray="2 6" />
          )}
          <ReferenceLine x={firedAtMs} stroke="#f97316" strokeDasharray="3 3" label={{ value: 'Fired', position: 'insideTopLeft', fill: '#f97316', fontSize: 10 }} />
          <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          {includeProjection && (
            <Line type="linear" dataKey="projected" stroke="#f97316" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** For a rapid fill the long-term slope is meaningless; use the last-24h rate instead. */
function effectiveDaysToFull(trend: TrendAnalysis): number | null {
  if (trend.pattern === 'rapid-fill') {
    return trend.recentProjectedDaysToCeiling ?? trend.projectedDaysToCeiling;
  }

  return trend.projectedDaysToCeiling;
}

function formatTimeToFull(trend: TrendAnalysis): string {
  const days = effectiveDaysToFull(trend);

  if (days === null) return '—';
  if (days < 1) return `~${Math.max(1, Math.round(days * 24))} h`;
  return `~${Math.round(days)} d`;
}

function timeToFullHint(trend: TrendAnalysis): string {
  const days = effectiveDaysToFull(trend);

  if (days === null) return 'No positive trend';
  if (trend.pattern === 'rapid-fill') return 'At the current fill rate';
  return trend.projectedCeilingDate ? trend.projectedCeilingDate.slice(0, 10) : '';
}

function timeToFullTone(trend: TrendAnalysis): 'critical' | 'error' | 'neutral' {
  const days = effectiveDaysToFull(trend);

  if (days === null) return 'neutral';
  if (days <= 7) return 'critical';
  if (days <= 30) return 'error';
  return 'neutral';
}

function TrendTiles({ trend, unit }: Readonly<{ trend: TrendAnalysis; unit: string }>) {
  const pattern = patternLabel(trend.pattern);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile label="Pattern" value={<Badge tone={pattern.tone}>{pattern.label}</Badge>} hint={`${trend.pointCount} points over ${Math.round(trend.spanDays)} d`} />
      <StatTile label="Growth / day" value={formatSigned(trend.slopePerDay, unit)} hint={`r² ${trend.rSquared}`} />
      <StatTile label="Last 6 h" value={formatSigned(trend.delta6h, unit)} tone={trend.delta6h !== null && trend.delta6h >= 10 ? 'critical' : 'neutral'} />
      <StatTile label="Last 24 h" value={formatSigned(trend.delta24h, unit)} />
      <StatTile
        label={trend.pattern === 'rapid-fill' ? 'Time to full (24 h rate)' : 'Days to full'}
        value={formatTimeToFull(trend)}
        hint={timeToFullHint(trend)}
        tone={timeToFullTone(trend)}
      />
      <StatTile label="Suggested urgency" value={<UrgencyBadge urgency={trend.suggestedUrgency} />} hint={`Now at ${formatValue(trend.last, unit)}`} />
    </div>
  );
}

export function AlertMetricsTab({ alert }: Readonly<AlertMetricsTabProps>) {
  const status = useAlertEnrichment(alert.id);
  const [detail, setDetail] = useState<AlertEnrichmentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshKey = `${alert.id}|${status?.state ?? 'none'}|${status?.updatedAt ?? ''}`;

  useEffect(() => {
    if (!status) {
      setDetail(null);
      return;
    }

    const controller = new AbortController();

    async function load(): Promise<void> {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ alertId: alert.id });
        if (alert.clientSlug) params.set('clientSlug', alert.clientSlug);
        const response = await fetch(`/api/alerts/enrichment?${params.toString()}`, { signal: controller.signal });

        if (response.status === 404) {
          setDetail(null);
          return;
        }

        if (!response.ok) {
          throw new Error(`Enrichment request failed: ${response.status}`);
        }

        setDetail((await response.json()) as AlertEnrichmentDetail);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load enrichment.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const longTerm = detail?.history.find((result) => result.request.label === 'long-term');
  const zoom = detail?.history.find((result) => result.request.label === 'zoom');
  const hasLongTerm = longTerm?.status === 'ready' && (longTerm.series[0]?.points.length ?? 0) > 0;
  const hasZoom = zoom?.status === 'ready' && (zoom.series[0]?.points.length ?? 0) > 0;
  const trend = detail?.trend ?? null;
  const unit = longTerm?.series[0]?.unit ?? zoom?.series[0]?.unit ?? 'Percent';

  return (
    <div className="flex flex-col gap-3 p-3">
      {isLoading && !detail && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <Spinner size={12} /> Loading metric history…
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {trend && <TrendTiles trend={trend} unit={unit} />}

      {hasLongTerm && longTerm && (
        <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text)]">{longTerm.series[0].displayName}</p>
              <p className="text-[11px] text-[var(--color-text-secondary)]">
                {longTerm.request.interval} grain · source {longTerm.provider}
                {longTerm.derivation ? ` · ${longTerm.derivation}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
              <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-accent" /> Actual</span>
              {shouldProject(trend) && <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t border-dashed border-sev-error" /> Projection</span>}
              <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t border-dashed border-sev-critical" /> Threshold</span>
            </div>
          </div>
          <div className="h-56">
            <HistoryChart result={longTerm} alert={alert} trend={trend} includeProjection />
          </div>
        </section>
      )}

      {hasZoom && zoom && (
        <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
          <p className="mb-1 text-xs font-semibold text-[var(--color-text)]">Recent detail · {zoom.request.interval} grain</p>
          <div className="h-40">
            <HistoryChart result={zoom} alert={alert} trend={trend} includeProjection={false} />
          </div>
        </section>
      )}

      {detail && !hasLongTerm && !hasZoom && (
        <EmptyState>
          {detail.history[0]?.message ?? 'No metric history was returned for this alert.'}
        </EmptyState>
      )}

      {!status && (
        <Notice tone="neutral">
          No enrichment has run for this alert yet. Live resource metrics from Azure Monitor are shown below when credentials are configured.
        </Notice>
      )}

      {(!detail || (!hasLongTerm && !hasZoom)) && alert.resourceIds[0] && !alert.isSimulated && (
        <MetricContextPanel resourceId={alert.resourceIds[0]} metricName={alert.metricName} />
      )}
    </div>
  );
}

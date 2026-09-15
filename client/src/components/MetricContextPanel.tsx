import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardHeader, Notice, Spinner } from '@/components/ui';
import { useResourceMetrics } from '@/hooks/useResourceMetrics';
import type { MetricAggregation, MetricSeries } from '@/types';

interface MetricContextPanelProps {
  resourceId?: string;
  metricName?: string;
}

const aggregationFieldMap: Record<MetricAggregation, keyof MetricSeries['points'][number]> = {
  Average: 'average',
  Minimum: 'minimum',
  Maximum: 'maximum',
  Total: 'total',
  Count: 'count'
};

function formatMetricValue(value: number | undefined, unit: string): string {
  if (value === undefined) {
    return 'No data';
  }

  if (unit === 'Percent') {
    return `${value.toFixed(1)}%`;
  }

  if (unit === 'Bytes') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let nextValue = value;
    let unitIndex = 0;

    while (nextValue >= 1024 && unitIndex < units.length - 1) {
      nextValue /= 1024;
      unitIndex += 1;
    }

    return `${nextValue.toFixed(1)} ${units[unitIndex]}`;
  }

  if (unit === 'MilliSeconds') {
    return `${value.toFixed(0)} ms`;
  }

  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
}

function formatTick(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MetricCard({ series }: Readonly<{ series: MetricSeries }>) {
  const fieldName = aggregationFieldMap[series.aggregation];
  const latestPoint = [...series.points].reverse().find((point) => typeof point[fieldName] === 'number');
  const latestValue = latestPoint?.[fieldName] as number | undefined;

  return (
    <article className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-[var(--color-text)]">{series.displayName}</p>
          <p className="text-[11px] text-[var(--color-text-secondary)]">{series.aggregation} · last 6 hours · 5 min grain</p>
        </div>
        <p className="font-mono text-sm font-semibold text-[var(--color-text)]">{formatMetricValue(latestValue, series.unit)}</p>
      </div>

      <div className="mt-2 h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series.points} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="timestamp" tickFormatter={formatTick} tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={32} />
            <YAxis tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                color: 'var(--color-text)',
                fontSize: 12
              }}
              labelFormatter={(label) => new Date(label).toLocaleString('en-GB')}
              formatter={(value: number) => formatMetricValue(value, series.unit)}
            />
            <Line type="monotone" dataKey={fieldName} stroke="#2563eb" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {series.errorCode && series.errorCode !== 'Success' ? (
        <Notice tone="warning" className="mt-2">
          {series.errorMessage ?? `Metric query returned ${series.errorCode}.`}
        </Notice>
      ) : null}
    </article>
  );
}

export function MetricContextPanel({ resourceId, metricName }: Readonly<MetricContextPanelProps>) {
  const { context, isLoading } = useResourceMetrics({ resourceId, metricName });

  return (
    <Card>
      <CardHeader
        eyebrow="Azure Monitor"
        title="Live resource metrics"
        description="Supplementary polling for context. Alert delivery stays webhook-first."
        actions={context?.fetchedAt ? <span className="text-[11px] text-[var(--color-text-tertiary)]">Updated {new Date(context.fetchedAt).toLocaleTimeString()}</span> : undefined}
      />

      {!resourceId && <Notice>No resource ID is available for this alert.</Notice>}
      {resourceId && isLoading && !context && (
        <p className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <Spinner size={12} /> Loading metrics…
        </p>
      )}
      {resourceId && context?.status === 'disabled' && <Notice>{context.message}</Notice>}
      {resourceId && context?.status === 'error' && <Notice tone="warning">{context.message}</Notice>}
      {resourceId && context?.status === 'ready' && context.series.length === 0 && <Notice>No metric data was returned for this resource and time range.</Notice>}

      {context?.status === 'ready' && context.series.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {context.series.map((series) => (
            <MetricCard key={`${series.metricName}-${series.aggregation}`} series={series} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

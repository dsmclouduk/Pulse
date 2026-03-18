import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

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

  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatTick(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MetricCard({ series }: Readonly<{ series: MetricSeries }>) {
  const fieldName = aggregationFieldMap[series.aggregation];
  const latestPoint = [...series.points].reverse().find((point) => typeof point[fieldName] === 'number');
  const latestValue = latestPoint?.[fieldName] as number | undefined;

  return (
    <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white">{series.displayName}</p>
          <p className="mt-1 text-xs text-slate-400">{series.aggregation} over the last 6 hours</p>
        </div>
        <p className="font-mono text-sm text-slate-200">{formatMetricValue(latestValue, series.unit)}</p>
      </div>

      <div className="mt-4 h-36">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series.points} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTick}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              contentStyle={{
                background: '#0f1419',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                color: '#e2e8f0'
              }}
              labelFormatter={(label) => new Date(label).toLocaleString()}
              formatter={(value: number) => formatMetricValue(value, series.unit)}
            />
            <Line
              type="monotone"
              dataKey={fieldName}
              stroke="#74d3ff"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {series.errorCode && series.errorCode !== 'Success' ? (
        <p className="mt-3 text-xs text-amber-300">{series.errorMessage ?? `Metric query returned ${series.errorCode}.`}</p>
      ) : null}
    </article>
  );
}

export function MetricContextPanel({ resourceId, metricName }: Readonly<MetricContextPanelProps>) {
  const { context, isLoading } = useResourceMetrics({ resourceId, metricName });

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Metric context</p>
          <p className="mt-2 text-sm text-slate-300">Supplementary Azure Monitor polling. Alert delivery remains webhook-first.</p>
        </div>
        {context?.fetchedAt ? <p className="text-xs text-slate-500">Updated {new Date(context.fetchedAt).toLocaleTimeString()}</p> : null}
      </div>

      {!resourceId ? <p className="mt-4 text-sm text-slate-400">No resource ID is available for this alert.</p> : null}
      {resourceId && isLoading ? <p className="mt-4 text-sm text-slate-400">Loading metrics context...</p> : null}
      {resourceId && !isLoading && context?.status === 'disabled' ? <p className="mt-4 text-sm text-slate-400">{context.message}</p> : null}
      {resourceId && !isLoading && context?.status === 'error' ? <p className="mt-4 text-sm text-amber-300">{context.message}</p> : null}
      {resourceId && !isLoading && context?.status === 'ready' && context.series.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No metric data was returned for this resource and time range.</p>
      ) : null}

      {context?.status === 'ready' && context.series.length > 0 ? (
        <div className="mt-5 grid gap-4">
          {context.series.map((series) => (
            <MetricCard key={`${series.metricName}-${series.aggregation}`} series={series} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

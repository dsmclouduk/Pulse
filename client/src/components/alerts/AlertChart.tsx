import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

import type { AlertEvent } from '@/types';

interface AlertChartProps {
  alerts: AlertEvent[];
}

interface ChartBucket {
  time: string;
  timestamp: number;
  critical: number;
  error: number;
  warning: number;
}

function buildTimeSeries(alerts: AlertEvent[]): ChartBucket[] {
  if (alerts.length === 0) return [];

  const timestamps = alerts.map((a) => new Date(a.firedAt).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  const rangeMs = maxTime - minTime;
  const bucketMs = Math.max(rangeMs / 24, 3600000);
  const bucketCount = Math.max(Math.ceil(rangeMs / bucketMs) + 1, 2);

  const buckets: ChartBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const t = minTime + i * bucketMs;
    const date = new Date(t);
    buckets.push({
      time: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
        date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      timestamp: t,
      critical: 0,
      error: 0,
      warning: 0,
    });
  }

  for (const alert of alerts) {
    if (alert.status === 'Resolved') continue;

    const t = new Date(alert.firedAt).getTime();
    const bucketIdx = Math.min(Math.floor((t - minTime) / bucketMs), bucketCount - 1);
    const bucket = buckets[bucketIdx];
    if (!bucket) continue;

    switch (alert.severity) {
      case 'Sev0':
        bucket.critical += 1;
        break;
      case 'Sev1':
        bucket.error += 1;
        break;
      case 'Sev2':
      case 'Sev3':
      case 'Sev4':
        bucket.warning += 1;
        break;
    }
  }

  return buckets;
}

export function AlertChart({ alerts }: Readonly<AlertChartProps>) {
  const data = useMemo(() => buildTimeSeries(alerts), [alerts]);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-text-tertiary)]">
        No alert data to chart.
      </div>
    );
  }

  return (
    <div className="h-52 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={30}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              fontSize: '12px',
              color: 'var(--color-text)',
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: '10px' }}
            iconType="circle"
            iconSize={8}
          />
          <Area
            type="monotone"
            dataKey="critical"
            name="Critical"
            stackId="1"
            stroke="#ef4444"
            fill="#ef4444"
            fillOpacity={0.3}
          />
          <Area
            type="monotone"
            dataKey="error"
            name="Error"
            stackId="1"
            stroke="#f97316"
            fill="#f97316"
            fillOpacity={0.3}
          />
          <Area
            type="monotone"
            dataKey="warning"
            name="Warning"
            stackId="1"
            stroke="#eab308"
            fill="#eab308"
            fillOpacity={0.3}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

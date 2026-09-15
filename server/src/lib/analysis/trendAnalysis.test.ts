import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MetricSeries } from '../../../../shared/types.js';
import { generateSyntheticSeries } from '../metrics/syntheticProvider.js';
import { planMetricHistory, isDiskMetric } from '../enrichment/metricRequestPlanner.js';
import { getEnrichmentConfig } from '../enrichment/enrichmentConfig.js';
import { buildDiskFreeSpaceQuery, kqlStringLiteral } from '../metrics/kql.js';
import { analyseTrend } from './trendAnalysis.js';

const NOW = new Date('2026-09-15T12:00:00Z');

function synthetic(pattern: 'steady-growth' | 'rapid-fill' | 'flat' | 'sawtooth', start: number, end: number, days = 90): MetricSeries {
  return generateSyntheticSeries(
    { pattern, days, startPercent: start, endPercent: end, noise: 0.3, jumpHoursAgo: 6, periodDays: 7 },
    `test-${pattern}`,
    NOW,
    'Disk % Used',
    'Percent'
  );
}

describe('analyseTrend', () => {
  it('classifies 90 days of steady growth and projects time to full', () => {
    const trend = analyseTrend(synthetic('steady-growth', 59, 95), { ceiling: 100, now: NOW });

    assert.equal(trend.pattern, 'steady-growth');
    assert.ok(Math.abs(trend.slopePerDay - 0.4) < 0.05, `slope ${trend.slopePerDay}`);
    assert.ok(trend.rSquared > 0.95);
    assert.ok(trend.projectedDaysToCeiling !== null && trend.projectedDaysToCeiling > 8 && trend.projectedDaysToCeiling < 16);
    assert.equal(trend.suggestedUrgency, 'soon');
  });

  it('classifies a sudden jump in the last hours as rapid fill with immediate urgency', () => {
    const trend = analyseTrend(synthetic('rapid-fill', 55, 96), { ceiling: 100, now: NOW });

    assert.equal(trend.pattern, 'rapid-fill');
    assert.ok(trend.delta6h !== null && trend.delta6h > 30, `delta6h ${trend.delta6h}`);
    assert.equal(trend.suggestedUrgency, 'immediate');
  });

  it('classifies a flat series at the threshold as flat / soon', () => {
    const trend = analyseTrend(synthetic('flat', 95, 95.2), { ceiling: 100, threshold: 95, now: NOW });

    assert.equal(trend.pattern, 'flat');
    assert.equal(trend.suggestedUrgency, 'soon');
  });

  it('treats a weekly sawtooth as volatile, not a rapid fill', () => {
    const trend = analyseTrend(synthetic('sawtooth', 30, 95, 30), { ceiling: 100, now: NOW });

    assert.equal(trend.pattern, 'volatile');
    assert.notEqual(trend.suggestedUrgency, 'immediate');
  });

  it('returns insufficient-data for fewer than three points', () => {
    const series: MetricSeries = {
      metricName: 'x',
      displayName: 'x',
      unit: 'Percent',
      aggregation: 'Average',
      points: [
        { timestamp: '2026-09-14T00:00:00Z', average: 10 },
        { timestamp: '2026-09-15T00:00:00Z', average: 12 }
      ]
    };

    const trend = analyseTrend(series, { ceiling: 100, now: NOW });
    assert.equal(trend.pattern, 'insufficient-data');
    assert.equal(trend.suggestedUrgency, 'informational');
  });
});

describe('planMetricHistory', () => {
  const config = getEnrichmentConfig();
  const vm = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1';

  it('uses the synthetic provider for simulated alerts', () => {
    const plan = planMetricHistory(
      {
        id: 'simulated:1',
        ruleName: 'r',
        severity: 'Sev2',
        status: 'Fired',
        signalType: 'Metric',
        resourceIds: [vm],
        firedAt: NOW.toISOString(),
        resolvedAt: null,
        receivedAt: NOW.toISOString(),
        lagMs: 0,
        metricName: 'Disk % Used',
        isSimulated: true
      },
      config,
      NOW
    );

    assert.equal(plan.requests[0]?.source, 'synthetic');
    assert.equal(plan.requests[0]?.ceiling, 100);
    assert.equal(plan.primaryIndex, 0);
  });

  it('marks VM disk alerts as unavailable when Log Analytics is not configured', () => {
    delete process.env.LOG_ANALYTICS_WORKSPACE_ID;

    const plan = planMetricHistory(
      {
        id: 'real:1',
        ruleName: 'r',
        severity: 'Sev2',
        status: 'Fired',
        signalType: 'Metric',
        resourceIds: [vm],
        firedAt: NOW.toISOString(),
        resolvedAt: null,
        receivedAt: NOW.toISOString(),
        lagMs: 0,
        metricName: 'Logical Disk Free Space %',
        isSimulated: false
      },
      config,
      NOW
    );

    assert.equal(plan.requests[0]?.source, 'none');
    assert.match(plan.requests[0]?.filter ?? '', /LOG_ANALYTICS_WORKSPACE_ID/);
  });

  it('recognises disk metric names', () => {
    assert.equal(isDiskMetric('Disk % Used'), true);
    assert.equal(isDiskMetric('LogicalDisk % Free Space'), true);
    assert.equal(isDiskMetric('Percentage CPU'), false);
  });
});

describe('kql', () => {
  it('escapes quotes and backslashes in string literals', () => {
    assert.equal(kqlStringLiteral('a"b\\c'), '"a\\"b\\\\c"');
  });

  it('builds a LogicalDisk free space query scoped to the resource', () => {
    const query = buildDiskFreeSpaceQuery({ resourceId: '/subscriptions/x/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm', mountId: 'C:', days: 90, binSize: '1d' });

    assert.match(query, /InsightsMetrics/);
    assert.match(query, /Namespace == "LogicalDisk" and Name == "FreeSpacePercentage"/);
    assert.match(query, /_ResourceId =~ "\/subscriptions\/x/);
    assert.match(query, /Mount =~ "C:"/);
    assert.match(query, /bin\(TimeGenerated, 1d\)/);
  });
});

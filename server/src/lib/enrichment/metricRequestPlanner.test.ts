import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { AlertEvent } from '../../../../shared/types.js';
import { getEnrichmentConfig } from './enrichmentConfig.js';
import { extractMountFromQuery } from '../normalise.js';
import { isDiskAlert, planMetricHistory } from './metricRequestPlanner.js';

const VM_ID = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-01';
/** Azure sends lower-cased ARM paths in alert payloads; the planner must cope with both. */
const VM_ID_LOWER = VM_ID.toLowerCase();

function alert(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 'alert-1',
    ruleName: 'rule',
    severity: 'Sev2',
    status: 'Fired',
    signalType: 'Metric',
    resourceIds: [VM_ID],
    firedAt: '2026-09-15T12:00:00Z',
    resolvedAt: null,
    receivedAt: '2026-09-15T12:00:01Z',
    lagMs: 1000,
    isSimulated: false,
    ...overrides
  };
}

describe('metricRequestPlanner', () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env.AZURE_TENANT_ID = 'tenant';
    process.env.AZURE_CLIENT_ID = 'client';
    process.env.AZURE_CLIENT_SECRET = 'secret';
    process.env.LOG_ANALYTICS_WORKSPACE_ID = 'workspace';
  });

  afterEach(() => {
    process.env = { ...previous };
  });

  it('recognises a disk alert from the rule name when the metric is a query column', () => {
    // A scheduled-query rule names the aggregated column ("FreePct"), never a platform metric.
    assert.equal(isDiskAlert(alert({ ruleName: 'pulse-vm-os-disk-free', metricName: 'FreePct' })), true);
    assert.equal(isDiskAlert(alert({ ruleName: 'cpu-high', metricName: 'Percentage CPU' })), false);
  });

  it('sends a log-based VM disk alert to Log Analytics', () => {
    const plan = planMetricHistory(
      alert({ signalType: 'Log', ruleName: 'pulse-vm-os-disk-free', metricName: 'FreePct', resourceIds: [VM_ID_LOWER] }),
      getEnrichmentConfig()
    );

    assert.equal(plan.primaryIndex, 0);
    assert.equal(plan.requests.length, 2);
    assert.equal(plan.requests[0].source, 'log-analytics');
    assert.equal(plan.requests[0].metricName, 'FreeSpacePercentage');
    assert.equal(plan.requests[0].ceiling, 100);
  });

  it('charts any other guest log alert on a VM from its aggregated column', () => {
    const plan = planMetricHistory(
      alert({ signalType: 'Log', ruleName: 'pulse-vm-memory-low', metricName: 'AvailableMB' }),
      getEnrichmentConfig()
    );

    assert.equal(plan.primaryIndex, 0);
    assert.equal(plan.requests[0].source, 'log-analytics');
    assert.equal(plan.requests[0].metricName, 'AvailableMB');
  });

  it('sends a platform metric alert to the ARM metrics API', () => {
    const plan = planMetricHistory(alert({ metricName: 'Percentage CPU' }), getEnrichmentConfig());

    assert.equal(plan.requests.length, 2);
    assert.equal(plan.requests[0].source, 'arm');
    assert.equal(plan.requests[0].metricName, 'Percentage CPU');
    assert.equal(plan.requests[1].label, 'zoom');
  });

  it('plans nothing when there is no metric to chart', () => {
    const plan = planMetricHistory(alert({ signalType: 'ActivityLog', resourceIds: [] }), getEnrichmentConfig());

    assert.equal(plan.requests.length, 0);
    assert.equal(plan.primaryIndex, -1);
  });
});

describe('extractMountFromQuery', () => {
  it('reads the mount a disk rule pins in its own query text', () => {
    const query =
      'InsightsMetrics | where Namespace == "LogicalDisk" | extend Mount = tostring(todynamic(Tags)["vm.azm.ms/mountId"]) | where Mount == "C:" | project FreePct = Val';

    assert.equal(extractMountFromQuery(query), 'C:');
  });

  it('returns nothing when the rule splits by mount instead of pinning one', () => {
    const query = 'InsightsMetrics | extend Mount = tostring(todynamic(Tags)["vm.azm.ms/mountId"]) | project Mount, FreePct = Val';

    assert.equal(extractMountFromQuery(query), undefined);
    assert.equal(extractMountFromQuery(undefined), undefined);
  });
});

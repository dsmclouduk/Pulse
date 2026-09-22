import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCoverageReport, COVERAGE_QUERIES, type CoverageFacts } from './coverageReport.js';

const CLIENT = 'rwk';
const VM_TYPES = ['microsoft.compute/virtualmachines'];

function pulseRule(name: string, type = 'microsoft.insights/metricalerts', tags: Record<string, string> = {}) {
  return {
    id: `/subscriptions/s/resourceGroups/rg/providers/${type}/${name}`,
    name,
    type,
    tags: { 'pulse-managed': 'true', 'pulse-client': CLIENT, ...tags },
    properties: {}
  };
}

function facts(overrides: Partial<CoverageFacts> = {}): CoverageFacts {
  return { pulseResources: [], vms: [], ...overrides };
}

function report(input: CoverageFacts, resourceTypes = VM_TYPES) {
  return buildCoverageReport(input, { clientSlug: CLIENT, tier: 'essential', resourceTypes });
}

function check(result: ReturnType<typeof report>, key: string) {
  const found = result.checks.find((entry) => entry.key === key);
  assert.ok(found, `expected a check named ${key}`);
  return found;
}

describe('coverage report', () => {
  it('asks Azure only about monitoring configuration, never telemetry', () => {
    for (const query of Object.values(COVERAGE_QUERIES)) {
      for (const forbidden of ['InsightsMetrics', 'Perf ', 'AzureMetrics', 'Heartbeat']) {
        assert.ok(!query.includes(forbidden), `coverage query must not read telemetry (${forbidden})`);
      }
    }
  });

  it('reports a client with nothing deployed as unmonitored rather than erroring', () => {
    const result = report(facts());

    assert.equal(check(result, 'action-group').state, 'UNMONITORED');
    assert.equal(check(result, 'rules').state, 'UNMONITORED');
    assert.equal(result.presentRuleCount, 0);
    assert.ok(result.expectedRuleCount > 0);
  });

  it('recognises only rules tagged as ours', () => {
    // A client's own alert rules must never be counted as coverage, or the report lies.
    const result = report(
      facts({
        pulseResources: [
          pulseRule('pulse-rwk-vm-cpu-high-uksouth'),
          { id: '/x', name: 'clients-own-cpu-alert', type: 'microsoft.insights/metricalerts', tags: {}, properties: {} }
        ]
      })
    );

    const cpu = result.rules.find((rule) => rule.key === 'vm-cpu-high');
    assert.equal(cpu?.present, true);
    assert.equal(cpu?.deployedCount, 1);
    assert.equal(result.presentRuleCount, 1);
    assert.deepEqual(result.orphanedRuleNames, []);
  });

  it('ignores rules tagged for a different client', () => {
    const result = report(
      facts({ pulseResources: [pulseRule('pulse-rwk-vm-cpu-high-uksouth', 'microsoft.insights/metricalerts', { 'pulse-client': 'tardis' })] })
    );

    assert.equal(result.presentRuleCount, 0);
  });

  it('counts one deployed rule per region against a single catalogue entry', () => {
    const result = report(
      facts({ pulseResources: [pulseRule('pulse-rwk-vm-cpu-high-uksouth'), pulseRule('pulse-rwk-vm-cpu-high-ukwest')] })
    );

    const cpu = result.rules.find((rule) => rule.key === 'vm-cpu-high');
    assert.equal(cpu?.deployedCount, 2);
    assert.equal(result.presentRuleCount, 1, 'two regions of one rule is still one rule covered');
  });

  it('flags rules we deployed that the catalogue no longer wants', () => {
    // Left behind by a tier change or a renamed rule; the engineer should know to remove them.
    const result = report(facts({ pulseResources: [pulseRule('pulse-rwk-vm-retired-check')] }));

    assert.deepEqual(result.orphanedRuleNames, ['pulse-rwk-vm-retired-check']);
  });

  it('treats a partly rolled-out agent as partial, not complete', () => {
    const result = report(
      facts({
        vms: [
          { vmId: 'a', vmName: 'vm-a', identityType: 'SystemAssigned', agentName: 'AzureMonitorWindowsAgent' },
          { vmId: 'b', vmName: 'vm-b', identityType: 'SystemAssigned', agentName: null }
        ]
      })
    );

    assert.equal(check(result, 'agent').state, 'PARTIAL');
    assert.equal(result.vmsWithAgent, 1);
    assert.equal(result.vmsTotal, 2);
  });

  it('calls out VMs that can never take the agent', () => {
    // These look healthy forever otherwise: no agent means no guest alerts and no failure either.
    const result = report(
      facts({ vms: [{ vmId: 'a', vmName: 'vm-a', identityType: 'None', agentName: null }] })
    );

    assert.equal(check(result, 'identity').state, 'BLOCKED_NO_IDENTITY');
    assert.equal(result.vmsBlockedNoIdentity, 1);
  });

  it('does not demand a DCR or agent from an estate with no VMs', () => {
    const result = report(facts(), ['microsoft.web/sites']);

    assert.equal(check(result, 'dcr').state, 'MONITORED');
    assert.equal(check(result, 'agent').state, 'MONITORED');
  });

  it('goes fully green once everything the catalogue wants is deployed', () => {
    const essentialForVms = report(facts()).rules.map((rule) => rule.key);

    const result = report(
      facts({
        pulseResources: [
          ...essentialForVms.map((key) => pulseRule(`pulse-rwk-${key}-uksouth`)),
          pulseRule('pulse-rwk-ag', 'microsoft.insights/actiongroups'),
          pulseRule('law-pulse-rwk', 'microsoft.operationalinsights/workspaces'),
          pulseRule('dcr-pulse-rwk', 'microsoft.insights/datacollectionrules')
        ],
        vms: [{ vmId: 'a', vmName: 'vm-a', identityType: 'SystemAssigned', agentName: 'AzureMonitorWindowsAgent' }]
      })
    );

    assert.equal(result.presentRuleCount, result.expectedRuleCount);
    for (const entry of result.checks) {
      assert.equal(entry.state, 'MONITORED', `${entry.key} should be green: ${entry.detail}`);
    }
  });
});

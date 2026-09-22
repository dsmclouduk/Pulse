import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  allRules,
  BASELINE_VERSION,
  baselineTags,
  RESOURCE_TYPES,
  resourceTypesCovered,
  ruleByKey,
  ruleResourceName,
  rulesFor,
  rulesForEstate,
  tiersUpTo
} from './baseline.js';

describe('baseline catalogue', () => {
  it('has a unique, stable key for every rule', () => {
    const keys = allRules().map((rule) => rule.key);
    assert.equal(new Set(keys).size, keys.length, 'rule keys must be unique: they become Azure resource names');
    assert.ok(keys.every((key) => /^[a-z0-9-]+$/.test(key)), 'keys must be safe in a resource name');
  });

  it('gives every rule the condition its kind requires', () => {
    for (const rule of allRules()) {
      const condition = rule.kind === 'metric' ? rule.metric : rule.kind === 'log' ? rule.log : rule.activity;
      assert.ok(condition, `${rule.key} is kind ${rule.kind} but carries no matching condition`);
    }
  });

  it('splits every log rule by resource, and by the dimension that names the thing', () => {
    for (const rule of allRules()) {
      if (rule.kind !== 'log' || !rule.log) continue;

      assert.ok(rule.log.splitBy.includes('_ResourceId'), `${rule.key} must split by _ResourceId or the alert cannot name the resource`);

      for (const dimension of rule.log.splitBy) {
        assert.ok(
          rule.log.query.includes(dimension),
          `${rule.key} splits by ${dimension} but the query never projects it`
        );
      }

      assert.ok(
        rule.log.query.includes(rule.log.metricMeasureColumn),
        `${rule.key} measures ${rule.log.metricMeasureColumn} but the query never projects it`
      );
    }
  });

  it('marks activity-log rules as never auto-resolving', () => {
    // Azure fires these once and never clears them, so presenting them as Fired/Resolved pairs lies.
    for (const rule of allRules()) {
      if (rule.kind === 'activityLog') {
        assert.equal(rule.autoMitigate, false, `${rule.key} is an activity-log rule and cannot auto-resolve`);
      } else {
        assert.equal(rule.autoMitigate, true, `${rule.key} should auto-resolve so Resolved flows into Pulse`);
      }
    }
  });

  it('requires the agent for every guest signal', () => {
    // A guest rule without the agent silently produces nothing, which looks like "all healthy".
    for (const rule of allRules()) {
      if (rule.kind === 'log' && rule.resourceType === RESOURCE_TYPES.virtualMachine) {
        assert.ok(rule.requires.includes('ama'), `${rule.key} reads guest data and must require the agent`);
        assert.ok(rule.requires.includes('workspace'), `${rule.key} queries a workspace and must require one`);
      }
    }
  });

  it('keeps thresholds meaningful rather than noisy', () => {
    // A "< 90% free" disk rule fires constantly and trains people to ignore alerts; we shipped one
    // by accident on 2026-09-15 and the agent correctly called it out.
    const osDisk = ruleByKey('vm-os-disk-free');
    assert.ok(osDisk?.log);
    assert.ok(osDisk.log.threshold <= 25, 'OS disk free threshold must represent real pressure');

    const cpu = ruleByKey('vm-cpu-high');
    assert.ok(cpu?.metric);
    assert.ok(cpu.metric.threshold >= 80, 'CPU threshold must be high enough not to flap on an idle VM');
  });

  it('treats tiers as cumulative', () => {
    assert.deepEqual(tiersUpTo('essential'), ['essential']);
    assert.deepEqual(tiersUpTo('standard'), ['essential', 'standard']);
    assert.deepEqual(tiersUpTo('full'), ['essential', 'standard', 'full']);

    const essential = rulesFor(RESOURCE_TYPES.virtualMachine, 'essential');
    const standard = rulesFor(RESOURCE_TYPES.virtualMachine, 'standard');
    assert.ok(standard.length > essential.length);
    assert.ok(essential.every((rule) => standard.some((entry) => entry.key === rule.key)));
  });

  it('matches resource types case-insensitively', () => {
    // Azure sends lower-cased ARM paths in alert payloads but canonical casing elsewhere.
    const lower = rulesFor('microsoft.compute/virtualmachines', 'essential');
    const canonical = rulesFor('Microsoft.Compute/virtualMachines', 'essential');
    assert.ok(lower.length > 0);
    assert.deepEqual(
      lower.map((rule) => rule.key),
      canonical.map((rule) => rule.key)
    );
  });

  it('covers the Essential rows of the coverage matrix', () => {
    const essentialKeys = allRules()
      .filter((rule) => rule.tier === 'essential')
      .map((rule) => rule.key);

    for (const expected of [
      'vm-unavailable',
      'vm-heartbeat-missing',
      'vm-cpu-high',
      'vm-memory-low',
      'vm-os-disk-free',
      'vm-data-disk-free',
      'app-http5xx',
      'app-health-check',
      'app-response-time',
      'plan-cpu-high',
      'plan-memory-high',
      'sql-cpu-high',
      'sql-storage-high',
      'sql-deadlocks',
      'sql-failed-connections',
      'storage-availability',
      'storage-throttling',
      'keyvault-availability',
      'keyvault-saturation',
      'service-health',
      'resource-health'
    ]) {
      assert.ok(essentialKeys.includes(expected), `Essential tier is missing ${expected}`);
    }
  });

  it('plans an estate from the resource types actually present, always including subscription rules', () => {
    const plan = rulesForEstate(['Microsoft.Compute/virtualMachines'], 'essential');
    const types = new Set(plan.map((rule) => rule.resourceType));

    assert.ok(types.has(RESOURCE_TYPES.virtualMachine));
    assert.ok(types.has(RESOURCE_TYPES.subscription), 'Service Health applies even to an estate of one type');
    assert.ok(!types.has(RESOURCE_TYPES.appService), 'no App Service rules for a client with no App Services');
  });

  it('names and tags rules so the coverage report can recognise them', () => {
    assert.equal(ruleResourceName('rwk', 'vm-cpu-high'), 'pulse-rwk-vm-cpu-high');
    assert.deepEqual(baselineTags('rwk'), {
      'pulse-managed': 'true',
      'pulse-client': 'rwk',
      'pulse-baseline': BASELINE_VERSION
    });
  });

  it('covers the resource types the baseline claims to support', () => {
    assert.deepEqual(resourceTypesCovered(), [
      'microsoft.compute/virtualmachines',
      'microsoft.containerservice/managedclusters',
      'microsoft.keyvault/vaults',
      'microsoft.sql/servers/databases',
      'microsoft.sql/servers/elasticpools',
      'microsoft.storage/storageaccounts',
      'microsoft.web/serverfarms',
      'microsoft.web/sites',
      'subscription'
    ]);
  });
});

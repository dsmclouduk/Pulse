import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INVENTORY_QUERY,
  mapResourceGraphRow,
  regionsInUse,
  summariseInventory,
  type DiscoveredResource
} from './resourceGraph.js';

function resource(overrides: Partial<DiscoveredResource> = {}): DiscoveredResource {
  return {
    resourceId: '/subscriptions/s/resourcegroups/rg/providers/microsoft.compute/virtualmachines/vm1',
    resourceIdDisplay: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1',
    name: 'vm1',
    resourceType: 'microsoft.compute/virtualmachines',
    resourceGroup: 'rg',
    subscriptionId: 's',
    location: 'uksouth',
    kind: null,
    tags: {},
    hasManagedIdentity: true,
    ...overrides
  };
}

describe('resource graph inventory', () => {
  it('asks only for metadata', () => {
    // The line Pulse does not cross: no metric values, no log rows. Those stay in Azure.
    for (const forbidden of ['InsightsMetrics', 'Perf', 'AzureMetrics', 'summarize', 'Heartbeat']) {
      assert.ok(!INVENTORY_QUERY.includes(forbidden), `inventory query must not touch ${forbidden}`);
    }

    for (const field of ['id', 'name', 'type', 'resourceGroup', 'location', 'tags']) {
      assert.ok(INVENTORY_QUERY.includes(field), `inventory query should project ${field}`);
    }
  });

  it('keeps a lower-cased key alongside the canonical id', () => {
    // Resource Graph returns canonical casing, alert payloads lower-cased. One key, or one resource
    // becomes two rows.
    const mapped = mapResourceGraphRow({
      id: '/subscriptions/S/resourceGroups/RG/providers/Microsoft.Compute/virtualMachines/VM1',
      name: 'VM1',
      type: 'Microsoft.Compute/virtualMachines',
      resourceGroup: 'RG',
      subscriptionId: 'S',
      location: 'uksouth'
    });

    assert.ok(mapped);
    assert.equal(mapped.resourceId, mapped.resourceId.toLowerCase());
    assert.equal(mapped.resourceType, 'microsoft.compute/virtualmachines');
    assert.equal(mapped.resourceIdDisplay, '/subscriptions/S/resourceGroups/RG/providers/Microsoft.Compute/virtualMachines/VM1');
  });

  it('reads managed identity so blocked VMs can be flagged', () => {
    // A VM with no identity cannot take the agent, so its guest rules stay silent forever. Better to
    // say so during onboarding than to let it look healthy.
    const withIdentity = mapResourceGraphRow({ id: '/a/providers/x/y', type: 'T', identityType: 'SystemAssigned' });
    const without = mapResourceGraphRow({ id: '/a/providers/x/y', type: 'T', identityType: 'None' });
    const unknown = mapResourceGraphRow({ id: '/a/providers/x/y', type: 'T' });

    assert.equal(withIdentity?.hasManagedIdentity, true);
    assert.equal(without?.hasManagedIdentity, false);
    assert.equal(unknown?.hasManagedIdentity, null);
  });

  it('ignores rows with no id or type', () => {
    assert.equal(mapResourceGraphRow({ name: 'orphan' }), null);
    assert.equal(mapResourceGraphRow({ id: '/a' }), null);
  });

  it('coerces tag values to strings', () => {
    const mapped = mapResourceGraphRow({
      id: '/a/providers/x/y',
      type: 'T',
      tags: { env: 'prod', cost: 42, missing: null }
    });

    assert.deepEqual(mapped?.tags, { env: 'prod', cost: '42' });
  });

  it('summarises by type, busiest first, counting VMs that cannot take the agent', () => {
    const summary = summariseInventory([
      resource(),
      resource({ resourceId: 'b', location: 'ukwest', hasManagedIdentity: false }),
      resource({ resourceId: 'c', resourceType: 'microsoft.web/sites', hasManagedIdentity: null })
    ]);

    assert.equal(summary[0].resourceType, 'microsoft.compute/virtualmachines');
    assert.equal(summary[0].count, 2);
    assert.deepEqual(summary[0].regions, ['uksouth', 'ukwest']);
    assert.equal(summary[0].withoutManagedIdentity, 1);
    assert.equal(summary[0].agentCapable, true);
  });

  it('only counts a missing identity where the agent actually runs', () => {
    // A network interface has no managed identity and never needs one; counting it as a blocker
    // buries the VMs that genuinely cannot be monitored.
    const summary = summariseInventory([
      resource({ resourceType: 'microsoft.network/networkinterfaces', hasManagedIdentity: false }),
      resource({ resourceId: 'b', resourceType: 'microsoft.compute/virtualmachines', hasManagedIdentity: false })
    ]);

    const nic = summary.find((row) => row.resourceType === 'microsoft.network/networkinterfaces');
    const vm = summary.find((row) => row.resourceType === 'microsoft.compute/virtualmachines');

    assert.equal(nic?.withoutManagedIdentity, 0);
    assert.equal(nic?.agentCapable, false);
    assert.equal(vm?.withoutManagedIdentity, 1);
  });

  it('lists the regions the generator needs for multi-resource rules', () => {
    const regions = regionsInUse([resource(), resource({ resourceId: 'b', location: 'ukwest' }), resource({ resourceId: 'c', location: null })]);
    assert.deepEqual(regions, ['uksouth', 'ukwest']);
  });
});

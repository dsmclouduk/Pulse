import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DiscoveredSubscription } from '../../../../shared/types.js';
import { slugify, suggestClientName, suggestMonitoringHome } from './subscriptionDiscovery.js';

function subscription(displayName: string, subscriptionId = displayName): DiscoveredSubscription {
  return {
    subscriptionId,
    displayName,
    state: 'Enabled',
    tenantId: 't',
    isDelegated: true,
    managedByTenantIds: []
  };
}

describe('subscription discovery helpers', () => {
  it('suggests a client name from the naming convention', () => {
    assert.equal(suggestClientName('RWK - Landing Zone - AVD - CSP'), 'RWK');
    assert.equal(suggestClientName('Tardis - Platform - Connectivity - CSP'), 'Tardis');
    assert.equal(suggestClientName('Pay-As-You-Go'), undefined, 'a name with no separator is not a client prefix');
  });

  it('prefers a management subscription to hold the shared monitoring resources', () => {
    // Scattering the workspace, DCRs and action group across a client estate is tidy-up nobody wants.
    const subscriptions = [
      subscription('RWK - Landing Zone - AVD - CSP'),
      subscription('RWK - Platform - Management - CSP'),
      subscription('RWK - Platform - Connectivity - CSP')
    ];

    assert.equal(suggestMonitoringHome(subscriptions), 'RWK - Platform - Management - CSP');
  });

  it('falls back through platform, then core, then the first subscription', () => {
    assert.equal(
      suggestMonitoringHome([subscription('Client - Apps - Prod'), subscription('Client - Platform - Connectivity')]),
      'Client - Platform - Connectivity'
    );
    assert.equal(suggestMonitoringHome([subscription('Only one')]), 'Only one');
    assert.equal(suggestMonitoringHome([]), undefined);
  });

  it('slugifies a client name safely for urls and resource names', () => {
    assert.equal(slugify('RWK Goodman'), 'rwk-goodman');
    assert.equal(slugify('  Tardis & Co.  '), 'tardis-co');
  });
});

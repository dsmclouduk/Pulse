import { Router } from 'express';

import type { SubscriptionDiscoveryResult } from '../../../shared/types.js';
import { isAzureMetricsConfigured } from '../lib/azureAuth.js';
import {
  allRules,
  BASELINE_VERSION,
  resourceTypesCovered,
  rulesForEstate,
  tiersUpTo,
  type BaselineTier
} from '../lib/onboarding/baseline.js';
import { listDiscoveredSubscriptions } from '../lib/onboarding/subscriptionDiscovery.js';

/**
 * Onboarding is read-only. Pulse discovers what its identity can reach and generates the deployment
 * an engineer applies; it never writes to a client tenant.
 */
export const onboardingRouter = Router();

function parseTier(value: unknown): BaselineTier {
  return value === 'standard' || value === 'full' ? value : 'essential';
}

/**
 * The alert catalogue. Identical for every client at a given tier; client variation is an override
 * applied on top, never a forked catalogue. `resourceTypes` narrows it to an estate, which is how
 * the Plan step avoids offering App Service rules to a client with no App Services.
 */
onboardingRouter.get('/baseline', (request, response) => {
  const tier = parseTier(request.query.tier);
  const requested = typeof request.query.resourceTypes === 'string' ? request.query.resourceTypes : '';
  const resourceTypes = requested
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean);

  // Tiers are cumulative, so an unscoped request returns everything up to the tier, not just its own.
  const tiers = new Set(tiersUpTo(tier));
  const rules = resourceTypes.length > 0 ? rulesForEstate(resourceTypes, tier) : allRules().filter((rule) => tiers.has(rule.tier));

  response.json({
    version: BASELINE_VERSION,
    tier,
    resourceTypesCovered: resourceTypesCovered(),
    scopedTo: resourceTypes.length > 0 ? resourceTypes : null,
    ruleCount: rules.length,
    rules
  });
});

onboardingRouter.get('/subscriptions', async (_request, response) => {
  if (!isAzureMetricsConfigured()) {
    const result: SubscriptionDiscoveryResult = {
      credentialsConfigured: false,
      subscriptions: [],
      message: 'Azure credentials are not configured, so Pulse cannot see any subscriptions yet.'
    };

    response.json(result);
    return;
  }

  try {
    const subscriptions = await listDiscoveredSubscriptions();
    const delegated = subscriptions.filter((subscription) => subscription.isDelegated).length;

    const result: SubscriptionDiscoveryResult = {
      credentialsConfigured: true,
      homeTenantId: process.env.AZURE_TENANT_ID,
      subscriptions,
      message:
        delegated === 0
          ? 'Only the home tenant is visible. Client subscriptions appear once Pulse is authorised in their Lighthouse delegation (docs/onboarding/LIGHTHOUSE.md).'
          : undefined
    };

    console.log(`[${new Date().toISOString()}] [onboarding] discovered ${subscriptions.length} subscription(s), ${delegated} delegated`);
    response.json(result);
  } catch (error) {
    response.status(502).json({
      error: `Could not list subscriptions: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

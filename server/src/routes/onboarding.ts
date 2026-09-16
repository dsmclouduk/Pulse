import { Router } from 'express';

import type { SubscriptionDiscoveryResult } from '../../../shared/types.js';
import { isAzureMetricsConfigured } from '../lib/azureAuth.js';
import { listDiscoveredSubscriptions } from '../lib/onboarding/subscriptionDiscovery.js';

/**
 * Onboarding is read-only. Pulse discovers what its identity can reach and generates the deployment
 * an engineer applies; it never writes to a client tenant.
 */
export const onboardingRouter = Router();

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

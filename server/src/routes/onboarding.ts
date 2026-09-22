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
import { generateBaselineDeployment, type BaselinePlanInput } from '../lib/onboarding/bicepGenerator.js';
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

/**
 * Generates the per-client deployment. Pulse never applies it: the response is files and two
 * commands for an engineer to run with a write-capable account. The webhook token is deliberately
 * absent, so nothing sensitive passes through here.
 */
onboardingRouter.post('/plan', (request, response) => {
  const body = request.body as Partial<BaselinePlanInput> | undefined;

  const missing = (['clientSlug', 'subscriptionId', 'location'] as const).filter((field) => !body?.[field]);

  if (!body || missing.length > 0) {
    response.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}.` });
    return;
  }

  const input: BaselinePlanInput = {
    clientSlug: body.clientSlug ?? '',
    clientName: body.clientName ?? body.clientSlug ?? '',
    subscriptionId: body.subscriptionId ?? '',
    tier: parseTier(body.tier),
    resourceGroup: body.resourceGroup ?? 'rg-pulse-monitoring',
    location: body.location ?? '',
    regions: body.regions?.length ? body.regions : [body.location ?? ''],
    resourceTypes: body.resourceTypes ?? [],
    perResourceTargets: body.perResourceTargets,
    workspaceName: body.workspaceName,
    pulseBaseUrl: body.pulseBaseUrl ?? process.env.APP_SERVICE_URL ?? '',
    deployAgentPolicy: body.deployAgentPolicy
  };

  const deployment = generateBaselineDeployment(input);

  console.log(
    `[${new Date().toISOString()}] [onboarding] generated baseline for ${input.clientSlug}: ${deployment.rules.length} rule(s), ${deployment.warnings.length} warning(s)`
  );

  response.json({
    version: BASELINE_VERSION,
    tier: input.tier,
    ruleCount: deployment.rules.length,
    rules: deployment.rules.map((rule) => ({
      key: rule.key,
      title: rule.title,
      resourceType: rule.resourceType,
      kind: rule.kind,
      scope: rule.scope,
      severity: rule.severity
    })),
    files: deployment.files,
    whatIfCommand: deployment.whatIfCommand,
    deployCommand: deployment.deployCommand,
    warnings: deployment.warnings
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

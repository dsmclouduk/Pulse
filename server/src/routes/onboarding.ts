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
import { buildCoverageReport, queryCoverageFacts } from '../lib/onboarding/coverageReport.js';
import { lastInventoryRun, listInventory, saveInventory } from '../lib/onboarding/inventoryRepository.js';
import { queryInventory, regionsInUse, summariseInventory, type DiscoveredResource } from '../lib/onboarding/resourceGraph.js';
import { prisma } from '../lib/prisma.js';
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

async function resolveClient(clientSlug: string | undefined) {
  if (!clientSlug || !process.env.DATABASE_URL) {
    return null;
  }

  return prisma.clientAccount.findUnique({
    where: { slug: clientSlug },
    select: { id: true, name: true, slug: true, azureSubscriptions: { select: { externalSubscriptionId: true } } }
  });
}

function toDiscovered(rows: Awaited<ReturnType<typeof listInventory>>): DiscoveredResource[] {
  return rows.map((row) => ({
    resourceId: row.resourceId.toLowerCase(),
    resourceIdDisplay: row.resourceId,
    name: row.name,
    resourceType: row.resourceType,
    resourceGroup: row.resourceGroup,
    subscriptionId: '',
    location: row.region,
    kind: null,
    tags: row.tags,
    hasManagedIdentity: row.hasManagedIdentity
  }));
}

/** What Pulse currently holds for a client. Reads the stored inventory; never calls Azure. */
onboardingRouter.get('/inventory', async (request, response) => {
  const clientSlug = typeof request.query.clientSlug === 'string' ? request.query.clientSlug : undefined;
  const client = await resolveClient(clientSlug);

  if (!client) {
    response.status(404).json({ error: `No client account for slug "${clientSlug ?? ''}".` });
    return;
  }

  const resources = await listInventory(client.id);
  const discovered = toDiscovered(resources);

  response.json({
    clientSlug: client.slug,
    clientName: client.name,
    lastRunAt: await lastInventoryRun(client.id),
    subscriptionCount: client.azureSubscriptions.length,
    resourceCount: resources.length,
    regions: regionsInUse(discovered),
    byType: summariseInventory(discovered),
    resources
  });
});

/** Refreshes the inventory from Resource Graph. Read-only against Azure; writes only metadata. */
onboardingRouter.post('/inventory/refresh', async (request, response) => {
  const body = request.body as { clientSlug?: string } | undefined;
  const client = await resolveClient(body?.clientSlug);

  if (!client) {
    response.status(404).json({ error: `No client account for slug "${body?.clientSlug ?? ''}".` });
    return;
  }

  const subscriptionIds = client.azureSubscriptions.map((subscription) => subscription.externalSubscriptionId);

  if (subscriptionIds.length === 0) {
    response.status(400).json({
      error: `${client.name} has no subscriptions assigned yet. Assign one on the Access step first.`
    });
    return;
  }

  try {
    const { resources, truncated } = await queryInventory(subscriptionIds);
    const written = await saveInventory(client.id, subscriptionIds, resources);

    console.log(
      `[${new Date().toISOString()}] [onboarding] inventory ${client.slug}: ${resources.length} resource(s) across ${subscriptionIds.length} subscription(s), ${written.created} new, ${written.stale} stale`
    );

    response.json({
      clientSlug: client.slug,
      resourceCount: resources.length,
      regions: regionsInUse(resources),
      byType: summariseInventory(resources),
      written,
      truncated
    });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * Reads back what monitoring exists in Azure, so the plan can show a diff rather than assume a clean
 * slate. Read-only, and it trusts Azure over Pulse's own records: the point is to catch the case
 * where they disagree.
 */
onboardingRouter.get('/coverage', async (request, response) => {
  const clientSlug = typeof request.query.clientSlug === 'string' ? request.query.clientSlug : undefined;
  const client = await resolveClient(clientSlug);

  if (!client) {
    response.status(404).json({ error: `No client account for slug "${clientSlug ?? ''}".` });
    return;
  }

  const subscriptionIds = client.azureSubscriptions.map((subscription) => subscription.externalSubscriptionId);

  if (subscriptionIds.length === 0) {
    response.status(400).json({ error: `${client.name} has no subscriptions assigned yet.` });
    return;
  }

  try {
    // The tier decides what "complete" means, and the inventory decides which sections apply.
    const stored = await listInventory(client.id);
    const resourceTypes = [...new Set(stored.map((row) => row.resourceType))];

    const facts = await queryCoverageFacts(subscriptionIds);
    const report = buildCoverageReport(facts, {
      clientSlug: client.slug,
      tier: parseTier(request.query.tier),
      resourceTypes,
      pulseBaseUrl: process.env.APP_SERVICE_URL
    });

    console.log(
      `[${new Date().toISOString()}] [onboarding] coverage ${client.slug}: ${report.presentRuleCount}/${report.expectedRuleCount} rules, ${report.vmsWithAgent}/${report.vmsTotal} agents`
    );

    response.json({ ...report, clientName: client.name, inventoryRun: stored.length > 0 });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
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

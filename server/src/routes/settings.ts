import { Router } from 'express';

import type { SettingsSummary } from '../../../shared/types.js';
import { isAzureMetricsConfigured, isLogAnalyticsConfigured } from '../lib/azureAuth.js';
import { getEnrichmentConfig } from '../lib/enrichment/enrichmentConfig.js';

/**
 * Read-only view of the effective configuration. Values come from environment variables today;
 * editing them in the UI (with secrets in Key Vault) is tracked in the Alerter v1 milestone.
 * Secrets are never returned, only whether they are set.
 */
export const settingsRouter = Router();

settingsRouter.get('/summary', (_request, response) => {
  const enrichment = getEnrichmentConfig();

  const summary: SettingsSummary = {
    generatedAt: new Date().toISOString(),
    source: 'environment',
    agent: {
      provider: enrichment.agentProvider,
      effectiveProvider: enrichment.agentProvider === 'rule-based' ? 'rule-based' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'rule-based',
      model: enrichment.agentModel,
      apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      timeoutMs: enrichment.agentTimeoutMs
    },
    enrichment: {
      enabled: enrichment.enabled,
      timeoutMs: enrichment.timeoutMs,
      cooldownMs: enrichment.cooldownMs,
      onResolved: enrichment.onResolved,
      historyDays: enrichment.historyDays
    },
    azure: {
      credentialsConfigured: isAzureMetricsConfigured(),
      tenantId: process.env.AZURE_TENANT_ID ? `${process.env.AZURE_TENANT_ID.slice(0, 8)}…` : null,
      logAnalyticsConfigured: isLogAnalyticsConfigured(),
      logAnalyticsWorkspaceId: process.env.LOG_ANALYTICS_WORKSPACE_ID ? `${process.env.LOG_ANALYTICS_WORKSPACE_ID.slice(0, 8)}…` : null
    },
    ingest: {
      globalWebhookSecretConfigured: Boolean(process.env.WEBHOOK_SECRET),
      simulateEnabled: process.env.NODE_ENV !== 'production',
      publicBaseUrl: process.env.APP_SERVICE_URL ?? null
    },
    persistence: {
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      mode: process.env.DATABASE_URL ? 'prisma' : 'memory'
    }
  };

  response.json(summary);
});

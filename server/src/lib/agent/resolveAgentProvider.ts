import { getEnrichmentConfig } from '../enrichment/enrichmentConfig.js';
import type { AgentProvider } from './agentProvider.js';
import { anthropicProvider } from './anthropicProvider.js';
import { ruleBasedProvider } from './ruleBasedProvider.js';

export interface ResolvedAgentProviders {
  primary: AgentProvider;
  fallback: AgentProvider;
}

/**
 * PULSE_AGENT_PROVIDER=auto picks Anthropic when a key is present, otherwise the rule-based
 * provider. The rule-based provider is always the fallback so a diagnosis is produced even
 * when the LLM call fails.
 */
export function resolveAgentProvider(): ResolvedAgentProviders {
  const config = getEnrichmentConfig();

  if (config.agentProvider === 'rule-based') {
    return { primary: ruleBasedProvider, fallback: ruleBasedProvider };
  }

  if (config.agentProvider === 'anthropic' || anthropicProvider.isConfigured()) {
    return { primary: anthropicProvider, fallback: ruleBasedProvider };
  }

  return { primary: ruleBasedProvider, fallback: ruleBasedProvider };
}

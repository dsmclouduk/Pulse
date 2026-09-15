export type AgentProviderName = 'auto' | 'anthropic' | 'rule-based';

export interface EnrichmentConfig {
  enabled: boolean;
  /** Whole-pipeline timeout: history fetch + analysis + agent. */
  timeoutMs: number;
  /** Minimum gap between automatic enrichments of the same real alert. */
  cooldownMs: number;
  onResolved: 'note' | 'skip';
  historyDays: number;
  agentProvider: AgentProviderName;
  agentModel: string;
  agentTimeoutMs: number;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();

  if (raw === undefined || raw === '') {
    return fallback;
  }

  return !['0', 'false', 'no', 'off'].includes(raw);
}

export function getEnrichmentConfig(): EnrichmentConfig {
  const provider = process.env.PULSE_AGENT_PROVIDER?.trim().toLowerCase();
  const onResolved = process.env.PULSE_ENRICHMENT_ON_RESOLVED?.trim().toLowerCase();

  return {
    enabled: readBoolean('PULSE_ENRICHMENT_ENABLED', true),
    timeoutMs: readNumber('PULSE_ENRICHMENT_TIMEOUT_MS', 60_000),
    cooldownMs: readNumber('PULSE_ENRICHMENT_COOLDOWN_MS', 15 * 60_000),
    onResolved: onResolved === 'skip' ? 'skip' : 'note',
    historyDays: readNumber('PULSE_HISTORY_DAYS', 90),
    agentProvider: provider === 'anthropic' || provider === 'rule-based' ? provider : 'auto',
    agentModel: process.env.PULSE_AGENT_MODEL?.trim() || 'claude-opus-5',
    agentTimeoutMs: readNumber('PULSE_AGENT_TIMEOUT_MS', 30_000)
  };
}

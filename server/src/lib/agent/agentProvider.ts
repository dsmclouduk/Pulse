import type { AlertEvent, DiagnosisUrgency, MetricHistoryResult, TrendAnalysis } from '../../../../shared/types.js';

export interface AgentInput {
  alert: AlertEvent;
  trend: TrendAnalysis | null;
  history: MetricHistoryResult[];
}

export interface AgentDiagnosis {
  /** One or two sentences, at most 300 characters. */
  summary: string;
  urgency: DiagnosisUrgency;
  /** At most 800 characters. */
  reasoning: string;
  /** At most five items. */
  recommendedActions: string[];
  /** 0..1 */
  confidence: number;
  provider: string;
  model?: string;
  isFallback: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface DiagnoseOptions {
  signal: AbortSignal;
}

export interface AgentProvider {
  readonly name: 'anthropic' | 'rule-based' | 'azure-openai';
  isConfigured(): boolean;
  diagnose(input: AgentInput, options: DiagnoseOptions): Promise<AgentDiagnosis>;
}

export class AgentOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentOutputError';
  }
}

export const URGENCY_VALUES: readonly DiagnosisUrgency[] = ['immediate', 'soon', 'planned', 'informational'];

export function isDiagnosisUrgency(value: unknown): value is DiagnosisUrgency {
  return typeof value === 'string' && (URGENCY_VALUES as readonly string[]).includes(value);
}

export function clampDiagnosis(diagnosis: AgentDiagnosis): AgentDiagnosis {
  return {
    ...diagnosis,
    summary: diagnosis.summary.trim().slice(0, 300),
    reasoning: diagnosis.reasoning.trim().slice(0, 800),
    recommendedActions: diagnosis.recommendedActions
      .map((action) => action.trim())
      .filter(Boolean)
      .slice(0, 5)
      .map((action) => action.slice(0, 200)),
    confidence: Math.min(1, Math.max(0, Number.isFinite(diagnosis.confidence) ? diagnosis.confidence : 0.5))
  };
}

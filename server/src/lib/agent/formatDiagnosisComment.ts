import type { AlertEvent, TrendAnalysis } from '../../../../shared/types.js';
import type { AgentDiagnosis } from './agentProvider.js';

const MAX_BODY_BYTES = 6 * 1024;

/**
 * Renders a diagnosis as markdown using a fixed template so LLM and rule-based comments
 * look identical. Trend numbers always come from our own analysis, never from the model.
 */
export function renderDiagnosisMarkdown(diagnosis: AgentDiagnosis, trend: TrendAnalysis | null, _alert: AlertEvent): string {
  const lines: string[] = [];

  lines.push(`**Urgency: ${diagnosis.urgency.toUpperCase()}**`);
  lines.push('');
  lines.push(diagnosis.summary);

  if (trend && trend.notes.length > 0) {
    lines.push('');
    lines.push('**Trend**');

    for (const note of trend.notes) {
      lines.push(`- ${note}`);
    }
  }

  if (diagnosis.reasoning) {
    lines.push('');
    lines.push('**Reasoning**');
    lines.push('');
    lines.push(diagnosis.reasoning);
  }

  if (diagnosis.recommendedActions.length > 0) {
    lines.push('');
    lines.push('**Recommended actions**');

    diagnosis.recommendedActions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action}`);
    });
  }

  lines.push('');

  if (diagnosis.isFallback) {
    lines.push('_Rule-based diagnosis, no LLM configured (set ANTHROPIC_API_KEY to enable the agent)._');
  } else {
    const model = diagnosis.model ? ` (${diagnosis.model})` : '';
    lines.push(`_Diagnosis by Pulse Agent via ${providerLabel(diagnosis.provider)}${model}, confidence ${Math.round(diagnosis.confidence * 100)}%._`);
  }

  let body = lines.join('\n');

  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    body = `${body.slice(0, MAX_BODY_BYTES - 20)}\n\n_…truncated_`;
  }

  return body;
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'Claude';
    case 'azure-openai':
      return 'Azure OpenAI';
    default:
      return provider;
  }
}

export function agentAuthorName(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'Pulse Agent (Claude)';
    case 'azure-openai':
      return 'Pulse Agent (Azure OpenAI)';
    case 'rule-based':
      return 'Pulse Agent (rules)';
    default:
      return 'Pulse Agent';
  }
}

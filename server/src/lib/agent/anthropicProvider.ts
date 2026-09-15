import Anthropic from '@anthropic-ai/sdk';

import { getEnrichmentConfig } from '../enrichment/enrichmentConfig.js';
import type { AgentDiagnosis, AgentInput, AgentProvider, DiagnoseOptions } from './agentProvider.js';
import { AgentOutputError, clampDiagnosis } from './agentProvider.js';
import { buildDiagnosisPrompt, DIAGNOSIS_OUTPUT_SCHEMA, isAgentDiagnosisShape } from './promptBuilder.js';

let client: Anthropic | null = null;
let disabledReason: string | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: getEnrichmentConfig().agentTimeoutMs,
      maxRetries: 1
    });
  }

  return client;
}

function logAgent(message: string): void {
  console.log(`[${new Date().toISOString()}] [agent] ${message}`);
}

export const anthropicProvider: AgentProvider = {
  name: 'anthropic',
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY) && disabledReason === null,
  diagnose: async (input: AgentInput, options: DiagnoseOptions): Promise<AgentDiagnosis> => {
    if (disabledReason) {
      throw new Error(`Anthropic provider disabled: ${disabledReason}`);
    }

    const config = getEnrichmentConfig();
    const prompt = buildDiagnosisPrompt(input);
    const startedAt = Date.now();

    try {
      const response = await getClient().messages.create(
        {
          model: config.agentModel,
          max_tokens: 2048,
          system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: prompt.user }],
          output_config: {
            effort: 'low',
            format: { type: 'json_schema', schema: DIAGNOSIS_OUTPUT_SCHEMA }
          }
        },
        { signal: options.signal }
      );

      if (response.stop_reason === 'refusal') {
        throw new AgentOutputError(
          `Model declined to answer${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ''}`
        );
      }

      if (response.stop_reason === 'max_tokens') {
        throw new AgentOutputError('Model output was truncated (max_tokens).');
      }

      const textBlock = response.content.find((block) => block.type === 'text');

      if (!textBlock || textBlock.type !== 'text') {
        throw new AgentOutputError('Model returned no text block.');
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(textBlock.text);
      } catch {
        throw new AgentOutputError('Model output was not valid JSON.');
      }

      if (!isAgentDiagnosisShape(parsed)) {
        throw new AgentOutputError('Model output did not match the diagnosis schema.');
      }

      const durationMs = Date.now() - startedAt;
      logAgent(
        `diagnosis ok alert=${input.alert.id} model=${response.model} in=${response.usage.input_tokens} out=${response.usage.output_tokens} cacheRead=${response.usage.cache_read_input_tokens ?? 0} ${durationMs}ms`
      );

      return clampDiagnosis({
        ...parsed,
        provider: 'anthropic',
        model: response.model,
        isFallback: false,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
      });
    } catch (error) {
      // Most specific first. The API key is never logged.
      if (error instanceof Anthropic.AuthenticationError) {
        disabledReason = 'authentication failed (check ANTHROPIC_API_KEY)';
        logAgent(`Anthropic authentication failed; provider disabled for this process.`);
        throw new Error('Anthropic authentication failed.');
      }

      if (error instanceof Anthropic.RateLimitError) {
        logAgent(`Anthropic rate limited alert=${input.alert.id}`);
        throw new Error('Anthropic rate limit reached.');
      }

      if (error instanceof Anthropic.APIError) {
        logAgent(`Anthropic API error ${error.status ?? ''} alert=${input.alert.id}: ${error.message}`);
        throw new Error(`Anthropic API error${error.status ? ` ${error.status}` : ''}.`);
      }

      if (error instanceof Anthropic.APIConnectionError) {
        logAgent(`Anthropic connection error alert=${input.alert.id}: ${error.message}`);
        throw new Error('Could not reach the Anthropic API.');
      }

      throw error;
    }
  }
};

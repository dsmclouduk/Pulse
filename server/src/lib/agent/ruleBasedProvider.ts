import { formatMetricDelta, formatMetricValue, formatSpan } from '../analysis/formatMetricValue.js';
import type { AgentDiagnosis, AgentInput, AgentProvider } from './agentProvider.js';
import { clampDiagnosis } from './agentProvider.js';

function resourceName(resourceId: string | undefined): string {
  if (!resourceId) {
    return 'The resource';
  }

  const parts = resourceId.split('/').filter(Boolean);
  return parts.at(-1) ?? resourceId;
}

function buildDiagnosis(input: AgentInput): Omit<AgentDiagnosis, 'provider' | 'isFallback' | 'model'> {
  const { alert, trend } = input;
  const name = resourceName(alert.resourceIds[0]);
  const metric = alert.metricName ?? trend?.metricName ?? 'the metric';
  const historyFailure = input.history.find((result) => result.status === 'error' || result.status === 'unavailable');

  if (!trend || trend.pattern === 'insufficient-data') {
    const reason = historyFailure?.message ?? 'no usable metric history was returned';
    const value = alert.metricValue !== undefined ? ` at ${alert.metricValue}` : '';
    const threshold = alert.threshold !== undefined ? ` against a threshold of ${alert.threshold}` : '';

    return {
      summary: `${name} raised "${alert.ruleName}" (${alert.severity}) on ${metric}${value}${threshold}. No metric history was available, so the trend could not be assessed.`,
      urgency: alert.severity === 'Sev0' || alert.severity === 'Sev1' ? 'soon' : 'planned',
      reasoning: `Diagnosis is based on alert fields only because ${reason}. Treat the alert severity as the primary signal until history can be collected.`,
      recommendedActions: [
        'Check the resource directly for the current value and any obvious cause.',
        'Confirm the monitoring data source (Log Analytics / Azure Monitor) is connected so future alerts get trend context.'
      ],
      confidence: 0.3
    };
  }

  const unit = trend.unit;
  const last = formatMetricValue(trend.last, unit);

  switch (trend.pattern) {
    case 'rapid-fill': {
      const delta = trend.delta6h ?? trend.delta24h ?? 0;
      const window = trend.delta6h !== null ? '6 hours' : '24 hours';
      const previous = formatMetricValue(trend.last - delta, unit);

      return {
        summary: `${name}: ${metric} increased by ${formatMetricDelta(delta, unit)} in the last ${window}, from ${previous} to ${last}. This is not organic growth and needs immediate investigation.`,
        urgency: 'immediate',
        reasoning: `Before the jump the metric was ${trend.slopePerDay < 0.1 ? 'essentially flat' : 'growing slowly'}, moving about ${formatMetricDelta(trend.slopePerDay, unit)} a day over ${formatSpan(trend.spanDays)}. A change of this size in a few hours points to a runaway process, log or dump file, failed backup cleanup, or a bulk copy rather than steady usage.${trend.recentProjectedDaysToCeiling !== null ? ` At the current rate it reaches its limit in about ${formatSpan(trend.recentProjectedDaysToCeiling)}.` : ''}`,
        recommendedActions: [
          'Identify what is consuming space right now (largest recently modified files, temp/log directories, database dumps).',
          'Stop or throttle the offending process before the resource hits 100%.',
          'Free space or extend the disk as a stop-gap, then add a guardrail alert at a lower threshold.'
        ],
        confidence: 0.7
      };
    }

    case 'steady-growth': {
      const projection =
        trend.projectedDaysToCeiling !== null && trend.projectedCeilingDate && trend.ceiling !== null
          ? ` At this rate it reaches ${formatMetricValue(trend.ceiling, unit)} in about ${formatSpan(trend.projectedDaysToCeiling)} (${trend.projectedCeilingDate.slice(0, 10)}).`
          : '';
      const urgency = trend.suggestedUrgency;
      const tone =
        urgency === 'immediate'
          ? 'Capacity will be exhausted within the week; act now.'
          : urgency === 'soon'
            ? 'Not an emergency, but schedule the expansion in the next couple of weeks.'
            : 'Not urgent; plan the expansion in the normal change window.';

      return {
        summary: `${name}: ${metric} has grown steadily by about ${formatMetricDelta(trend.slopePerDay, unit)} a day for ${formatSpan(trend.spanDays)} and is now at ${last}, crossing the alert threshold through normal growth.${projection}`,
        urgency,
        reasoning: `Growth has been consistent rather than sudden: the trend line explains ${Math.round(trend.rSquared * 100)}% of the movement, and the last 24 hours added ${formatMetricDelta(trend.delta24h ?? 0, unit)}, in line with the longer-term rate. ${tone}`,
        recommendedActions: [
          'Schedule a capacity increase (resize disk / add storage) sized for at least 6 months at the current growth rate.',
          'Review retention and archiving policies to slow the growth.',
          'Raise the alert threshold or add a forecast-based alert so the next warning arrives earlier.'
        ],
        confidence: 0.75
      };
    }

    case 'declining':
      return {
        summary: `${name}: ${metric} is at ${last} but has been falling by about ${formatMetricDelta(trend.slopePerDay, unit)} a day over ${formatSpan(trend.spanDays)}. The alert likely reflects a temporary spike or an already-resolved condition.`,
        urgency: 'informational',
        reasoning: 'The long-term trend is downward, so capacity pressure is easing rather than building. Verify the current value and confirm whether the alert has already cleared.',
        recommendedActions: ['Confirm the current value on the resource.', 'If the alert has cleared, no action is needed beyond noting the spike.'],
        confidence: 0.6
      };

    case 'volatile':
      return {
        summary: `${name}: ${metric} is at ${last} with a highly variable history and no clear trend. The threshold breach may be one of many oscillations.`,
        urgency: trend.suggestedUrgency,
        reasoning: `Readings swing widely and no trend line fits them, which usually indicates periodic jobs, cache churn or temp files being created and removed. The risk is that a normal peak coincides with a shrinking baseline.`,
        recommendedActions: [
          'Correlate peaks with scheduled jobs (backups, ETL, log rotation).',
          'Add headroom or move the periodic workload to a separate volume.',
          'Consider alerting on a smoothed average rather than the raw value.'
        ],
        confidence: 0.55
      };

    case 'flat':
    default: {
      const nearLimit = trend.suggestedUrgency === 'soon';

      return {
        summary: `${name}: ${metric} has been stable around ${formatMetricValue(trend.mean, unit)} for ${formatSpan(trend.spanDays)} and is now at ${last}. ${nearLimit ? 'It sits right at the threshold with little headroom.' : 'The breach is marginal rather than a growth problem.'}`,
        urgency: trend.suggestedUrgency,
        reasoning: `There is no meaningful growth trend: the metric moves less than ${formatMetricDelta(Math.max(Math.abs(trend.slopePerDay), 0.01), unit)} a day. ${nearLimit ? 'A flat metric this close to the limit will keep flapping the alert until headroom is added.' : 'Either the threshold is set too tight or a small one-off change pushed it over.'}`,
        recommendedActions: nearLimit
          ? ['Add headroom (extend the disk or clear reclaimable space) to stop the alert flapping.', 'Review whether the threshold matches the actual risk for this resource.']
          : ['Verify the threshold is appropriate for this resource.', 'Check for a recent one-off change that nudged the value over the line.'],
        confidence: 0.6
      };
    }
  }
}

/** Appends recurrence and prior-resolution facts from earlier alerts; escalates urgency when the problem keeps returning. */
function applyPriorContext(diagnosis: Omit<AgentDiagnosis, 'provider' | 'isFallback' | 'model'>, input: AgentInput) {
  const prior = input.prior;

  if (!prior || (prior.sameResource.length === 0 && prior.similar.length === 0)) {
    return diagnosis;
  }

  const sentences: string[] = [];
  const actions = [...diagnosis.recommendedActions];
  let urgency = diagnosis.urgency;

  if (prior.sameResourceCount30d >= 2) {
    sentences.push(`This resource has alerted ${prior.sameResourceCount30d} times in the last 30 days, so the underlying cause has not been addressed.`);
    if (urgency === 'planned') urgency = 'soon';
    else if (urgency === 'soon') urgency = 'immediate';
  }

  const withResolution = [...prior.sameResource, ...prior.similar].find((entry) => entry.notes.length > 0);

  if (withResolution) {
    const where = prior.sameResource.includes(withResolution) ? 'on this resource' : `on ${withResolution.resourceName}${withResolution.clientSlug ? ` (client ${withResolution.clientSlug})` : ''}`;
    sentences.push(`This happened previously ${where} in alert "${withResolution.ruleName}" (${withResolution.firedAt.slice(0, 10)}); the noted resolution was: "${withResolution.notes[0]}".`);
    actions.unshift(`Check whether the previous resolution still applies: ${withResolution.notes[0]}`);
  } else {
    const withDiagnosis = prior.sameResource.find((entry) => entry.diagnosisSummary);
    if (withDiagnosis) {
      sentences.push(`The previous diagnosis on this resource (${withDiagnosis.firedAt.slice(0, 10)}) was: ${withDiagnosis.diagnosisSummary}`);
    }
  }

  if (sentences.length === 0) {
    return diagnosis;
  }

  return {
    ...diagnosis,
    urgency,
    reasoning: `${diagnosis.reasoning} ${sentences.join(' ')}`,
    recommendedActions: actions
  };
}

export const ruleBasedProvider: AgentProvider = {
  name: 'rule-based',
  isConfigured: () => true,
  diagnose: async (input) =>
    clampDiagnosis({
      ...applyPriorContext(buildDiagnosis(input), input),
      provider: 'rule-based',
      isFallback: true
    })
};

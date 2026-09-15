import type { AgentDiagnosis, AgentInput, AgentProvider } from './agentProvider.js';
import { clampDiagnosis } from './agentProvider.js';

function resourceName(resourceId: string | undefined): string {
  if (!resourceId) {
    return 'The resource';
  }

  const parts = resourceId.split('/').filter(Boolean);
  return parts.at(-1) ?? resourceId;
}

function unitSuffix(unit: string): string {
  return unit === 'Percent' ? '%' : ` ${unit}`;
}

function formatDays(days: number): string {
  if (days < 1) {
    return `${Math.max(1, Math.round(days * 24))} hours`;
  }

  return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`;
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

  const suffix = unitSuffix(trend.unit);
  const last = `${trend.last}${suffix}`;

  switch (trend.pattern) {
    case 'rapid-fill': {
      const delta = trend.delta6h ?? trend.delta24h ?? 0;
      const window = trend.delta6h !== null ? '6 hours' : '24 hours';
      const previous = Math.round((trend.last - delta) * 10) / 10;

      return {
        summary: `${name}: ${metric} jumped ${Math.round(delta * 10) / 10}${suffix === '%' ? ' pts' : suffix} in the last ${window} (from ${previous}${suffix} to ${last}). This is not organic growth and needs immediate investigation.`,
        urgency: 'immediate',
        reasoning: `Before the jump the metric was ${trend.pattern === 'rapid-fill' && trend.slopePerDay < 0.1 ? 'essentially flat' : 'growing slowly'} (${trend.slopePerDay}/day over ${Math.round(trend.spanDays)} days). A change of this size in a few hours points to a runaway process, log or dump file, failed backup cleanup, or a bulk copy rather than steady usage.${trend.recentProjectedDaysToCeiling !== null ? ` At the current rate the resource reaches its limit in about ${formatDays(trend.recentProjectedDaysToCeiling)}.` : ''}`,
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
        trend.projectedDaysToCeiling !== null && trend.projectedCeilingDate
          ? ` At this rate it reaches ${trend.ceiling}${suffix} in about ${formatDays(trend.projectedDaysToCeiling)} (${trend.projectedCeilingDate.slice(0, 10)}).`
          : '';
      const urgency = trend.suggestedUrgency;
      const tone =
        urgency === 'immediate'
          ? 'Capacity will be exhausted within the week; act now.'
          : urgency === 'soon'
            ? 'Not an emergency, but schedule the expansion in the next couple of weeks.'
            : 'Not urgent; plan the expansion in the normal change window.';

      return {
        summary: `${name}: ${metric} has grown steadily by about ${Math.round(trend.slopePerDay * 100) / 100}${suffix === '%' ? ' pts' : suffix}/day for ${Math.round(trend.spanDays)} days and is now at ${last}, crossing the ${alert.threshold ?? 'alert'} threshold through normal growth.${projection}`,
        urgency,
        reasoning: `The linear fit explains ${Math.round(trend.rSquared * 100)}% of the variance (r²=${trend.rSquared}), and the last 24 hours moved ${trend.delta24h ?? 0}${suffix === '%' ? ' pts' : suffix}, consistent with the long-term rate. There is no sign of a sudden event. ${tone}`,
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
        summary: `${name}: ${metric} is at ${last} but has been declining (${trend.slopePerDay}${suffix === '%' ? ' pts' : suffix}/day over ${Math.round(trend.spanDays)} days). The alert likely reflects a temporary spike or an already-resolved condition.`,
        urgency: 'informational',
        reasoning: 'The long-term trend is downward, so capacity pressure is easing rather than building. Verify the current value and confirm whether the alert has already cleared.',
        recommendedActions: ['Confirm the current value on the resource.', 'If the alert has cleared, no action is needed beyond noting the spike.'],
        confidence: 0.6
      };

    case 'volatile':
      return {
        summary: `${name}: ${metric} is at ${last} with a highly variable history (σ=${trend.residualStdDev}) and no clear trend. The threshold breach may be one of many oscillations.`,
        urgency: trend.suggestedUrgency,
        reasoning: `The residual spread is large and the linear fit is weak (r²=${trend.rSquared}), which usually indicates periodic jobs, cache churn or temp files being created and removed. The risk is that a normal peak coincides with a shrinking baseline.`,
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
        summary: `${name}: ${metric} has been stable around ${trend.mean}${suffix} for ${Math.round(trend.spanDays)} days and is now at ${last}. ${nearLimit ? 'It sits right at the threshold with little headroom.' : 'The breach is marginal rather than a growth problem.'}`,
        urgency: trend.suggestedUrgency,
        reasoning: `Slope is ${trend.slopePerDay}${suffix === '%' ? ' pts' : suffix}/day with r²=${trend.rSquared}, so there is no meaningful growth trend. ${nearLimit ? 'A flat metric this close to the limit will keep flapping the alert until headroom is added.' : 'Either the threshold is set too tight or a small one-off change pushed it over.'}`,
        recommendedActions: nearLimit
          ? ['Add headroom (extend the disk or clear reclaimable space) to stop the alert flapping.', 'Review whether the threshold matches the actual risk for this resource.']
          : ['Verify the threshold is appropriate for this resource.', 'Check for a recent one-off change that nudged the value over the line.'],
        confidence: 0.6
      };
    }
  }
}

export const ruleBasedProvider: AgentProvider = {
  name: 'rule-based',
  isConfigured: () => true,
  diagnose: async (input) =>
    clampDiagnosis({
      ...buildDiagnosis(input),
      provider: 'rule-based',
      isFallback: true
    })
};

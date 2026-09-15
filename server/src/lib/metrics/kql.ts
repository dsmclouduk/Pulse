/**
 * Renders a string as a KQL double-quoted literal. JSON escaping covers `"`, `\` and control
 * characters, which is exactly what KQL string literals accept, so untrusted values (resource IDs,
 * mount names from alert dimensions) cannot break out of the literal.
 */
export function kqlStringLiteral(value: string): string {
  return JSON.stringify(value);
}

const ARM_RESOURCE_ID_PATTERN = /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/[^/]+\/[^/]+\/[^/]+(\/[^/]+\/[^/]+)*$/i;

export function isValidArmResourceId(value: string): boolean {
  return ARM_RESOURCE_ID_PATTERN.test(value);
}

export interface DiskFreeSpaceQueryInput {
  resourceId: string;
  mountId?: string;
  days: number;
  binSize: '1d' | '1h';
}

/**
 * VM Insights stores guest disk usage in InsightsMetrics as LogicalDisk / FreeSpacePercentage,
 * one row per mount, with the mount name in the Tags JSON under "vm.azm.ms/mountId".
 */
export function buildDiskFreeSpaceQuery(input: DiskFreeSpaceQueryInput): string {
  const days = Math.max(1, Math.min(365, Math.round(input.days)));
  const lines = [
    'InsightsMetrics',
    `| where TimeGenerated > ago(${days}d)`,
    '| where Origin == "vm.azm.ms" and Namespace == "LogicalDisk" and Name == "FreeSpacePercentage"',
    `| where _ResourceId =~ ${kqlStringLiteral(input.resourceId)}`,
    '| extend Mount = tostring(todynamic(Tags)["vm.azm.ms/mountId"])'
  ];

  if (input.mountId) {
    lines.push(`| where Mount =~ ${kqlStringLiteral(input.mountId)}`);
  }

  lines.push(
    `| summarize FreePct = avg(Val), MinFreePct = min(Val), MaxFreePct = max(Val) by bin(TimeGenerated, ${input.binSize}), Mount`,
    '| order by TimeGenerated asc'
  );

  return lines.join('\n');
}

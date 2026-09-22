import { AZURE_MANAGEMENT_RESOURCE, getAzureToken, isAzureMetricsConfigured } from '../azureAuth.js';
import { rulesForEstate, ruleResourceName, type BaselineRule, type BaselineTier } from './baseline.js';

/**
 * Reads back what monitoring actually exists in a client's estate, so onboarding shows a diff rather
 * than assuming a clean slate, and steady state shows drift.
 *
 * Everything here is read-only and comes from Azure, never from Pulse's own records: the point is to
 * catch the case where Pulse believes a rule exists and Azure disagrees. Pulse recognises its own
 * rules by the `pulse-managed` tag, so a client's pre-existing alerts are never touched or counted.
 */

const RESOURCE_GRAPH_URL = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01';

/** Agent extensions, by the names Azure gives them. */
const AGENT_EXTENSION_NAMES = ['azuremonitorwindowsagent', 'azuremonitorlinuxagent'];

export const COVERAGE_QUERIES = {
  /** Alert rules and action groups Pulse deployed, recognised by tag rather than by name guessing. */
  pulseResources: [
    'Resources',
    "| where type in~ ('microsoft.insights/metricalerts', 'microsoft.insights/scheduledqueryrules', 'microsoft.insights/activitylogalerts', 'microsoft.insights/actiongroups', 'microsoft.operationalinsights/workspaces', 'microsoft.insights/datacollectionrules')",
    '| project id, name, type, resourceGroup, location, tags, properties',
    '| order by name asc'
  ].join('\n'),

  /** One row per VM, with whether the monitoring agent extension is installed on it. */
  vmAgents: [
    'Resources',
    "| where type =~ 'microsoft.compute/virtualmachines'",
    '| project vmId = tolower(id), vmName = name, location, identityType = tostring(identity.type)',
    '| join kind=leftouter (',
    '    Resources',
    "    | where type =~ 'microsoft.compute/virtualmachines/extensions'",
    "    | where name in~ ('AzureMonitorWindowsAgent', 'AzureMonitorLinuxAgent')",
    '    | project vmId = tolower(strcat_array(array_slice(split(id, "/"), 0, -3), "/")), agentName = name',
    ') on vmId',
    '| project vmId, vmName, location, identityType, agentName'
  ].join('\n')
} as const;

export type CoverageState = 'MONITORED' | 'PARTIAL' | 'UNMONITORED' | 'BLOCKED_NO_IDENTITY' | 'UNKNOWN';

export interface CoverageCheck {
  key: string;
  label: string;
  state: CoverageState;
  detail: string;
}

export interface RuleCoverage {
  key: string;
  title: string;
  resourceType: string;
  severity: number;
  /** How many deployed rules matched this catalogue entry. Multi-resource rules give one per region. */
  deployedCount: number;
  present: boolean;
}

export interface CoverageReport {
  clientSlug: string;
  checkedAt: string;
  checks: CoverageCheck[];
  rules: RuleCoverage[];
  expectedRuleCount: number;
  presentRuleCount: number;
  /** Rules Pulse deployed that are no longer in the catalogue at this tier: candidates for removal. */
  orphanedRuleNames: string[];
  vmsTotal: number;
  vmsWithAgent: number;
  vmsBlockedNoIdentity: number;
}

interface PulseResourceRow {
  id: string;
  name: string;
  type: string;
  tags?: Record<string, string> | null;
  properties?: Record<string, unknown> | null;
}

interface VmAgentRow {
  vmId: string;
  vmName: string;
  location?: string;
  identityType?: string | null;
  agentName?: string | null;
}

export interface CoverageFacts {
  pulseResources: PulseResourceRow[];
  vms: VmAgentRow[];
}

async function runQuery<T>(query: string, subscriptionIds: string[], token: string): Promise<T[]> {
  const response = await fetch(RESOURCE_GRAPH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriptions: subscriptionIds, query, options: { resultFormat: 'objectArray', $top: 1000 } })
  });

  if (!response.ok) {
    throw new Error(`Resource Graph returned ${response.status} ${response.statusText}: ${(await response.text()).slice(0, 300)}`);
  }

  const payload = (await response.json()) as { data?: T[] };
  return payload.data ?? [];
}

export async function queryCoverageFacts(subscriptionIds: string[]): Promise<CoverageFacts> {
  if (!isAzureMetricsConfigured()) {
    throw new Error('Azure credentials are not configured.');
  }

  const token = await getAzureToken(AZURE_MANAGEMENT_RESOURCE);

  const [pulseResources, vms] = await Promise.all([
    runQuery<PulseResourceRow>(COVERAGE_QUERIES.pulseResources, subscriptionIds, token),
    runQuery<VmAgentRow>(COVERAGE_QUERIES.vmAgents, subscriptionIds, token)
  ]);

  return { pulseResources, vms };
}

function isPulseManaged(row: PulseResourceRow, clientSlug: string): boolean {
  const tags = row.tags ?? {};
  const managed = tags['pulse-managed'] ?? tags['Pulse-Managed'];
  const client = tags['pulse-client'] ?? tags['Pulse-Client'];

  return String(managed).toLowerCase() === 'true' && (!client || client.toLowerCase() === clientSlug.toLowerCase());
}

function typeOf(row: PulseResourceRow): string {
  return row.type.toLowerCase();
}

/** Names a few examples rather than every one: a real estate has dozens of workspaces. */
function nameList(rows: PulseResourceRow[], limit = 3): string {
  const names = rows.map((row) => row.name);
  const shown = names.slice(0, limit).join(', ');

  return names.length > limit ? `${shown} and ${names.length - limit} more` : shown;
}

function state(present: number, expected: number): CoverageState {
  if (expected === 0) return 'MONITORED';
  if (present === 0) return 'UNMONITORED';
  return present >= expected ? 'MONITORED' : 'PARTIAL';
}

/**
 * Pure: turns the raw Azure facts into the report. Kept separate from the queries so the logic is
 * testable without a subscription.
 */
export function buildCoverageReport(
  facts: CoverageFacts,
  options: { clientSlug: string; tier: BaselineTier; resourceTypes: string[]; pulseBaseUrl?: string }
): CoverageReport {
  const { clientSlug, tier, resourceTypes } = options;
  const expected = rulesForEstate(resourceTypes, tier);
  const ours = facts.pulseResources.filter((row) => isPulseManaged(row, clientSlug));

  const alertTypes = new Set([
    'microsoft.insights/metricalerts',
    'microsoft.insights/scheduledqueryrules',
    'microsoft.insights/activitylogalerts'
  ]);

  const deployedAlerts = ours.filter((row) => alertTypes.has(typeOf(row)));
  const matchedNames = new Set<string>();

  const rules: RuleCoverage[] = expected.map((rule: BaselineRule) => {
    // Deployed names are pulse-<client>-<key>, optionally suffixed with a region or resource name.
    const prefix = ruleResourceName(clientSlug, rule.key).toLowerCase();
    const matches = deployedAlerts.filter((row) => row.name.toLowerCase().startsWith(prefix));

    for (const match of matches) {
      matchedNames.add(match.name);
    }

    return {
      key: rule.key,
      title: rule.title,
      resourceType: rule.resourceType,
      severity: rule.severity,
      deployedCount: matches.length,
      present: matches.length > 0
    };
  });

  const orphanedRuleNames = deployedAlerts.filter((row) => !matchedNames.has(row.name)).map((row) => row.name);

  const actionGroups = ours.filter((row) => typeOf(row) === 'microsoft.insights/actiongroups');
  // Any workspace will serve, tagged or not: reusing a client's existing one is normal and expected,
  // so requiring our tag here would report a working estate as missing a workspace.
  const workspaces = facts.pulseResources.filter((row) => typeOf(row) === 'microsoft.operationalinsights/workspaces');
  const ourWorkspaces = workspaces.filter((row) => isPulseManaged(row, clientSlug));
  const dcrs = ours.filter((row) => typeOf(row) === 'microsoft.insights/datacollectionrules');

  const vmsTotal = facts.vms.length;
  const vmsWithAgent = facts.vms.filter((vm) => vm.agentName && AGENT_EXTENSION_NAMES.includes(vm.agentName.toLowerCase())).length;
  const vmsBlockedNoIdentity = facts.vms.filter((vm) => !vm.identityType || vm.identityType === 'None').length;

  const presentRuleCount = rules.filter((rule) => rule.present).length;

  const checks: CoverageCheck[] = [
    {
      key: 'action-group',
      label: 'Pulse action group',
      state: actionGroups.length > 0 ? 'MONITORED' : 'UNMONITORED',
      detail:
        actionGroups.length > 0
          ? `${actionGroups.length} present: ${nameList(actionGroups)}`
          : 'Not present, so no alert can reach Pulse however many rules exist'
    },
    {
      key: 'workspace',
      label: 'Log Analytics workspace',
      state: workspaces.length > 0 ? 'MONITORED' : 'UNMONITORED',
      detail:
        workspaces.length > 0
          ? `${workspaces.length} found: ${nameList(workspaces)}${ourWorkspaces.length === 0 ? '. None created by Pulse; an existing one can be reused.' : ''}`
          : 'Not present; guest rules have nowhere to query'
    },
    {
      key: 'dcr',
      label: 'VM Insights data collection rule',
      state: dcrs.length > 0 ? 'MONITORED' : vmsTotal === 0 ? 'MONITORED' : 'UNMONITORED',
      detail: dcrs.length > 0 ? nameList(dcrs) : 'Not present; VMs will report no guest metrics'
    },
    {
      key: 'agent',
      label: 'Monitoring agent on VMs',
      state: vmsTotal === 0 ? 'MONITORED' : state(vmsWithAgent, vmsTotal),
      detail: vmsTotal === 0 ? 'No VMs in this estate' : `${vmsWithAgent} of ${vmsTotal} VMs`
    },
    {
      key: 'identity',
      label: 'VMs able to take the agent',
      state: vmsBlockedNoIdentity === 0 ? 'MONITORED' : 'BLOCKED_NO_IDENTITY',
      detail:
        vmsBlockedNoIdentity === 0
          ? 'Every VM has a managed identity'
          : `${vmsBlockedNoIdentity} VM(s) have no managed identity, so the agent cannot be installed`
    },
    {
      key: 'rules',
      label: 'Baseline alert rules',
      state: state(presentRuleCount, expected.length),
      detail: `${presentRuleCount} of ${expected.length} catalogue rules deployed`
    }
  ];

  return {
    clientSlug,
    checkedAt: new Date().toISOString(),
    checks,
    rules,
    expectedRuleCount: expected.length,
    presentRuleCount,
    orphanedRuleNames,
    vmsTotal,
    vmsWithAgent,
    vmsBlockedNoIdentity
  };
}

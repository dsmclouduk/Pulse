import {
  BASELINE_VERSION,
  RESOURCE_TYPES,
  rulesForEstate,
  ruleResourceName,
  type BaselineRule,
  type BaselineTier
} from './baseline.js';

/**
 * Turns the baseline catalogue into a per-client Bicep deployment that an engineer applies with the
 * Azure CLI. Pulse never writes to a client tenant: it generates, the engineer deploys, Pulse reads
 * the result back.
 *
 * Two files, because only some of this is subscription-scoped:
 *   pulse-<client>-baseline.bicep     subscription scope: resource group, agent policy, the module
 *   pulse-<client>-monitoring.bicep   resource group scope: workspace, DCR, action group, alert rules
 *
 * The webhook token is a secure parameter rather than a literal, so it never lands in a file we
 * generate or in Azure's deployment history.
 */

export interface BaselinePlanInput {
  clientSlug: string;
  clientName: string;
  subscriptionId: string;
  tier: BaselineTier;
  /** Where the monitoring resources live. Created if absent. */
  resourceGroup: string;
  /** Primary region, for the resource group and the workspace. */
  location: string;
  /** Every region the estate uses. Multi-resource metric rules are emitted once per region. */
  regions: string[];
  /** Lower-cased ARM types present in the estate, from the inventory. */
  resourceTypes: string[];
  /** Resource ids per type, for the types that have no multi-resource rule form. */
  perResourceTargets?: Record<string, string[]>;
  workspaceName?: string;
  /** Pulse's public base URL. The client's webhook token is supplied at deploy time. */
  pulseBaseUrl: string;
  /** Roll the agent out with Azure Policy so new VMs onboard themselves. */
  deployAgentPolicy?: boolean;
}

export interface GeneratedFile {
  name: string;
  content: string;
}

export interface GeneratedDeployment {
  files: GeneratedFile[];
  parametersFileName: string;
  whatIfCommand: string;
  deployCommand: string;
  rules: BaselineRule[];
  warnings: string[];
}

/** Built-in initiative: install the agent and associate a DCR on every VM, now and in future. */
const AMA_POLICY_INITIATIVE = '/providers/Microsoft.Authorization/policySetDefinitions/924bfe3a-762f-40e7-86dd-5c8b95eb09e6';

function quote(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

/** Bicep identifiers cannot contain hyphens. */
function symbol(prefix: string, key: string): string {
  return `${prefix}_${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/** Multi-line KQL as a Bicep multi-line string. Bicep does not interpolate inside ''' ''' . */
function kql(query: string): string {
  return `'''\n${query}\n'''`;
}

function tagBlock(indent: string, clientSlug: string): string {
  return [
    `${indent}tags: {`,
    `${indent}  'pulse-managed': 'true'`,
    `${indent}  'pulse-client': ${quote(clientSlug)}`,
    `${indent}  'pulse-baseline': ${quote(BASELINE_VERSION)}`,
    `${indent}}`
  ].join('\n');
}

function metricAlert(rule: BaselineRule, clientSlug: string, region: string | null, targetId: string | null): string {
  const metric = rule.metric;

  if (!metric) {
    return '';
  }

  const suffix = region ? `-${region}` : targetId ? `-${targetId.split('/').at(-1)}` : '';
  const name = `${ruleResourceName(clientSlug, rule.key)}${suffix}`;
  const dimensions = (metric.dimensions ?? [])
    .map((dimension) =>
      [
        `            {`,
        `              name: ${quote(dimension.name)}`,
        `              operator: ${quote(dimension.operator)}`,
        `              values: [${dimension.values.map(quote).join(', ')}]`,
        `            }`
      ].join('\n')
    )
    .join('\n');

  // A multi-resource rule targets a type and a region; a per-resource rule targets the resource.
  const scopeLines = targetId
    ? [`    scopes: [${quote(targetId)}]`]
    : [
        `    scopes: [subscription().id]`,
        `    targetResourceType: ${quote(rule.resourceType)}`,
        `    targetResourceRegion: ${quote(region ?? '')}`
      ];

  const criteriaType = targetId
    ? 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
    : 'Microsoft.Azure.Monitor.MultipleResourceMultipleMetricCriteria';

  return [
    `resource ${symbol('alert', `${rule.key}${suffix}`)} 'Microsoft.Insights/metricAlerts@2018-03-01' = {`,
    `  name: ${quote(name)}`,
    `  location: 'global'`,
    tagBlock('  ', clientSlug),
    `  properties: {`,
    `    description: ${quote(rule.description)}`,
    `    severity: ${rule.severity}`,
    `    enabled: true`,
    ...scopeLines,
    `    evaluationFrequency: ${quote(metric.evaluationFrequency)}`,
    `    windowSize: ${quote(metric.windowSize)}`,
    `    autoMitigate: ${rule.autoMitigate}`,
    `    criteria: {`,
    `      'odata.type': '${criteriaType}'`,
    `      allOf: [`,
    `        {`,
    `          name: 'condition'`,
    `          criterionType: 'StaticThresholdCriterion'`,
    `          metricName: ${quote(metric.metricName)}`,
    `          operator: ${quote(metric.operator)}`,
    `          threshold: ${metric.threshold}`,
    `          timeAggregation: ${quote(metric.aggregation)}`,
    ...(dimensions ? [`          dimensions: [`, dimensions, `          ]`] : []),
    `        }`,
    `      ]`,
    `    }`,
    `    actions: [`,
    `      {`,
    `        actionGroupId: pulseActionGroup.id`,
    `      }`,
    `    ]`,
    `  }`,
    `}`
  ]
    .filter(Boolean)
    .join('\n');
}

function scheduledQueryRule(rule: BaselineRule, clientSlug: string, location: string): string {
  const log = rule.log;

  if (!log) {
    return '';
  }

  const dimensions = log.splitBy
    .map((name) =>
      [
        `            {`,
        `              name: ${quote(name)}`,
        `              operator: 'Include'`,
        `              values: ['*']`,
        `            }`
      ].join('\n')
    )
    .join('\n');

  return [
    `resource ${symbol('log', rule.key)} 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {`,
    `  name: ${quote(ruleResourceName(clientSlug, rule.key))}`,
    `  location: ${quote(location)}`,
    tagBlock('  ', clientSlug),
    `  properties: {`,
    `    displayName: ${quote(rule.title)}`,
    `    description: ${quote(rule.description)}`,
    `    severity: ${rule.severity}`,
    `    enabled: true`,
    `    scopes: [workspace.id]`,
    `    evaluationFrequency: ${quote(log.evaluationFrequency)}`,
    `    windowSize: ${quote(log.windowSize)}`,
    `    autoMitigate: ${rule.autoMitigate}`,
    `    criteria: {`,
    `      allOf: [`,
    `        {`,
    `          query: ${kql(log.query)}`,
    `          timeAggregation: ${quote(log.aggregation)}`,
    `          metricMeasureColumn: ${quote(log.metricMeasureColumn)}`,
    `          operator: ${quote(log.operator)}`,
    `          threshold: ${log.threshold}`,
    `          failingPeriods: {`,
    `            numberOfEvaluationPeriods: 1`,
    `            minFailingPeriodsToAlert: 1`,
    `          }`,
    `          dimensions: [`,
    dimensions,
    `          ]`,
    `        }`,
    `      ]`,
    `    }`,
    `    actions: {`,
    `      actionGroups: [pulseActionGroup.id]`,
    `    }`,
    `  }`,
    `}`
  ].join('\n');
}

function activityLogAlert(rule: BaselineRule, clientSlug: string): string {
  const activity = rule.activity;

  if (!activity) {
    return '';
  }

  const conditions = [`        {`, `          field: 'category'`, `          equals: ${quote(activity.category)}`, `        }`];

  if (activity.operationName) {
    conditions.push(`        {`, `          field: 'operationName'`, `          equals: ${quote(activity.operationName)}`, `        }`);
  }

  if (activity.status) {
    conditions.push(`        {`, `          field: 'status'`, `          equals: ${quote(activity.status)}`, `        }`);
  }

  return [
    `resource ${symbol('activity', rule.key)} 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {`,
    `  name: ${quote(ruleResourceName(clientSlug, rule.key))}`,
    `  location: 'global'`,
    tagBlock('  ', clientSlug),
    `  properties: {`,
    `    description: ${quote(rule.description)}`,
    `    enabled: true`,
    `    scopes: [subscription().id]`,
    `    condition: {`,
    `      allOf: [`,
    ...conditions,
    `      ]`,
    `    }`,
    `    actions: {`,
    `      actionGroups: [`,
    `        {`,
    `          actionGroupId: pulseActionGroup.id`,
    `        }`,
    `      ]`,
    `    }`,
    `  }`,
    `}`
  ].join('\n');
}

function monitoringModule(input: BaselinePlanInput, rules: BaselineRule[], warnings: string[]): string {
  const workspaceName = input.workspaceName ?? `law-pulse-${input.clientSlug}`;
  const needsWorkspace = rules.some((rule) => rule.kind === 'log' || rule.requires.includes('workspace'));
  const blocks: string[] = [];

  for (const rule of rules) {
    if (rule.kind === 'metric') {
      if (rule.scope === 'per-resource') {
        const targets = input.perResourceTargets?.[rule.resourceType] ?? [];

        if (targets.length === 0) {
          warnings.push(`${rule.key}: no ${rule.resourceType} resources supplied, so no rule was emitted.`);
          continue;
        }

        for (const target of targets) {
          blocks.push(metricAlert(rule, input.clientSlug, null, target));
        }
      } else {
        for (const region of input.regions) {
          blocks.push(metricAlert(rule, input.clientSlug, region, null));
        }
      }
      continue;
    }

    if (rule.kind === 'log') {
      blocks.push(scheduledQueryRule(rule, input.clientSlug, input.location));
      continue;
    }

    blocks.push(activityLogAlert(rule, input.clientSlug));
  }

  return [
    `// Monitoring baseline for ${input.clientName} — tier ${input.tier}, catalogue ${BASELINE_VERSION}.`,
    `// Generated by Pulse. Re-running is idempotent: everything is named deterministically.`,
    `// Edit the catalogue rather than this file, or the next generation will overwrite your change.`,
    ``,
    `@description('Client slug, used in every resource name and tag.')`,
    `param clientSlug string`,
    ``,
    `@description('Region for regional resources.')`,
    `param location string`,
    ``,
    `@description('Public base URL of the Pulse instance that receives alerts.')`,
    `param pulseBaseUrl string`,
    ``,
    // Bicep strings are single-quoted only, so descriptions must avoid or escape apostrophes.
    `@description('Webhook token for this client, from Pulse. Secure: never stored in deployment history.')`,
    `@secure()`,
    `param webhookToken string`,
    ``,
    ...(needsWorkspace
      ? [
          `resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {`,
          `  name: ${quote(workspaceName)}`,
          `  location: location`,
          tagBlock('  ', input.clientSlug),
          `  properties: {`,
          `    sku: {`,
          `      name: 'PerGB2018'`,
          `    }`,
          `    retentionInDays: 30`,
          `  }`,
          `}`,
          ``,
          `// VM Insights guest counters. One rule per workspace; every VM associates with it.`,
          `resource vmInsightsDcr 'Microsoft.Insights/dataCollectionRules@2023-03-11' = {`,
          `  name: 'dcr-pulse-\${clientSlug}-vminsights'`,
          `  location: location`,
          tagBlock('  ', input.clientSlug),
          `  properties: {`,
          `    description: 'Pulse VM Insights performance counters'`,
          `    dataSources: {`,
          `      performanceCounters: [`,
          `        {`,
          `          name: 'VMInsightsPerfCounters'`,
          `          streams: ['Microsoft-InsightsMetrics']`,
          `          samplingFrequencyInSeconds: 60`,
          `          counterSpecifiers: ['\\\\VmInsights\\\\DetailedMetrics']`,
          `        }`,
          `      ]`,
          `    }`,
          `    destinations: {`,
          `      logAnalytics: [`,
          `        {`,
          `          workspaceResourceId: workspace.id`,
          `          name: 'law'`,
          `        }`,
          `      ]`,
          `    }`,
          `    dataFlows: [`,
          `      {`,
          `        streams: ['Microsoft-InsightsMetrics']`,
          `        destinations: ['law']`,
          `      }`,
          `    ]`,
          `  }`,
          `}`,
          ``
        ]
      : []),
    `// Azure action groups cannot send custom headers, so the token travels in the URL path.`,
    `resource pulseActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {`,
    `  name: 'ag-pulse-\${clientSlug}'`,
    `  location: 'Global'`,
    tagBlock('  ', input.clientSlug),
    `  properties: {`,
    `    groupShortName: 'pulse'`,
    `    enabled: true`,
    `    webhookReceivers: [`,
    `      {`,
    `        name: 'pulse'`,
    `        serviceUri: '\${pulseBaseUrl}/api/webhook/azure-alerts/\${webhookToken}'`,
    `        useCommonAlertSchema: true`,
    `      }`,
    `    ]`,
    `  }`,
    `}`,
    ``,
    ...blocks.filter(Boolean).flatMap((block) => [block, '']),
    ...(needsWorkspace ? [`output workspaceId string = workspace.properties.customerId`] : []),
    `output actionGroupId string = pulseActionGroup.id`
  ].join('\n');
}

function subscriptionTemplate(input: BaselinePlanInput, moduleFileName: string): string {
  const deployPolicy = input.deployAgentPolicy ?? true;

  return [
    `// Pulse monitoring baseline for ${input.clientName}.`,
    `// Subscription scope, so the agent policy goes in with everything else.`,
    `//   az deployment sub create --subscription <id> --location ${input.location} \\`,
    `//     --template-file <this file> --parameters @${input.clientSlug}.parameters.json`,
    ``,
    `targetScope = 'subscription'`,
    ``,
    `param clientSlug string`,
    `param location string`,
    `param resourceGroupName string`,
    `param pulseBaseUrl string`,
    ``,
    `@secure()`,
    `param webhookToken string`,
    ``,
    `resource monitoringGroup 'Microsoft.Resources/resourceGroups@2021-04-01' = {`,
    `  name: resourceGroupName`,
    `  location: location`,
    tagBlock('  ', input.clientSlug),
    `}`,
    ``,
    `module monitoring '${moduleFileName}' = {`,
    `  name: 'pulse-monitoring'`,
    `  scope: monitoringGroup`,
    `  params: {`,
    `    clientSlug: clientSlug`,
    `    location: location`,
    `    pulseBaseUrl: pulseBaseUrl`,
    `    webhookToken: webhookToken`,
    `  }`,
    `}`,
    ...(deployPolicy
      ? [
          ``,
          `// Installs the Azure Monitor Agent and associates the VM Insights DCR on every VM, now and`,
          `// in future, so new VMs onboard themselves rather than waiting for the next deployment.`,
          `resource agentPolicy 'Microsoft.Authorization/policyAssignments@2022-06-01' = {`,
          `  name: 'pulse-\${clientSlug}-ama'`,
          `  location: location`,
          `  identity: {`,
          `    type: 'SystemAssigned'`,
          `  }`,
          `  properties: {`,
          `    displayName: 'Pulse: Azure Monitor Agent on all VMs'`,
          `    policyDefinitionId: '${AMA_POLICY_INITIATIVE}'`,
          `    parameters: {}`,
          `  }`,
          `}`
        ]
      : []),
    ``,
    `output actionGroupId string = monitoring.outputs.actionGroupId`
  ].join('\n');
}

function parametersFile(input: BaselinePlanInput): string {
  return `${JSON.stringify(
    {
      $schema: 'https://schema.management.azure.com/schemas/2019-04-26/deploymentParameters.json#',
      contentVersion: '1.0.0.0',
      parameters: {
        clientSlug: { value: input.clientSlug },
        location: { value: input.location },
        resourceGroupName: { value: input.resourceGroup },
        pulseBaseUrl: { value: input.pulseBaseUrl },
        webhookToken: {
          value: 'PASTE-THE-TOKEN-FROM-PULSE-SETTINGS-CLIENTS'
        }
      }
    },
    null,
    2
  )}\n`;
}

export function generateBaselineDeployment(input: BaselinePlanInput): GeneratedDeployment {
  const warnings: string[] = [];
  const rules = rulesForEstate(input.resourceTypes, input.tier);

  if (input.regions.length === 0) {
    warnings.push('No regions supplied, so no multi-resource metric rules were emitted. Run the inventory first.');
  }

  if (input.resourceTypes.some((type) => type.toLowerCase() === RESOURCE_TYPES.virtualMachine) && !(input.deployAgentPolicy ?? true)) {
    warnings.push('Agent policy is disabled, so guest rules (disk, heartbeat) will stay silent on VMs without the agent.');
  }

  const baseName = `pulse-${input.clientSlug}-baseline.bicep`;
  const moduleName = `pulse-${input.clientSlug}-monitoring.bicep`;
  const parametersName = `pulse-${input.clientSlug}.parameters.json`;

  const commandTail = [
    `--subscription ${input.subscriptionId}`,
    `--location ${input.location}`,
    `--template-file ${baseName}`,
    `--parameters @${parametersName}`
  ].join(' \\\n  ');

  return {
    files: [
      { name: baseName, content: subscriptionTemplate(input, `./${moduleName}`) },
      { name: moduleName, content: monitoringModule(input, rules, warnings) },
      { name: parametersName, content: parametersFile(input) }
    ],
    parametersFileName: parametersName,
    whatIfCommand: `az deployment sub what-if \\\n  ${commandTail}`,
    deployCommand: `az deployment sub create \\\n  --name pulse-baseline \\\n  ${commandTail}`,
    rules,
    warnings
  };
}

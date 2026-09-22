/**
 * The baseline alert catalogue, as data.
 *
 * This is the product: "the system is only as good as the alerts we receive". Every client at a
 * given tier gets exactly these rules, so a client never silently differs from the standard. Client
 * variation belongs in overrides applied on top, never in a forked catalogue.
 *
 * Encodes docs/onboarding/COVERAGE.md. Thresholds follow Microsoft's Azure Monitor Baseline Alerts
 * (AMBA) where it publishes one, tuned where running it for real showed the AMBA value was noise.
 * The generator (#36) turns these into Bicep; the coverage report (#35) reads them back from Azure
 * by the `pulse-managed` tag.
 */

export const BASELINE_VERSION = '2026.09.1';

export type BaselineTier = 'essential' | 'standard' | 'full';

/** How the rule is evaluated in Azure. */
export type BaselineRuleKind = 'metric' | 'log' | 'activityLog';

/**
 * How widely one deployed rule reaches. Most rules are estate-wide, which is why adding VMs to a
 * client changes nothing in the generated deployment.
 */
export type BaselineScope =
  /** One rule per region covers every resource of the type in the subscription. */
  | 'multi-resource-region'
  /** One rule per resource. App Service and Storage have no multi-resource form. */
  | 'per-resource'
  /** One rule on the workspace covers every VM reporting to it, split into per-resource alerts. */
  | 'workspace'
  /** One rule for the whole subscription. */
  | 'subscription';

/** What must already be true in the estate for the rule to produce anything. */
export type BaselineRequirement = 'ama' | 'vminsights' | 'workspace' | 'container-insights';

export type MetricAggregation = 'Average' | 'Minimum' | 'Maximum' | 'Total' | 'Count';
export type ConditionOperator = 'GreaterThan' | 'GreaterThanOrEqual' | 'LessThan' | 'LessThanOrEqual';

export interface MetricDimension {
  name: string;
  operator: 'Include' | 'Exclude';
  values: string[];
}

export interface MetricCondition {
  metricName: string;
  aggregation: MetricAggregation;
  operator: ConditionOperator;
  threshold: number;
  /** ISO-8601 duration, e.g. PT5M. */
  windowSize: string;
  evaluationFrequency: string;
  dimensions?: MetricDimension[];
  /** Human unit, for the UI and the diagnosis. Not sent to Azure. */
  unit?: string;
}

export interface LogCondition {
  /** KQL. Must project the measure column and every column named in `splitBy`. */
  query: string;
  metricMeasureColumn: string;
  aggregation: MetricAggregation;
  operator: ConditionOperator;
  threshold: number;
  windowSize: string;
  evaluationFrequency: string;
  /**
   * Dimensions to split on, producing one alert per combination. Always include `_ResourceId` so the
   * alert names the resource, and the dimension that identifies the thing (a mount, a NIC) so the
   * payload says which one. Without the second, Pulse has to guess which disk an alert is about.
   */
  splitBy: string[];
}

export interface ActivityLogCondition {
  category: 'ServiceHealth' | 'ResourceHealth' | 'Administrative';
  operationName?: string;
  status?: string;
}

export interface BaselineRule {
  /** Stable and unique. Becomes the resource name: `pulse-<client>-<key>`. Never renamed. */
  key: string;
  title: string;
  /** Lower-cased ARM type, or `subscription` for subscription-wide rules. */
  resourceType: string;
  tier: BaselineTier;
  kind: BaselineRuleKind;
  scope: BaselineScope;
  /** Azure severity: 0 critical … 4 verbose. */
  severity: 0 | 1 | 2 | 3 | 4;
  /** Why this rule exists, in the words an engineer reading the alert needs. */
  description: string;
  requires: BaselineRequirement[];
  /** Whether Azure resolves the alert on its own. Activity-log rules never do. */
  autoMitigate: boolean;
  amba?: string;
  metric?: MetricCondition;
  log?: LogCondition;
  activity?: ActivityLogCondition;
}

export const RESOURCE_TYPES = {
  virtualMachine: 'microsoft.compute/virtualmachines',
  appService: 'microsoft.web/sites',
  appServicePlan: 'microsoft.web/serverfarms',
  sqlDatabase: 'microsoft.sql/servers/databases',
  sqlElasticPool: 'microsoft.sql/servers/elasticpools',
  storageAccount: 'microsoft.storage/storageaccounts',
  keyVault: 'microsoft.keyvault/vaults',
  aksCluster: 'microsoft.containerservice/managedclusters',
  subscription: 'subscription'
} as const;

/**
 * VM Insights writes guest counters to InsightsMetrics with the mount in a tag. Projecting Mount as
 * a real column is what lets the rule split on it, so Azure names the drive in the alert payload.
 */
const DISK_FREE_QUERY = [
  'InsightsMetrics',
  '| where Origin == "vm.azm.ms" and Namespace == "LogicalDisk" and Name == "FreeSpacePercentage"',
  '| extend Mount = tostring(todynamic(Tags)["vm.azm.ms/mountId"])',
  '| project TimeGenerated, _ResourceId, Mount, FreePct = Val'
].join('\n');

const OS_MOUNTS = '"C:", "/"';

const RULES: BaselineRule[] = [
  /* ── Virtual machines ─────────────────────────────────────── */
  {
    key: 'vm-unavailable',
    title: 'VM unavailable',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 1,
    description: 'Azure reports the VM as not running or not reachable by the platform.',
    requires: [],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/VmAvailabilityMetric',
    metric: {
      metricName: 'VmAvailabilityMetric',
      aggregation: 'Average',
      operator: 'LessThan',
      threshold: 1,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT1M'
    }
  },
  {
    key: 'vm-heartbeat-missing',
    title: 'VM heartbeat missing',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'essential',
    kind: 'log',
    scope: 'workspace',
    severity: 1,
    description: 'The agent has not reported for 10 minutes. The VM may be down, or the agent has stopped.',
    requires: ['ama', 'workspace'],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/Heartbeat',
    log: {
      // Counting heartbeats and alerting on zero produces no series for a VM that has gone silent,
      // so the alert never fires. Selecting the stale ones gives a row to alert on instead.
      query: [
        'Heartbeat',
        '| summarize LastHeartbeat = max(TimeGenerated) by _ResourceId, Computer',
        '| where LastHeartbeat < ago(10m)',
        '| project _ResourceId, Computer, StaleVms = 1'
      ].join('\n'),
      metricMeasureColumn: 'StaleVms',
      aggregation: 'Total',
      operator: 'GreaterThanOrEqual',
      threshold: 1,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      splitBy: ['_ResourceId']
    }
  },
  {
    key: 'vm-cpu-high',
    title: 'VM CPU high',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 2,
    description: 'Sustained high CPU. A 15-minute window avoids alerting on short bursts.',
    requires: [],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/PercentageCPU',
    metric: {
      metricName: 'Percentage CPU',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 90,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'vm-memory-low',
    title: 'VM available memory low',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 2,
    description: 'Less than 1 GB of memory available. Paging and instability follow.',
    requires: [],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/AvailableMemoryBytes',
    metric: {
      metricName: 'Available Memory Bytes',
      aggregation: 'Average',
      operator: 'LessThan',
      threshold: 1_073_741_824,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'Bytes'
    }
  },
  {
    key: 'vm-os-disk-free',
    title: 'VM OS disk free space low',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'essential',
    kind: 'log',
    scope: 'workspace',
    severity: 2,
    description: 'The system drive is below 20% free. Below 10% Windows begins to fail in ways that are hard to recover remotely.',
    requires: ['ama', 'vminsights', 'workspace'],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/FreeSpacePercentage',
    log: {
      query: `${DISK_FREE_QUERY}\n| where Mount in (${OS_MOUNTS})`,
      metricMeasureColumn: 'FreePct',
      aggregation: 'Average',
      operator: 'LessThan',
      threshold: 20,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      splitBy: ['_ResourceId', 'Mount']
    }
  },
  {
    key: 'vm-data-disk-free',
    title: 'VM data disk free space low',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'essential',
    kind: 'log',
    scope: 'workspace',
    severity: 2,
    description: 'A non-system drive is below 10% free.',
    requires: ['ama', 'vminsights', 'workspace'],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/FreeSpacePercentage',
    log: {
      query: `${DISK_FREE_QUERY}\n| where Mount !in (${OS_MOUNTS})`,
      metricMeasureColumn: 'FreePct',
      aggregation: 'Average',
      operator: 'LessThan',
      threshold: 10,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      splitBy: ['_ResourceId', 'Mount']
    }
  },
  {
    key: 'vm-disk-latency',
    title: 'VM disk latency high',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'standard',
    kind: 'log',
    scope: 'workspace',
    severity: 2,
    description: 'Disk read or write latency above 25 ms sustained, which users feel as general slowness.',
    requires: ['ama', 'vminsights', 'workspace'],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/DiskLatency',
    log: {
      query: [
        'InsightsMetrics',
        '| where Origin == "vm.azm.ms" and Namespace == "LogicalDisk"',
        '| where Name in ("ReadLatencyMs", "WriteLatencyMs")',
        '| extend Mount = tostring(todynamic(Tags)["vm.azm.ms/mountId"])',
        '| project TimeGenerated, _ResourceId, Mount, LatencyMs = Val'
      ].join('\n'),
      metricMeasureColumn: 'LatencyMs',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 25,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      splitBy: ['_ResourceId', 'Mount']
    }
  },
  {
    key: 'vm-os-disk-iops',
    title: 'VM OS disk IOPS saturated',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'standard',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 2,
    description: 'The OS disk is at its IOPS limit, so the disk SKU is the bottleneck rather than the workload.',
    requires: [],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/OSDiskIOPSConsumedPercentage',
    metric: {
      metricName: 'OS Disk IOPS Consumed Percentage',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 95,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'vm-data-disk-iops',
    title: 'VM data disk IOPS saturated',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'standard',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 2,
    description: 'A data disk is at its IOPS limit.',
    requires: [],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/DataDiskIOPSConsumedPercentage',
    metric: {
      metricName: 'Data Disk IOPS Consumed Percentage',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 95,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'vm-cpu-credits-low',
    title: 'VM CPU credits exhausted (B-series)',
    resourceType: RESOURCE_TYPES.virtualMachine,
    tier: 'standard',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 3,
    description: 'A burstable VM has spent its credits and is now throttled to its baseline. Usually means the SKU is wrong for the workload.',
    requires: [],
    autoMitigate: true,
    amba: 'Compute/virtualMachines/CPUCreditsRemaining',
    metric: {
      metricName: 'CPU Credits Remaining',
      aggregation: 'Average',
      operator: 'LessThan',
      threshold: 5,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M'
    }
  },

  /* ── App Service ──────────────────────────────────────────── */
  {
    key: 'app-http5xx',
    title: 'App Service server errors',
    resourceType: RESOURCE_TYPES.appService,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 1,
    description: 'The site is returning 5xx responses, so users are seeing failures.',
    requires: [],
    autoMitigate: true,
    amba: 'Web/sites/Http5xx',
    metric: {
      metricName: 'Http5xx',
      aggregation: 'Total',
      operator: 'GreaterThan',
      threshold: 10,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M'
    }
  },
  {
    key: 'app-health-check',
    title: 'App Service health check failing',
    resourceType: RESOURCE_TYPES.appService,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 2,
    description: 'One or more instances are failing the configured health check path.',
    requires: [],
    autoMitigate: true,
    amba: 'Web/sites/HealthCheckStatus',
    metric: {
      metricName: 'HealthCheckStatus',
      aggregation: 'Average',
      operator: 'LessThan',
      threshold: 100,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT1M',
      unit: 'Percent'
    }
  },
  {
    key: 'app-response-time',
    title: 'App Service response time high',
    resourceType: RESOURCE_TYPES.appService,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 2,
    description: 'Average response time above 5 seconds sustained.',
    requires: [],
    autoMitigate: true,
    amba: 'Web/sites/HttpResponseTime',
    metric: {
      metricName: 'HttpResponseTime',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 5,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      unit: 'Seconds'
    }
  },
  {
    key: 'plan-cpu-high',
    title: 'App Service plan CPU high',
    resourceType: RESOURCE_TYPES.appServicePlan,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 3,
    description: 'The plan is CPU bound, which affects every site on it.',
    requires: [],
    autoMitigate: true,
    amba: 'Web/serverFarms/CpuPercentage',
    metric: {
      metricName: 'CpuPercentage',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 90,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'plan-memory-high',
    title: 'App Service plan memory high',
    resourceType: RESOURCE_TYPES.appServicePlan,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 3,
    description: 'The plan is memory bound, which affects every site on it.',
    requires: [],
    autoMitigate: true,
    amba: 'Web/serverFarms/MemoryPercentage',
    metric: {
      metricName: 'MemoryPercentage',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 90,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'plan-http-queue',
    title: 'App Service plan request queue building',
    resourceType: RESOURCE_TYPES.appServicePlan,
    tier: 'standard',
    kind: 'metric',
    scope: 'per-resource',
    severity: 3,
    description: 'Requests are queuing rather than being served, usually the first sign of saturation.',
    requires: [],
    autoMitigate: true,
    amba: 'Web/serverFarms/HttpQueueLength',
    metric: {
      metricName: 'HttpQueueLength',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 100,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M'
    }
  },
  {
    key: 'app-filesystem-usage',
    title: 'App Service file system usage high',
    resourceType: RESOURCE_TYPES.appService,
    tier: 'standard',
    kind: 'metric',
    scope: 'per-resource',
    severity: 1,
    description: 'The site is approaching its storage quota, after which deployments and logging fail.',
    requires: [],
    autoMitigate: true,
    amba: 'Web/sites/FileSystemUsage',
    metric: {
      metricName: 'FileSystemUsage',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 85,
      windowSize: 'PT6H',
      evaluationFrequency: 'PT1H',
      unit: 'Percent'
    }
  },

  /* ── Azure SQL ────────────────────────────────────────────── */
  {
    key: 'sql-cpu-high',
    title: 'SQL database CPU high',
    resourceType: RESOURCE_TYPES.sqlDatabase,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 3,
    description: 'The database is CPU bound and queries will be queuing.',
    requires: [],
    autoMitigate: true,
    amba: 'Sql/servers/databases/cpu_percent',
    metric: {
      metricName: 'cpu_percent',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 80,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'sql-storage-high',
    title: 'SQL database storage high',
    resourceType: RESOURCE_TYPES.sqlDatabase,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 3,
    description: 'The database is approaching its maximum size, after which writes fail.',
    requires: [],
    autoMitigate: true,
    amba: 'Sql/servers/databases/storage_percent',
    metric: {
      metricName: 'storage_percent',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 90,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'sql-deadlocks',
    title: 'SQL database deadlocks',
    resourceType: RESOURCE_TYPES.sqlDatabase,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 3,
    description: 'Deadlocks are occurring, so some transactions are being killed.',
    requires: [],
    autoMitigate: true,
    amba: 'Sql/servers/databases/deadlock',
    metric: {
      metricName: 'deadlock',
      aggregation: 'Total',
      operator: 'GreaterThan',
      threshold: 1,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M'
    }
  },
  {
    key: 'sql-failed-connections',
    title: 'SQL database failed connections',
    resourceType: RESOURCE_TYPES.sqlDatabase,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 3,
    description: 'Connections are being refused, which usually means credentials, limits or firewall.',
    requires: [],
    autoMitigate: true,
    amba: 'Sql/servers/databases/connection_failed',
    metric: {
      metricName: 'connection_failed',
      aggregation: 'Total',
      operator: 'GreaterThan',
      threshold: 5,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M'
    }
  },
  {
    key: 'sql-pool-cpu-high',
    title: 'SQL elastic pool CPU high',
    resourceType: RESOURCE_TYPES.sqlElasticPool,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 3,
    description: 'The pool is CPU bound, affecting every database in it.',
    requires: [],
    autoMitigate: true,
    amba: 'Sql/servers/elasticPools/cpu_percent',
    metric: {
      metricName: 'cpu_percent',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 90,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'sql-pool-storage-high',
    title: 'SQL elastic pool storage high',
    resourceType: RESOURCE_TYPES.sqlElasticPool,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 3,
    description: 'The pool is approaching its storage limit.',
    requires: [],
    autoMitigate: true,
    amba: 'Sql/servers/elasticPools/storage_percent',
    metric: {
      metricName: 'storage_percent',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 90,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'sql-blocked-by-firewall',
    title: 'SQL database connections blocked by firewall',
    resourceType: RESOURCE_TYPES.sqlDatabase,
    tier: 'standard',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 2,
    description: 'Something is trying to connect from an address the firewall does not allow. Either a misconfiguration or an intrusion attempt.',
    requires: [],
    autoMitigate: true,
    amba: 'Sql/servers/databases/blocked_by_firewall',
    metric: {
      metricName: 'blocked_by_firewall',
      aggregation: 'Total',
      operator: 'GreaterThan',
      threshold: 5,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M'
    }
  },
  {
    key: 'sql-workers-high',
    title: 'SQL database workers near limit',
    resourceType: RESOURCE_TYPES.sqlDatabase,
    tier: 'standard',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 3,
    description: 'Worker threads are nearly exhausted; new requests will start being rejected.',
    requires: [],
    autoMitigate: true,
    amba: 'Sql/servers/databases/workers_percent',
    metric: {
      metricName: 'workers_percent',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 90,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },

  /* ── Storage ──────────────────────────────────────────────── */
  {
    key: 'storage-availability',
    title: 'Storage account availability degraded',
    resourceType: RESOURCE_TYPES.storageAccount,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 1,
    description: 'The storage account is failing some requests at the platform level.',
    requires: [],
    autoMitigate: true,
    amba: 'Storage/storageAccounts/Availability',
    metric: {
      metricName: 'Availability',
      aggregation: 'Average',
      operator: 'LessThan',
      threshold: 99,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'storage-throttling',
    title: 'Storage account throttling',
    resourceType: RESOURCE_TYPES.storageAccount,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 2,
    description: 'Requests are being throttled, so the account is at its scale limit.',
    requires: [],
    autoMitigate: true,
    amba: 'Storage/storageAccounts/Transactions',
    metric: {
      metricName: 'Transactions',
      aggregation: 'Total',
      operator: 'GreaterThanOrEqual',
      threshold: 1,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      dimensions: [{ name: 'ResponseType', operator: 'Include', values: ['ServerBusyError', 'ClientThrottlingError'] }]
    }
  },
  {
    key: 'storage-latency',
    title: 'Storage account latency high',
    resourceType: RESOURCE_TYPES.storageAccount,
    tier: 'standard',
    kind: 'metric',
    scope: 'per-resource',
    severity: 3,
    description: 'End-to-end latency above one second, which callers will feel.',
    requires: [],
    autoMitigate: true,
    amba: 'Storage/storageAccounts/SuccessE2ELatency',
    metric: {
      metricName: 'SuccessE2ELatency',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 1000,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'MilliSeconds'
    }
  },

  /* ── Key Vault ────────────────────────────────────────────── */
  {
    key: 'keyvault-availability',
    title: 'Key Vault availability degraded',
    resourceType: RESOURCE_TYPES.keyVault,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 1,
    description: 'The vault is failing requests. Anything depending on it for secrets or certificates will fail with it.',
    requires: [],
    autoMitigate: true,
    amba: 'KeyVault/vaults/Availability',
    metric: {
      metricName: 'Availability',
      aggregation: 'Average',
      operator: 'LessThan',
      threshold: 90,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'keyvault-saturation',
    title: 'Key Vault approaching its request limit',
    resourceType: RESOURCE_TYPES.keyVault,
    tier: 'essential',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 1,
    description: 'Vault capacity is above 75% used; beyond the limit requests are throttled.',
    requires: [],
    autoMitigate: true,
    amba: 'KeyVault/vaults/SaturationShoebox',
    metric: {
      metricName: 'SaturationShoebox',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 75,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'keyvault-latency',
    title: 'Key Vault API latency high',
    resourceType: RESOURCE_TYPES.keyVault,
    tier: 'standard',
    kind: 'metric',
    scope: 'multi-resource-region',
    severity: 3,
    description: 'Vault calls are taking over a second, which slows every dependent service.',
    requires: [],
    autoMitigate: true,
    amba: 'KeyVault/vaults/ServiceApiLatency',
    metric: {
      metricName: 'ServiceApiLatency',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 1000,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      unit: 'MilliSeconds'
    }
  },

  /* ── AKS ──────────────────────────────────────────────────── */
  {
    key: 'aks-node-not-ready',
    title: 'AKS node not ready',
    resourceType: RESOURCE_TYPES.aksCluster,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 3,
    description: 'A node is NotReady or Unknown, so its pods are being rescheduled or are stuck.',
    requires: ['container-insights'],
    autoMitigate: true,
    amba: 'ContainerService/managedClusters/kube_node_status_condition',
    metric: {
      metricName: 'kube_node_status_condition',
      aggregation: 'Total',
      operator: 'GreaterThan',
      threshold: 0,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      dimensions: [{ name: 'condition', operator: 'Include', values: ['Ready'] }, { name: 'status', operator: 'Include', values: ['false', 'unknown'] }]
    }
  },
  {
    key: 'aks-pods-failed',
    title: 'AKS pods failed',
    resourceType: RESOURCE_TYPES.aksCluster,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 3,
    description: 'Pods are in the Failed phase.',
    requires: ['container-insights'],
    autoMitigate: true,
    amba: 'ContainerService/managedClusters/kube_pod_status_phase',
    metric: {
      metricName: 'kube_pod_status_phase',
      aggregation: 'Total',
      operator: 'GreaterThan',
      threshold: 0,
      windowSize: 'PT5M',
      evaluationFrequency: 'PT5M',
      dimensions: [{ name: 'phase', operator: 'Include', values: ['Failed'] }]
    }
  },
  {
    key: 'aks-node-disk-high',
    title: 'AKS node disk usage high',
    resourceType: RESOURCE_TYPES.aksCluster,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 2,
    description: 'A node is above 80% disk. Kubelet begins evicting pods when disk pressure sets in.',
    requires: ['container-insights'],
    autoMitigate: true,
    amba: 'ContainerService/managedClusters/node_disk_usage_percentage',
    metric: {
      metricName: 'node_disk_usage_percentage',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 80,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'aks-node-cpu-high',
    title: 'AKS node CPU high',
    resourceType: RESOURCE_TYPES.aksCluster,
    tier: 'essential',
    kind: 'metric',
    scope: 'per-resource',
    severity: 3,
    description: 'A node is above 95% CPU sustained.',
    requires: ['container-insights'],
    autoMitigate: true,
    amba: 'ContainerService/managedClusters/node_cpu_usage_percentage',
    metric: {
      metricName: 'node_cpu_usage_percentage',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 95,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M',
      unit: 'Percent'
    }
  },
  {
    key: 'aks-unschedulable-pods',
    title: 'AKS pods cannot be scheduled',
    resourceType: RESOURCE_TYPES.aksCluster,
    tier: 'standard',
    kind: 'metric',
    scope: 'per-resource',
    severity: 3,
    description: 'The autoscaler cannot place pods, so the cluster is out of capacity or constrained by limits.',
    requires: ['container-insights'],
    autoMitigate: true,
    amba: 'ContainerService/managedClusters/cluster_autoscaler_unschedulable_pods_count',
    metric: {
      metricName: 'cluster_autoscaler_unschedulable_pods_count',
      aggregation: 'Average',
      operator: 'GreaterThan',
      threshold: 0,
      windowSize: 'PT15M',
      evaluationFrequency: 'PT5M'
    }
  },

  /* ── Subscription level ───────────────────────────────────── */
  {
    key: 'service-health',
    title: 'Azure Service Health',
    resourceType: RESOURCE_TYPES.subscription,
    tier: 'essential',
    kind: 'activityLog',
    scope: 'subscription',
    severity: 2,
    description: 'Microsoft has declared an incident, planned maintenance or advisory affecting this subscription.',
    requires: [],
    // Activity-log alerts are stateless: Azure fires them once and never resolves them.
    autoMitigate: false,
    activity: { category: 'ServiceHealth' }
  },
  {
    key: 'resource-health',
    title: 'Resource became unavailable',
    resourceType: RESOURCE_TYPES.subscription,
    tier: 'essential',
    kind: 'activityLog',
    scope: 'subscription',
    severity: 2,
    description: 'The platform reports a resource as Unavailable, usually platform-initiated.',
    requires: [],
    autoMitigate: false,
    activity: { category: 'ResourceHealth' }
  },
  {
    key: 'keyvault-deleted',
    title: 'Key Vault deleted',
    resourceType: RESOURCE_TYPES.subscription,
    tier: 'essential',
    kind: 'activityLog',
    scope: 'subscription',
    severity: 1,
    description: 'A vault was deleted. Everything depending on it for secrets or certificates is about to fail.',
    requires: [],
    autoMitigate: false,
    activity: { category: 'Administrative', operationName: 'Microsoft.KeyVault/vaults/delete', status: 'Succeeded' }
  },
  {
    key: 'vm-deleted',
    title: 'Virtual machine deleted',
    resourceType: RESOURCE_TYPES.subscription,
    tier: 'standard',
    kind: 'activityLog',
    scope: 'subscription',
    severity: 2,
    description: 'A VM was deleted. Expected during decommissioning, worth knowing about otherwise.',
    requires: [],
    autoMitigate: false,
    activity: { category: 'Administrative', operationName: 'Microsoft.Compute/virtualMachines/delete', status: 'Succeeded' }
  }
];

/** Tiers are cumulative: Standard includes Essential, Full includes both. */
const TIER_ORDER: BaselineTier[] = ['essential', 'standard', 'full'];

export function tiersUpTo(tier: BaselineTier): BaselineTier[] {
  return TIER_ORDER.slice(0, TIER_ORDER.indexOf(tier) + 1);
}

export function allRules(): readonly BaselineRule[] {
  return RULES;
}

/** Every rule for a resource type at a tier, cumulative. Resource types compare case-insensitively. */
export function rulesFor(resourceType: string, tier: BaselineTier): BaselineRule[] {
  const wanted = new Set(tiersUpTo(tier));
  const type = resourceType.toLowerCase();

  return RULES.filter((rule) => rule.resourceType === type && wanted.has(rule.tier));
}

/** Rules to deploy for a client, given the resource types actually present plus subscription-wide ones. */
export function rulesForEstate(resourceTypes: readonly string[], tier: BaselineTier): BaselineRule[] {
  const present = new Set(resourceTypes.map((type) => type.toLowerCase()));
  const wanted = new Set(tiersUpTo(tier));

  return RULES.filter(
    (rule) => wanted.has(rule.tier) && (rule.resourceType === RESOURCE_TYPES.subscription || present.has(rule.resourceType))
  );
}

export function resourceTypesCovered(): string[] {
  return [...new Set(RULES.map((rule) => rule.resourceType))].sort((left, right) => left.localeCompare(right));
}

export function ruleByKey(key: string): BaselineRule | undefined {
  return RULES.find((rule) => rule.key === key);
}

/** Azure resource name for a deployed rule. Also how the coverage report recognises our own rules. */
export function ruleResourceName(clientSlug: string, key: string): string {
  return `pulse-${clientSlug}-${key}`;
}

/** Tags stamped on everything the baseline creates, so Pulse can tell its rules from the client's. */
export function baselineTags(clientSlug: string): Record<string, string> {
  return {
    'pulse-managed': 'true',
    'pulse-client': clientSlug,
    'pulse-baseline': BASELINE_VERSION
  };
}

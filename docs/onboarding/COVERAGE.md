# Monitoring coverage matrix

What Pulse can monitor through Azure Monitor, which metrics exist per resource type, which alerts the baseline configures, and what is out of reach. Thresholds come from Microsoft's Azure Monitor Baseline Alerts (AMBA) catalogue and should be tuned per client. Last reviewed 2026-09-15.

**Tiers.** Essential = deployed for every client. Standard = recommended. Full = everything AMBA lists for the type. Tiers are cumulative. Metric rules use `autoMitigate` so Resolved events flow into Pulse's Fired → Resolved upsert.

**Rule mechanics.** Multi-resource metric rules (one rule per region covers every resource of the type in the subscription) are available for VMs, SQL databases and elastic pools, Key Vault, Recovery Services vaults and PostgreSQL flexible servers. App Service and Storage need one rule per resource. Guest-OS signals need the Azure Monitor Agent and are alerted with log search rules split by `_ResourceId`, one rule for all VMs.

---

## Virtual machines (`Microsoft.Compute/virtualMachines`)

**Platform metrics (no agent):** Percentage CPU, Available Memory Bytes, Network In/Out Total, Disk Read/Write Bytes and Operations/sec, OS and Data Disk IOPS Consumed %, OS and Data Disk Bandwidth Consumed %, Disk Queue Depth, CPU Credits Remaining/Consumed (B-series), VmAvailabilityMetric, Inbound/Outbound Flows.

**Guest metrics (AMA + VM Insights DCR → Log Analytics `InsightsMetrics`):** LogicalDisk FreeSpacePercentage per mount, Processor UtilizationPercentage, Memory AvailableMB, LogicalDisk read/write latency, network bytes/sec per NIC, Heartbeat.

| Alert | Kind / scope | Condition | Sev | Tier |
|---|---|---|---|---|
| VM availability | metric, multi-resource | VmAvailabilityMetric < 1 avg 5 m | 1 | Essential |
| Heartbeat missing | log, split by `_ResourceId` | no Heartbeat for 10 m | 1 | Essential |
| CPU high | metric, multi-resource | Percentage CPU > 80 avg 5 m (AMBA) or > 90 avg 15 m | 2 | Essential |
| Memory low | metric, multi-resource | Available Memory Bytes < 1 GB avg 5 m | 2 | Essential |
| OS disk free space | log | FreeSpacePercentage (OS disk) < 20 avg 15 m | 2 | Essential |
| Data disk free space | log | FreeSpacePercentage (data disks) < 10 avg 15 m | 2 | Essential |
| Disk latency | log | Read/Write LatencyMs > 25 avg 15 m | 2 | Standard |
| Disk IOPS consumed | metric, multi-resource | OS/Data Disk IOPS Consumed % > 95 | 2 | Standard |
| Disk bandwidth consumed | metric, multi-resource | OS/Data Disk Bandwidth Consumed % > 90 | 2 | Standard |
| Memory available % | log | AvailableMB / total < 10 % | 2 | Standard |
| CPU credits remaining (B-series) | metric | < 5 | 3 | Standard |
| Network read/write bytes/sec | log | > 10 MB/s (tune per client) | 3 | Full |
| Disk queue depth, cached/uncached IOPS, burst IOPS | metric | AMBA auto-generated thresholds | 2–3 | Full |

**Cannot monitor without extra work:** disk % and memory % on VMs without AMA; VMs without a managed identity (AMA install is blocked); service or process state and Windows events / Syslog content (needs a separate logs DCR); servers outside Azure unless Arc-enabled.

Sources: AMBA `services/Compute/virtualMachines/alerts.yaml`; platform metrics reference for `Microsoft.Compute/virtualMachines`.

## App Service (`Microsoft.Web/sites`) and plans (`Microsoft.Web/serverFarms`)

**Site metrics:** Requests, Http2xx/3xx/4xx/5xx (and specific codes 401/403/404/406), HttpResponseTime, AverageResponseTime, CpuTime, MemoryWorkingSet, AverageMemoryWorkingSet, PrivateBytes, AppConnections, Threads, Handles, FileSystemUsage, HealthCheckStatus, BytesSent/Received, FunctionExecutionCount/Units (Functions), WorkflowRunsFailureRate (Logic Apps Standard).
**Plan metrics:** CpuPercentage, MemoryPercentage, HttpQueueLength, DiskQueueLength, TcpEstablished, TcpTimeWait, SocketOutboundAll, BytesSent/Received.

| Alert | Target | Condition | Sev | Tier |
|---|---|---|---|---|
| Http5xx | site | > 10 total 5 m, window 15 m | 1 | Essential |
| HealthCheckStatus | site | < 100 avg 5 m | 2 | Essential |
| HttpResponseTime | site | > 5 s avg 15 m | 2 | Essential |
| CpuPercentage / MemoryPercentage | plan | > 90 avg 5 m | 3 | Essential |
| HttpQueueLength | plan | > 100 avg 5 m | 3 | Standard |
| FileSystemUsage | site | > quota-based threshold avg 6 h | 1 | Standard |
| Http401 / Http403 / Http404 spikes | site | AMBA thresholds | 1–2 | Full |
| Threads, Handles (dynamic), TcpEstablished/TimeWait | site / plan | AMBA thresholds | 2–4 | Full |

**Limits:** one rule per site and per plan (no multi-resource support). Request traces, dependencies and failures need Application Insights; smart detection needs 24 h of data.

Sources: AMBA `services/Web/sites/alerts.yaml`, `services/Web/serverFarms/alerts.yaml`.

## Azure SQL Database (`Microsoft.Sql/servers/databases`) and elastic pools (`…/elasticPools`)

**Database metrics:** cpu_percent, cpu_used, dtu_consumption_percent, dtu_used, storage, storage_percent, workers_percent, sessions_percent, sessions_count, deadlock, connection_failed, connection_failed_user_error, connection_successful, blocked_by_firewall, log_write_percent, physical_data_read_percent, sql_instance_cpu_percent, sql_instance_memory_percent, tempdb_data_size, tempdb_log_used_percent.
**Pool metrics:** cpu_percent, dtu_consumption_percent, eDTU_used, storage_percent, allocated_data_storage_percent, workers_percent, sessions_percent, log_write_percent, sqlserver_process_core_percent, sqlserver_process_memory_percent.

| Alert | Target | Condition | Sev | Tier |
|---|---|---|---|---|
| CPU / DTU | database | cpu_percent or dtu_consumption_percent > 80 avg 5 m | 3 | Essential |
| Storage | database | storage_percent > 90 | 3 | Essential |
| Deadlocks | database | deadlock > 1 total 5 m | 3 | Essential |
| Failed connections | database | connection_failed > 5 total 5 m | 3 | Essential |
| Pool CPU / DTU / storage | pool | > 90 avg 5 m | 3 | Essential |
| Blocked by firewall | database | > 5 total 5 m | 2 | Standard |
| Workers / sessions % | database, pool | > 90 | 3 | Standard |
| Instance memory %, tempdb | database | > 90 / > 80 | 2–3 | Full |

**Limits:** multi-resource rules supported (one rule per region covers all databases). Query-level insight needs Query Performance Insight or Database Watcher, not Azure Monitor metrics.

Source: AMBA `services/Sql/servers/alerts.yaml`.

## Storage accounts (`Microsoft.Storage/storageAccounts` and blob/file/queue/table services)

**Metrics:** Availability, Transactions (dimensions ResponseType, ApiName), SuccessE2ELatency, SuccessServerLatency, UsedCapacity, Ingress, Egress; per service: BlobCapacity, BlobCount, FileCapacity, FileShareCapacityQuota, FileShareSnapshotCount, QueueMessageCount, QueueCapacity.

| Alert | Target | Condition | Sev | Tier |
|---|---|---|---|---|
| Availability | account | < 100 avg 1 m (AMBA) or < 90 avg 5 m | 1 | Essential |
| Throttling | account | Transactions with ResponseType in ServerBusyError / ClientThrottlingError ≥ 1 total 15 m | 2 | Essential |
| E2E latency | blob service | SuccessE2ELatency > 1000 ms avg 5 m | 3 | Standard |
| File share capacity | file service | FileCapacity or FileShareCapacityQuota approaching quota | 3–4 | Standard |
| Used capacity | account | client threshold (AMBA default 500 TB) | 3 | Standard |
| Ingress / Egress, queue counts | account / queue | AMBA thresholds | 2–4 | Full |

**Limits:** one rule per storage account (no multi-resource). Per-container sizes need blob inventory. Object-level access logs need diagnostic settings to a workspace.

Source: AMBA `services/Storage/storageAccounts/alerts.yaml`.

## Key Vault (`Microsoft.KeyVault/vaults`)

**Metrics:** Availability, SaturationShoebox, ServiceApiHit, ServiceApiLatency, ServiceApiResult (dimensions ActivityType, ActivityName, StatusCode).

| Alert | Condition | Sev | Tier |
|---|---|---|---|
| Availability | < 90 avg 5 m | 1 | Essential |
| SaturationShoebox | > 75 avg 5 m | 1 | Essential |
| Vault deleted | activity log `Microsoft.KeyVault/vaults/delete` | 1 | Essential |
| ServiceApiLatency | > 1000 ms avg 5 m | 3 | Standard |
| ServiceApiResult | dynamic threshold | 2 | Full |
| ServiceApiHit | ≥ 80 avg 5 m | 3 | Full |

Multi-resource rules supported. Secret contents and access policies are data plane and are not monitored.

Source: AMBA `services/KeyVault/vaults/alerts.yaml`.

## AKS (`Microsoft.ContainerService/managedClusters`)

Requires Container Insights and/or managed Prometheus on the cluster. **Metrics:** node_cpu_usage_percentage, node_memory_working_set_percentage, node_memory_rss_percentage, node_disk_usage_percentage, kube_node_status_condition, kube_pod_status_phase, kube_pod_status_ready, cluster_autoscaler_unschedulable_pods_count, cluster_autoscaler_cluster_safe_to_autoscale, kube_node_status_allocatable_cpu_cores / memory_bytes.

| Alert | Condition | Sev | Tier |
|---|---|---|---|
| Node not ready | kube_node_status_condition (NotReady/Unknown) > 0 | 3 | Essential |
| Pods failed | kube_pod_status_phase (Failed) > 0 | 3 | Essential |
| Node disk usage | > 80 % | 2 | Essential |
| Node CPU | > 95 % | 3 | Essential |
| Unschedulable pods | > 0 | 3 | Standard |
| Node memory working set / RSS | > 90–100 % | 3 | Standard |
| Allocatable CPU / memory low | < 2 cores / < 2 GB | 3 | Full |

Source: AMBA `services/ContainerService/managedClusters/alerts.yaml`.

## Networking and other types (Full tier; AMBA catalogues exist)

| Type | Key alerts |
|---|---|
| Application Gateway | Unhealthy host count, failed requests, backend response time, capacity units |
| Load Balancer | Health probe status, data path availability, SNAT exhaustion |
| VPN Gateway / ExpressRoute | Tunnel status, bandwidth, BGP peer status |
| Azure Firewall | Health state, throughput, SNAT port utilisation |
| VM scale sets | Same as VMs, per scale set |
| Cosmos DB | Availability, normalised RU consumption, throttled requests (429) |
| Azure Cache for Redis | Server load, memory, connected clients, errors |
| Service Bus | Dead-lettered messages, server errors, throttled requests |
| Recovery Services vaults | Backup job failures, backup health events |

## Subscription level (Essential for every onboarded subscription)

| Alert | Type | Notes |
|---|---|---|
| Service Health | activity log | incidents, planned maintenance, health advisories, security advisories |
| Resource Health | activity log | resource becomes Unavailable, platform-initiated |
| Resource deletion (VMs, Key Vaults, workspaces) | activity log | Administrative category, operation `…/delete`, status Succeeded |

Activity-log alerts are stateless: they fire once and never resolve. Pulse should present them as events rather than Fired/Resolved pairs.

## What we cannot monitor

- Anything inside the guest OS without the Azure Monitor Agent and a data collection rule: disk %, memory %, services, event logs.
- Application-level telemetry (requests, dependencies, exceptions) without Application Insights.
- Servers outside Azure unless they are Arc-enabled.
- Microsoft Entra, Microsoft 365 and other non-Azure-Monitor signals; Lighthouse is ARM-only.
- Data-plane content: blob data, Key Vault secrets, storage keys.
- Resources in subscriptions that have not been delegated to Synextra.
- Log-based alerts lag ingestion by roughly 2–15 minutes; metric alerts are faster. Pulse's lag badge will show this difference.

## Sources
- AMBA service catalogues: https://azure.github.io/azure-monitor-baseline-alerts/services/ (raw definitions at `https://raw.githubusercontent.com/Azure/azure-monitor-baseline-alerts/main/services/<RP>/<type>/alerts.yaml`)
- Supported metrics index: https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/metrics-index
- Alert types and multi-resource support: https://learn.microsoft.com/azure/azure-monitor/alerts/alerts-types

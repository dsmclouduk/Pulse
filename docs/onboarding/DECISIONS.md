# Azure onboarding: decision record

Status: draft for review. Owner: Dean Murray. Last updated 2026-09-15.

This records how Pulse gets access to a client's Azure estate, how much access it should have, and what that means for onboarding. Facts were verified against Microsoft Learn and the Azure Monitor Baseline Alerts (AMBA) catalogue in September 2026; links are at the end.

## D1. Access model: Azure Lighthouse from the Synextra tenant

**Decision:** use Azure Lighthouse delegation. Do not build the multi-tenant Entra application + admin-consent + `/auth/callback` flow that the earlier scaffolding implied.

**Why.** Everything Pulse touches is Azure Resource Manager: the metrics API, Resource Graph, Log Analytics queries, alert rules, action groups, data collection rules, Azure Monitor Agent extensions, Service Health and Resource Health. Lighthouse delegates all of that to principals in our own tenant, including service principals, so Pulse authenticates once with one credential and reaches every delegated customer. The existing `server/src/lib/azureAuth.ts` client-credentials pattern already fits this model.

| Pulse needs | Lighthouse | Notes |
|---|---|---|
| List subscriptions and resources (Resource Graph) | Yes | `GET /subscriptions` returns `managedByTenants`; Resource Graph queries span delegated subscriptions and return `tenantId` |
| Azure Monitor metrics API | Yes | ARM control plane |
| Log Analytics queries (guest disk history) | Yes | Listed by Microsoft as a cross-tenant scenario |
| Alerts, activity log, Service Health, Resource Health | Yes | Listed |
| Create alert rules, action groups, DCRs, diagnostic settings, AMA extensions, Policy | Yes | Needs Contributor-level built-in roles |
| Application Insights, AKS monitoring, Arc servers, Backup reports | Yes | Listed |
| Microsoft Entra / Graph data (users, sign-ins, M365) | No | Lighthouse is ARM-only; Pulse does not need this for monitoring |
| Data-plane access (blob contents, Key Vault secrets, storage keys) | No | Not needed for monitoring |

**Limits to design around.**
- Built-in roles only; no Owner, no roles containing `DataActions`, no custom roles. User Access Administrator is allowed only for assigning roles to managed identities (used by Policy remediation).
- Delegation is per subscription or per resource group, not management group. Defender for Cloud scenarios need whole-subscription delegation.
- Delegated role assignments do not appear in `az role assignment list`; they are visible under Lighthouse → Delegations in the portal.
- Customer action is still required once per subscription: deploy the Lighthouse registration template (or accept a Marketplace Managed Service offer later).

**Rejected alternative:** multi-tenant platform app with admin consent. It needs two customer actions (consent plus RBAC assignment), a consent callback with anti-spoofing, per-tenant token acquisition, and Graph permissions we do not otherwise need. Keep the `TenantConnection.credentialMode` field so this can be added later if a customer refuses Lighthouse.

## D2. Access posture: read-only for Pulse, write for engineers (Pulse write access deferred)

**Decision:** Pulse's service principal receives read-only roles. Any Azure changes (action groups, DCRs, alert rules, agent installs) are made by Synextra engineers running Pulse-generated scripts under their own delegated Contributor rights. Giving Pulse itself write access is deferred until there is a clear need and an agreed blast-radius review.

| Posture | Roles delegated | Pulse can |
|---|---|---|
| Read-only (build first) | Reader, Monitoring Reader, Log Analytics Reader | Discover resources, read metrics, query logs, list alerts and health, report coverage gaps, generate deployment scripts |
| Write (deferred) | plus Monitoring Contributor, Log Analytics Contributor | Also create action groups, DCRs and associations, alert rules, install AMA (`Microsoft.Compute/virtualMachines/extensions/write` is in Log Analytics Contributor) |

A single Lighthouse template can grant read-only roles to the Pulse service principal and Contributor roles to a Synextra engineers group at the same time. That is the recommended template.

## D3. Webhook authentication: per-client token in the URL

**Finding:** Azure action-group Webhook actions cannot send custom HTTP headers; credentials can only be carried in the URI. Secure Webhook uses an Entra service principal (`AZNS AAD Webhook`, appId `461e8683-5575-4561-ac7f-899cc907d62a`) and needs an app role on a protected API. Webhooks are retried up to five times (5/20/5/40/5 s) and the endpoint is muted for 15 minutes after repeated failure.

**Decision:** Pulse accepts `POST /api/webhook/azure-alerts/<clientWebhookToken>` where the token is a per-client, rotatable, URL-safe secret separate from the header secret. The `x-webhook-secret` header path stays for manual and ngrok testing. Secure Webhook is a later hardening item. The README and CLAUDE.md instructions to add a custom header were wrong for real action groups and must be corrected.

## D4. VM guest telemetry: one DCR per workspace, one association per VM

**Findings.** Data collection rule associations are many-to-many: one DCR can serve any number of VMs (a VM can carry up to 30 DCRs). Each association is its own ARM resource. The Azure Monitor Agent is installed once per VM and requires a managed identity. Azure Policy ("Enable Azure Monitor for VMs with Azure Monitoring Agent") can install the agent and associate the DCR at scale. The classic VM Insights DCR streams `Microsoft-InsightsMetrics` (`\VmInsights\DetailedMetrics`) to Log Analytics, which is what Pulse's disk-history provider already reads. Microsoft's newer default is OpenTelemetry performance metrics into an Azure Monitor workspace with query-based metric alerts (preview).

**Decision:** one VM Insights DCR per client workspace; one association per VM created in a scripted loop; Policy path documented for estates above roughly 1000 VMs. Stay on the classic InsightsMetrics path until query-based metric alerts leave preview.

## D5. Alert baseline: tiered subset of AMBA, deterministic names and tags

**Decision:** Pulse ships a versioned baseline (`pulse-baseline=<version>`) derived from AMBA in three tiers: Essential (every client), Standard (recommended), Full (everything AMBA lists). Every artifact is named `pulse-<client-slug>-<rule-key>[-<region>]` and tagged `pulse-managed=true`, `pulse-client=<slug>`, `pulse-baseline=<version>`, `pulse-rule=<key>` so coverage and drift can be read back from Resource Graph without any Pulse-side state.

Alert rule mechanics that shape the baseline:

| Rule type | ARM type | At-scale behaviour |
|---|---|---|
| Metric | `Microsoft.Insights/metricAlerts` | Multi-resource rules (one rule per region covering all resources of a type in a subscription) for VMs, SQL databases, elastic pools, Key Vault, Recovery Services vaults, PostgreSQL flexible servers. Not available for App Service, Storage, VM guest metrics or VM network metrics; those need one rule per resource. Billed per time series. |
| Log search | `Microsoft.Insights/scheduledQueryRules` | Scoped to the workspace and split by `_ResourceId`, so one rule alerts per VM. Billed per evaluation frequency. |
| Activity log | `Microsoft.Insights/activityLogAlerts` | Subscription scope for Service Health, Resource Health and resource deletion. Stateless: never auto-resolves. |

All of these are creatable with Azure CLI, Bicep or REST, so the whole baseline can be scripted.

## D6. Persistence: keep `db push` for now

No migrations directory exists and no production database is deployed. Continue with `prisma db push` until the first shared SQL Server exists, then switch to `prisma migrate` before adding the onboarding models.

## Open questions
1. Which customer becomes the Lighthouse pilot, and does their Azure agreement allow delegation to an MSP tenant?
2. Whether Synextra wants a Marketplace Managed Service offer (self-service onboarding) or template-only delegation.
3. When, if ever, Pulse should be granted write roles. Trigger for revisiting: engineers spending more than a few hours a month running generated scripts.

## Sources
- Azure Lighthouse cross-tenant management experiences: https://learn.microsoft.com/azure/lighthouse/concepts/cross-tenant-management-experience
- Action groups (webhook credentials in URI, retry rules, Secure Webhook): https://learn.microsoft.com/azure/azure-monitor/alerts/action-groups
- Data collection rules and associations: https://learn.microsoft.com/azure/azure-monitor/essentials/data-collection-rule-overview
- Enable VM monitoring at scale (AMA, DCR JSON, CLI, Policy): https://learn.microsoft.com/azure/azure-monitor/vm/vminsights-enable-overview
- Alert types and multi-resource support: https://learn.microsoft.com/azure/azure-monitor/alerts/alerts-types
- Azure Monitor Baseline Alerts: https://azure.github.io/azure-monitor-baseline-alerts/

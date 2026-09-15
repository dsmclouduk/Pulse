# Pulse product requirements: the alerter

Working notes from 2026-09-15. Pulse is an alert and action layer over Azure Monitor, not a metrics store or inventory. Azure remains the source of truth for what exists and for metric and log data; Pulse pulls those on demand. This document captures what Pulse must do to replace LogicMonitor as Synextra's alerter, and the decisions still open.

## 1. What Pulse stores (decided)

| Keep | Detail |
|---|---|
| Alerts | Every Fired/Resolved event: rule, severity, resource ID, fired/resolved/received times, lag, metric value and threshold at fire time |
| Comments and diagnoses | Operator notes, agent diagnoses with trend summary and urgency, system status notes |
| Alert-derived resource record | Any resource that has ever alerted: ID, type, region, first seen, last alert, counts. Not an inventory |
| Enrichment snapshot | The downsampled metric series the agent analysed (a few KB per alert) so the Metrics tab still renders after Azure retention has passed |

| Do not keep | Why |
|---|---|
| Raw metric or log history | Fetch from Azure Monitor / Log Analytics on demand; short in-memory cache only |
| Full resource inventory | Only useful for a coverage report, which is optional |

Retention: alerts and comments for around 180 days, then roll up to per-resource counts. Decide when the shared database exists.

## 2. Resource history and agent memory (shipped 2026-09-15)

- Resources page: every resource that has alerted, with alert counts, firing count, last alert, last diagnosis, note count.
- History tab in the alert flyout: previous alerts on the same resource with their diagnoses and notes; recurring resources flagged.
- The agent receives prior alerts on the same resource and similar alerts on the same resource type across clients, each with its diagnosis and operator notes, and is instructed to say "this happened previously in alert X; the noted resolution was Y" and to escalate urgency for recurrence.
- Dashboard: client-filterable counters (firing, fired/resolved 24 h, resources, mean time to resolve, webhook lag average and p95, agent urgency split, top resources, top rules).

Follow-ups: similarity should eventually match on metric plus dimension (for example the same mount letter) and on rule name fuzzily; notes should be markable as "resolution" so the agent weights them above ordinary comments.

## 3. Alert delivery (requirement, not yet built)

Synextra uses OpsGenie for the on-call rota and out-of-hours alerting. Pulse must deliver alerts outbound the way LogicMonitor does today.

| Requirement | Notes |
|---|---|
| Custom HTTP delivery integration | Configurable outbound webhook per destination: URL, method, headers (API key), JSON body template with alert fields (`{{ruleName}}`, `{{severity}}`, `{{resource}}`, `{{status}}`, `{{diagnosisSummary}}`, `{{urgency}}`, `{{pulseUrl}}`), separate templates for fired and resolved so OpsGenie can close the alert (alias = Pulse alert ID) |
| OpsGenie first | Alerts API v2 with `alias` for dedupe, `priority` mapped from severity and agent urgency, `responders` from a routing rule, close on Resolved |
| Routing rules | Per client and per severity: which destination, quiet hours, whether resolved events are sent, whether to wait for the agent diagnosis (a few seconds) so the payload includes it |
| Retries and audit | Retry with backoff, delivery log per alert (attempt, status code, response), visible in the flyout as a "Delivery" section |
| Also worth supporting | Microsoft Teams (Adaptive Card via workflow webhook), email (SMTP or Graph), generic webhook, and later ServiceNow / Jira for ticket creation |
| Suppression | Maintenance windows per resource or client; deduplicate flapping alerts; do not deliver while a resource is acknowledged |

Design note: Pulse-side delivery is preferable to point Azure action groups at OpsGenie directly because Pulse adds the diagnosis, the client context and the routing logic, and one action group per client stays simple.

## 4. Settings (requirement)

| Area | Settings |
|---|---|
| Agent | Provider (Anthropic / rule-based), model, API key (write-only, stored in Key Vault, never displayed), effort, timeout, cooldown, enable/disable per client, monthly token budget and spend readout |
| Integrations | Delivery destinations (OpsGenie, Teams, email, webhook) with test-send; Log Analytics workspace per client/subscription; Lighthouse status per client |
| Clients | Existing client account, tenant and subscription management; webhook secret display and rotation; per-client defaults (severity floor for delivery, quiet hours) |
| Alert handling | Auto-resolve behaviour for stateless activity-log alerts, simulated-alert visibility, retention |
| Users and access | See section 5 |
| Audit log | Who changed what, when; who acknowledged or commented; deliveries sent |

Secrets belong in Azure Key Vault (the App Service managed identity reads them); `.env` remains for local development only.

## 5. Identity, SSO, SCIM and roles (requirement; Phase 4 in CLAUDE.md)

Hosting target is Azure App Service, so Microsoft Entra ID is the natural identity provider.

| Decision | Recommendation |
|---|---|
| Sign-in | Entra ID SSO via MSAL (OpenID Connect). App Service's built-in authentication (Easy Auth) can enforce sign-in at the edge with almost no code; the app reads the identity headers and maps roles |
| Provisioning | Start with Entra **group claims** in the token mapped to Pulse roles; no user records to provision. SCIM is only needed if Pulse must know about users before they sign in (for example to assign alert ownership or on-call). Defer SCIM; add it when assignment features arrive |
| Roles | Three to begin with: **Reader** (view alerts, resources, dashboards, comments), **Operator** (plus acknowledge, comment, re-run analysis, simulate), **Admin** (plus settings, integrations, clients, API keys). Map each to an Entra group. Per-client scoping (a client user seeing only their own alerts) is a later fourth role if Pulse is ever exposed to clients |
| API access | Service-to-service via an API key or Entra app registration for OpsGenie callbacks (acknowledge from OpsGenie) and future automation |
| Enforcement | All `/api/admin/*` routes and write endpoints require Operator or Admin; the SSE stream and read endpoints require Reader; the webhook endpoint stays token-authenticated |

## 6. Other features worth having for an alerter

Ordered by expected value.

1. **Acknowledge and assign.** Acknowledge an alert (stops delivery re-notifications, shows who owns it), assign to a person, snooze until a time. Mirrors OpsGenie state back and forth.
2. **Grouping and dedupe.** Collapse repeated fires of the same rule on the same resource into one incident with a count; detect flapping.
3. **Escalation.** If not acknowledged within N minutes, deliver to the next destination (or let OpsGenie handle it and record the escalation).
4. **Maintenance windows.** Per resource, resource group or client, with a reason; alerts during a window are recorded but not delivered.
5. **Resolution notes and knowledge.** Mark a comment as the resolution; the agent prefers those; a searchable "similar alerts" view shows past resolutions across clients.
6. **Agent actions (guarded).** Suggested remediation with one-click execution behind approval, for example clearing a known temp directory via Run Command, once Pulse has any write path.
7. **Client-facing digest.** Weekly summary per client: alerts, MTTR, recurring resources, capacity forecasts from the trend analysis (disks projected to fill within 30 days).
8. **Service Health and Resource Health handling.** Present as events with expiry rather than Fired/Resolved rows.
9. **Reports and SLAs.** Time to acknowledge, time to resolve, per client and per severity; export to CSV.
10. **Mobile-friendly alert view** for on-call engineers opening links from OpsGenie.
11. **Audit trail** of every action, needed for MSP change evidence.

## 7. Open questions
- Which delivery destinations are needed at launch beyond OpsGenie? Teams for daytime visibility is the obvious second.
- Should acknowledgement in Pulse close the OpsGenie alert, or only the reverse?
- Do clients ever get access to Pulse, or is it internal only? This decides whether per-client roles are needed.
- Retention period and whether resolved alerts older than the window should be summarised or deleted.

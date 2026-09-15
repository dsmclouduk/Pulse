# Pulse

Pulse is a webhook-first Azure monitoring portal built to replace LogicMonitor. Azure Monitor alert events are pushed into an Express backend, normalized into a shared `AlertEvent` shape, persisted in an in-memory store, and broadcast to the React client over Server-Sent Events.

## What is implemented

- Phase 1: Azure Common Alert Schema webhook receiver, in-memory alert store, SSE stream, alert listing endpoint, and simulation endpoint
- Phase 2: React/Vite/Tailwind dashboard with live feed, lag badges, connection status, detail drawer, and simulation controls
- Phase 3: Optional Azure metrics polling, server-side cache, and minimal drawer charts
- Phase 3.5 (Demo 1): Alert enrichment. When an alert lands, Pulse pulls metric history for the resource (synthetic for simulated alerts, Log Analytics VM Insights for VM disk alerts, ARM metrics otherwise), runs a deterministic trend analysis (rapid fill vs steady growth, projection to full), and an in-app agent posts a diagnosis comment on the alert. The UI gained a Metrics tab (90-day chart with threshold, fired marker and projection), a Diagnosis tab (comment thread, re-run, operator notes), lag badges in the table, urgency dots, and a scenario-based Simulate page.

## Project layout

```text
.
|-- client
|-- prisma
|-- server
|-- shared
|-- .env.example
|-- CLAUDE.md
`-- README.md
```

## Environment setup

1. Copy `.env.example` to `.env`.
2. Set `WEBHOOK_SECRET` to a random shared secret for Azure Action Groups.
3. Set `DATABASE_URL` to your Azure SQL or local SQL Server connection string for Prisma.
4. Leave the Azure credential variables empty for now unless you are preparing for Phase 3.

## Install dependencies

```bash
npm install
npm run db:generate
```

## Database foundation

The repo now uses Prisma for the MSP multi-tenant data model, targeting Azure SQL / SQL Server.

Useful commands from the repo root:

```bash
npm run db:format
npm run db:validate
npm run db:generate
npm run db:push
npm run db:migrate:dev
npm run db:migrate:deploy
npm run db:studio
```

Current schema scope in [prisma/schema.prisma](prisma/schema.prisma):

- client accounts and sites
- tenant connections for customer Entra tenants
- platform users and client memberships
- Azure subscriptions and managed resources
- persisted alert event records
- dashboards and widgets

Alerts, comments and enrichment runs are written through Prisma when `DATABASE_URL` is set and the alert belongs to a client account; everything else stays in the in-memory store (capped at 500 alerts).

Local database (SQL Server 2022 in Docker, host port 14330 because a local SQL Server service often owns 1433):

```bash
npm run db:local            # docker compose up -d db
# .env
DATABASE_URL="sqlserver://localhost:14330;database=Pulse;user=sa;password=Pulse_Dev_Passw0rd!;encrypt=true;trustServerCertificate=true"
npm run db:push && npm run db:generate   # stop the dev server first: generate has to replace the query engine DLL it holds open
```

Create a client account (Settings → Clients, or `POST /api/admin/clients`) and fire a simulate with its `clientSlug`; the alert, its diagnosis comment and the enrichment run are then in `AlertEventRecord`, `AlertComment` and `AlertEnrichment` and come back after a restart.

## Azure hosting assumptions

The current MSP foundation assumes:

- the app runs in Azure App Service
- a single platform Entra application / service principal is used for cross-tenant onboarding
- customer tenants are onboarded through federated or consent-based tenant connections
- Azure Key Vault is available for platform secret and certificate management

New bootstrap admin endpoints:

- `GET /api/admin/platform-identity`
  Returns whether the App Service and platform identity settings are configured.
- `GET /api/admin/clients`
  Lists onboarded MSP client accounts from Prisma.
- `POST /api/admin/clients`
  Creates a client account, generates a webhook secret, creates tenant connections, and registers Azure subscriptions in a pending onboarding state.

## Run locally

Run both apps from the repo root:

```bash
npm run dev
```

Run them separately if you prefer:

```bash
npm run dev --workspace server
npm run dev --workspace client
```

- Server: http://localhost:3001
- Client: http://localhost:5173

## API endpoints

- `POST /api/webhook/azure-alerts` and `POST /api/webhook/azure-alerts/<webhookSecret>`
  Accepts Azure Common Alert Schema payloads. The first form requires the `x-webhook-secret` header (manual tests); the second carries the secret in the URL because Azure action groups cannot send custom headers. Either the global `WEBHOOK_SECRET` or a client's webhook secret is accepted.
- `GET /api/alerts/stream`
  SSE endpoint. Sends an immediate `init` payload, then `alert`, `comment` and `enrichment` events, plus `: ping` keepalives every 15 seconds.
- `GET /api/alerts`
  Returns the current alert list as JSON. Supports optional `clientAccountId`, `clientSlug`, and `subscriptionId` filters.
- `GET /api/alerts/comments?alertId=<id>` / `GET /api/alerts/comments/recent?limit=200`
  Comments (agent diagnoses, operator notes, system status) for one alert, or the most recent across alerts. Alert IDs are ARM paths, so they travel as query parameters.
- `POST /api/alerts/comments`
  Body `{ alertId, body, authorName?, clientSlug? }`. Adds an operator note and broadcasts it over SSE.
- `GET /api/alerts/enrichment?alertId=<id>`
  Enrichment status, trend analysis, downsampled metric history and comments for an alert. `GET /api/alerts/enrichment/summary` lists all statuses.
- `POST /api/alerts/enrichment/rerun`
  Body `{ alertId, clientSlug? }`. Re-fetches history and asks the agent for a fresh diagnosis (202, or 409 while one is running).
- `GET /api/simulate/scenarios`
  Lists the simulation presets (disk steady growth, disk rapid fill, disk flat, CPU sawtooth, memory leak).
- `POST /api/simulate/alert`
  Dev-only helper that builds a valid Azure-style payload and sends it through the same normalization, broadcast and enrichment path. Accepts `scenario`, `unique` (new alert id per fire), `firedAt` (simulate lag), `dimensions`, `syntheticHistory` and optional `clientSlug`.
- `GET /api/metrics/context?resourceId=<resourceId>&metricName=<metricName>`
  Returns cached or freshly queried Azure Monitor metric context for a resource. If Azure credentials are not configured, the endpoint returns a disabled status instead of failing the app.
- `GET /api/admin/platform-identity/validate`
  Uses Azure credentials to acquire an ARM token and confirms the platform identity is usable from the running environment.

## Test the pipeline with simulation

Start the server and client, then fire a simulated alert:

```bash
curl -X POST http://localhost:3001/api/simulate/alert \
  -H "Content-Type: application/json" \
  -d '{
    "ruleName": "High CPU - web-server-01",
    "severity": "Sev1",
    "status": "Fired",
    "resourceId": "/subscriptions/test/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/web-server-01",
    "metricName": "Percentage CPU",
    "metricValue": 97.4,
    "threshold": 90
  }'
```

Expected result:

- The server logs the rule, severity, status, and lag.
- `GET /api/alerts` returns the new alert at the top of the store.
- The browser feed updates live over SSE.
- The lag badge appears on the alert row and in the drawer.

## Demo the enrichment pipeline offline

No Azure credentials or LLM key are needed. Open the Simulate page, pick "Disk: steady growth (90 days)" and "Disk: rapid fill (6 hours)", fire both, then open each alert in the feed:

- the Agent column shows the urgency the agent assigned (immediate / soon / planned / informational)
- the Metrics tab shows the 90-day history with the threshold and fired markers and, for a steady trend, a dashed projection to 100%
- the Diagnosis tab shows the agent's comment. Without `ANTHROPIC_API_KEY` it is the deterministic rule-based diagnosis, labelled as such; with a key the same template is filled by Claude using structured output

Or from the shell:

```bash
curl -s -X POST http://localhost:3001/api/simulate/alert -H "Content-Type: application/json" \
  -d '{"scenario":"disk-rapid-fill","resourceId":"/subscriptions/test/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/web-01","unique":true}'
# then, with the returned id:
curl -s "http://localhost:3001/api/alerts/enrichment?alertId=<id>"
curl -s "http://localhost:3001/api/alerts/comments?alertId=<id>"
```

For real VM disk alerts, set `LOG_ANALYTICS_WORKSPACE_ID` (the workspace receiving VM Insights `InsightsMetrics`) alongside the Azure credentials; the service principal needs Log Analytics Reader. Other metric alerts use the ARM metrics API with the same credentials.

## Connect real Azure alerts with ngrok

1. Start the local server.
2. Start ngrok against the server port:

```bash
ngrok http 3001
```

3. Copy the HTTPS ngrok URL.
4. In Azure Portal, go to Monitor -> Alerts -> Action Groups.
5. Create or edit a webhook action. Azure action groups cannot send custom headers, so the secret goes in the URL path:
   URL: `https://<your-ngrok-id>.ngrok-free.app/api/webhook/azure-alerts/<WEBHOOK_SECRET or client webhook secret>`
   (The header form `x-webhook-secret` on `/api/webhook/azure-alerts` still works for curl and manual tests.)
6. Use a per-client webhook secret from Settings when the alert should land in that client's scope.
7. Enable `Use common alert schema`.
8. Attach the action group to an alert rule and trigger the condition.
9. Watch the live feed and lag badge in the UI.

## Notes

- The simulation endpoint is disabled automatically when `NODE_ENV=production`.
- The store is intentionally in-memory and capped at 500 alerts.
- Fired and Resolved transitions are upserted by `alert.id`, so the same alert row is updated in place.
- Alerts are webhook-driven. Polling will only be added later for metric context, not for alert delivery.
- Phase 3 polling is optional and only activates when `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` are configured.
- The metrics service uses the Azure Resource Manager metrics endpoint and caches per-resource results for roughly one minute to support the drawer charts without hammering Azure.
- The Prisma schema is the foundation for the MSP multi-client build, but the server has not been fully refactored off the in-memory alert store yet.
- Alerts are now persisted to Prisma when a scoped client can be resolved, and the alerts and SSE APIs support tenant and subscription filters.
- The current onboarding routes are bootstrap admin APIs and do not enforce user auth yet.
- Platform identity validation now uses Azure credential acquisition for ARM access, but customer-tenant consent and downstream ARM calls still need onboarding flow work.
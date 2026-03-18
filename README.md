# Pulse

Pulse is a webhook-first Azure monitoring portal built to replace LogicMonitor. Azure Monitor alert events are pushed into an Express backend, normalized into a shared `AlertEvent` shape, persisted in an in-memory store, and broadcast to the React client over Server-Sent Events.

## What is implemented

- Phase 1: Azure Common Alert Schema webhook receiver, in-memory alert store, SSE stream, alert listing endpoint, and simulation endpoint
- Phase 2: React/Vite/Tailwind dashboard with live feed, lag badges, connection status, detail drawer, and simulation controls
- Phase 3: Optional Azure metrics polling, server-side cache, and minimal drawer charts

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

This is the first persistence layer for the MSP pivot. The runtime alert pipeline is still using the in-memory store until the next refactor moves ingestion and queries onto Prisma.

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

- `POST /api/webhook/azure-alerts`
  Accepts Azure Common Alert Schema payloads and requires the `x-webhook-secret` header.
- `GET /api/alerts/stream`
  SSE endpoint. Sends an immediate `init` payload, then `alert` events, plus `: ping` keepalives every 15 seconds.
- `GET /api/alerts`
  Returns the current alert list as JSON. Supports optional `clientAccountId`, `clientSlug`, and `subscriptionId` filters.
- `POST /api/simulate/alert`
  Dev-only helper that builds a valid Azure-style payload and sends it through the same normalization and broadcast path. Accepts optional `clientSlug` for tenant-scoped simulation.
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

## Connect real Azure alerts with ngrok

1. Start the local server.
2. Start ngrok against the server port:

```bash
ngrok http 3001
```

3. Copy the HTTPS ngrok URL.
4. In Azure Portal, go to Monitor -> Alerts -> Action Groups.
5. Create or edit a webhook action:
   URL: `https://<your-ngrok-id>.ngrok-free.app/api/webhook/azure-alerts`
6. Add the custom header `x-webhook-secret` with the value from your `.env` file.
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
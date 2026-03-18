# CLAUDE.md

This file gives Claude Code the context it needs to work effectively in this repo.
Read this before touching any code.

---

## What This Project Is

A real-time Azure monitoring portal built to replace LogicMonitor.
Azure Monitor / Application Insights / Log Analytics are the data sources.
The defining architectural decision is **webhook-first alerting** — Azure pushes to us,
we do not poll for alerts.

---

## Current Development Phase

> Update this section as phases complete.

- [x] Phase 1 — Webhook pipeline + SSE + simulation endpoint
- [x] Phase 2 — React frontend (live feed, lag measurement, simulate panel)
- [x] Phase 3 — Azure Metrics polling (supplementary context charts)
- [ ] Phase 4 — Azure AD / Entra ID auth (MSAL)
- [ ] Phase 5 — Multi-subscription scope selector

---

## Architecture

```
Azure Monitor
    │  fires alert → POST /api/webhook/azure-alerts
    ▼
Express Server (server/)
    │  normalises → AlertEvent
    │  stamps receivedAt, calculates lagMs
    │  broadcasts → SSE
    ▼
React Client (client/)
    │  EventSource /api/alerts/stream
    │  upserts alert state
    ▼
Live Alert Feed UI
    shows lag badge (green <5s / amber 5–30s / red >30s)
```

---

## Monorepo Layout

```
/prisma          Prisma schema for Azure SQL multi-tenant persistence
/client          React 18 + TypeScript + Vite + Tailwind
/server          Node.js + Express + TypeScript
/shared          Types shared between client and server
CLAUDE.md        This file
README.md        Setup and ngrok instructions
.env.example     All required environment variables
```

---

## Key Files to Know

| File | Purpose |
|---|---|
| `shared/types.ts` | Single source of truth for AlertEvent and all shared types |
| `prisma/schema.prisma` | Azure SQL Prisma schema for MSP tenants, users, subscriptions, resources, alerts, and dashboards |
| `server/src/lib/normalise.ts` | Converts raw Azure Common Alert Schema → AlertEvent |
| `server/src/lib/alertStore.ts` | In-memory alert store, capped at 500, newest first |
| `server/src/lib/prisma.ts` | Shared Prisma client singleton for server-side persistence work |
| `server/src/lib/sseRegistry.ts` | SSE client registry and broadcast function |
| `server/src/routes/webhook.ts` | Receives real Azure webhook POSTs |
| `server/src/routes/simulate.ts` | Simulation endpoint — same code path as real webhooks |
| `server/src/routes/sse.ts` | SSE stream endpoint, sends init payload on connect |
| `client/src/hooks/useAlertStream.ts` | SSE hook with auto-reconnect and alert upsert logic |

---

## Core Data Type

All alert data flows through `AlertEvent` defined in `shared/types.ts`.
Never define alert shapes locally in client or server — always import from shared.

```typescript
interface AlertEvent {
  id: string;
  ruleName: string;
  severity: 'Sev0' | 'Sev1' | 'Sev2' | 'Sev3' | 'Sev4';
  status: 'Fired' | 'Resolved';
  signalType: 'Metric' | 'Log' | 'ActivityLog';
  resourceIds: string[];
  resourceGroup?: string;
  subscriptionId?: string;
  firedAt: string;          // ISO — from Azure payload
  resolvedAt: string | null;
  receivedAt: string;       // ISO — stamped by our server on receipt
  lagMs: number;            // receivedAt - firedAt in ms — key metric
  metricName?: string;
  metricValue?: number;
  threshold?: number;
  description?: string;
  isSimulated: boolean;
}
```

---

## Webhook Security

Real webhook endpoint requires `x-webhook-secret` header matching `process.env.WEBHOOK_SECRET`.
Simulation endpoint (`/api/simulate/alert`) does NOT require the secret — it's dev-only.
Never expose the simulation endpoint in production.

If you add any new endpoints that receive external data, validate the secret header first.

---

## SSE Pattern

The SSE registry lives in `server/src/lib/sseRegistry.ts`.
The broadcast function signature is:

```typescript
broadcast(event: AlertEvent): void
```

Every route that creates or updates an AlertEvent must call broadcast.
The SSE stream sends two event types:
- `{ type: 'init', alerts: AlertEvent[] }` — sent once on client connect
- `{ type: 'alert', alert: AlertEvent }` — sent on every new/updated alert

The client upserts by `alert.id` so Fired → Resolved transitions update the same row.

---

## Lag Measurement

`lagMs` is calculated in `normalise.ts`:

```typescript
const lagMs = new Date(receivedAt).getTime() - new Date(firedAt).getTime();
```

This is the primary metric we're tracking in Phase 1.
It must be visible in the UI on every alert row (lag badge).
Lag badge colours: green < 5000ms / amber 5000–30000ms / red > 30000ms.

---

## Environment Variables

Copy `.env.example` to `.env` before running anything.

| Variable | Required for | Notes |
|---|---|---|
| `WEBHOOK_SECRET` | Phase 1 | Any random string, used as shared secret with Azure |
| `PORT` | Phase 1 | Default 3001 |
| `DATABASE_URL` | MSP persistence | Azure SQL / SQL Server connection string used by Prisma |
| `APP_SERVICE_URL` | Azure hosting | Public App Service URL used for platform metadata and future callback generation |
| `AZURE_PLATFORM_TENANT_ID` | MSP cross-tenant auth | Home tenant for the platform application |
| `AZURE_PLATFORM_CLIENT_ID` | MSP cross-tenant auth | Client ID of the shared platform application |
| `AZURE_PLATFORM_APP_OBJECT_ID` | MSP cross-tenant auth | Optional object ID of the platform app/service principal |
| `AZURE_KEY_VAULT_URI` | Azure hosting | Key Vault for platform secrets, certificates, and webhook material |
| `AZURE_TENANT_ID` | Phase 3+ | Not needed for Phase 1 or 2 |
| `AZURE_CLIENT_ID` | Phase 3+ | Not needed for Phase 1 or 2 |
| `AZURE_CLIENT_SECRET` | Phase 3+ | Not needed for Phase 1 or 2 |
| `AZURE_SUBSCRIPTION_IDS` | Phase 3+ | Comma-separated |
| `NGROK_URL` | Dev reference | Reminder only, not consumed by app |

---

## Dev Setup

```bash
# Install all dependencies
cd server && npm install
cd ../client && npm install

# Run both concurrently (from root, if concurrently is set up)
npm run dev

# Or separately:
cd server && npm run dev      # http://localhost:3001
cd client && npm run dev      # http://localhost:5173
```

---

## Testing the Webhook Pipeline

### Option A — Simulation (no Azure needed)
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

### Option B — Real Azure via ngrok
1. Start ngrok: `ngrok http 3001`
2. Copy the `https://xxxx.ngrok-free.app` URL
3. In Azure Portal: Monitor → Alerts → Action Groups
4. Add Webhook action, URL: `https://xxxx.ngrok-free.app/api/webhook/azure-alerts`
5. Add custom header: `x-webhook-secret` = your `WEBHOOK_SECRET` value
6. Enable **Use common alert schema: YES** (critical)
7. Create an alert rule on any resource with a threshold you can breach
8. Breach the threshold and watch the lag badge in the UI

---

## Coding Conventions

- TypeScript strict mode on everywhere — no `any` without a comment explaining why
- Prisma is the persistence layer for the MSP foundation and targets Azure SQL / SQL Server
- Assume Azure App Service hosting and a single platform Entra application for cross-tenant MSP onboarding work
- All shared types in `shared/types.ts` — never duplicate type definitions
- Server routes are thin — business logic lives in `lib/`
- React components are functional — no class components
- No UI component libraries — build from scratch with Tailwind
- Imports from shared: `import { AlertEvent } from '../../shared/types'`
- Console logs on the server should include: timestamp, route, key identifiers
- Never `console.log` sensitive values (secrets, full auth tokens)

---

## What Not to Do

- Do not add Azure AD auth until Phase 4 is explicitly started — keep it simple for now
- Do not poll for alerts — webhooks only (polling is Phase 3 metrics only, and for metrics context not alerts)
- Do not bypass the Prisma schema when adding MSP persistence work — keep relational ownership and tenant boundaries explicit
- Do not assume per-client app registrations by default — current direction is one platform identity with tenant-scoped consent/onboarding
- Do not use a UI component library (MUI, Chakra, shadcn) — Tailwind only
- Do not implement alert acknowledgement/suppression until core pipeline is stable
- Do not skip the simulation endpoint — it's required for offline development

---

## Azure Common Alert Schema Reference

The webhook payload Azure sends looks like this:

```json
{
  "schemaId": "azureMonitorCommonAlertSchema",
  "data": {
    "essentials": {
      "alertId": "/subscriptions/.../alerts/...",
      "alertRule": "High CPU on web-server-01",
      "severity": "Sev1",
      "signalType": "Metric",
      "monitorCondition": "Fired",
      "alertTargetIDs": ["/subscriptions/.../virtualMachines/web-server-01"],
      "firedDateTime": "2026-03-17T10:23:00Z",
      "resolvedDateTime": null
    },
    "alertContext": {
      "condition": {
        "allOf": [{
          "metricName": "Percentage CPU",
          "operator": "GreaterThan",
          "threshold": "90",
          "metricValue": "97.4"
        }]
      }
    }
  }
}
```

`monitorCondition` is either `"Fired"` or `"Resolved"`.
Always use `essentials.alertId` as the AlertEvent `id` for upsert matching.

---

## Roadmap (do not implement ahead of schedule)

| Phase | Feature | Status |
|---|---|---|
| 1 | Webhook receiver + SSE + simulation endpoint | In progress |
| 2 | React frontend — live feed + lag display + simulate panel | Not started |
| 3 | Azure Metrics API polling for chart context | Complete |
| 4 | Azure AD / Entra ID auth via MSAL | Not started |
| 5 | Multi-subscription scope selector | Not started |
| 6 | Alert acknowledgement (write back to Azure) | Not started |
| 7 | Webhook receiver for App Insights smart detection | Not started |
| 8 | Azure Service Health integration | Not started |

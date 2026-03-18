# Azure Monitor Portal — Claude Code Prompt
# LogicMonitor Replacement | Webhook-First Architecture

---

Paste this entire prompt into Claude Code to scaffold the project.

---

```
Build a full-stack real-time monitoring portal to replace LogicMonitor, using Azure-native 
services as the data backend. The architecture is webhook-first: Azure Action Groups push 
alert events directly to our Express backend the instant they fire, which then streams them 
to connected browser clients via SSE. Polling is a fallback only.

The immediate goal is a working end-to-end pipeline:
  Azure Alert fires → webhook hits our server → SSE pushes to frontend → alert appears live

We want to be able to trigger and simulate alerts from real Azure resources and measure 
the actual end-to-end lag from fire to UI.

---

## Architecture Overview

  [Azure Monitor]
      detects threshold breach on any resource
           │
           │  POST /api/webhook/azure-alerts  (Azure Common Alert Schema)
           ▼
  [Express Backend]
      validates shared secret
      normalises to internal AlertEvent shape
      persists to in-memory store (+ optional Redis)
      stamps receivedAt for lag measurement
           │
           │  SSE event broadcast to all subscribers
           ▼
  [React Frontend]
      EventSource receives event
      React state upserts alert (Fired → Resolved handled)
      Alert appears in live feed with lag timestamp visible

---

## Phase 1 — Core Webhook Pipeline (build this first, nothing else)

### 1.1 Express Webhook Receiver

POST /api/webhook/azure-alerts
- Accept Azure Common Alert Schema payload (schemaId: "azureMonitorCommonAlertSchema")
- Validate shared secret via x-webhook-secret header (env: WEBHOOK_SECRET)
- Return 200 immediately — never make Azure wait
- Stamp receivedAt = Date.now() on the event for lag tracking
- Normalise to internal AlertEvent type (see Shared Types below)
- Broadcast to all SSE clients
- Push to in-memory alertStore (capped at 500 events, newest first)
- Log to console: alert rule name, severity, status, and lag from firedDateTime to receivedAt

### 1.2 SSE Stream Endpoint

GET /api/alerts/stream
- Set headers: Content-Type: text/event-stream, Cache-Control: no-cache, Connection: keep-alive
- On connect: immediately send { type: "init", alerts: alertStore } so client hydrates instantly
- Keep a sseClients registry (Map<id, Response>)
- Clean up on req close
- Send a keepalive comment (": ping") every 15 seconds to prevent proxy timeouts

### 1.3 Alert Store Endpoint

GET /api/alerts
- Returns current alertStore as JSON
- Used for initial load and as fallback if SSE connection fails

### 1.4 Simulation Endpoint (critical for dev/testing)

POST /api/simulate/alert
- Accepts a simplified body:
  {
    "ruleName": "High CPU - web-server-01",
    "severity": "Sev1",
    "status": "Fired",         // or "Resolved"
    "resourceId": "/subscriptions/xxx/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/web-server-01",
    "metricName": "Percentage CPU",
    "metricValue": 97.4,
    "threshold": 90
  }
- Wraps into a valid Azure Common Alert Schema payload internally
- Passes through the same normalisation and broadcast path as a real webhook
- This means you can test the full pipeline without needing Azure configured
- Returns the normalised AlertEvent with lag measurement included

---

## Shared Types (in /shared/types.ts)

```typescript
export type AlertSeverity = 'Sev0' | 'Sev1' | 'Sev2' | 'Sev3' | 'Sev4';
export type AlertStatus = 'Fired' | 'Resolved';
export type SignalType = 'Metric' | 'Log' | 'ActivityLog';

export interface AlertEvent {
  id: string;                    // Azure alert ID
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  signalType: SignalType;
  resourceIds: string[];
  resourceGroup?: string;
  subscriptionId?: string;
  firedAt: string;               // ISO string from Azure
  resolvedAt: string | null;
  receivedAt: string;            // ISO string — when our server got the webhook
  lagMs: number;                 // receivedAt - firedAt in milliseconds
  metricName?: string;
  metricValue?: number;
  threshold?: number;
  description?: string;
  isSimulated: boolean;
}

export interface SSEMessage {
  type: 'init' | 'alert' | 'ping';
  alerts?: AlertEvent[];         // for type: init
  alert?: AlertEvent;            // for type: alert
}
```

---

## Phase 2 — React Frontend (after Phase 1 is working end-to-end)

### Stack
- React 18 + TypeScript
- Vite
- Tailwind CSS
- Recharts for any sparklines/charts
- No UI component library — build components from scratch

### Design Direction
Dark theme. Dense, utilitarian, data-forward. Think ops dashboard, not marketing site.
Use a monospace font for metric values and timestamps. Clear severity colour coding:
  Sev0/Sev1 → red
  Sev2       → amber  
  Sev3       → yellow
  Sev4       → blue
  Resolved   → green

### Components to Build

#### LiveAlertFeed
- Scrollable list of AlertEvent items, newest at top
- Each row shows: severity badge, rule name, resource (shortened), fired time (relative), lag badge
- Lag badge colour: green <5s, amber 5–30s, red >30s — this is the key metric we're watching
- Fired alerts have a pulsing left border
- Resolved alerts dim slightly but stay in feed
- Clicking a row opens AlertDetailDrawer

#### AlertDetailDrawer
- Slides in from the right
- Shows all AlertEvent fields in full
- Prominent lag display: "Received in 3.2s" 
- Shows full resource ID
- If simulated, shows a "SIMULATED" badge

#### StatusBar (top of page)
- SSE connection status: Connected (green dot) / Reconnecting (amber) / Disconnected (red)
- Total firing alerts count
- Last received timestamp

#### SimulatePanel (collapsible, bottom of page or side drawer)
- Simple form to POST to /api/simulate/alert
- Fields: Rule Name, Severity (dropdown), Status (Fired/Resolved), Resource ID, Metric Name, Value, Threshold
- Pre-populated with sensible defaults
- "Fire Alert" and "Resolve Alert" quick-action buttons for one-click testing
- Shows the raw AlertEvent returned by the server so you can inspect the lag

#### useAlertStream hook
```typescript
// Manages SSE connection with auto-reconnect
// On init message: replaces alert state with full store
// On alert message: upserts by id (handles both Fired and Resolved)
// Exposes: alerts[], connectionStatus, lastReceivedAt
// Auto-reconnects with exponential backoff (1s, 2s, 4s, max 30s)
```

---

## Phase 3 — Azure Metrics Polling (after Phase 1 and 2 are solid)

Once the live alert pipeline is working, add a background poller for metrics context:

- Poll Azure Monitor Metrics REST API every 60 seconds
- Pull CPU %, memory %, and HTTP response time for configured resources
- Surface as sparkline charts in the alert detail drawer (so when you see a CPU alert, you see the metric history inline)
- This is supplementary context only — alerts are still webhook-driven

---

## Project Structure

```
/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── LiveAlertFeed.tsx
│   │   │   ├── AlertDetailDrawer.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   └── SimulatePanel.tsx
│   │   ├── hooks/
│   │   │   └── useAlertStream.ts
│   │   ├── types/                  # re-exports from shared
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
│
├── server/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── webhook.ts
│   │   │   ├── sse.ts
│   │   │   ├── alerts.ts
│   │   │   └── simulate.ts
│   │   ├── lib/
│   │   │   ├── alertStore.ts       # in-memory store with cap
│   │   │   ├── sseRegistry.ts      # SSE client registry + broadcast
│   │   │   └── normalise.ts        # Azure payload → AlertEvent
│   │   └── index.ts
│   ├── tsconfig.json
│   └── package.json
│
├── shared/
│   └── types.ts
│
├── .env.example
├── CLAUDE.md
└── README.md
```

---

## Environment Variables (.env.example)

```
# Webhook security
WEBHOOK_SECRET=changeme-generate-a-random-string

# Server
PORT=3001

# Azure (needed for Phase 3 metrics polling — not required for Phase 1)
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_SUBSCRIPTION_IDS=        # comma-separated

# Dev tunnel (ngrok URL — update when you restart ngrok)
# Used only as a reference reminder, not consumed by the app
NGROK_URL=https://xxxx.ngrok-free.app
```

---

## Build Order Instructions for Claude Code

Work in this exact sequence. Do not skip ahead.

1. Scaffold the full monorepo structure with all config files
2. Implement shared/types.ts
3. Implement server: alertStore, sseRegistry, normalise
4. Implement server routes: webhook, sse, alerts, simulate
5. Verify Phase 1 works: use curl or Postman to POST to /api/simulate/alert and confirm SSE stream receives the event
6. Scaffold React client with Vite + Tailwind
7. Implement useAlertStream hook
8. Implement StatusBar, LiveAlertFeed, AlertDetailDrawer, SimulatePanel
9. Wire everything together in App.tsx
10. Write README.md with ngrok setup instructions

---

## Testing the Pipeline (describe in README)

### With simulation (no Azure needed):
```bash
# Terminal 1 — start server
cd server && npm run dev

# Terminal 2 — start client  
cd client && npm run dev

# Terminal 3 — fire a simulated alert
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

### With real Azure via ngrok:
```bash
# Start ngrok pointing at your server port
ngrok http 3001

# Take the https URL from ngrok output, e.g.:
# https://abc123.ngrok-free.app

# In Azure Portal:
# Monitor → Alerts → Action Groups → New Action Group
# Add action type: Webhook
# URL: https://abc123.ngrok-free.app/api/webhook/azure-alerts
# Add custom header: x-webhook-secret: <your WEBHOOK_SECRET value>
# Enable "Use common alert schema": YES

# Then trigger an alert:
# Go to any resource (VM, App Service, etc.)
# Monitor → Alerts → Create alert rule
# Set a threshold you can easily breach (e.g. CPU > 1%)
# Assign the action group above
# Trigger it by doing something on the resource

# Watch the lag badge in the UI
```
```

---

## Notes

- Always use the Azure Common Alert Schema on action groups — set "Use common alert schema" to YES
- The simulation endpoint is not a mock — it runs through identical code paths to real webhooks
- Keep the lag measurement prominent in the UI — it's the primary thing we're validating in Phase 1
- Do not implement Azure AD auth in Phase 1 — keep the webhook endpoint open (secret header is sufficient for now)
- Redis integration is optional — in-memory store is fine for Phase 1 and 2
```

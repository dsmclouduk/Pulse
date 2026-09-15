# Live test readiness plan

Goal: run Pulse against a real Azure Monitor alert from a test VM, end to end, from a developer laptop. Persistence, Azure auth, tunnelling, the test estate and the agent key are the prerequisites. Written 2026-09-15; tracked in the GitHub milestone "Live test readiness".

## 1. Database: local SQL Server now, Azure SQL later

Prisma targets `sqlserver`, so the local database should be SQL Server too, not SQLite, or the schema (NVarChar(Max), cascade rules) will drift.

- **Local:** SQL Server 2022 in Docker via `docker compose up -d db` (`docker-compose.yml` in the repo root). Connection string for `.env`:
  `DATABASE_URL="sqlserver://localhost:14330;database=Pulse;user=sa;password=<from compose>;encrypt=true;trustServerCertificate=true"`
  Then `npm run db:push` (schema) and `npm run db:generate`. Alerts, comments and enrichment then survive restarts and the client accounts UI works.
- **Later:** Azure SQL Database (serverless tier is enough) in the Synextra tenant, App Service connects with its managed identity (`Authentication=Active Directory Managed Identity` in the connection string, Prisma supports it through the `sqlserver` driver with an access token; fall back to SQL auth stored in Key Vault if that proves awkward). Switch from `db push` to `prisma migrate` at that point so schema changes are reproducible.
- Behaviour without a database is unchanged (in-memory, capped at 500 alerts), so nothing breaks if the container is down.

## 2. Authenticating to the Synextra tenant from a laptop

Yes: a temporary service principal with a client secret is the right local answer, and it is exactly the credential shape the server already reads (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`). Two rules: the secret lives only in `.env` (gitignored) and expires within 90 days; production will use the App Service managed identity or a Key Vault certificate instead.

```bash
# In the Synextra tenant, once:
az ad sp create-for-rbac --name pulse-dev --skip-assignment --years 0.25
# → appId (AZURE_CLIENT_ID), password (AZURE_CLIENT_SECRET), tenant (AZURE_TENANT_ID)

# Read-only roles on the test subscription (or resource group), matching the read-only posture:
az role assignment create --assignee <appId> --role "Monitoring Reader"     --scope /subscriptions/<testSub>
az role assignment create --assignee <appId> --role "Log Analytics Reader"  --scope /subscriptions/<testSub>
az role assignment create --assignee <appId> --role "Reader"                --scope /subscriptions/<testSub>
```

If the test VM lives in a client tenant rather than Synextra's, delegate that subscription to Synextra with Lighthouse and grant the same roles to `pulse-dev` inside the Lighthouse template. For the very first run, a subscription in the Synextra tenant is simpler.

Verify from the laptop: `GET /api/settings/summary` shows the service principal as configured, and `GET /api/metrics/context?resourceId=<vm>` returns real series.

## 3. ngrok for webhook passthrough

Azure action groups need a public HTTPS URL. ngrok's free tier gives one static domain, which avoids re-editing the action group every restart.

- Set `APP_SERVICE_URL=https://<your-static>.ngrok-free.dev` in `.env`. `npm run tunnel` runs `ngrok http 3001 --url <that domain>` for you (or run the command yourself); Settings shows the correct action-group URL from the same value.
- Action group webhook URL: `https://<your-static>.ngrok-free.app/api/webhook/azure-alerts/<WEBHOOK_SECRET>` with "Use common alert schema" on. No header needed or possible.
- ngrok's inspector at http://127.0.0.1:4040 shows every Azure POST and Pulse's response, which is the fastest way to debug payload or secret problems.

Note the free tier shows an interstitial page for browser requests but not for API POSTs, so the webhook is unaffected.

## 4. Test estate in Azure

One small VM is enough for the demo scenarios; the following creates everything the alert flow needs.

| Step | What | How |
|---|---|---|
| Resource group and VM | `rg-pulse-test`, a B2s Windows Server VM with system-assigned managed identity | `az vm create … --assign-identity` |
| Log Analytics workspace | `law-pulse-test` in the same region | `az monitor log-analytics workspace create` |
| VM Insights DCR | classic InsightsMetrics DCR (`\VmInsights\DetailedMetrics`, 60 s) to the workspace | `az monitor data-collection rule create --rule-file dcr-vminsights.json` |
| Azure Monitor Agent | extension on the VM | `az vm extension set --name AzureMonitorWindowsAgent --publisher Microsoft.Azure.Monitor` |
| DCR association | link VM to DCR | `az monitor data-collection rule association create` |
| Action group | webhook to the ngrok URL, common schema | `az monitor action-group create --action webhook pulse <url> useCommonAlertSchema` |
| CPU alert (platform metric) | Percentage CPU > 5 for 1 min, Sev2, auto-mitigate | `az monitor metrics alert create` |
| Disk alert (guest, log) | `InsightsMetrics` LogicalDisk FreeSpacePercentage < 90 split by `_ResourceId`, 5-min frequency | `az monitor scheduled-query create` |
| Service Health alert | subscription scope | `az monitor activity-log alert create` |

Breach on demand: CPU with a PowerShell busy loop; disk with `fsutil file createnew C:\fill.bin <bytes>`. Set `LOG_ANALYTICS_WORKSPACE_ID` to the workspace's customer ID so the disk alert's history comes from Log Analytics. Expect the log-based alert to lag 5–15 minutes; the metric alert fires within about 2 minutes.

These commands are the seed of the baseline script generator (#36); capture them as a runnable `scripts/azure/test-estate.sh` so the estate can be rebuilt.

## 5. Outside Azure

| Need | Notes |
|---|---|
| Anthropic API key | `ANTHROPIC_API_KEY` in `.env`; without it the rule-based agent runs. Default model `claude-opus-5`; `claude-sonnet-5` is cheaper for volume testing. Budget a few pounds for a day of testing |
| ngrok account | Free tier, one static domain |
| Docker Desktop | For local SQL Server |
| OpsGenie sandbox (later) | For delivery testing (#45); a free team or a test API integration is enough |
| Entra test users/groups (later) | For SSO and role mapping (#47) |

Nothing else outside Azure is required for the first live alert.

## 6. Usability items that make live testing bearable

- Dev convenience: `npm run dev:all` starts DB, server and client; a health page or the System settings section shows what is connected.
- Stateless activity-log alerts (Service Health) need an "event" presentation so they do not sit as Fired forever.
- Real alert payloads should be visible raw in the flyout (an "Payload" view of the Common Alert Schema JSON) for debugging mapping issues.
- Acknowledge/snooze (#48) is the first workflow feature that live testing will make you want.

## 7. Order of work

1. Local SQL Server + `db push` (unblocks persistence and client accounts)
2. Dev service principal + roles, `.env` filled in, settings summary green
3. ngrok static domain + `APP_SERVICE_URL`
4. Test estate script, action group pointing at ngrok
5. First live alert: CPU (metric) then disk (log); confirm lag badge, Metrics tab from Azure, diagnosis
6. Anthropic key on; compare rule-based vs Claude diagnosis on the same alert
7. Raw payload view and any mapping fixes found
8. Azure SQL + App Service deployment planning (separate milestone)

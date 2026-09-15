#!/usr/bin/env node
/**
 * Creates the "Live test readiness" milestone and issues (docs/LIVE-TEST-PLAN.md).
 *   node scripts/github/live-test-issues.mjs            # dry run
 *   node scripts/github/live-test-issues.mjs --apply
 */
import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const MILESTONE = 'Live test readiness';

function gh(args, { json = false } = {}) {
  const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return json ? JSON.parse(out || 'null') : out;
}

const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
if (gh(['api', `repos/${repo}`, '--jq', '.permissions.push']) !== 'true') {
  console.error(`No push access to ${repo}; run gh auth switch.`);
  process.exit(1);
}

const LABELS = [
  ['area:devex', '5319E7', 'Local development experience'],
  ['area:infra', '0E8A16', 'Hosting, database, deployment']
];

const PLAN = 'See docs/LIVE-TEST-PLAN.md.';

/** @type {Array<{title:string,labels:string[],body:string,done?:string}>} */
const ISSUES = [
  {
    title: 'L-1 Local SQL Server via Docker Compose, db push, persistence verified',
    labels: ['area:devex', 'area:infra'],
    body: `Run SQL Server 2022 locally with \`npm run db:local\` (docker-compose.yml), set DATABASE_URL, \`npm run db:push && npm run db:generate\`.

**Acceptance**: alerts, comments and enrichment survive a server restart; client accounts can be created in Settings → Clients; a scoped simulate (clientSlug) lands in that client's scope; \`GET /api/settings/summary\` shows persistence mode prisma. Fix any Prisma issues the new AlertComment/AlertEnrichment models surface on real SQL Server. ${PLAN}`
  },
  {
    title: 'L-2 Dev service principal in the Synextra tenant with read-only roles; .env filled in',
    labels: ['area:azure', 'area:devex'],
    body: `\`az ad sp create-for-rbac --name pulse-dev --skip-assignment --years 0.25\`, then Reader + Monitoring Reader + Log Analytics Reader on the test subscription. Put AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET in .env (never committed; rotate within 90 days).

**Acceptance**: Settings → Integrations shows credentials configured; \`GET /api/metrics/context?resourceId=<test VM>\` returns real series. ${PLAN} section 2.`
  },
  {
    title: 'L-3 ngrok static domain, ngrok.yml, APP_SERVICE_URL, webhook passthrough verified',
    labels: ['area:devex'],
    body: `Copy ngrok.yml.example → ngrok.yml with authtoken and free static domain; \`npm run tunnel\`; set APP_SERVICE_URL to the ngrok URL so Settings shows the correct action-group webhook URL.

**Acceptance**: a curl POST of a Common Alert Schema payload to \`https://<static>.ngrok-free.app/api/webhook/azure-alerts/<WEBHOOK_SECRET>\` returns 200 and appears in the feed; the ngrok inspector (127.0.0.1:4040) shows the request. ${PLAN} section 3.`
  },
  {
    title: 'L-4 Test estate script: VM + AMA + VM Insights DCR + workspace + action group + alert rules',
    labels: ['area:azure'],
    body: `\`scripts/azure/test-estate.sh\` builds rg-pulse-test: B2s Windows VM with managed identity, Log Analytics workspace, VM Insights DCR and association, AMA extension, action group to the ngrok URL (common schema), CPU metric alert (> 5%), OS disk log alert (InsightsMetrics split by _ResourceId), Service Health alert. All Pulse-tagged.

**Acceptance**: script runs idempotently; \`az monitor data-collection rule association list\` shows the association; \`Heartbeat\` and \`InsightsMetrics\` rows appear in the workspace within 10 minutes; LOG_ANALYTICS_WORKSPACE_ID set in .env. ${PLAN} section 4.`
  },
  {
    title: 'L-5 First live alerts: CPU (metric) and disk (log) from the test VM through to diagnosis',
    labels: ['area:azure'],
    body: `Breach CPU with a busy loop and disk with fsutil. Confirm in Pulse: Fired then Resolved via the token URL, lag badge values (metric ~1–2 min, log 5–15 min), Metrics tab shows ARM history for CPU and Log Analytics history for disk, diagnosis posted. Record timings and screenshots in docs/onboarding/LIVE-TEST.md. Supersedes #20 and #38 for the Synextra-tenant case.`
  },
  {
    title: 'L-6 Anthropic key on: compare Claude vs rule-based diagnosis on the same live alert',
    labels: ['area:agent'],
    body: `Set ANTHROPIC_API_KEY; re-run analysis on the live disk alert; compare with the rule-based comment. Check prior-alert references, prompt-injection resistance (description containing instructions), token usage and latency in the comment footer. Decide default model for testing (claude-opus-5 vs claude-sonnet-5).`
  },
  {
    title: 'L-7 Raw payload view in the alert flyout and mapping fixes from real payloads',
    labels: ['area:ui', 'area:server'],
    body: `Show the stored Common Alert Schema JSON (rawPayloadJson) in a Payload view for debugging. Fix anything real payloads reveal: dimensions for log alerts, resolvedDateTime handling, activity-log/Service Health shape (no metric, stateless), multi-target alertTargetIDs.`
  },
  {
    title: 'L-8 Stateless alerts (Service Health, Resource Health, activity log) presented as events',
    labels: ['area:ui', 'area:server'],
    body: `Activity-log alerts never resolve. Mark signalType ActivityLog alerts as events: auto-expire from "firing" counts after a configurable window, show an "event" chip instead of Fired, exclude from firing totals and severity chips.`
  },
  {
    title: 'L-9 Dev experience: dev:all, health check in Settings → System, README quick start',
    labels: ['area:devex', 'type:docs'],
    body: `\`npm run dev:all\` (DB + server + client), Settings → System shows DB/Azure/ngrok/agent connectivity checks live, README quick start covering docker, SP, ngrok, test estate in order. ${PLAN} sections 6–7.`
  },
  {
    title: 'L-10 Production hosting plan: Azure SQL, App Service, managed identity, Key Vault, migrations',
    labels: ['area:infra'],
    body: `Decide and document: Azure SQL (serverless) + \`prisma migrate\`; App Service (Linux, Node 22) with system-assigned managed identity used for SQL auth and Key Vault secret access; Key Vault for ANTHROPIC_API_KEY / WEBHOOK_SECRET; Bicep for the platform; GitHub Actions deploy. Output: docs/DEPLOYMENT.md and a Bicep skeleton. Feeds SSO (#47).`
  }
];

function run(args) {
  if (!APPLY) {
    console.log('[dry-run] gh', args.map((a) => (a.includes(' ') || a.includes('\n') ? JSON.stringify(a.slice(0, 60)) : a)).join(' '));
    return '';
  }
  return gh(args);
}

console.log(`Repo: ${repo} (${APPLY ? 'applying' : 'dry run'})`);

for (const [name, color, description] of LABELS) {
  run(['label', 'create', name, '--color', color, '--description', description, '--force']);
}

const milestones = gh(['api', `repos/${repo}/milestones?state=all`], { json: true }) ?? [];
if (!milestones.some((m) => m.title === MILESTONE)) {
  run(['api', `repos/${repo}/milestones`, '-f', `title=${MILESTONE}`, '-f', 'description=Everything needed to run a real Azure Monitor alert through Pulse from a laptop: local SQL Server, dev service principal, ngrok, test estate, first live alerts, agent comparison. docs/LIVE-TEST-PLAN.md']);
}

const existing = APPLY ? gh(['issue', 'list', '--state', 'all', '--limit', '300', '--json', 'number,title'], { json: true }) : [];
const created = [];

for (const issue of ISSUES) {
  const match = existing.find((e) => e.title === issue.title);
  if (match) {
    console.log(`exists  #${match.number} ${issue.title}`);
    created.push({ ...issue, number: match.number });
    continue;
  }
  const url = run(['issue', 'create', '--title', issue.title, '--body', issue.body, '--milestone', MILESTONE, ...issue.labels.flatMap((l) => ['--label', l])]);
  const number = Number((url.match(/\/(\d+)$/) ?? [])[1]);
  console.log(`created #${number || '?'} ${issue.title}`);
  created.push({ ...issue, number });
}

if (APPLY) {
  const title = 'Live test readiness roadmap (tracking)';
  const body = `Order: L-1 → L-2 → L-3 → L-4 → L-5 → L-6 → L-7/L-8 → L-9 → L-10. Plan: docs/LIVE-TEST-PLAN.md.\n\n## Work items\n${created.map((i) => `- [ ] #${i.number} ${i.title}`).join('\n')}`;
  const tracking = existing.find((e) => e.title === title);
  if (tracking) {
    run(['issue', 'edit', String(tracking.number), '--body', body]);
    console.log(`tracking #${tracking.number}`);
  } else {
    const url = run(['issue', 'create', '--title', title, '--body', body, '--milestone', MILESTONE, '--label', 'area:devex']);
    console.log(`tracking #${(url.match(/\/(\d+)$/) ?? [])[1]}`);
  }
}

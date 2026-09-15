#!/usr/bin/env node
/**
 * Creates the Demo 1 labels, milestone and issues on GitHub, then closes the ones already
 * delivered with a verification comment. Idempotent-ish: skips issues whose title already exists.
 *
 *   node scripts/github/demo1-issues.mjs            # dry run (prints what it would do)
 *   node scripts/github/demo1-issues.mjs --apply    # create/close for real
 *
 * Requires `gh` authenticated with push access to the repo (check:
 *   gh api repos/<owner>/<repo> --jq .permissions.push
 * ).
 */
import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const MILESTONE = 'Demo 1: alert → metrics → diagnosis';

function gh(args, { json = false } = {}) {
  const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return json ? JSON.parse(out || 'null') : out;
}

const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
const canPush = gh(['api', `repos/${repo}`, '--jq', '.permissions.push']) === 'true';

if (!canPush) {
  console.error(`The active gh account has no push access to ${repo}. Run "gh auth login" as the repo owner or add this account as a collaborator.`);
  process.exit(1);
}

const LABELS = [
  ['area:ui', '0E8A16', 'Client UI work'],
  ['area:simulation', 'FBCA04', 'Dummy alert simulation'],
  ['area:server', '1D76DB', 'Server pipeline and API'],
  ['area:metrics', '5319E7', 'Azure metrics and history providers'],
  ['area:agent', 'D93F0B', 'LLM diagnosis agent'],
  ['area:docs', '0075CA', 'Documentation and config']
];

const VERIFY_SIM = 'curl -s -X POST localhost:3001/api/simulate/alert -H "Content-Type: application/json" -d \'{"scenario":"disk-rapid-fill","resourceId":"/subscriptions/test/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/web-01","unique":true}\'';

/** @type {Array<{title:string, labels:string[], body:string, done?:string}>} */
const ISSUES = [
  {
    title: '1.1 Unify theme: restyle legacy panels onto CSS-variable tokens + shared UI primitives',
    labels: ['area:ui'],
    body: `Replace the legacy dark palette (\`border-white/10 bg-white/5 text-cyan/70 rounded-[28px]\`) in SimulatePanel, MetricContextPanel and the workspace cards with the CSS-variable tokens used by the alert drawer, and add Tailwind-only primitives (Card, Button, Badge, Field, Notice, StatTile) in \`client/src/components/ui/\`.

**Acceptance**
- Settings, Simulate and metric panels look correct in both light and dark mode
- No references to the legacy colour block remain; block removed from tailwind config
- \`npx tsc -p client/tsconfig.json --noEmit\` and \`npx vite build\` pass`,
    done: 'Delivered in commit c7fe97a. Verified with headless-Chrome screenshots of /alerts, /simulate and /settings in light mode; legacy block removed from tailwind.config.ts; client tsc and vite build pass.'
  },
  {
    title: '1.2 Lag badge in the alert table and drawer header',
    labels: ['area:ui'],
    body: `Add a \`LagBadge\` (green < 5 s, amber 5–30 s, red > 30 s per CLAUDE.md) using \`formatLag\`/\`getLagTone\`, a sortable Lag column in the table and the badge in the drawer header.

**Acceptance**: every alert row shows the badge with the right colour; column sorts by lagMs.`,
    done: 'Delivered in commit c7fe97a (LagBadge.tsx, Lag column, drawer header). Screenshot shows green 621 ms, amber 8.9 s, red 39 s badges.'
  },
  {
    title: '1.3 Detail drawer: Overview / Metrics / Diagnosis tabs + enrichment status pill',
    labels: ['area:ui'],
    body: `Rename Graphs → Metrics, add Diagnosis tab, show an enrichment state pill (queued/fetching/analysing/diagnosing/complete/failed) and an agent summary strip on Overview. Default height 360 px. Deep link \`/alerts?alert=<id>&tab=metrics|diagnosis\`.`,
    done: 'Delivered in commit c7fe97a. Verified via deep links in headless Chrome: Metrics and Diagnosis tabs open, pill shows urgency once complete.'
  },
  {
    title: '1.4 Metrics tab: alert-scoped history chart with trend tiles',
    labels: ['area:ui', 'area:metrics'],
    body: `Render \`GET /api/alerts/enrichment?alertId=\` history with Recharts: long-range chart with threshold and fired ReferenceLines and a dashed projection to the ceiling for steady growth, a zoom chart, and trend tiles (pattern, growth/day, Δ6h, Δ24h, time to full, suggested urgency).`,
    done: 'Delivered in commit c7fe97a (AlertMetricsTab.tsx). Screenshot of the rapid-fill scenario shows the 90-day series, jump, threshold and fired markers and tiles.'
  },
  {
    title: '1.5 Diagnosis tab: comment thread with agent card, notes and re-run',
    labels: ['area:ui', 'area:agent'],
    body: `Comment thread seeded from \`/api/alerts/comments/recent\` and live over SSE \`comment\` events, agent diagnosis card (urgency badge, safe markdown, provider/model footer, rule-based label), operator note composer (POST /api/alerts/comments), Re-run analysis button.`,
    done: 'Delivered in commit c7fe97a (AlertCommentsTab.tsx, lib/markdown.tsx). Verified: diagnosis card renders, note posts return 201 and appear live.'
  },
  {
    title: '1.6 Toolbar and top bar polish: client scope selector, bulk Add Note / Re-run, analysing indicator, urgency dots',
    labels: ['area:ui'],
    body: `Global client-scope selector in the top bar (so Simulate no longer depends on Settings), working Add Note and Re-run bulk actions, "Analysing N" indicator, Simulate quick-action button, urgency dot in an Agent column.`,
    done: 'Delivered in commit c7fe97a. Screenshot shows Agent column dots, selector and Simulate button; bulk note posts to each checked alert.'
  },
  {
    title: '2.1 Simulate request extensions: scenarios, unique ids, firedAt lag, dimensions, synthetic history',
    labels: ['area:simulation', 'area:server'],
    body: `Extend \`SimulateAlertRequest\` with scenario presets, \`unique\`/\`nonce\`, \`firedAt\` (clamped ≤ now), \`signalType\`, \`operator\`, \`dimensions\`, \`syntheticHistory\`, \`skipEnrichment\`. Presets in \`server/src/lib/simulation/scenarios.ts\`; hand-rolled enum validation; synthetic history registered before the pipeline runs.

**Verify**
\`\`\`bash
${VERIFY_SIM}
curl -s localhost:3001/api/simulate/scenarios
\`\`\``,
    done: 'Delivered in commit f2cd3f9. Verified: repeated fires with unique:true create distinct ids; invalid severity returns 400 with a clear message; firedAt backdating produces the expected lagMs.'
  },
  {
    title: '2.2 Simulate page rebuilt around scenario presets',
    labels: ['area:simulation', 'area:ui'],
    body: `Scenario cards with sparkline previews, editable payload form, synthetic history controls (pattern, days, start value), lag minutes, Fire / Resolve / Fire 5 random, recent simulated alerts list linking into the feed, response JSON behind a toggle.`,
    done: 'Delivered in commit c7fe97a (SimulatePanel.tsx, SimulatePage.tsx, lib/syntheticPreview.ts). Screenshot verified.'
  },
  {
    title: '2.3 Simulate from the alerts page: quick button and Re-fire',
    labels: ['area:simulation', 'area:ui'],
    body: `Toolbar Simulate button navigates to /simulate; drawer shows a Re-fire action for simulated alerts that re-posts the alert with unique:true and a matching synthetic history.`,
    done: 'Delivered in commit c7fe97a.'
  },
  {
    title: '3.1 Shared types + comments store + SSE comment events + comment routes',
    labels: ['area:server'],
    body: `\`AlertComment\`, \`CreateAlertCommentRequest\`, SSE \`comment\`/\`enrichment\` types; in-memory comment store (cap 100/alert, 5000 total); \`GET/POST /api/alerts/comments\`, \`GET /api/alerts/comments/recent\`; \`matchesScope\` shared by alert, comment and enrichment broadcasts. Alert IDs travel as query params (ARM paths).`,
    done: 'Delivered in commit f2cd3f9. Verified with curl: POST returns 201, GET lists oldest→newest, recent returns newest first, SSE emits type:"comment".'
  },
  {
    title: '3.2 Prisma AlertComment + AlertEnrichment models and repository DB branch',
    labels: ['area:server'],
    body: `Add \`AlertComment\` and \`AlertEnrichment\` models (NVarChar(Max) bodies, NoAction on the ClientAccount FK to avoid SQL Server multiple cascade paths), fix \`rawPayloadJson\`/\`description\` to NVarChar(Max), implement the Prisma branch of \`commentRepository\`.

**Remaining**: run \`npm run db:push\` against a real SQL Server / Azure SQL (\`DATABASE_URL\`) and confirm comments survive a restart for a scoped client.`,
  },
  {
    title: '3.3 Trend analysis (pure) + downsample + unit tests',
    labels: ['area:metrics', 'area:server'],
    body: `\`analyseTrend(series, {ceiling, threshold, now})\`: OLS slope/r²/residual σ, Δ6h/24h/7d, anomalies, projection to ceiling, classification (rapid-fill requires a new high; steady-growth; declining; volatile; flat; insufficient-data) and suggested urgency. node:test suite via \`npm test\` in server/.`,
    done: 'Delivered in commits f2cd3f9 and c7fe97a. `cd server && npm test` → 10 passing tests covering steady growth (slope ≈ 0.4/day, ~12 days to full), rapid fill (immediate), flat at threshold (soon), sawtooth (volatile), insufficient data, planner rows and KQL escaping.'
  },
  {
    title: '3.4 Metric history providers (synthetic, ARM, Log Analytics) + request planner',
    labels: ['area:metrics', 'area:server'],
    body: `\`MetricHistoryProvider\` interface; synthetic provider with seeded PRNG (reproducible reruns); ARM provider over the new parameterised \`queryArmMetrics\`; Log Analytics provider querying VM Insights \`InsightsMetrics\` LogicalDisk FreeSpacePercentage via KQL; planner mapping simulated / VM disk / metric / other alerts to requests.`,
    done: 'Delivered in commit f2cd3f9. Synthetic path verified end to end; ARM and Log Analytics providers compile and are unit-tested for query building but need Azure credentials to exercise (see 5.3).'
  },
  {
    title: '3.5 Enrichment orchestrator, status store, processAlert hook, SSE enrichment events',
    labels: ['area:server'],
    body: `Fire-and-forget \`scheduleEnrichment\` after broadcast; states queued → fetching-history → analysing → diagnosing → complete/failed; cooldown for real alerts; resolved alerts get a status note; \`GET /api/alerts/enrichment\`, \`/enrichment/summary\`, \`POST /enrichment/rerun\`.

**Verify**
\`\`\`bash
${VERIFY_SIM}
curl -s "localhost:3001/api/alerts/enrichment?alertId=<id>"
\`\`\``,
    done: 'Delivered in commit f2cd3f9. Verified: simulate returns in ms, enrichment completes within ~5 ms offline, rerun returns 202, resolved alert produces a status note.'
  },
  {
    title: '4.1 Agent provider interface, rule-based provider, diagnosis comment renderer',
    labels: ['area:agent'],
    body: `\`AgentProvider\` interface; rule-based provider with templated diagnoses per trend pattern (no LLM needed); fixed markdown template where trend numbers always come from our analysis; author names per provider.`,
    done: 'Delivered in commit f2cd3f9. Verified diagnosis text for steady growth ("~0.4 pts/day for 90 days… reaches 100% in about 12 days") and rapid fill ("jumped 40.7 pts in the last 6 hours… investigate immediately").'
  },
  {
    title: '4.2 Anthropic provider + prompt builder (structured JSON output, prompt-injection hardening)',
    labels: ['area:agent'],
    body: `\`@anthropic-ai/sdk\` provider using \`output_config.format\` json_schema, effort low, cached static system prompt, typed error chain with rule-based fallback and process-level disable on auth failure. Prompt wraps alert fields as untrusted \`<alert_data>\`, sanitised and truncated. Default model \`claude-opus-5\`, override with \`PULSE_AGENT_MODEL\`.

**Remaining**: run with a real \`ANTHROPIC_API_KEY\`; confirm \`metadata.provider:"anthropic"\`, rapid-fill → immediate, and that a description containing "IGNORE ALL PRIOR INSTRUCTIONS…" does not change the urgency. Test an invalid key falls back to rule-based without crashing.`,
  },
  {
    title: '4.3 Re-run, cooldown and resolved-note behaviour',
    labels: ['area:agent', 'area:server'],
    body: `POST /api/alerts/enrichment/rerun (202 / 409 while inflight / 503 when disabled), \`metadata.enrichmentTrigger:"rerun"\`, 15-minute cooldown for real alerts only, resolved alerts get "Resolved after X" note.`,
    done: 'Delivered in commit f2cd3f9 and verified with curl.'
  },
  {
    title: '5.1 Token audiences + parameterised ARM metrics query',
    labels: ['area:metrics'],
    body: `\`getAzureToken(resource)\` with per-audience cache (management vs Log Analytics), \`isLogAnalyticsConfigured()\`, exported \`queryArmMetrics\` returning every dimension series; existing poller behaviour unchanged.`,
    done: 'Delivered in commit f2cd3f9. `/api/metrics/context` code path unchanged in behaviour (poller still picks the largest series).'
  },
  {
    title: '5.2 Log Analytics provider + KQL builder',
    labels: ['area:metrics'],
    body: `\`buildDiskFreeSpaceQuery\` (InsightsMetrics, LogicalDisk FreeSpacePercentage, bin 1d/1h, per-mount), \`kqlStringLiteral\` escaping, provider posting to \`api.loganalytics.io/v1/workspaces/{id}/query\`, worst-mount selection, used% = 100 − free%.`,
    done: 'Delivered in commit f2cd3f9; KQL builder unit-tested. Live query needs LOG_ANALYTICS_WORKSPACE_ID + credentials (see 5.3).'
  },
  {
    title: '5.3 End-to-end with a real VM: ngrok → disk alert → Log Analytics history → Claude diagnosis',
    labels: ['area:metrics', 'area:docs'],
    body: `1. Set \`AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET\`, \`LOG_ANALYTICS_WORKSPACE_ID\` (VM Insights workspace; SP needs Log Analytics Reader) and \`ANTHROPIC_API_KEY\`.
2. ngrok http 3001, Action Group webhook with \`x-webhook-secret\`, common alert schema enabled.
3. Fire a disk % alert on a VM with VM Insights; confirm the Metrics tab shows 90 days from Log Analytics and the Diagnosis tab shows a Claude diagnosis.
4. Confirm \`/api/metrics/context\` still works (regression).

Docs (README, CLAUDE.md, .env.example) were updated in the same change set; remaining work here is the live run.`,
  },
  {
    title: 'Demo 1 roadmap (tracking)',
    labels: ['area:docs'],
    body: `Tracking issue for the "alert → metrics → agent diagnosis" demo. Individual issues carry the acceptance criteria; this one links them all.

Order of work: GitHub issues → UI + simulation → enrichment pipeline → agent → real Azure wiring.

Decisions: pluggable agent (Claude first via @anthropic-ai/sdk, rule-based fallback), Log Analytics / VM Insights for disk history, polish the existing shell rather than redesign, comments in memory until DATABASE_URL is set.`,
  }
];

function run(args) {
  if (!APPLY) {
    console.log('[dry-run] gh', args.map((a) => (a.includes(' ') ? JSON.stringify(a.slice(0, 60)) : a)).join(' '));
    return '';
  }

  return gh(args);
}

console.log(`Repo: ${repo} (${APPLY ? 'applying' : 'dry run'})`);

for (const [name, color, description] of LABELS) {
  run(['label', 'create', name, '--color', color, '--description', description, '--force']);
}

let milestoneExists = false;
try {
  const milestones = gh(['api', `repos/${repo}/milestones?state=all`], { json: true }) ?? [];
  milestoneExists = milestones.some((m) => m.title === MILESTONE);
} catch {}

if (!milestoneExists) {
  run(['api', `repos/${repo}/milestones`, '-f', `title=${MILESTONE}`, '-f', 'description=Working demo: Azure Monitor alert lands in Pulse, metric history is pulled and trend-analysed, an in-app agent posts a diagnosis comment.']);
}

const existing = APPLY ? gh(['issue', 'list', '--state', 'all', '--limit', '200', '--json', 'number,title'], { json: true }) : [];
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

for (const issue of created) {
  if (issue.done && issue.number) {
    run(['issue', 'close', String(issue.number), '--comment', `Done. ${issue.done}`]);
    console.log(`closed  #${issue.number}`);
  }
}

if (APPLY) {
  const tracking = created.find((i) => i.title.startsWith('Demo 1 roadmap'));
  if (tracking?.number) {
    const checklist = created
      .filter((i) => i !== tracking && i.number)
      .map((i) => `- [${i.done ? 'x' : ' '}] #${i.number} ${i.title}`)
      .join('\n');
    run(['issue', 'edit', String(tracking.number), '--body', `${tracking.body}\n\n## Work items\n${checklist}`]);
    console.log(`updated tracking issue #${tracking.number}`);
  }
}

#!/usr/bin/env node
/**
 * Creates the "Onboarding v1" labels, milestone and issues on GitHub, closes the ones already
 * delivered with a verification comment, and links the tracking issue from #20.
 *
 *   node scripts/github/onboarding-issues.mjs            # dry run
 *   node scripts/github/onboarding-issues.mjs --apply    # create for real
 *
 * Requires `gh` authenticated with push access (gh api repos/<owner>/<repo> --jq .permissions.push).
 */
import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const MILESTONE = 'Onboarding v1: Lighthouse read-only + baseline scripts';

function gh(args, { json = false } = {}) {
  const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return json ? JSON.parse(out || 'null') : out;
}

const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);

if (gh(['api', `repos/${repo}`, '--jq', '.permissions.push']) !== 'true') {
  console.error(`The active gh account has no push access to ${repo}. Run "gh auth switch --user <owner>".`);
  process.exit(1);
}

const LABELS = [
  ['area:onboarding', 'C2E0C6', 'Client / Azure onboarding'],
  ['area:azure', '0052CC', 'Azure platform integration'],
  ['type:spike', 'BFD4F2', 'Time-boxed investigation'],
  ['type:decision', 'F9D0C4', 'Decision record'],
  ['type:docs', '0075CA', 'Documentation']
];

const DOCS = 'See `docs/onboarding/DECISIONS.md` and `docs/onboarding/COVERAGE.md`.';

/** @type {Array<{key:string,title:string,labels:string[],body:string,done?:string}>} */
const ISSUES = [
  {
    key: 'O-0',
    title: 'O-0 Decision record: Lighthouse access model, read-only vs write posture, roles',
    labels: ['area:onboarding', 'type:decision'],
    body: `Record how Pulse gets access to client Azure estates and how much access it should have.

**Decisions**
- Access via Azure Lighthouse delegation from the Synextra tenant (not a multi-tenant Entra app + admin consent). Lighthouse covers everything Pulse touches (ARM: metrics, Resource Graph, Log Analytics, alerts, action groups, DCRs, AMA, Service/Resource Health). It does not cover Entra/Graph or data-plane access, which monitoring does not need.
- Read-only roles for the Pulse service principal (Reader, Monitoring Reader, Log Analytics Reader). Write roles (Monitoring Contributor, Log Analytics Contributor) go to a Synextra engineers group who run Pulse-generated scripts. Pulse write access is deferred.
- Per-client webhook token in the URL because action-group webhooks cannot send custom headers.

${DOCS}`,
    done: 'docs/onboarding/DECISIONS.md committed with D1–D6, limits, rejected alternative and sources.'
  },
  {
    key: 'O-1',
    title: 'O-1 Monitoring coverage matrix: resource types, metrics, baseline alerts, what we cannot monitor',
    labels: ['area:onboarding', 'type:docs'],
    body: `Per resource type (VMs, App Service + plans, Azure SQL + pools, Storage, Key Vault, AKS, networking, subscription health): available platform and guest metrics, Essential / Standard / Full baseline alerts with AMBA thresholds, multi-resource vs per-resource rule support, and explicit "cannot monitor" notes.

${DOCS}`,
    done: 'docs/onboarding/COVERAGE.md committed, sourced from AMBA alerts.yaml catalogues and Microsoft Learn (Sept 2026).'
  },
  {
    key: 'O-2',
    title: 'O-2 Baseline alert catalogue as data with tiers and AMBA references',
    labels: ['area:onboarding', 'area:server'],
    body: `Encode COVERAGE.md as data in \`server/src/lib/onboarding/baseline.ts\`: \`BASELINE_VERSION\`, \`BaselineRule { key, resourceType, tier, kind: metric|log|activityLog, scope: multi-resource-region|per-resource|workspace|subscription, severity, metric?/log?/activity?, requires: ['ama'|'vminsights'|'workspace'], amba }\`, \`rulesFor(resourceType, tier)\`.

**Acceptance**: covers every Essential and Standard row in COVERAGE.md; snapshot unit test; \`GET /api/admin/onboarding/baseline\` returns the catalogue; \`npm test\` passes.`
  },
  {
    key: 'O-3',
    title: 'O-3 Webhook auth for action groups: token in URL, rotatable per-client token, docs corrected',
    labels: ['area:onboarding', 'area:server', 'bug'],
    body: `Azure action-group Webhook actions cannot send custom headers, so the documented \`x-webhook-secret\` header cannot be used by a real action group.

**Delivered**: \`POST /api/webhook/azure-alerts/:webhookToken\` accepts the client's webhook secret in the URL (header path retained for manual/ngrok tests); credential never logged; Settings shows the copyable URL; README and CLAUDE.md corrected.

**Remaining**: separate rotatable \`ClientAccount.webhookToken\` (distinct from \`webhookSecret\`) with a rotate endpoint and UI, so the URL-visible token has no other use. Do this together with the Prisma work in O-6/O-7.`
  },
  {
    key: 'O-4',
    title: 'O-4 Lighthouse onboarding template generator + customer runbook',
    labels: ['area:onboarding', 'area:azure'],
    body: `Generate a per-client Lighthouse registration definition + assignment (Bicep/ARM) granting read-only roles to the Pulse service principal and, optionally, Monitoring Contributor + Log Analytics Contributor to the Synextra engineers group. Provide the \`az deployment sub create\` one-liner and a customer runbook (\`docs/onboarding/CUSTOMER-RUNBOOK.md\`) with screenshots of the Lighthouse → Delegations view.

**Acceptance**: \`GET /api/admin/clients/:id/lighthouse-template\` returns the template; \`az bicep build\` passes; runbook reviewed.`
  },
  {
    key: 'O-5',
    title: 'O-5 Spike: Lighthouse end-to-end from the Synextra tenant against a test customer subscription',
    labels: ['area:onboarding', 'area:azure', 'type:spike'],
    body: `Delegate a test subscription to the Synextra tenant with the O-4 template. Confirm with the Pulse service principal's home-tenant token: \`GET /subscriptions\` lists it with \`managedByTenants\`; Resource Graph returns its resources; the metrics API and a Log Analytics query succeed; alert rules are visible. Time-box: one day. Append findings (including anything that did not work) to DECISIONS.md.`
  },
  {
    key: 'O-6',
    title: 'O-6 Subscription detection: list delegated subscriptions and replace the hand-typed form',
    labels: ['area:onboarding', 'area:server', 'area:ui'],
    body: `Use \`GET https://management.azure.com/subscriptions?api-version=2022-12-01\` with the home-tenant token, match \`tenantId\`/\`managedByTenants\` to the client's tenant connections, and show delegated subscriptions in Settings with an Onboard action. Keep manual entry as a fallback. Populate \`AzureSubscription.tenantId\` and status. Set \`TenantConnection.credentialMode='lighthouse'\`.`
  },
  {
    key: 'O-7',
    title: 'O-7 Resource discovery via Resource Graph into the Resource table',
    labels: ['area:onboarding', 'area:server', 'area:ui'],
    body: `\`server/src/lib/azure/resourceGraph.ts\`: paged Resource Graph query over delegated subscriptions for the supported types, projecting id, type, name, location, resourceGroup, tags, kind, OS type, identity type, power state. Upsert into \`Resource\` (populate region and tagsJson, add kind/identityType/powerState/lastSeenAt). Grouped resource table in Settings with counts per type.

**Acceptance**: 5k resources in under 60 s with paging; re-run is idempotent; VMs without a managed identity are flagged.`
  },
  {
    key: 'O-8',
    title: 'O-8 Read-only coverage report: per-resource monitoring state from Resource Graph',
    labels: ['area:onboarding', 'area:server', 'area:ui'],
    body: `For each discovered resource compute UNMONITORED / PARTIAL / MONITORED / UNSUPPORTED by reading, via Resource Graph, AMA extensions, \`microsoft.insights/datacollectionruleassociations\`, \`microsoft.insights/metricalerts\`, \`microsoft.insights/scheduledqueryrules\` (matching \`pulse-managed=true\` tags and the \`pulse-<slug>-<rule>\` naming) and Service Health activity-log alerts. Show badges in Settings and in the Alerts page resource column; add a Re-check button.`
  },
  {
    key: 'O-9',
    title: 'O-9 Baseline script / Bicep generator for engineers',
    labels: ['area:onboarding', 'area:server'],
    body: `From discovered resources plus a chosen tier, generate a per-client bundle: action group (webhook token URL, common alert schema), Log Analytics workspace (create or reuse), VM Insights DCR, AMA extension + DCR association loop over VMs, multi-resource metric alert rules per region (VMs, SQL, Key Vault), per-resource rules (App Service, Storage), log search rules split by \`_ResourceId\`, Service Health and Resource Health activity-log alerts. Deterministic names \`pulse-<slug>-<rule>[-<region>]\` and tags \`pulse-managed\`, \`pulse-client\`, \`pulse-baseline\`, \`pulse-rule\`.

**Acceptance**: \`POST /api/admin/onboarding/subscriptions/:id/generate\` returns the bundle; \`az bicep build\` passes; output includes a cost estimate (metric time series, log-alert evaluations, expected InsightsMetrics GB/month).`
  },
  {
    key: 'O-10',
    title: 'O-10 Enrichment per subscription: workspace and tenant resolved from AzureSubscription',
    labels: ['area:onboarding', 'area:metrics'],
    body: `Metric history providers take \`{ workspaceCustomerId, tenantId? }\` from the alert's \`AzureSubscription\` instead of the global \`LOG_ANALYTICS_WORKSPACE_ID\`. Env vars remain as dev fallbacks. Planner tests updated; simulate path unchanged.`
  },
  {
    key: 'O-11',
    title: 'O-11 Live test on a real VM: baseline deployed via generated scripts, disk and CPU alerts end to end',
    labels: ['area:onboarding', 'area:azure'],
    body: `Extends #20. Deploy the O-9 bundle to the test subscription with delegated Contributor rights, breach a disk threshold and a CPU threshold, confirm Fired and Resolved arrive in Pulse via the token URL, lag badge values, Log Analytics history in the Metrics tab and a diagnosis in the Diagnosis tab. Record timings and screenshots in \`docs/onboarding/LIVE-TEST.md\`.`
  },
  {
    key: 'O-12',
    title: 'O-12 Secure Webhook (Entra) hardening for alert ingest (later)',
    labels: ['area:onboarding', 'area:server'],
    body: `Accept action-group Secure Webhook calls: validate the Entra token issued to the \`AZNS AAD Webhook\` service principal (appId 461e8683-5575-4561-ac7f-899cc907d62a) against a Pulse API app role. Token-in-URL remains for dev. Requires the app role to be set up in each customer tenant, so this is a hardening step after Lighthouse onboarding is proven.`
  },
  {
    key: 'O-13',
    title: 'O-13 Epic (deferred): Pulse applies the baseline directly via ARM',
    labels: ['area:onboarding', 'area:azure'],
    body: `Blocked on the write-posture decision in O-0. When approved, Pulse would apply the O-9 plan itself:
- \`lib/azure/armClient.ts\` (GET/PUT/DELETE, long-running-operation polling via Azure-AsyncOperation/Location, 429 back-off, per-subscription write limiter under 1200 writes/h)
- job runner with persisted steps (resumable, cancellable) and SSE progress channel
- deployers per artifact kind (action group, workspace, DCR, AMA extension, DCR association, metric/log/activity alerts) with hash-based idempotency (skip PUT when desired == actual)
- drift check and safe teardown limited to \`pulse-managed=true\` artifacts with a Pulse record
- Azure Policy path for estates above ~1000 VMs
- Prisma: OnboardingJob, OnboardingStep, MonitoringArtifact, per-subscription workspace fields, Resource.monitoringState

Requires Monitoring Contributor + Log Analytics Contributor delegated to the Pulse service principal.`
  },
  {
    key: 'O-14',
    title: 'O-14 Docs: README / CLAUDE.md onboarding section, .env.example, issue script',
    labels: ['area:onboarding', 'type:docs'],
    body: `Add an onboarding section to README and CLAUDE.md pointing at docs/onboarding, update the phase roadmap, and keep \`scripts/github/onboarding-issues.mjs\` in step with the backlog.`,
    done: 'Issue script committed and used to create this backlog; README and CLAUDE.md webhook instructions corrected; onboarding docs linked from CLAUDE.md Key Files.'
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

let milestoneExists = false;
try {
  const milestones = gh(['api', `repos/${repo}/milestones?state=all`], { json: true }) ?? [];
  milestoneExists = milestones.some((m) => m.title === MILESTONE);
} catch {}

if (!milestoneExists) {
  run(['api', `repos/${repo}/milestones`, '-f', `title=${MILESTONE}`, '-f', 'description=Lighthouse read-only access from the Synextra tenant, resource discovery and coverage report, AMBA-aligned baseline generated as scripts for engineers. Pulse write access deferred (O-13).']);
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

for (const issue of created) {
  if (issue.done && issue.number) {
    run(['issue', 'close', String(issue.number), '--comment', `Done. ${issue.done}`]);
    console.log(`closed  #${issue.number}`);
  }
}

if (APPLY) {
  const trackingTitle = 'Onboarding v1 roadmap (tracking)';
  const checklist = created.map((i) => `- [${i.done ? 'x' : ' '}] #${i.number} ${i.title}`).join('\n');
  const trackingBody = `Tracking issue for Azure onboarding. Decisions and coverage live in \`docs/onboarding/\`.

Order: O-0, O-1 → O-3, O-2 → O-4, O-5 → O-6, O-7 → O-8, O-9 → O-10 → O-11 → O-14. O-12 and O-13 stay open as deferred.

## Work items
${checklist}`;

  const existingTracking = existing.find((e) => e.title === trackingTitle);
  let trackingNumber;

  if (existingTracking) {
    run(['issue', 'edit', String(existingTracking.number), '--body', trackingBody]);
    trackingNumber = existingTracking.number;
  } else {
    const url = run(['issue', 'create', '--title', trackingTitle, '--body', trackingBody, '--milestone', MILESTONE, '--label', 'area:onboarding', '--label', 'type:docs']);
    trackingNumber = Number((url.match(/\/(\d+)$/) ?? [])[1]);
  }

  console.log(`tracking #${trackingNumber}`);
  run(['issue', 'comment', '20', '--body', `The live-test prerequisites (Lighthouse access, webhook token URL, baseline scripts) are now planned in the Onboarding v1 milestone; see tracking issue #${trackingNumber}. O-11 in that milestone is the live run that closes this issue.`]);
  console.log('linked from #20');
}

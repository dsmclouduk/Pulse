import { useState } from 'react';

import { Badge, Button, Card, CardHeader, Notice, Select, StatTile } from '@/components/ui';

/**
 * Steps 2 to 6 of the onboarding wizard, rendered as the intended design against representative
 * data. Nothing here calls Azure yet: these exist so the shape of the process can be reviewed
 * before the generator and coverage reader are built (#34, #35, #36).
 */

function PreviewBanner({ issue }: Readonly<{ issue: string }>) {
  return (
    <Notice tone="info">
      Design preview. The layout and wording are real; the numbers are representative. Wired up in {issue}.
    </Notice>
  );
}

function ClientHeading({ clientName, fallback }: Readonly<{ clientName: string | null; fallback: string }>) {
  if (clientName) {
    return null;
  }

  return <Notice tone="warning">{fallback}</Notice>;
}

/* ── 2. Inventory ─────────────────────────────────────────────── */

const INVENTORY_ROWS = [
  { type: 'Virtual machines', count: 24, regions: 'uksouth, ukwest', note: '3 without a managed identity' },
  { type: 'App Services', count: 11, regions: 'uksouth', note: 'per-resource rules required' },
  { type: 'App Service plans', count: 4, regions: 'uksouth', note: '' },
  { type: 'SQL databases', count: 7, regions: 'uksouth', note: '' },
  { type: 'Storage accounts', count: 19, regions: 'uksouth, ukwest', note: 'per-resource rules required' },
  { type: 'Key vaults', count: 6, regions: 'uksouth', note: '' }
];

export function InventoryStep({ clientName }: Readonly<{ clientName: string | null }>) {
  return (
    <div className="flex flex-col gap-3">
      <PreviewBanner issue="#34" />
      <ClientHeading clientName={clientName} fallback="Pick a client on the Access step to scope the inventory." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Resources" value={71} />
        <StatTile label="Subscriptions" value={4} />
        <StatTile label="Regions in use" value={2} />
        <StatTile label="Blockers" value={3} tone="warning" />
      </div>

      <Card>
        <CardHeader
          title="What is in the estate"
          description="Metadata only: id, name, type, resource group, region and tags. Metrics are never stored; they stay in Azure Monitor and are queried when an alert needs diagnosing."
        />
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Count</th>
                <th className="px-4 py-2 font-medium">Regions</th>
                <th className="px-4 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {INVENTORY_ROWS.map((row) => (
                <tr key={row.type} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-[var(--color-text)]">{row.type}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--color-text)]">{row.count}</td>
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">{row.regions}</td>
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">{row.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Blockers" description="Things that will stop monitoring working, surfaced before anything is deployed." />
        <ul className="space-y-1 text-sm text-[var(--color-text-secondary)]">
          <li>
            <Badge tone="warning">3 VMs</Badge> have no managed identity, so the Azure Monitor Agent cannot be installed on them.
          </li>
          <li>
            <Badge tone="neutral">1 region</Badge> has resources but no workspace; one will be created by the deployment.
          </li>
        </ul>
      </Card>
    </div>
  );
}

/* ── 3. Coverage ──────────────────────────────────────────────── */

const COVERAGE_ROWS: Array<{ check: string; state: 'ok' | 'partial' | 'missing'; detail: string }> = [
  { check: 'Log Analytics workspace', state: 'ok', detail: 'law-rwk-prod, uksouth' },
  { check: 'Azure Monitor Agent on VMs', state: 'partial', detail: '18 of 24 VMs' },
  { check: 'VM Insights DCR associated', state: 'partial', detail: '18 of 24 VMs' },
  { check: 'Pulse action group', state: 'missing', detail: 'not present' },
  { check: 'VM alert rules', state: 'missing', detail: 'no pulse-managed rules found' },
  { check: 'SQL alert rules', state: 'missing', detail: 'no pulse-managed rules found' },
  { check: 'Service Health alert', state: 'missing', detail: 'not configured' }
];

const COVERAGE_TONE = { ok: 'ok', partial: 'warning', missing: 'error' } as const;
const COVERAGE_LABEL = { ok: 'In place', partial: 'Partial', missing: 'Missing' } as const;

export function CoverageStep({ clientName }: Readonly<{ clientName: string | null }>) {
  return (
    <div className="flex flex-col gap-3">
      <PreviewBanner issue="#35" />
      <ClientHeading clientName={clientName} fallback="Pick a client on the Access step to read its coverage." />

      <Card>
        <CardHeader
          title="What monitoring exists today"
          description="Read back from Azure, not from Pulse's own records. Pulse recognises its own rules by the pulse-managed tag, so a client's existing alerts are never touched or double-counted."
          actions={
            <Button size="sm" variant="secondary">
              Re-check
            </Button>
          }
        />
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <th className="px-4 py-2 font-medium">Check</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {COVERAGE_ROWS.map((row) => (
                <tr key={row.check} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-[var(--color-text)]">{row.check}</td>
                  <td className="px-4 py-2">
                    <Badge tone={COVERAGE_TONE[row.state]}>{COVERAGE_LABEL[row.state]}</Badge>
                  </td>
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ── 4. Plan ──────────────────────────────────────────────────── */

const PLAN_RULES = [
  { rule: 'VM availability', condition: 'VmAvailabilityMetric < 1 for 5 min', sev: 'Sev1', scope: 'All VMs, one rule per region' },
  { rule: 'Heartbeat missing', condition: 'No heartbeat for 10 min', sev: 'Sev1', scope: 'All VMs, split by resource' },
  { rule: 'CPU high', condition: 'Percentage CPU > 90 avg 15 min', sev: 'Sev2', scope: 'All VMs, one rule per region' },
  { rule: 'Memory low', condition: 'Available memory < 1 GB avg 5 min', sev: 'Sev2', scope: 'All VMs, one rule per region' },
  { rule: 'OS disk free', condition: 'Free space < 20% avg 15 min', sev: 'Sev2', scope: 'All VMs, split by resource and mount' },
  { rule: 'App Service 5xx', condition: 'Http5xx > 10 in 5 min', sev: 'Sev1', scope: 'Per App Service (11 rules)' },
  { rule: 'SQL CPU', condition: 'cpu_percent > 80 avg 5 min', sev: 'Sev3', scope: 'All databases, one rule' },
  { rule: 'Service Health', condition: 'Any incident or maintenance', sev: 'Sev2', scope: 'Subscription' }
];

export function PlanStep({ clientName }: Readonly<{ clientName: string | null }>) {
  const [tier, setTier] = useState('essential');

  return (
    <div className="flex flex-col gap-3">
      <PreviewBanner issue="#29 and #36" />
      <ClientHeading clientName={clientName} fallback="Pick a client on the Access step to build a plan." />

      <Card>
        <CardHeader
          title="Baseline tier"
          description="The catalogue is identical for every client at a given tier. Client-specific changes are overrides on top, so a threshold change never forks the baseline."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Select value={tier} onChange={(event) => setTier(event.target.value)} className="w-56">
            <option value="essential">Essential — every client</option>
            <option value="standard">Standard — recommended</option>
            <option value="full">Full — everything in AMBA</option>
          </Select>
          <span className="text-xs text-[var(--color-text-secondary)]">
            Overrides: 1 threshold changed, 1 rule disabled, 2 resources excluded by tag
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Rules to create" value={19} />
        <StatTile label="Rules to update" value={0} />
        <StatTile label="Unchanged" value={0} />
        <StatTile label="Est. monthly cost" value="£31" hint="time series, evaluations, ingestion" />
      </div>

      <Card>
        <CardHeader
          title="What will be created"
          description="Most rules cover the whole estate, so adding VMs later changes nothing here. Only App Service and Storage need one rule per resource."
        />
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <th className="px-4 py-2 font-medium">Rule</th>
                <th className="px-4 py-2 font-medium">Condition</th>
                <th className="px-4 py-2 font-medium">Severity</th>
                <th className="px-4 py-2 font-medium">Scope</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_RULES.map((row) => (
                <tr key={row.rule} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 text-[var(--color-text)]">{row.rule}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-[var(--color-text-secondary)]">{row.condition}</td>
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">{row.sev}</td>
                  <td className="px-4 py-2 text-[var(--color-text-secondary)]">{row.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ── 5. Deploy ────────────────────────────────────────────────── */

function CommandBlock({ label, command, hint }: Readonly<{ label: string; command: string; hint?: string }>) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(command);
          }}
        >
          Copy
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-[11px] leading-relaxed text-[var(--color-text)]">
        {command}
      </pre>
      {hint && <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">{hint}</p>}
    </div>
  );
}

export function DeployStep({ clientName }: Readonly<{ clientName: string | null }>) {
  const slug = (clientName ?? 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return (
    <div className="flex flex-col gap-3">
      <PreviewBanner issue="#36" />
      <ClientHeading clientName={clientName} fallback="Pick a client on the Access step to generate a deployment." />

      <Notice tone="info">
        Pulse never writes to a client tenant. Sign in with a write-capable account inside a BeyondTrust session, run these two
        commands, then sign out. Pulse verifies the result read-only afterwards.
      </Notice>

      <Card>
        <CardHeader
          title="1. Download the deployment"
          description="Bicep plus a parameters file. The parameters file carries the client's webhook token, so delete it after applying."
          actions={
            <div className="flex gap-2">
              <Button size="sm">Download .bicep</Button>
              <Button size="sm" variant="secondary">
                Download parameters
              </Button>
            </div>
          }
        />
        <p className="text-xs text-[var(--color-text-secondary)]">
          pulse-{slug}-baseline.bicep · pulse-{slug}-baseline.parameters.json
        </p>
      </Card>

      <Card>
        <CardHeader title="2. Preview, then apply" description="what-if shows exactly what will change before anything is created." />
        <div className="flex flex-col gap-4">
          <CommandBlock
            label="Dry run"
            command={`az deployment sub what-if \\
  --subscription <subscription id> \\
  --location uksouth \\
  --template-file pulse-${slug}-baseline.bicep \\
  --parameters @pulse-${slug}-baseline.parameters.json`}
            hint="Read the diff. On a clean subscription every line should be a create."
          />
          <CommandBlock
            label="Apply"
            command={`az deployment sub create \\
  --name pulse-baseline \\
  --subscription <subscription id> \\
  --location uksouth \\
  --template-file pulse-${slug}-baseline.bicep \\
  --parameters @pulse-${slug}-baseline.parameters.json`}
            hint="Subscription scope, so the agent policy assignment goes in with everything else. Idempotent: re-running changes nothing."
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="3. Sign out"
          description="az logout ends the write session. Everything from here on is read-only."
        />
      </Card>
    </div>
  );
}

/* ── 6. Verify ────────────────────────────────────────────────── */

export function VerifyStep({ clientName }: Readonly<{ clientName: string | null }>) {
  return (
    <div className="flex flex-col gap-3">
      <PreviewBanner issue="#35 and #38" />
      <ClientHeading clientName={clientName} fallback="Pick a client on the Access step to verify it." />

      <Card>
        <CardHeader
          title="Prove it works"
          description="Nothing counts as onboarded until an alert has actually arrived. A green coverage report only says the rules exist."
          actions={
            <Button size="sm" variant="secondary">
              Re-check coverage
            </Button>
          }
        />
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <Badge tone="ok">Pass</Badge>
            <span className="text-[var(--color-text)]">Action group present and pointing at this Pulse instance</span>
          </li>
          <li className="flex items-center gap-2">
            <Badge tone="ok">Pass</Badge>
            <span className="text-[var(--color-text)]">19 pulse-managed rules found, matching the plan</span>
          </li>
          <li className="flex items-center gap-2">
            <Badge tone="warning">Pending</Badge>
            <span className="text-[var(--color-text)]">Agent rollout in progress, 18 of 24 VMs reporting</span>
          </li>
          <li className="flex items-center gap-2">
            <Badge tone="neutral">Not run</Badge>
            <span className="text-[var(--color-text)]">Test alert through the action group</span>
          </li>
        </ul>
        <div className="mt-3">
          <Button size="sm">Send a test alert</Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Then what"
          description="Policy onboards new VMs by itself. Re-run the coverage check when the estate changes and Pulse offers a deployment for the difference only."
        />
      </Card>
    </div>
  );
}

import { Badge, Card, CardHeader, Notice } from '@/components/ui';
import type { SettingsSummary } from '@/types';

function Row({ label, value, ok }: Readonly<{ label: string; value: React.ReactNode; ok?: boolean }>) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-1.5 text-xs last:border-b-0">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <span className="flex items-center gap-2 font-mono text-[11px] text-[var(--color-text)]">
        {value}
        {ok !== undefined && <Badge tone={ok ? 'ok' : 'warning'}>{ok ? 'Configured' : 'Not set'}</Badge>}
      </span>
    </div>
  );
}

function formatMs(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;
}

const EnvNote = () => (
  <Notice className="mt-3">
    Values come from environment variables today. Editing here, with secrets held in Azure Key Vault, is tracked as issue #46.
  </Notice>
);

export function AgentSection({ summary }: Readonly<{ summary: SettingsSummary }>) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader
          eyebrow="Agent"
          title="Diagnosis provider"
          description="Which model writes the diagnosis comment, and the fallback when it is unavailable."
          actions={<Badge tone={summary.agent.effectiveProvider === 'anthropic' ? 'ok' : 'neutral'}>{summary.agent.effectiveProvider === 'anthropic' ? 'Claude active' : 'Rule-based active'}</Badge>}
        />
        <Row label="Provider setting (PULSE_AGENT_PROVIDER)" value={summary.agent.provider} />
        <Row label="Model (PULSE_AGENT_MODEL)" value={summary.agent.model} />
        <Row label="Anthropic API key (ANTHROPIC_API_KEY)" value={summary.agent.apiKeyConfigured ? 'set, hidden' : 'missing'} ok={summary.agent.apiKeyConfigured} />
        <Row label="Agent timeout" value={formatMs(summary.agent.timeoutMs)} />
        <EnvNote />
      </Card>

      <Card>
        <CardHeader eyebrow="Enrichment" title="Metric history and trend analysis" description="Runs after every fired alert, never blocking the webhook." />
        <Row label="Enabled" value={summary.enrichment.enabled ? 'yes' : 'no'} ok={summary.enrichment.enabled} />
        <Row label="History window" value={`${summary.enrichment.historyDays} days`} />
        <Row label="Pipeline timeout" value={formatMs(summary.enrichment.timeoutMs)} />
        <Row label="Cooldown per real alert" value={formatMs(summary.enrichment.cooldownMs)} />
        <Row label="On resolved" value={summary.enrichment.onResolved === 'note' ? 'post a status note' : 'skip'} />
      </Card>
    </div>
  );
}

export function IntegrationsSection({ summary }: Readonly<{ summary: SettingsSummary }>) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader
          eyebrow="Azure"
          title="Azure access (read-only)"
          description="One identity in the Synextra tenant, in the Synextra - Monitoring Reader group. Client subscriptions reach it through Lighthouse delegations that authorise that group."
        />
        <Row label="Home tenant" value={summary.azure.tenantId ?? '—'} ok={summary.azure.credentialsConfigured} />
        <Row label="Log Analytics workspace (optional)" value={summary.azure.logAnalyticsWorkspaceId ?? 'not needed'} />
        <Notice className="mt-3">
          Guest history is queried in resource context, so no workspace id is required; the field above is only the fallback for
          workspace-context queries. Pulse can see a subscription only when its identity is authorised in that client&apos;s
          delegation. Runbook: docs/onboarding/LIGHTHOUSE.md. Replacing the client secret with a managed identity is #67.
        </Notice>
      </Card>

      <Card>
        <CardHeader eyebrow="Ingest" title="Inbound alerts" description="Azure action groups post Common Alert Schema payloads to Pulse." />
        <Row label="Public base URL (APP_SERVICE_URL)" value={summary.ingest.publicBaseUrl ?? window.location.origin} />
        <Row label="Global webhook secret (WEBHOOK_SECRET)" value={summary.ingest.globalWebhookSecretConfigured ? 'set, hidden' : 'missing'} ok={summary.ingest.globalWebhookSecretConfigured} />
        <Row label="Simulation endpoint" value={summary.ingest.simulateEnabled ? 'enabled (dev)' : 'disabled (production)'} />
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
          Each client has its own webhook secret, shown in the Clients section. Use that rather than the global secret: only alerts
          that resolve to a client are persisted, scoped and enriched with that client&apos;s history.
        </p>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader eyebrow="Delivery" title="Outbound destinations" description="Where Pulse sends alerts and diagnoses: OpsGenie for on-call, Teams for daytime visibility, generic HTTP webhooks." actions={<Badge tone="neutral">Planned · #45</Badge>} />
        <Notice>
          Not built yet. Design: destinations with URL, headers and fired/resolved body templates; OpsGenie Alerts API with alias dedupe and close-on-resolve; routing per client and severity; delivery log per alert. See docs/PRODUCT-REQUIREMENTS.md section 3.
        </Notice>
      </Card>
    </div>
  );
}

export function AccessSection() {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          eyebrow="Access"
          title="Sign-in, roles and audit"
          description="Nothing here is built yet. Recorded so the shape is agreed before it is."
          actions={<Badge tone="neutral">Planned · #46, #47</Badge>}
        />
        <Notice tone="warning">
          Every route is currently open and the admin APIs are unauthenticated. Do not expose this instance publicly.
        </Notice>
        <ul className="mt-3 space-y-1.5 text-xs text-[var(--color-text-secondary)]">
          <li>
            <strong className="text-[var(--color-text)]">Sign-in:</strong> Entra ID, through App Service Easy Auth or MSAL.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Roles from Entra group claims:</strong> Reader views, Operator
            acknowledges, comments, re-runs and simulates, Admin changes settings and clients.
          </li>
          <li>
            <strong className="text-[var(--color-text)]">Audit:</strong> who changed settings, who acknowledged or commented, and
            which deliveries were sent. Needed as MSP change evidence.
          </li>
          <li>SCIM provisioning stays deferred until alert assignment needs users who have never signed in.</li>
        </ul>
      </Card>
    </div>
  );
}

export function SystemSection({ summary }: Readonly<{ summary: SettingsSummary }>) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader
          eyebrow="Storage"
          title="Persistence"
          description="Alerts, comments, diagnoses and resource metadata. Metric values and log rows are never stored: they stay in Azure Monitor and Log Analytics and are queried when an alert needs diagnosing."
        />
        <Row label="Mode" value={summary.persistence.mode === 'prisma' ? 'SQL Server via Prisma' : 'in-memory (capped at 500 alerts, lost on restart)'} ok={summary.persistence.databaseConfigured} />
        <Notice className="mt-3">
          Only alerts that resolve to a client account are persisted; unscoped alerts stay in memory. Retention (around 180 days,
          then roll-up) is #44.
        </Notice>
      </Card>
      <Card>
        <CardHeader eyebrow="About" title="Pulse" />
        <Row label="Configuration source" value={summary.source} />
        <Row label="Summary generated" value={new Date(summary.generatedAt).toLocaleString()} />
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">Decisions and requirements live in docs/onboarding/DECISIONS.md and docs/PRODUCT-REQUIREMENTS.md.</p>
      </Card>
    </div>
  );
}

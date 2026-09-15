import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { EnrichmentStatePill } from '@/components/alerts/EnrichmentBadges';
import { LagBadge } from '@/components/alerts/LagBadge';
import { SeverityIndicator } from '@/components/alerts/SeverityIndicator';
import { Badge, Button, Card, CardHeader, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { useAlertData } from '@/context/AlertDataContext';
import { formatRelativeTime, shortenResourceId } from '@/lib/alerts';
import { previewSyntheticSeries, sparklinePath } from '@/lib/syntheticPreview';
import type { AlertEvent, AlertSeverity, SimulateAlertRequest, SimulateScenario, SyntheticHistorySpec } from '@/types';

interface ScenarioPreset {
  id: SimulateScenario;
  label: string;
  description: string;
  defaults: Pick<SimulateAlertRequest, 'ruleName' | 'severity' | 'metricName' | 'metricValue' | 'threshold' | 'description' | 'dimensions'>;
  syntheticHistory?: SyntheticHistorySpec;
}

interface SimulatePanelProps {
  clientSlug: string | null;
}

interface FormState {
  ruleName: string;
  severity: AlertSeverity;
  resourceId: string;
  metricName: string;
  metricValue: string;
  threshold: string;
  description: string;
  mountId: string;
  lagMinutes: string;
  unique: boolean;
  pattern: SyntheticHistorySpec['pattern'];
  historyDays: string;
  startPercent: string;
}

const DEFAULT_RESOURCE_ID = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachines/web-01';

const SEVERITIES: AlertSeverity[] = ['Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'];
const PATTERNS: Array<{ value: SyntheticHistorySpec['pattern']; label: string }> = [
  { value: 'steady-growth', label: 'Steady growth' },
  { value: 'rapid-fill', label: 'Rapid fill (last hours)' },
  { value: 'flat', label: 'Flat' },
  { value: 'sawtooth', label: 'Sawtooth cycle' }
];

const RANDOM_RESOURCES = ['web-01', 'web-02', 'sql-01', 'app-03', 'dc-01', 'file-01'];

function formFromPreset(preset: ScenarioPreset | null, current: FormState): FormState {
  if (!preset) {
    return current;
  }

  const history = preset.syntheticHistory;

  return {
    ...current,
    ruleName: preset.defaults.ruleName,
    severity: preset.defaults.severity,
    metricName: preset.defaults.metricName ?? '',
    metricValue: preset.defaults.metricValue?.toString() ?? '',
    threshold: preset.defaults.threshold?.toString() ?? '',
    description: preset.defaults.description ?? '',
    mountId: preset.defaults.dimensions?.mountId ?? '',
    pattern: history?.pattern ?? 'steady-growth',
    historyDays: history?.days?.toString() ?? '90',
    startPercent: history?.startPercent?.toString() ?? '55'
  };
}

function toNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function Sparkline({ spec, className = '' }: Readonly<{ spec: SyntheticHistorySpec; className?: string }>) {
  const width = 96;
  const height = 32;
  const path = useMemo(() => sparklinePath(previewSyntheticSeries(spec), width, height), [spec]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`flex-shrink-0 ${className}`} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function ScenarioCard({ preset, selected, onSelect }: Readonly<{ preset: ScenarioPreset; selected: boolean; onSelect: () => void }>) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full min-w-0 items-start gap-3 overflow-hidden rounded-md border p-3 text-left transition-colors ${
        selected ? 'border-accent bg-accent/5 ring-1 ring-accent/40' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-hover)]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-xs font-semibold text-[var(--color-text)]">{preset.label}</p>
          <SeverityIndicator severity={preset.defaults.severity} status="Fired" />
        </div>
        <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-secondary)]">{preset.description}</p>
      </div>
      {preset.syntheticHistory && <Sparkline spec={preset.syntheticHistory} className={selected ? 'text-accent' : 'text-[var(--color-text-tertiary)]'} />}
    </button>
  );
}

function RecentSimulatedAlerts({ alerts }: Readonly<{ alerts: AlertEvent[] }>) {
  const navigate = useNavigate();
  const { enrichmentByAlert } = useAlertData();
  const recent = alerts.filter((alert) => alert.isSimulated).slice(0, 8);

  if (recent.length === 0) {
    return <p className="text-xs text-[var(--color-text-tertiary)]">No simulated alerts yet. Fire one to watch it flow through the pipeline.</p>;
  }

  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {recent.map((alert) => (
        <li key={alert.id}>
          <button
            type="button"
            onClick={() => navigate(`/alerts?alert=${encodeURIComponent(alert.id)}`)}
            className="flex w-full items-center gap-2 px-1 py-2 text-left hover:bg-[var(--color-hover)]"
            title="Open in the alert feed"
          >
            <SeverityIndicator severity={alert.severity} status={alert.status} />
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text)]">
              {alert.ruleName} <span className="text-[var(--color-text-tertiary)]">· {shortenResourceId(alert.resourceIds[0])}</span>
            </span>
            <EnrichmentStatePill status={enrichmentByAlert[alert.id]} />
            <LagBadge lagMs={alert.lagMs} />
            <span className="whitespace-nowrap text-[11px] text-[var(--color-text-tertiary)]">{formatRelativeTime(alert.receivedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SimulatePanel({ clientSlug }: Readonly<SimulatePanelProps>) {
  const { alerts } = useAlertData();
  const navigate = useNavigate();
  const [presets, setPresets] = useState<ScenarioPreset[]>([]);
  const [scenario, setScenario] = useState<SimulateScenario>('disk-steady-growth');
  const [form, setForm] = useState<FormState>({
    ruleName: 'Disk C: used space > 95%',
    severity: 'Sev2',
    resourceId: DEFAULT_RESOURCE_ID,
    metricName: 'Disk % Used',
    metricValue: '95.3',
    threshold: '95',
    description: '',
    mountId: 'C:',
    lagMinutes: '0',
    unique: true,
    pattern: 'steady-growth',
    historyDays: '90',
    startPercent: '59'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastAlert, setLastAlert] = useState<AlertEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showResponse, setShowResponse] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/simulate/scenarios', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load scenarios (${response.status})`);
        const loaded = (await response.json()) as ScenarioPreset[];
        setPresets(loaded);
        const initial = loaded.find((preset) => preset.id === 'disk-steady-growth') ?? loaded[0];
        if (initial) {
          setForm((current) => formFromPreset(initial, current));
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load scenario presets.');
        }
      });

    return () => controller.abort();
  }, []);

  function selectScenario(id: SimulateScenario) {
    setScenario(id);
    const preset = presets.find((entry) => entry.id === id) ?? null;
    setForm((current) => formFromPreset(preset, current));
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (scenario !== 'custom' && key !== 'unique' && key !== 'lagMinutes' && key !== 'resourceId') {
      setScenario('custom');
    }
  }

  const previewSpec: SyntheticHistorySpec = useMemo(
    () => ({
      pattern: form.pattern,
      days: toNumber(form.historyDays) ?? 90,
      startPercent: toNumber(form.startPercent) ?? 55,
      endPercent: toNumber(form.metricValue) ?? 95
    }),
    [form.pattern, form.historyDays, form.startPercent, form.metricValue]
  );

  function buildRequest(status: SimulateAlertRequest['status'], overrides: Partial<SimulateAlertRequest> = {}): SimulateAlertRequest {
    const lagMinutes = toNumber(form.lagMinutes) ?? 0;

    return {
      clientSlug: clientSlug ?? undefined,
      ruleName: form.ruleName,
      severity: form.severity,
      status,
      resourceId: form.resourceId,
      metricName: form.metricName || undefined,
      metricValue: toNumber(form.metricValue),
      threshold: toNumber(form.threshold),
      description: form.description || undefined,
      dimensions: form.mountId ? { mountId: form.mountId } : undefined,
      firedAt: lagMinutes > 0 ? new Date(Date.now() - lagMinutes * 60_000).toISOString() : undefined,
      unique: status === 'Fired' ? form.unique : false,
      syntheticHistory: status === 'Fired' ? previewSpec : undefined,
      ...overrides
    };
  }

  async function submit(request: SimulateAlertRequest): Promise<AlertEvent | null> {
    const response = await fetch('/api/simulate/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Simulation failed with status ${response.status}`);
    }

    return (await response.json()) as AlertEvent;
  }

  async function fire(status: SimulateAlertRequest['status']): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const alert = await submit(buildRequest(status));
      setLastAlert(alert);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Simulation failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function fireBurst(): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const usable = presets.length > 0 ? presets : [];
      const requests: SimulateAlertRequest[] = [];

      for (let index = 0; index < 5; index += 1) {
        const preset = usable[Math.floor(Math.random() * usable.length)];
        const vm = RANDOM_RESOURCES[Math.floor(Math.random() * RANDOM_RESOURCES.length)];
        const resourceId = form.resourceId.replace(/[^/]+$/, vm);

        requests.push(
          preset
            ? { clientSlug: clientSlug ?? undefined, scenario: preset.id, ruleName: '', severity: preset.defaults.severity, status: 'Fired', resourceId, unique: true, firedAt: new Date(Date.now() - Math.random() * 45_000).toISOString() }
            : buildRequest('Fired', { resourceId, unique: true })
        );
      }

      let last: AlertEvent | null = null;

      for (const request of requests) {
        last = await submit(request);
      }

      setLastAlert(last);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Burst failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      {/* Left column: scenarios + recent */}
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader eyebrow="Scenarios" title="Pick a story to simulate" description="Each preset fires an alert and registers matching synthetic history so the agent has something to analyse." />
          <div className="grid gap-2">
            {presets.map((preset) => (
              <ScenarioCard key={preset.id} preset={preset} selected={scenario === preset.id} onSelect={() => selectScenario(preset.id)} />
            ))}
            <button
              type="button"
              onClick={() => setScenario('custom')}
              className={`rounded-md border p-3 text-left text-xs transition-colors ${
                scenario === 'custom' ? 'border-accent bg-accent/5 ring-1 ring-accent/40' : 'border-dashed border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
              }`}
            >
              <span className="font-semibold text-[var(--color-text)]">Custom</span>
              <span className="ml-2">Edit any field on the right; the form becomes a custom scenario.</span>
            </button>
          </div>
        </Card>

        <Card>
          <CardHeader eyebrow="Recent" title="Simulated alerts" description="Click one to open it in the feed and watch the agent's diagnosis land." />
          <RecentSimulatedAlerts alerts={alerts} />
        </Card>
      </div>

      {/* Right column: form */}
      <Card>
        <CardHeader
          eyebrow="Alert payload"
          title={scenario === 'custom' ? 'Custom alert' : presets.find((preset) => preset.id === scenario)?.label ?? 'Alert'}
          description={clientSlug ? `Scoped to client "${clientSlug}"` : 'Unscoped: not persisted. Pick a client in the top bar to scope it.'}
          actions={<Badge tone="warning">Dev only</Badge>}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Rule name" className="md:col-span-2">
            <Input value={form.ruleName} onChange={(event) => update('ruleName', event.target.value)} />
          </Field>

          <Field label="Severity">
            <Select value={form.severity} onChange={(event) => update('severity', event.target.value as AlertSeverity)}>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Metric name">
            <Input value={form.metricName} onChange={(event) => update('metricName', event.target.value)} />
          </Field>

          <Field label="Resource ID" className="md:col-span-2" hint="ARM path. The last segment is the resource name shown in the feed.">
            <Input className="font-mono text-xs" value={form.resourceId} onChange={(event) => update('resourceId', event.target.value)} />
          </Field>

          <Field label="Metric value">
            <Input type="number" step="0.1" value={form.metricValue} onChange={(event) => update('metricValue', event.target.value)} />
          </Field>

          <Field label="Threshold">
            <Input type="number" step="0.1" value={form.threshold} onChange={(event) => update('threshold', event.target.value)} />
          </Field>

          <Field label="Mount / dimension" hint="Optional, e.g. C: for a per-disk alert">
            <Input value={form.mountId} onChange={(event) => update('mountId', event.target.value)} />
          </Field>

          <Field label="Simulated lag (minutes)" hint="Backdates firedAt so the lag badge turns amber or red">
            <Input type="number" min="0" step="1" value={form.lagMinutes} onChange={(event) => update('lagMinutes', event.target.value)} />
          </Field>

          <Field label="Description" className="md:col-span-2">
            <Textarea rows={2} value={form.description} onChange={(event) => update('description', event.target.value)} />
          </Field>
        </div>

        <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Synthetic metric history</p>
            <Sparkline spec={previewSpec} className="text-accent" />
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Field label="Pattern">
              <Select value={form.pattern} onChange={(event) => update('pattern', event.target.value as SyntheticHistorySpec['pattern'])}>
                {PATTERNS.map((pattern) => (
                  <option key={pattern.value} value={pattern.value}>
                    {pattern.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Days of history">
              <Input type="number" min="1" max="366" value={form.historyDays} onChange={(event) => update('historyDays', event.target.value)} />
            </Field>
            <Field label="Start value" hint="Ends at the metric value above">
              <Input type="number" step="0.1" value={form.startPercent} onChange={(event) => update('startPercent', event.target.value)} />
            </Field>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="danger" onClick={() => void fire('Fired')} loading={isSubmitting} disabled={!form.ruleName || !form.resourceId}>
            Fire alert
          </Button>
          <Button variant="success" onClick={() => void fire('Resolved')} loading={isSubmitting} disabled={!form.ruleName || !form.resourceId} title="Resolves the alert with this rule + resource (ignores the unique flag)">
            Resolve alert
          </Button>
          <Button variant="secondary" onClick={() => void fireBurst()} loading={isSubmitting} disabled={presets.length === 0} title="Fire five random scenarios across random VMs">
            Fire 5 random
          </Button>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={form.unique} onChange={(event) => update('unique', event.target.checked)} className="accent-accent" />
            New alert each fire
          </label>
        </div>

        {errorMessage && (
          <Notice tone="error" className="mt-3">
            {errorMessage}
          </Notice>
        )}

        {lastAlert && (
          <div className="mt-3 rounded-md border border-sev-ok/30 bg-sev-ok/5 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <SeverityIndicator severity={lastAlert.severity} status={lastAlert.status} />
              <span className="font-medium text-[var(--color-text)]">{lastAlert.ruleName}</span>
              <LagBadge lagMs={lastAlert.lagMs} withLabel />
              <span className="text-[var(--color-text-tertiary)]">{shortenResourceId(lastAlert.resourceIds[0])}</span>
              <div className="flex-1" />
              <Button size="sm" variant="primary" onClick={() => navigate(`/alerts?alert=${encodeURIComponent(lastAlert.id)}`)}>
                Open in feed
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowResponse((value) => !value)}>
                {showResponse ? 'Hide' : 'Show'} response
              </Button>
            </div>
            {showResponse && (
              <pre className="mt-2 max-h-56 overflow-auto rounded bg-[var(--color-bg)] p-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
                {JSON.stringify(lastAlert, null, 2)}
              </pre>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

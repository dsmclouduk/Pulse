import { Badge, Spinner } from '@/components/ui';
import type { AlertEnrichmentStatus, DiagnosisUrgency, EnrichmentState } from '@/types';

/* ── Urgency ──────────────────────────────────────────────────── */

const urgencyConfig: Record<DiagnosisUrgency, { label: string; tone: 'critical' | 'error' | 'warning' | 'info'; dot: string }> = {
  immediate: { label: 'Immediate', tone: 'critical', dot: 'bg-sev-critical' },
  soon: { label: 'Soon', tone: 'error', dot: 'bg-sev-error' },
  planned: { label: 'Planned', tone: 'warning', dot: 'bg-sev-warning' },
  informational: { label: 'Informational', tone: 'info', dot: 'bg-sev-info' }
};

export function UrgencyBadge({ urgency, className = '' }: Readonly<{ urgency: DiagnosisUrgency; className?: string }>) {
  const config = urgencyConfig[urgency];

  return (
    <Badge tone={config.tone} className={className} title={`Agent urgency: ${config.label}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </Badge>
  );
}

export function UrgencyDot({ urgency, title }: Readonly<{ urgency: DiagnosisUrgency; title?: string }>) {
  const config = urgencyConfig[urgency];
  return <span title={title ?? `Agent urgency: ${config.label}`} className={`inline-block h-2 w-2 rounded-full ${config.dot}`} />;
}

/* ── Enrichment state ─────────────────────────────────────────── */

const stateLabels: Record<EnrichmentState, string> = {
  queued: 'Queued',
  'fetching-history': 'Fetching history',
  analysing: 'Analysing trend',
  diagnosing: 'Diagnosing',
  complete: 'Diagnosed',
  failed: 'Diagnosis failed',
  skipped: 'Not analysed'
};

export const ACTIVE_ENRICHMENT_STATES: readonly EnrichmentState[] = ['queued', 'fetching-history', 'analysing', 'diagnosing'];

export function isEnrichmentActive(state: EnrichmentState | undefined): boolean {
  return state !== undefined && ACTIVE_ENRICHMENT_STATES.includes(state);
}

export function EnrichmentStatePill({ status }: Readonly<{ status: AlertEnrichmentStatus | undefined }>) {
  if (!status) {
    return (
      <Badge tone="neutral" title="No enrichment has run for this alert">
        No analysis
      </Badge>
    );
  }

  if (isEnrichmentActive(status.state)) {
    return (
      <Badge tone="accent" title={status.message}>
        <Spinner size={10} />
        {stateLabels[status.state]}
      </Badge>
    );
  }

  if (status.state === 'complete' && status.urgency) {
    return <UrgencyBadge urgency={status.urgency} />;
  }

  if (status.state === 'failed') {
    return (
      <Badge tone="error" title={status.message}>
        {stateLabels.failed}
      </Badge>
    );
  }

  return (
    <Badge tone="neutral" title={status.message}>
      {stateLabels[status.state]}
    </Badge>
  );
}

export function enrichmentStateLabel(state: EnrichmentState): string {
  return stateLabels[state];
}

import type { AlertEvent, AlertSeverity } from '@/types';

interface SeverityIndicatorProps {
  severity: AlertSeverity;
  status: AlertEvent['status'];
  /** 'chip' = solid colored pill (table), 'dot' = dot + text (other contexts) */
  variant?: 'chip' | 'dot';
}

interface SeverityConfig {
  bgColor: string;
  label: string;
  icon: React.ReactNode;
}

/* ── Severity icons (12x12 viewBox, white stroke/fill) ────── */

/** Flame icon for Critical */
function CriticalIcon() {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1C7 1 3 4.5 3 8a4 4 0 0 0 8 0c0-1.5-.8-2.8-1.5-3.5-.3.8-1 1.5-1.5 1.5 0-2-1-4-1-4v0Z"
        fill="white"
        fillOpacity="0.9"
      />
      <path
        d="M7 13a4 4 0 0 1-4-4c0-2 1.5-4 2.5-5.2.5 1.5 1.2 2.7 2 3.2.2-.8.5-2 .5-3C9.5 5.5 11 7.5 11 9a4 4 0 0 1-4 4Z"
        stroke="white"
        strokeWidth="0.8"
        fill="none"
      />
    </svg>
  );
}

/** Circle with exclamation for Error */
function ErrorIcon() {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.3" />
      <path d="M7 4.5v3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="9.5" r="0.75" fill="white" />
    </svg>
  );
}

/** Triangle with exclamation for Warning */
function WarningIcon() {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1.5L1.5 12h11L7 1.5Z"
        stroke="white"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M7 5.5v3" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="7" cy="10.25" r="0.65" fill="white" />
    </svg>
  );
}

/** Checkmark circle for Cleared */
function ClearedIcon() {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.3" />
      <path d="M4.5 7l2 2 3.5-3.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getConfig(severity: AlertSeverity, status: AlertEvent['status']): SeverityConfig {
  if (status === 'Resolved') {
    return { bgColor: 'bg-sev-ok', label: 'Cleared', icon: <ClearedIcon /> };
  }

  switch (severity) {
    case 'Sev0':
      return { bgColor: 'bg-sev-critical', label: 'Critical', icon: <CriticalIcon /> };
    case 'Sev1':
      return { bgColor: 'bg-sev-error', label: 'Error', icon: <ErrorIcon /> };
    case 'Sev2':
    case 'Sev3':
    case 'Sev4':
      return { bgColor: 'bg-sev-warning', label: 'Warning', icon: <WarningIcon /> };
  }
}

export function SeverityIndicator({ severity, status, variant = 'chip' }: Readonly<SeverityIndicatorProps>) {
  const config = getConfig(severity, status);

  if (variant === 'dot') {
    return (
      <div className="flex items-center gap-2">
        <span className={`inline-block h-3 w-3 flex-shrink-0 rounded-full ${config.bgColor}`} />
        <span className="text-sm text-[var(--color-text)]">{config.label}</span>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-white ${config.bgColor}`}>
      {config.icon}
      {config.label}
    </span>
  );
}

/** Just the colored dot, no label. Used in compact contexts. */
export function SeverityDot({ severity, status }: Readonly<Omit<SeverityIndicatorProps, 'variant'>>) {
  const config = getConfig(severity, status);
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${config.bgColor}`} />;
}

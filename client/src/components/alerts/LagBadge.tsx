import { formatLag, getLagTone } from '@/lib/alerts';

interface LagBadgeProps {
  lagMs: number;
  /** Show the "lag" word after the value. */
  withLabel?: boolean;
}

/**
 * Webhook lag badge: receivedAt minus firedAt.
 * Green under 5 s, amber 5–30 s, red above 30 s (see CLAUDE.md).
 */
export function LagBadge({ lagMs, withLabel = false }: Readonly<LagBadgeProps>) {
  return (
    <span
      title={`Webhook lag: ${lagMs}ms between Azure firing the alert and Pulse receiving it`}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none ${getLagTone(lagMs)}`}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="6" cy="6" r="4.5" />
        <path d="M6 3.5V6l1.8 1.2" strokeLinecap="round" />
      </svg>
      {formatLag(lagMs)}
      {withLabel && <span className="font-sans font-medium opacity-80">lag</span>}
    </span>
  );
}

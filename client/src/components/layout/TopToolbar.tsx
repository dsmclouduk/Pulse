import { useState } from 'react';

import type { ConnectionStatus } from '@/hooks/useAlertStream';
import { applyTheme, getStoredTheme } from '@/lib/theme';

interface TopToolbarProps {
  pageTitle: string;
  connectionStatus: ConnectionStatus;
  selectedClientSlug: string | null;
  onSelectClientSlug: (slug: string | null) => void;
}

const statusConfig: Record<ConnectionStatus, { label: string; color: string }> = {
  connected: { label: 'Connected', color: 'bg-sev-ok' },
  reconnecting: { label: 'Reconnecting', color: 'bg-sev-warning' },
  disconnected: { label: 'Disconnected', color: 'bg-sev-critical' },
};

function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => getStoredTheme() === 'dark');

  function toggle() {
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    setIsDark(next === 'dark');
  }

  return (
    <button
      onClick={toggle}
      className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        // Sun icon — click to go light
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      ) : (
        // Moon icon — click to go dark
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 1a7 7 0 1 0 8.9 8.9A5.5 5.5 0 0 1 6 1Z" />
        </svg>
      )}
    </button>
  );
}

export function TopToolbar({
  pageTitle,
  connectionStatus,
  selectedClientSlug,
}: Readonly<TopToolbarProps>) {
  const status = statusConfig[connectionStatus];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <header className="flex h-12 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      {/* Left — branding + page title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-accent">Pulse</span>
          <span className="text-[var(--color-text-secondary)]">/</span>
        </div>
        <h1 className="text-sm font-medium text-[var(--color-text)]">{pageTitle}</h1>
      </div>

      {/* Right — status indicators */}
      <div className="flex items-center gap-4">
        {/* Client scope */}
        {selectedClientSlug && (
          <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
            {selectedClientSlug}
          </span>
        )}

        {/* Timezone */}
        <span className="text-xs text-[var(--color-text-tertiary)]">{tz}</span>

        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${status.color}`} />
          <span className="text-xs text-[var(--color-text-secondary)]">{status.label}</span>
        </div>

        {/* Theme toggle */}
        <ThemeToggle />
      </div>
    </header>
  );
}

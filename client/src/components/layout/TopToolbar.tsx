import { useState } from 'react';

import { Spinner } from '@/components/ui';
import { useActiveEnrichmentCount } from '@/context/AlertDataContext';
import type { ConnectionStatus } from '@/hooks/useAlertStream';
import { useClientAccounts } from '@/hooks/useClientAccounts';
import { applyTheme, getStoredTheme } from '@/lib/theme';

interface TopToolbarProps {
  pageTitle: string;
  connectionStatus: ConnectionStatus;
  selectedClientSlug: string | null;
  onSelectClientSlug: (slug: string | null) => void;
}

const statusConfig: Record<ConnectionStatus, { label: string; color: string }> = {
  connected: { label: 'Live', color: 'bg-sev-ok' },
  reconnecting: { label: 'Reconnecting', color: 'bg-sev-warning' },
  disconnected: { label: 'Disconnected', color: 'bg-sev-critical' }
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
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 1a7 7 0 1 0 8.9 8.9A5.5 5.5 0 0 1 6 1Z" />
        </svg>
      )}
    </button>
  );
}

function ClientScopeSelector({ selectedClientSlug, onSelectClientSlug }: Readonly<Pick<TopToolbarProps, 'selectedClientSlug' | 'onSelectClientSlug'>>) {
  const { clients, isLoading } = useClientAccounts();

  return (
    <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]" title="Scope the live feed, comments and simulations to a client account">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 13V5.5L8 2l6 3.5V13" />
        <path d="M6 13V9h4v4" />
      </svg>
      <select
        value={selectedClientSlug ?? ''}
        onChange={(event) => onSelectClientSlug(event.target.value || null)}
        disabled={isLoading}
        className="h-7 max-w-[180px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-xs text-[var(--color-text)] focus:border-accent focus:outline-none"
      >
        <option value="">All alerts (in-memory)</option>
        {clients.map((client) => (
          <option key={client.id} value={client.slug}>
            {client.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TopToolbar({ pageTitle, connectionStatus, selectedClientSlug, onSelectClientSlug }: Readonly<TopToolbarProps>) {
  const status = statusConfig[connectionStatus];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const activeEnrichments = useActiveEnrichmentCount();

  return (
    <header className="flex h-12 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-accent">Pulse</span>
          <span className="text-[var(--color-text-secondary)]">/</span>
        </div>
        <h1 className="text-sm font-medium text-[var(--color-text)]">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-4">
        <ClientScopeSelector selectedClientSlug={selectedClientSlug} onSelectClientSlug={onSelectClientSlug} />

        {activeEnrichments > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-accent" title="Pulse Agent is analysing alerts">
            <Spinner size={12} />
            Agent analysing {activeEnrichments}
          </span>
        )}

        <span className="hidden text-xs text-[var(--color-text-tertiary)] lg:inline">{tz}</span>

        <div className="flex items-center gap-1.5" title="Server-sent events connection">
          <span className={`h-2 w-2 rounded-full ${status.color} ${connectionStatus === 'connected' ? 'animate-pulse-slow' : ''}`} />
          <span className="text-xs text-[var(--color-text-secondary)]">{status.label}</span>
        </div>

        <ThemeToggle />
      </div>
    </header>
  );
}

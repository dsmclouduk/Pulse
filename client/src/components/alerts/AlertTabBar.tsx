interface AlertTabBarProps {
  alertCount: number;
}

export function AlertTabBar({ alertCount }: Readonly<AlertTabBarProps>) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3">
      {/* Tabs — only Alerts is active */}
      <div className="flex items-center gap-0">
        <button className="relative px-4 py-2.5 text-sm font-medium text-accent after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-accent">
          Alerts
          <span className="ml-1.5 text-xs text-[var(--color-text-tertiary)]">({alertCount})</span>
        </button>

        {/* Overflow menu */}
        <button className="px-2 py-2.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="3" cy="7" r="1.2" />
            <circle cx="7" cy="7" r="1.2" />
            <circle cx="11" cy="7" r="1.2" />
          </svg>
        </button>
      </div>

      {/* Right — column settings placeholder */}
      <div className="flex items-center gap-1">
        <button
          className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
          title="Column Settings (coming soon)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <rect x="1" y="1" width="12" height="12" rx="1.5" />
            <path d="M1 5h12M1 9h12M5 1v12M9 1v12" />
          </svg>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <rect x="1" y="1" width="5" height="5" rx="0.8" />
            <rect x="8" y="1" width="5" height="5" rx="0.8" />
            <rect x="1" y="8" width="5" height="5" rx="0.8" />
            <rect x="8" y="8" width="5" height="5" rx="0.8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

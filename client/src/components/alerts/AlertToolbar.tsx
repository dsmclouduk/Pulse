import { useState } from 'react';

import type { AlertFilters, SortField } from '@/lib/alertFilters';
import { DEFAULT_FILTERS } from '@/lib/alertFilters';
import type { AlertSeverity, AlertStatus } from '@/types';

interface AlertToolbarProps {
  filters: AlertFilters;
  onFiltersChange: (filters: AlertFilters) => void;
  totalCount: number;
  filteredCount: number;
  checkedCount: number;
  onAction: (action: string) => void;
  onClearChecked: () => void;
}

const actions = [
  { id: 'sdt', label: 'Add SDT', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4v6l4 2' },
  { id: 'ack', label: 'Add ACK', icon: 'M5 13l4 4L19 7' },
  { id: 'escalate', label: 'Escalate', icon: 'M5 10l7-7 7 7M12 3v18' },
  { id: 'note', label: 'Add Note', icon: 'M4 4h16v16H4zM8 8h8M8 12h5' },
];

const severityButtons: Array<{ key: string; severities: AlertSeverity[]; bgColor: string; label: string; icon: React.ReactNode }> = [
  {
    key: 'critical', severities: ['Sev0'], bgColor: 'bg-sev-critical', label: 'Critical',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none">
        <path d="M7 1C7 1 3 4.5 3 8a4 4 0 0 0 8 0c0-1.5-.8-2.8-1.5-3.5-.3.8-1 1.5-1.5 1.5 0-2-1-4-1-4v0Z" fill="white" fillOpacity="0.9" />
        <path d="M7 13a4 4 0 0 1-4-4c0-2 1.5-4 2.5-5.2.5 1.5 1.2 2.7 2 3.2.2-.8.5-2 .5-3C9.5 5.5 11 7.5 11 9a4 4 0 0 1-4 4Z" stroke="white" strokeWidth="0.8" fill="none" />
      </svg>
    ),
  },
  {
    key: 'error', severities: ['Sev1'], bgColor: 'bg-sev-error', label: 'Error',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.3" />
        <path d="M7 4.5v3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="9.5" r="0.75" fill="white" />
      </svg>
    ),
  },
  {
    key: 'warning', severities: ['Sev2', 'Sev3', 'Sev4'], bgColor: 'bg-sev-warning', label: 'Warning',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none">
        <path d="M7 1.5L1.5 12h11L7 1.5Z" stroke="white" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M7 5.5v3" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="7" cy="10.25" r="0.65" fill="white" />
      </svg>
    ),
  },
];

const timeRangeOptions: Array<{ value: AlertFilters['timeRange']; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: '1h', label: 'Last 1h' },
  { value: '6h', label: 'Last 6h' },
  { value: '24h', label: 'Last 24h' },
];

export function AlertToolbar({ filters, onFiltersChange, totalCount, filteredCount, checkedCount, onAction, onClearChecked }: Readonly<AlertToolbarProps>) {
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [showActionsDropdown, setShowActionsDropdown] = useState(false);

  function toggleSeverity(sevs: AlertSeverity[]) {
    const next = new Set(filters.severities);
    const allActive = sevs.every((s) => next.has(s));

    if (allActive) {
      sevs.forEach((s) => next.delete(s));
    } else {
      sevs.forEach((s) => next.add(s));
    }

    onFiltersChange({ ...filters, severities: next });
  }

  function toggleStatus(status: AlertStatus) {
    const next = new Set(filters.statuses);
    if (next.has(status)) {
      next.delete(status);
    } else {
      next.add(status);
    }
    onFiltersChange({ ...filters, statuses: next });
  }

  function setTimeRange(range: AlertFilters['timeRange']) {
    onFiltersChange({ ...filters, timeRange: range });
    setShowTimeDropdown(false);
  }

  function resetFilters() {
    onFiltersChange({ ...DEFAULT_FILTERS });
  }

  function removeFilter(type: string) {
    switch (type) {
      case 'severity':
        onFiltersChange({ ...filters, severities: new Set() });
        break;
      case 'status':
        onFiltersChange({ ...filters, statuses: new Set() });
        break;
      case 'time':
        onFiltersChange({ ...filters, timeRange: 'all' });
        break;
      case 'search':
        onFiltersChange({ ...filters, searchText: '' });
        break;
      case 'simulated':
        onFiltersChange({ ...filters, showSimulated: true });
        break;
    }
  }

  // Build active filter pills (severity excluded — icons already show it)
  const activeFilters: Array<{ key: string; label: string }> = [];
  if (filters.statuses.size > 0) {
    const labels = [...filters.statuses].join(', ');
    activeFilters.push({ key: 'status', label: `Status: ${labels}` });
  }
  if (filters.timeRange !== 'all') {
    const opt = timeRangeOptions.find((o) => o.value === filters.timeRange);
    activeFilters.push({ key: 'time', label: opt?.label ?? filters.timeRange });
  }
  if (!filters.showSimulated) {
    activeFilters.push({ key: 'simulated', label: 'Hide Simulated' });
  }

  const hasActiveFilters = activeFilters.length > 0 || filters.searchText.length > 0;
  const timeLabel = timeRangeOptions.find((o) => o.value === filters.timeRange)?.label ?? 'Any time';

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Main toolbar row */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Actions dropdown — visible when rows are checked */}
        {checkedCount > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowActionsDropdown(!showActionsDropdown)}
              className="flex items-center gap-1.5 rounded border border-accent bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/20"
            >
              Actions ({checkedCount})
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <path d="M2 3.5l3 3 3-3" />
              </svg>
            </button>

            {showActionsDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowActionsDropdown(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
                  {actions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => { onAction(action.id); setShowActionsDropdown(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-text)] hover:bg-[var(--color-hover)]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={action.icon} />
                      </svg>
                      {action.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Clear selection link */}
        {checkedCount > 0 && (
          <button onClick={onClearChecked} className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
            Clear
          </button>
        )}

        {/* Separator when actions visible */}
        {checkedCount > 0 && <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />}

        {/* Severity quick-filter icons */}
        <div className="flex items-center gap-1">
          {severityButtons.map((btn) => {
            const isActive = btn.severities.every((s) => filters.severities.has(s));
            const anyFilterActive = filters.severities.size > 0;
            const dimmed = anyFilterActive && !isActive;
            return (
              <button
                key={btn.key}
                onClick={() => toggleSeverity(btn.severities)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${btn.bgColor} ${
                  isActive
                    ? 'opacity-100'
                    : dimmed
                      ? 'opacity-25 hover:opacity-50'
                      : 'opacity-80 hover:opacity-100'
                }`}
                title={btn.label}
              >
                {btn.icon}
              </button>
            );
          })}
        </div>

        {/* Separator */}
        <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
          >
            <circle cx="6" cy="6" r="4.5" />
            <path d="M9.5 9.5 13 13" />
          </svg>
          <input
            type="text"
            placeholder="Search table..."
            value={filters.searchText}
            onChange={(e) => onFiltersChange({ ...filters, searchText: e.target.value })}
            className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {/* Filter by label */}
        <span className="text-xs text-[var(--color-text-secondary)]">Filter by:</span>

        {/* Quick add filter buttons */}
        <button
          onClick={() => toggleStatus('Fired')}
          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            filters.statuses.has('Fired')
              ? 'bg-accent text-white'
              : 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
          }`}
        >
          {filters.statuses.has('Fired') ? '✓ ' : '+ '}Fired
        </button>
        <button
          onClick={() => toggleStatus('Resolved')}
          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            filters.statuses.has('Resolved')
              ? 'bg-accent text-white'
              : 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
          }`}
        >
          {filters.statuses.has('Resolved') ? '✓ ' : '+ '}Cleared
        </button>
        <button
          onClick={() => onFiltersChange({ ...filters, showSimulated: !filters.showSimulated })}
          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            !filters.showSimulated
              ? 'bg-accent text-white'
              : 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
          }`}
        >
          {!filters.showSimulated ? '✓ ' : '+ '}Simulated
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Reset */}
        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="text-xs font-medium text-accent hover:text-accent-light"
          >
            Reset
          </button>
        )}

        {/* Time range */}
        <div className="relative">
          <button
            onClick={() => setShowTimeDropdown(!showTimeDropdown)}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="6" cy="6" r="5" />
              <path d="M6 3v3l2 1" />
            </svg>
            {timeLabel}
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
              <path d="M1 3l3 3 3-3" />
            </svg>
          </button>

          {showTimeDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowTimeDropdown(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
                {timeRangeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTimeRange(opt.value)}
                    className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-hover)] ${
                      filters.timeRange === opt.value ? 'font-medium text-accent' : 'text-[var(--color-text)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Count indicator */}
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {filteredCount === totalCount ? `${totalCount} alerts` : `${filteredCount} of ${totalCount}`}
        </span>
      </div>

      {/* Active filter pills row */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-3 py-1.5">
          {activeFilters.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-white"
            >
              {f.label}
              <button
                onClick={() => removeFilter(f.key)}
                className="ml-0.5 rounded-sm hover:bg-white/20"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <path d="M2.5 2.5 7.5 7.5M7.5 2.5 2.5 7.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

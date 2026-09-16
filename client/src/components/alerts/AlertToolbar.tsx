import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Spinner } from '@/components/ui';
import { useActiveEnrichmentCount } from '@/context/AlertDataContext';
import type { AlertFilters } from '@/lib/alertFilters';
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
  { id: 'note', label: 'Add Note', icon: 'M4 4h16v16H4zM8 8h8M8 12h5', enabled: true },
  { id: 'rerun', label: 'Re-run analysis', icon: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5', enabled: true },
  { id: 'ack', label: 'Add ACK', icon: 'M5 13l4 4L19 7', enabled: false },
  { id: 'sdt', label: 'Add SDT', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4v6l4 2', enabled: false },
  { id: 'escalate', label: 'Escalate', icon: 'M5 10l7-7 7 7M12 3v18', enabled: false }
];

const severityButtons: Array<{ key: string; severities: AlertSeverity[]; bgColor: string; label: string; icon: React.ReactNode }> = [
  {
    key: 'critical',
    severities: ['Sev0'],
    bgColor: 'bg-sev-critical',
    label: 'Critical',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none">
        <path d="M7 1C7 1 3 4.5 3 8a4 4 0 0 0 8 0c0-1.5-.8-2.8-1.5-3.5-.3.8-1 1.5-1.5 1.5 0-2-1-4-1-4v0Z" fill="white" fillOpacity="0.9" />
        <path d="M7 13a4 4 0 0 1-4-4c0-2 1.5-4 2.5-5.2.5 1.5 1.2 2.7 2 3.2.2-.8.5-2 .5-3C9.5 5.5 11 7.5 11 9a4 4 0 0 1-4 4Z" stroke="white" strokeWidth="0.8" fill="none" />
      </svg>
    )
  },
  {
    key: 'error',
    severities: ['Sev1'],
    bgColor: 'bg-sev-error',
    label: 'Error',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.3" />
        <path d="M7 4.5v3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="9.5" r="0.75" fill="white" />
      </svg>
    )
  },
  {
    key: 'warning',
    severities: ['Sev2', 'Sev3', 'Sev4'],
    bgColor: 'bg-sev-warning',
    label: 'Warning',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none">
        <path d="M7 1.5L1.5 12h11L7 1.5Z" stroke="white" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M7 5.5v3" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="7" cy="10.25" r="0.65" fill="white" />
      </svg>
    )
  }
];

const timeRangeOptions: Array<{ value: AlertFilters['timeRange']; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: '1h', label: 'Last 1h' },
  { value: '6h', label: 'Last 6h' },
  { value: '24h', label: 'Last 24h' }
];

const pillBase = 'rounded-md px-2 py-1 text-xs font-medium transition-colors';
const pillOff = 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]';
const pillOn = 'bg-accent text-white';

export function AlertToolbar({ filters, onFiltersChange, totalCount, filteredCount, checkedCount, onAction, onClearChecked }: Readonly<AlertToolbarProps>) {
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [showActionsDropdown, setShowActionsDropdown] = useState(false);
  const activeEnrichments = useActiveEnrichmentCount();
  const navigate = useNavigate();

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
      case 'status':
        onFiltersChange({ ...filters, statuses: new Set(DEFAULT_FILTERS.statuses) });
        break;
      case 'time':
        onFiltersChange({ ...filters, timeRange: 'all' });
        break;
      case 'simulated':
        onFiltersChange({ ...filters, showSimulated: true });
        break;
      default:
        break;
    }
  }

  const activeFilters: Array<{ key: string; label: string }> = [];
  if (filters.statuses.size > 0) {
    activeFilters.push({ key: 'status', label: `Status: ${[...filters.statuses].join(', ')}` });
  }
  if (filters.timeRange !== 'all') {
    const opt = timeRangeOptions.find((o) => o.value === filters.timeRange);
    activeFilters.push({ key: 'time', label: opt?.label ?? filters.timeRange });
  }
  if (!filters.showSimulated) {
    activeFilters.push({ key: 'simulated', label: 'Hide Simulated' });
  }

  const hasActiveFilters = activeFilters.length > 0 || filters.searchText.length > 0 || filters.severities.size > 0;
  const timeLabel = timeRangeOptions.find((o) => o.value === filters.timeRange)?.label ?? 'Any time';

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
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
                <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
                  {actions.map((action) => (
                    <button
                      key={action.id}
                      disabled={!action.enabled}
                      title={action.enabled ? undefined : 'Coming in a later phase'}
                      onClick={() => {
                        onAction(action.id);
                        setShowActionsDropdown(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-text)] hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-40"
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

        {checkedCount > 0 && (
          <button onClick={onClearChecked} className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
            Clear
          </button>
        )}

        {checkedCount > 0 && <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />}

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
                  isActive ? 'opacity-100 ring-2 ring-accent/50' : dimmed ? 'opacity-25 hover:opacity-50' : 'opacity-80 hover:opacity-100'
                }`}
                title={btn.label}
              >
                {btn.icon}
              </button>
            );
          })}
        </div>

        <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />

        <div className="relative max-w-xs flex-1">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="4.5" />
            <path d="M9.5 9.5 13 13" />
          </svg>
          <input
            type="text"
            placeholder="Search alerts…"
            value={filters.searchText}
            onChange={(e) => onFiltersChange({ ...filters, searchText: e.target.value })}
            className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <span className="text-xs text-[var(--color-text-secondary)]">Filter by:</span>

        <button onClick={() => toggleStatus('Fired')} className={`${pillBase} ${filters.statuses.has('Fired') ? pillOn : pillOff}`}>
          {filters.statuses.has('Fired') ? '✓ ' : '+ '}Fired
        </button>
        <button onClick={() => toggleStatus('Resolved')} className={`${pillBase} ${filters.statuses.has('Resolved') ? pillOn : pillOff}`}>
          {filters.statuses.has('Resolved') ? '✓ ' : '+ '}Cleared
        </button>
        <button onClick={() => onFiltersChange({ ...filters, showSimulated: !filters.showSimulated })} className={`${pillBase} ${!filters.showSimulated ? pillOn : pillOff}`}>
          {!filters.showSimulated ? '✓ ' : '+ '}Hide simulated
        </button>

        <div className="flex-1" />

        {activeEnrichments > 0 && (
          <span className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-xs font-medium text-accent" title="Pulse Agent is analysing alerts">
            <Spinner size={11} />
            Analysing {activeEnrichments}
          </span>
        )}

        {hasActiveFilters && (
          <button onClick={resetFilters} className="text-xs font-medium text-accent hover:text-accent-light">
            Reset
          </button>
        )}

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

        <span className="text-xs text-[var(--color-text-tertiary)]">{filteredCount === totalCount ? `${totalCount} alerts` : `${filteredCount} of ${totalCount}`}</span>

        <button
          onClick={() => navigate('/simulate')}
          className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-light"
          title="Fire a dummy alert through the real pipeline"
        >
          <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 1.5v4.5l-3 7.5a1.5 1.5 0 0 0 1.4 2h8.2a1.5 1.5 0 0 0 1.4-2l-3-7.5V1.5" />
            <path d="M5.5 1.5h7" />
          </svg>
          Simulate
        </button>
      </div>

      {activeFilters.length > 0 && (
        <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-3 py-1.5">
          {activeFilters.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-white">
              {f.label}
              <button onClick={() => removeFilter(f.key)} className="ml-0.5 rounded-sm hover:bg-white/20">
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

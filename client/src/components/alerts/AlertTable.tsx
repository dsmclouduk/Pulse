import { useCallback, useRef, useState } from 'react';

import type { AlertEvent } from '@/types';
import type { SortField } from '@/lib/alertFilters';
import { SeverityIndicator } from '@/components/alerts/SeverityIndicator';
import { shortenResourceId } from '@/lib/alerts';

interface AlertTableProps {
  alerts: AlertEvent[];
  selectedAlertId: string | null;
  onSelectAlert: (alert: AlertEvent) => void;
  sortBy: SortField;
  sortDirection: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  totalCount: number;
  checkedIds: Set<string>;
  onCheckedIdsChange: (ids: Set<string>) => void;
}

interface ColumnDef {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  sortable: boolean;
  sortKey?: SortField;
}

const COLUMNS: ColumnDef[] = [
  { key: 'checkbox', label: '', defaultWidth: 28, minWidth: 28, sortable: false },
  { key: 'severity', label: 'Severity', defaultWidth: 120, minWidth: 80, sortable: true, sortKey: 'severity' },
  { key: 'reportedAt', label: 'Reported At', defaultWidth: 230, minWidth: 140, sortable: true, sortKey: 'reportedAt' },
  { key: 'resource', label: 'Resource', defaultWidth: 220, minWidth: 100, sortable: true, sortKey: 'resource' },
  { key: 'datapoint', label: 'Datapoint', defaultWidth: 160, minWidth: 80, sortable: true, sortKey: 'datapoint' },
  { key: 'alertValue', label: 'Alert Value', defaultWidth: 100, minWidth: 60, sortable: true, sortKey: 'alertValue' },
  { key: 'alertRule', label: 'Alert Rule', defaultWidth: 200, minWidth: 100, sortable: true, sortKey: 'alertRule' },
  { key: 'threshold', label: 'Threshold', defaultWidth: 100, minWidth: 60, sortable: true, sortKey: 'threshold' },
];

const thBase = 'relative px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] border-r border-b border-[var(--color-border)] whitespace-nowrap select-none';
const tdBase = 'px-2 py-1.5 border-r border-[var(--color-border)] whitespace-nowrap overflow-hidden text-ellipsis';

function SortIcon({ field, currentSort, direction }: Readonly<{ field: SortField; currentSort: SortField; direction: 'asc' | 'desc' }>) {
  if (field !== currentSort) {
    return (
      <svg className="ml-1 inline-block opacity-30" width="8" height="10" viewBox="0 0 8 10" fill="currentColor">
        <path d="M4 0L7 4H1Z" />
        <path d="M4 10L1 6H7Z" />
      </svg>
    );
  }

  return (
    <svg className="ml-1 inline-block text-accent" width="8" height="10" viewBox="0 0 8 10" fill="currentColor">
      {direction === 'asc' ? <path d="M4 0L7 4H1Z" /> : <path d="M4 10L1 6H7Z" />}
    </svg>
  );
}

function formatReportedAt(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  let relative: string;
  if (diffSeconds < 60) {
    relative = `${diffSeconds}s ago`;
  } else if (diffSeconds < 3600) {
    const mins = Math.floor(diffSeconds / 60);
    relative = `${mins}m ago`;
  } else if (diffSeconds < 86400) {
    const hours = Math.floor(diffSeconds / 3600);
    relative = `${hours}h ago`;
  } else {
    const days = Math.floor(diffSeconds / 86400);
    relative = `${days}d ago`;
  }

  const absolute = date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }) + ' ' + date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return `${absolute}  (${relative})`;
}

/* ── Alert Table ───────────────────────────────────────────── */

export function AlertTable({ alerts, selectedAlertId, onSelectAlert, sortBy, sortDirection, onSort, totalCount, checkedIds, onCheckedIdsChange }: Readonly<AlertTableProps>) {
  const [columnWidths, setColumnWidths] = useState<number[]>(() => COLUMNS.map((c) => c.defaultWidth));
  const dragRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { colIndex, startX: e.clientX, startWidth: columnWidths[colIndex] };

    function handleMouseMove(moveEvent: MouseEvent) {
      if (!dragRef.current) return;
      const delta = moveEvent.clientX - dragRef.current.startX;
      const minW = COLUMNS[dragRef.current.colIndex].minWidth;
      const newWidth = Math.max(minW, dragRef.current.startWidth + delta);

      setColumnWidths((prev) => {
        const next = [...prev];
        next[dragRef.current!.colIndex] = newWidth;
        return next;
      });
    }

    function handleMouseUp() {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [columnWidths]);

  function toggleCheck(alertId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const next = new Set(checkedIds);
    if (next.has(alertId)) {
      next.delete(alertId);
    } else {
      next.add(alertId);
    }
    onCheckedIdsChange(next);
  }

  function toggleCheckAll() {
    if (checkedIds.size === alerts.length) {
      onCheckedIdsChange(new Set());
    } else {
      onCheckedIdsChange(new Set(alerts.map((a) => a.id)));
    }
  }

  if (alerts.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[var(--color-text-tertiary)]">
        No alerts match the current filters.
      </div>
    );
  }

  const totalTableWidth = columnWidths.reduce((sum, w) => sum + w, 0);
  const allChecked = checkedIds.size === alerts.length;
  const someChecked = checkedIds.size > 0 && !allChecked;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Scrollable table */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-sm" style={{ width: totalTableWidth, minWidth: '100%', tableLayout: 'fixed' }}>
          <colgroup>
            {columnWidths.map((w, i) => (
              <col key={COLUMNS[i].key} style={{ width: w }} />
            ))}
          </colgroup>

          {/* Sticky header */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--color-header)]">
              {COLUMNS.map((col, colIndex) => (
                <th
                  key={col.key}
                  className={`${thBase} ${col.sortable ? 'cursor-pointer hover:text-[var(--color-text)]' : ''} ${col.key === 'checkbox' ? '!px-1 text-center' : ''}`}
                  onClick={() => { if (col.sortKey) onSort(col.sortKey); }}
                >
                  {col.key === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked; }}
                      onChange={toggleCheckAll}
                      className="h-3.5 w-3.5 cursor-pointer rounded accent-accent"
                    />
                  ) : (
                    <span className="inline-flex items-center">
                      {col.label}
                      {col.sortable && col.sortKey && (
                        <SortIcon field={col.sortKey} currentSort={sortBy} direction={sortDirection} />
                      )}
                    </span>
                  )}

                  {/* Resize handle */}
                  {colIndex < COLUMNS.length - 1 && (
                    <div
                      className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-accent/40"
                      onMouseDown={(e) => handleResizeStart(colIndex, e)}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {alerts.map((alert) => {
              const isSelected = alert.id === selectedAlertId;
              const isResolved = alert.status === 'Resolved';
              const isChecked = checkedIds.has(alert.id);

              return (
                <tr
                  key={alert.id}
                  onClick={() => onSelectAlert(alert)}
                  className={`cursor-pointer border-b border-[var(--color-border)] transition-colors ${
                    isChecked
                      ? 'bg-accent/10'
                      : isSelected
                        ? 'bg-accent/5'
                        : 'bg-[var(--color-surface)] hover:bg-[var(--color-hover)]'
                  } ${isResolved ? 'opacity-70' : ''}`}
                >
                  {/* Checkbox */}
                  <td className={`${tdBase} !px-1 text-center`}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {/* handled by onClick */}}
                      onClick={(e) => toggleCheck(alert.id, e)}
                      className="h-3.5 w-3.5 cursor-pointer rounded accent-accent"
                    />
                  </td>

                  {/* Severity */}
                  <td className={tdBase}>
                    <div className="flex items-center gap-1">
                      <SeverityIndicator severity={alert.severity} status={alert.status} />
                      {alert.isSimulated && (
                        <span className="rounded bg-[var(--color-text-tertiary)]/20 px-1 py-0.5 text-[10px] font-medium uppercase text-[var(--color-text-tertiary)]">
                          SIM
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Reported At */}
                  <td className={`${tdBase} text-[var(--color-text-secondary)]`}>
                    {formatReportedAt(alert.firedAt)}
                  </td>

                  {/* Resource */}
                  <td className={`${tdBase} font-medium text-[var(--color-text)]`} title={alert.resourceIds[0]}>
                    {shortenResourceId(alert.resourceIds[0])}
                  </td>

                  {/* Datapoint */}
                  <td className={`${tdBase} text-[var(--color-text-secondary)]`}>
                    {alert.metricName ?? '—'}
                  </td>

                  {/* Alert Value */}
                  <td className={`${tdBase} font-mono text-xs text-[var(--color-text)]`}>
                    {alert.metricValue ?? '—'}
                  </td>

                  {/* Alert Rule */}
                  <td className={`${tdBase} text-[var(--color-text-secondary)]`} title={alert.ruleName}>
                    {alert.ruleName}
                  </td>

                  {/* Threshold */}
                  <td className={`${tdBase} font-mono text-xs text-[var(--color-text-secondary)]`}>
                    {alert.threshold !== undefined && alert.threshold !== null ? `> ${alert.threshold}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex flex-shrink-0 items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-header)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
        <span>
          {alerts.length === totalCount
            ? `${totalCount} Alerts`
            : `${alerts.length} of ${totalCount} Filtered Alerts (${totalCount} Total)`}
        </span>
        <span>Per Page: 50</span>
      </div>
    </div>
  );
}

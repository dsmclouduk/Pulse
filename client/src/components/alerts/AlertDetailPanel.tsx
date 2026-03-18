import { useCallback, useRef, useState } from 'react';

import type { AlertEvent } from '@/types';
import { SeverityIndicator } from '@/components/alerts/SeverityIndicator';
import { MetricContextPanel } from '@/components/MetricContextPanel';
import { formatAbsoluteTime, formatRelativeTime, shortenResourceId } from '@/lib/alerts';

interface AlertDetailPanelProps {
  alert: AlertEvent | null;
  onClose: () => void;
  height: number;
  onHeightChange: (height: number) => void;
}

type Tab = 'overview' | 'graphs';

function DetailRow({ label, value }: Readonly<{ label: string; value: string | number | null | undefined }>) {
  if (value === null || value === undefined) return null;
  return (
    <tr className="border-b border-[var(--color-border)]">
      <td className="whitespace-nowrap px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)]">{label}</td>
      <td className="px-3 py-1.5 text-xs text-[var(--color-text)]">{value}</td>
    </tr>
  );
}

function OverviewTab({ alert }: Readonly<{ alert: AlertEvent }>) {
  return (
    <div className="flex gap-6 overflow-auto p-3">
      {/* Left — key-value metadata */}
      <table className="min-w-0 flex-1 border-collapse text-sm">
        <tbody>
          <DetailRow label="Datapoint" value={alert.metricName} />
          <DetailRow label="Resource / Website" value={shortenResourceId(alert.resourceIds[0])} />
          <DetailRow label="Signal Type" value={alert.signalType} />
          <DetailRow label="Resource Group" value={alert.resourceGroup} />
          <DetailRow label="Subscription" value={alert.subscriptionId} />
          {alert.description && <DetailRow label="Description" value={alert.description} />}
        </tbody>
      </table>

      {/* Right — alert metadata */}
      <table className="min-w-0 flex-1 border-collapse text-sm">
        <tbody>
          <DetailRow label="Alert ID" value={alert.id} />
          <DetailRow label="Fired At" value={`${formatAbsoluteTime(alert.firedAt)} (${formatRelativeTime(alert.firedAt)})`} />
          {alert.resolvedAt && (
            <DetailRow label="Resolved At" value={`${formatAbsoluteTime(alert.resolvedAt)} (${formatRelativeTime(alert.resolvedAt)})`} />
          )}
          <DetailRow label="Received At" value={formatAbsoluteTime(alert.receivedAt)} />
          <DetailRow label="Lag" value={`${alert.lagMs}ms`} />
          <DetailRow label="Alert Value" value={alert.metricValue} />
          <DetailRow label="Threshold" value={alert.threshold !== undefined && alert.threshold !== null ? `> ${alert.threshold}` : undefined} />
          {alert.isSimulated && <DetailRow label="Simulated" value="Yes" />}
        </tbody>
      </table>
    </div>
  );
}

export function AlertDetailPanel({ alert, onClose, height, onHeightChange }: Readonly<AlertDetailPanelProps>) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: height };

    function handleMouseMove(moveEvent: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - moveEvent.clientY;
      const newHeight = Math.max(120, Math.min(dragRef.current.startHeight + delta, window.innerHeight * 0.7));
      onHeightChange(newHeight);
    }

    function handleMouseUp() {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [height, onHeightChange]);

  if (!alert) return null;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'graphs', label: 'Graphs' },
  ];

  return (
    <div className="flex flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)]" style={{ height }}>
      {/* Drag handle */}
      <div
        role="separator"
        tabIndex={0}
        className="flex h-1.5 cursor-row-resize items-center justify-center hover:bg-accent/20"
        onMouseDown={handleMouseDown}
      >
        <div className="h-0.5 w-8 rounded-full bg-[var(--color-text-tertiary)]" />
      </div>

      {/* Header bar — severity chip, alert ID, timestamp, tabs, close */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-1.5">
        <SeverityIndicator severity={alert.severity} status={alert.status} />
        <span className="font-mono text-xs text-[var(--color-text-secondary)]">{alert.id.slice(0, 24)}...</span>
        <span className="text-xs text-[var(--color-text-tertiary)]">{formatAbsoluteTime(alert.firedAt)}</span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tabs */}
        <div className="flex items-center">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l8 8M11 3 3 11" />
          </svg>
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && <OverviewTab alert={alert} />}
        {activeTab === 'graphs' && (
          <div className="p-3">
            <MetricContextPanel resourceId={alert.resourceIds[0]} metricName={alert.metricName} />
          </div>
        )}
      </div>
    </div>
  );
}

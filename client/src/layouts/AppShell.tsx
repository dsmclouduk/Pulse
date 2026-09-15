import type { ReactNode } from 'react';

import type { AlertEvent } from '@/types';
import type { ConnectionStatus } from '@/hooks/useAlertStream';
import { Sidebar, type SidebarSeverityLevel } from '@/components/layout/Sidebar';
import { TopToolbar } from '@/components/layout/TopToolbar';

interface AppShellProps {
  children: ReactNode;
  alerts: AlertEvent[];
  connectionStatus: ConnectionStatus;
  selectedClientSlug: string | null;
  onSelectClientSlug: (slug: string | null) => void;
  pageTitle: string;
  onSidebarSeverityClick: (level: SidebarSeverityLevel) => void;
  activeSeverityLevels: ReadonlySet<SidebarSeverityLevel>;
}

export function AppShell({
  children,
  alerts,
  connectionStatus,
  selectedClientSlug,
  onSelectClientSlug,
  pageTitle,
  onSidebarSeverityClick,
  activeSeverityLevels,
}: Readonly<AppShellProps>) {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* Sidebar — fixed left */}
      <Sidebar
        alerts={alerts}
        onSeverityClick={onSidebarSeverityClick}
        activeLevels={activeSeverityLevels}
      />

      {/* Main area — offset by sidebar width */}
      <div className="ml-[68px] flex flex-1 flex-col overflow-hidden">
        <TopToolbar
          pageTitle={pageTitle}
          connectionStatus={connectionStatus}
          selectedClientSlug={selectedClientSlug}
          onSelectClientSlug={onSelectClientSlug}
        />

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

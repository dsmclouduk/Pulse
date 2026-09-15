import { useCallback, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { AuthShell } from '@/components/auth/AuthShell';
import { AlertDataProvider } from '@/context/AlertDataContext';
import { AppShell } from '@/layouts/AppShell';
import { AlertsPage } from '@/pages/AlertsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SimulatePage } from '@/pages/SimulatePage';
import { useAlertStream } from '@/hooks/useAlertStream';
import type { SidebarSeverityLevel } from '@/components/layout/Sidebar';

const pageTitles: Record<string, string> = {
  '/alerts': 'Alerts',
  '/settings': 'Settings',
  '/simulate': 'Simulate'
};

export default function App() {
  const [selectedClientSlug, setSelectedClientSlug] = useState<string | null>(null);
  const stream = useAlertStream({ clientSlug: selectedClientSlug });
  const { alerts, connectionStatus, lastReceivedAt } = stream;
  const [sidebarSeverityFilter, setSidebarSeverityFilter] = useState<SidebarSeverityLevel | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const pageTitle = pageTitles[location.pathname] ?? 'Pulse';

  const handleSidebarSeverityClick = useCallback(
    (level: SidebarSeverityLevel) => {
      setSidebarSeverityFilter((prev) => (prev === level ? null : level));
      if (location.pathname !== '/alerts') {
        navigate('/alerts');
      }
    },
    [location.pathname, navigate]
  );

  return (
    <AuthShell>
      <AlertDataProvider value={stream}>
        <AppShell
          alerts={alerts}
          connectionStatus={connectionStatus}
          selectedClientSlug={selectedClientSlug}
          onSelectClientSlug={setSelectedClientSlug}
          pageTitle={pageTitle}
          onSidebarSeverityClick={handleSidebarSeverityClick}
          activeSeverityLevel={sidebarSeverityFilter}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/alerts" replace />} />
            <Route
              path="/alerts"
              element={
                <AlertsPage
                  alerts={alerts}
                  connectionStatus={connectionStatus}
                  lastReceivedAt={lastReceivedAt}
                  selectedClientSlug={selectedClientSlug}
                  sidebarSeverityFilter={sidebarSeverityFilter}
                  onClearSidebarFilter={() => setSidebarSeverityFilter(null)}
                />
              }
            />
            <Route path="/settings" element={<SettingsPage selectedClientSlug={selectedClientSlug} onSelectClientSlug={setSelectedClientSlug} />} />
            <Route path="/simulate" element={<SimulatePage clientSlug={selectedClientSlug} />} />
            <Route path="*" element={<Navigate to="/alerts" replace />} />
          </Routes>
        </AppShell>
      </AlertDataProvider>
    </AuthShell>
  );
}

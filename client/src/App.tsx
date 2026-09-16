import { useCallback, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { AuthShell } from '@/components/auth/AuthShell';
import { AlertDataProvider } from '@/context/AlertDataContext';
import { AppShell } from '@/layouts/AppShell';
import { AlertsPage } from '@/pages/AlertsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { ResourcesPage } from '@/pages/ResourcesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SimulatePage } from '@/pages/SimulatePage';
import { useAlertStream } from '@/hooks/useAlertStream';
import type { SidebarSeverityLevel } from '@/components/layout/Sidebar';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/resources': 'Resources',
  '/onboarding': 'Onboard a client',
  '/alerts': 'Alerts',
  '/settings': 'Settings',
  '/simulate': 'Simulate'
};

export default function App() {
  const [selectedClientSlug, setSelectedClientSlug] = useState<string | null>(null);
  const stream = useAlertStream({ clientSlug: selectedClientSlug });
  const { alerts, connectionStatus, lastReceivedAt } = stream;
  // Single source of truth for the severity filter: the sidebar chips and the toolbar buttons both read and write it.
  const [severityLevels, setSeverityLevels] = useState<ReadonlySet<SidebarSeverityLevel>>(() => new Set());
  const location = useLocation();
  const navigate = useNavigate();

  const pageTitle = pageTitles[location.pathname] ?? 'Pulse';

  const handleSidebarSeverityClick = useCallback(
    (level: SidebarSeverityLevel) => {
      setSeverityLevels((prev) => {
        const next = new Set(prev);
        if (next.has(level)) {
          next.delete(level);
        } else {
          next.add(level);
        }
        return next;
      });

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
          activeSeverityLevels={severityLevels}
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
                  severityLevels={severityLevels}
                  onSeverityLevelsChange={setSeverityLevels}
                />
              }
            />
            <Route path="/dashboard" element={<DashboardPage clientSlug={selectedClientSlug} />} />
            <Route path="/resources" element={<ResourcesPage clientSlug={selectedClientSlug} />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/settings" element={<SettingsPage selectedClientSlug={selectedClientSlug} onSelectClientSlug={setSelectedClientSlug} />} />
            <Route path="/simulate" element={<SimulatePage clientSlug={selectedClientSlug} />} />
            <Route path="*" element={<Navigate to="/alerts" replace />} />
          </Routes>
        </AppShell>
      </AlertDataProvider>
    </AuthShell>
  );
}

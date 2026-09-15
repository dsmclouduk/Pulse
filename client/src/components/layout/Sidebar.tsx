import { NavLink, useLocation } from 'react-router-dom';

import type { AlertEvent } from '@/types';

export type SidebarSeverityLevel = 'critical' | 'error' | 'warning';

interface SeverityCounts {
  critical: number;
  error: number;
  warning: number;
}

interface SidebarProps {
  alerts: AlertEvent[];
  onSeverityClick: (level: SidebarSeverityLevel) => void;
  /** Levels currently filtered on; shared with the toolbar's severity buttons. */
  activeLevels: ReadonlySet<SidebarSeverityLevel>;
}

function countBySeverity(alerts: AlertEvent[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, error: 0, warning: 0 };

  for (const alert of alerts) {
    // Only count firing alerts — cleared alerts drop off
    if (alert.status === 'Resolved') continue;

    switch (alert.severity) {
      case 'Sev0':
        counts.critical += 1;
        break;
      case 'Sev1':
        counts.error += 1;
        break;
      case 'Sev2':
      case 'Sev3':
      case 'Sev4':
        counts.warning += 1;
        break;
    }
  }

  return counts;
}

/* ── Icon components ─────────────────────────────────────────── */

function DashboardsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="6" height="6" rx="1.2" />
      <rect x="10.5" y="1.5" width="6" height="6" rx="1.2" />
      <rect x="1.5" y="10.5" width="6" height="6" rx="1.2" />
      <rect x="10.5" y="10.5" width="6" height="6" rx="1.2" />
    </svg>
  );
}

function ResourceTreeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="3" r="2" />
      <circle cx="4" cy="15" r="2" />
      <circle cx="14" cy="15" r="2" />
      <path d="M9 5v3M9 8l-5 5M9 8l5 5" />
    </svg>
  );
}

function ServicesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="14" height="4" rx="1" />
      <rect x="2" y="8" width="14" height="4" rx="1" />
      <rect x="2" y="14" width="14" height="2.5" rx="1" />
    </svg>
  );
}

function LogsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 4h12M3 7h9M3 10h6M3 13h10" />
    </svg>
  );
}

function AlertsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.5a5.5 5.5 0 0 0-5.5 5.5c0 3-1.5 4.5-2 5.5h15c-.5-1-2-2.5-2-5.5A5.5 5.5 0 0 0 9 1.5Z" />
      <path d="M7.5 14.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

function SimulateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 1.5v4.5l-3 7.5a1.5 1.5 0 0 0 1.4 2h8.2a1.5 1.5 0 0 0 1.4-2l-3-7.5V1.5" />
      <path d="M5.5 1.5h7" />
      <path d="M4.5 10.5h9" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 1v1.5M9 15.5V17M1 9h1.5M15.5 9H17M3.1 3.1l1.05 1.05M13.85 13.85l1.05 1.05M3.1 14.9l1.05-1.05M13.85 4.15l1.05-1.05" />
    </svg>
  );
}

/* ── Nav item component ──────────────────────────────────────── */

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
}

function NavItem({ to, icon, label, badge }: Readonly<NavItemProps>) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `group relative flex w-full flex-col items-center gap-1 px-1 py-3 transition-colors ${
          isActive
            ? 'bg-white/10 text-white'
            : 'text-white/60 hover:bg-white/5 hover:text-white/90'
        }`
      }
      title={label}
    >
      {({ isActive }) => (
        <>
          {/* Active indicator bar */}
          {isActive && <div className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-accent" />}
          {icon}
          <span className="text-[9px] font-medium leading-tight tracking-wide">{label}</span>
          {badge}
        </>
      )}
    </NavLink>
  );
}

interface DisabledNavItemProps {
  icon: React.ReactNode;
  label: string;
}

function DisabledNavItem({ icon, label }: Readonly<DisabledNavItemProps>) {
  return (
    <div
      className="flex w-full flex-col items-center gap-1 px-1 py-3 text-white/25 cursor-not-allowed"
      title={`${label} (coming soon)`}
    >
      {icon}
      <span className="text-[9px] font-medium leading-tight tracking-wide">{label}</span>
    </div>
  );
}

/* ── Severity badge ──────────────────────────────────────────── */

function formatBadgeCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

interface SeverityBadgeProps {
  level: SidebarSeverityLevel;
  count: number;
  isActive: boolean;
  dimmed: boolean;
  onClick: () => void;
}

const badgeClasses: Record<SidebarSeverityLevel, { solid: string; outline: string; label: string }> = {
  critical: { solid: 'bg-sev-critical text-white', outline: 'border-sev-critical text-sev-critical', label: 'Critical' },
  error: { solid: 'bg-sev-error text-white', outline: 'border-sev-error text-sev-error', label: 'Error' },
  warning: { solid: 'bg-sev-warning text-white', outline: 'border-sev-warning text-sev-warning', label: 'Warning' }
};

/** Zero counts keep the severity colour as an outlined chip so the row still reads as red / orange / yellow. */
function SeverityBadge({ level, count, isActive, dimmed, onClick }: Readonly<SeverityBadgeProps>) {
  const classes = badgeClasses[level];
  const tone = count > 0 ? classes.solid : `border ${classes.outline} bg-transparent`;

  return (
    <button
      onClick={onClick}
      title={`${classes.label}: ${count} firing. Click to filter${isActive ? ' (active)' : ''}`}
      className={`flex min-w-[2.75rem] cursor-pointer items-center justify-center rounded-full px-2 py-[3px] text-[11px] font-bold leading-none shadow-sm transition-all ${tone} ${
        isActive ? 'ring-2 ring-white/80 ring-offset-1 ring-offset-sidebar' : ''
      } ${dimmed ? 'opacity-30 hover:opacity-60' : 'opacity-100 hover:scale-105'}`}
    >
      {formatBadgeCount(count)}
    </button>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────── */

export function Sidebar({ alerts, onSeverityClick, activeLevels }: Readonly<SidebarProps>) {
  const counts = countBySeverity(alerts);
  const location = useLocation();
  const isAlertsActive = location.pathname === '/alerts';
  const anyActive = activeLevels.size > 0;
  const levels: SidebarSeverityLevel[] = ['critical', 'error', 'warning'];

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-[68px] flex-col border-r border-white/5" style={{ backgroundColor: '#0b1a2e' }}>
      {/* Logo */}
      <div className="flex h-12 items-center justify-center border-b border-white/5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white">
          P
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col">
        {/* Future pages */}
        <DisabledNavItem icon={<DashboardsIcon />} label="Dashboards" />
        <DisabledNavItem icon={<ResourceTreeIcon />} label="Resources" />
        <DisabledNavItem icon={<ServicesIcon />} label="Services" />
        <DisabledNavItem icon={<LogsIcon />} label="Logs" />

        {/* Divider */}
        <div className="mx-3 my-1 h-px bg-white/10" />

        {/* Alerts + severity badges — highlighted section when active */}
        <div className={`${isAlertsActive ? 'bg-white/10' : ''}`}>
          <NavItem to="/alerts" icon={<AlertsIcon />} label="Alerts" />

          {/* Severity count badges — clickable to filter */}
          <div className="flex flex-col items-center gap-1.5 pb-2 pt-1">
            {levels.map((level) => (
              <SeverityBadge
                key={level}
                level={level}
                count={counts[level]}
                isActive={activeLevels.has(level)}
                dimmed={anyActive && !activeLevels.has(level)}
                onClick={() => onSeverityClick(level)}
              />
            ))}
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom nav */}
        <NavItem to="/simulate" icon={<SimulateIcon />} label="Simulate" />
        <NavItem to="/settings" icon={<SettingsIcon />} label="Settings" />

        {/* Bottom padding */}
        <div className="h-2" />
      </nav>
    </aside>
  );
}

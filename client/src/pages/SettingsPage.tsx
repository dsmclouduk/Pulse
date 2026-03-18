import { ClientWorkspacePanel } from '@/components/ClientWorkspacePanel';

interface SettingsPageProps {
  selectedClientSlug: string | null;
  onSelectClientSlug: (slug: string | null) => void;
}

export function SettingsPage({ selectedClientSlug, onSelectClientSlug }: Readonly<SettingsPageProps>) {
  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Client Management</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Manage client accounts, tenant connections, and Azure subscriptions.
        </p>
      </div>

      <ClientWorkspacePanel
        selectedClientSlug={selectedClientSlug}
        onSelectClientSlug={onSelectClientSlug}
      />
    </div>
  );
}

import { SimulatePanel } from '@/components/SimulatePanel';

interface SimulatePageProps {
  clientSlug: string | null;
}

export function SimulatePage({ clientSlug }: Readonly<SimulatePageProps>) {
  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Alert Simulation</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Inject test alerts through the same pipeline as real Azure webhooks.
        </p>
        <div className="mt-3 rounded-md border border-sev-warning/30 bg-sev-warning/10 px-3 py-2 text-xs text-sev-warning">
          Dev-only — this page must not be exposed in production.
        </div>
      </div>

      <SimulatePanel clientSlug={clientSlug} />
    </div>
  );
}

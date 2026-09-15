import { SimulatePanel } from '@/components/SimulatePanel';

interface SimulatePageProps {
  clientSlug: string | null;
}

export function SimulatePage({ clientSlug }: Readonly<SimulatePageProps>) {
  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Alert simulation</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Dummy alerts run through the exact same pipeline as real Azure webhooks: normalise → store → stream → pull metric history → trend analysis → agent diagnosis.
          </p>
        </div>
        <span className="rounded-md border border-sev-warning/40 bg-sev-warning/10 px-3 py-1.5 text-xs font-medium text-yellow-800 dark:text-sev-warning">
          Dev only. The simulate endpoint returns 404 in production.
        </span>
      </div>

      <SimulatePanel clientSlug={clientSlug} />
    </div>
  );
}

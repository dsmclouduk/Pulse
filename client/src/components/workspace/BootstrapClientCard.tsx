import type { CreateClientAccountRequest } from '@/types';

interface BootstrapClientCardProps {
  formState: CreateClientAccountRequest;
  isSubmitting: boolean;
  onChange: (nextState: CreateClientAccountRequest) => void;
  onSubmit: () => Promise<void>;
}

export function BootstrapClientCard({ formState, isSubmitting, onChange, onSubmit }: Readonly<BootstrapClientCardProps>) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Bootstrap client</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm text-slate-200 md:col-span-2">
          <span>Client name</span>
          <input
            value={formState.name}
            onChange={(event) => onChange({ ...formState, name: event.target.value })}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
          />
        </label>

        <label className="grid gap-2 text-sm text-slate-200">
          <span>Client slug</span>
          <input
            value={formState.slug}
            onChange={(event) => onChange({ ...formState, slug: event.target.value })}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan/50"
          />
        </label>

        <label className="grid gap-2 text-sm text-slate-200">
          <span>Primary tenant ID</span>
          <input
            value={formState.primaryTenantId ?? ''}
            onChange={(event) => onChange({ ...formState, primaryTenantId: event.target.value })}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan/50"
          />
        </label>

        <label className="grid gap-2 text-sm text-slate-200">
          <span>Default domain</span>
          <input
            value={formState.defaultDomain ?? ''}
            onChange={(event) => onChange({ ...formState, defaultDomain: event.target.value })}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
          />
        </label>

        <label className="grid gap-2 text-sm text-slate-200 md:col-span-2">
          <span>Description</span>
          <textarea
            rows={3}
            value={formState.description ?? ''}
            onChange={(event) => onChange({ ...formState, description: event.target.value })}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={isSubmitting}
        onClick={onSubmit}
        className="mt-4 rounded-full bg-cyan px-5 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Create client account
      </button>
    </div>
  );
}
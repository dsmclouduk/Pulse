import { useState } from 'react';

import type { AlertEvent, SimulateAlertRequest } from '@/types';

const defaultFormState: SimulateAlertRequest = {
  ruleName: 'High CPU - web-server-01',
  severity: 'Sev1',
  status: 'Fired',
  resourceId: '/subscriptions/test/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/web-server-01',
  metricName: 'Percentage CPU',
  metricValue: 97.4,
  threshold: 90,
  description: 'Simulated CPU threshold breach from the Pulse control panel.'
};

interface SimulatePanelProps {
  clientSlug: string | null;
}

export function SimulatePanel({ clientSlug }: Readonly<SimulatePanelProps>) {
  const hasSelectedClient = Boolean(clientSlug);
  const [formState, setFormState] = useState<SimulateAlertRequest>(defaultFormState);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResponse, setLastResponse] = useState<AlertEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submitSimulation(status: SimulateAlertRequest['status']) {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/simulate/alert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...formState,
          clientSlug: clientSlug ?? undefined,
          status
        })
      });

      if (!response.ok) {
        throw new Error(`Simulation failed with status ${response.status}`);
      }

      const alert = (await response.json()) as AlertEvent;
      setFormState((currentState) => ({ ...currentState, status }));
      setLastResponse(alert);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Simulation failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 shadow-panel">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan/70">Simulation</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Dev-only alert injector</h2>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((currentValue) => !currentValue)}
          className="rounded-full border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:border-white/20 hover:text-white"
        >
          {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {isExpanded ? (
        <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
          <form className="grid gap-4">
            <label className="grid gap-2 text-sm text-slate-200">
              <span>Rule Name</span>
              <input
                value={formState.ruleName}
                onChange={(event) => setFormState({ ...formState, ruleName: event.target.value })}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-slate-200">
                <span>Severity</span>
                <select
                  value={formState.severity}
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      severity: event.target.value as SimulateAlertRequest['severity']
                    })
                  }
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
                >
                  <option value="Sev0">Sev0</option>
                  <option value="Sev1">Sev1</option>
                  <option value="Sev2">Sev2</option>
                  <option value="Sev3">Sev3</option>
                  <option value="Sev4">Sev4</option>
                </select>
              </label>

              <label className="grid gap-2 text-sm text-slate-200">
                <span>Metric Name</span>
                <input
                  value={formState.metricName ?? ''}
                  onChange={(event) => setFormState({ ...formState, metricName: event.target.value })}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm text-slate-200">
              <span>Resource ID</span>
              <input
                value={formState.resourceId}
                onChange={(event) => setFormState({ ...formState, resourceId: event.target.value })}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan/50"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-slate-200">
                <span>Metric Value</span>
                <input
                  type="number"
                  step="0.1"
                  value={formState.metricValue ?? 0}
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      metricValue: Number.parseFloat(event.target.value)
                    })
                  }
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan/50"
                />
              </label>

              <label className="grid gap-2 text-sm text-slate-200">
                <span>Threshold</span>
                <input
                  type="number"
                  step="0.1"
                  value={formState.threshold ?? 0}
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      threshold: Number.parseFloat(event.target.value)
                    })
                  }
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan/50"
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm text-slate-200">
              <span>Description</span>
              <textarea
                rows={4}
                value={formState.description ?? ''}
                onChange={(event) => setFormState({ ...formState, description: event.target.value })}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none transition focus:border-cyan/50"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={isSubmitting || !hasSelectedClient}
                onClick={() => void submitSimulation('Fired')}
                className="rounded-full bg-rose-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Fire Alert
              </button>
              <button
                type="button"
                disabled={isSubmitting || !hasSelectedClient}
                onClick={() => void submitSimulation('Resolved')}
                className="rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Resolve Alert
              </button>
            </div>

            {hasSelectedClient ? null : <p className="text-sm text-amber-300">Select a client scope before sending simulated alerts.</p>}
            {errorMessage ? <p className="text-sm text-rose-300">{errorMessage}</p> : null}
          </form>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Last server response</p>
            <pre className="mt-4 max-h-[28rem] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-slate-100">
              {lastResponse ? JSON.stringify(lastResponse, null, 2) : 'No simulated alerts sent yet.'}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}

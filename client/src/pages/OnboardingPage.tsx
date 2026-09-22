import { useMemo, useState } from 'react';

import { AccessStep } from '@/components/onboarding/AccessStep';
import { CoverageStep } from '@/components/onboarding/CoverageStep';
import { InventoryStep } from '@/components/onboarding/InventoryStep';
import { DeployStep, PlanStep, VerifyStep } from '@/components/onboarding/steps';
import { Button } from '@/components/ui';

/**
 * Client onboarding, as a wizard whose steps mirror what actually has to happen in Azure.
 * Pulse stays read-only throughout: it discovers, plans and verifies. An engineer applies the
 * generated deployment with the Azure CLI using a write-capable account.
 */

export type OnboardingStepId = 'access' | 'inventory' | 'coverage' | 'plan' | 'deploy' | 'verify';

interface StepDefinition {
  id: OnboardingStepId;
  title: string;
  blurb: string;
}

const STEPS: StepDefinition[] = [
  { id: 'access', title: 'Access', blurb: 'Which client tenants Pulse can reach through Lighthouse' },
  { id: 'inventory', title: 'Inventory', blurb: 'What is in the estate, and anything that blocks monitoring' },
  { id: 'coverage', title: 'Coverage', blurb: 'What monitoring exists today, read back from Azure' },
  { id: 'plan', title: 'Plan', blurb: 'Choose the tier, review thresholds, see the diff' },
  { id: 'deploy', title: 'Deploy', blurb: 'Generated Bicep, applied by an engineer' },
  { id: 'verify', title: 'Verify', blurb: 'Re-read coverage and prove an alert arrives' }
];

function StepRail({
  active,
  onSelect,
  reachable
}: Readonly<{ active: OnboardingStepId; onSelect: (id: OnboardingStepId) => void; reachable: Set<OnboardingStepId> }>) {
  return (
    <ol className="flex flex-wrap items-stretch gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
      {STEPS.map((step, index) => {
        const isActive = step.id === active;
        const isReachable = reachable.has(step.id);

        return (
          <li key={step.id} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              className={`flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors ${
                isActive
                  ? 'border-accent bg-accent/10'
                  : 'border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-hover)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                    isActive ? 'bg-accent text-white' : 'bg-[var(--color-surface-alt)] text-[var(--color-text-tertiary)]'
                  }`}
                >
                  {index + 1}
                </span>
                <span className={`truncate text-xs font-semibold ${isActive ? 'text-accent' : 'text-[var(--color-text)]'}`}>
                  {step.title}
                </span>
                {!isReachable && (
                  <span className="ml-auto rounded bg-[var(--color-surface-alt)] px-1 text-[9px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                    preview
                  </span>
                )}
              </span>
              <span className="truncate text-[11px] text-[var(--color-text-secondary)]">{step.blurb}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function OnboardingPage() {
  const [step, setStep] = useState<OnboardingStepId>('access');
  /** The tenant being onboarded. Everything downstream is scoped to it. */
  const [selectedClient, setSelectedClient] = useState<{ name: string; slug: string | null; tenantId: string } | null>(null);
  // Access, Inventory and Coverage are wired to live Azure; the rest render the intended design.
  const reachable = useMemo(() => new Set<OnboardingStepId>(['access', 'inventory', 'coverage']), []);

  const index = STEPS.findIndex((entry) => entry.id === step);
  const previous = index > 0 ? STEPS[index - 1] : null;
  const next = index < STEPS.length - 1 ? STEPS[index + 1] : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <StepRail active={step} onSelect={setStep} reachable={reachable} />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {step === 'access' && (
          <AccessStep selectedTenantId={selectedClient?.tenantId ?? null} onSelectTenant={setSelectedClient} />
        )}
        {step === 'inventory' && <InventoryStep clientSlug={selectedClient?.slug ?? null} clientName={selectedClient?.name ?? null} />}
        {step === 'coverage' && <CoverageStep clientSlug={selectedClient?.slug ?? null} clientName={selectedClient?.name ?? null} />}
        {step === 'plan' && <PlanStep clientName={selectedClient?.name ?? null} />}
        {step === 'deploy' && <DeployStep clientName={selectedClient?.name ?? null} />}
        {step === 'verify' && <VerifyStep clientName={selectedClient?.name ?? null} />}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <span className="text-xs text-[var(--color-text-secondary)]">
          Step {index + 1} of {STEPS.length}
          {selectedClient ? ` · ${selectedClient.name}` : ''}
        </span>
        <div className="flex-1" />
        {previous && (
          <Button size="sm" variant="secondary" onClick={() => setStep(previous.id)}>
            Back to {previous.title}
          </Button>
        )}
        {next && (
          <Button size="sm" onClick={() => setStep(next.id)}>
            Next: {next.title}
          </Button>
        )}
      </div>
    </div>
  );
}

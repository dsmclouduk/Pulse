import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ClientsSection } from '@/components/settings/ClientsSection';
import { AccessSection, AgentSection, IntegrationsSection, SystemSection } from '@/components/settings/SettingsSections';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { Notice, Spinner } from '@/components/ui';
import type { SettingsSummary } from '@/types';

interface SettingsPageProps {
  selectedClientSlug: string | null;
  onSelectClientSlug: (slug: string | null) => void;
}

type Section = 'clients' | 'onboarding' | 'agent' | 'integrations' | 'access' | 'system';

const SECTIONS: Array<{ id: Section; label: string; description: string }> = [
  { id: 'clients', label: 'Clients', description: 'Who Pulse monitors, and their webhook URLs' },
  { id: 'onboarding', label: 'Onboard a client', description: 'Discover subscriptions, plan and deploy monitoring' },
  { id: 'agent', label: 'Agent', description: 'Diagnosis provider and enrichment' },
  { id: 'integrations', label: 'Integrations', description: 'Azure access, ingest, delivery' },
  { id: 'access', label: 'Access', description: 'Sign-in, roles, audit' },
  { id: 'system', label: 'System', description: 'Storage and about' }
];

function isSection(value: string | null): value is Section {
  return SECTIONS.some((section) => section.id === value);
}

/**
 * Multi-section settings. Tenant consent and multi-tenant app registration were removed: Azure access
 * is delegated through Lighthouse to one service principal (docs/onboarding/DECISIONS.md).
 */
export function SettingsPage({ selectedClientSlug, onSelectClientSlug }: Readonly<SettingsPageProps>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('section');
  const [section, setSection] = useState<Section>(isSection(requested) ? requested : 'clients');
  const [summary, setSummary] = useState<SettingsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSection(requested) && requested !== section) {
      setSection(requested);
    }
  }, [requested, section]);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/settings/summary', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load settings (${response.status})`);
        setSummary((await response.json()) as SettingsSummary);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Failed to load settings.');
      });

    return () => controller.abort();
  }, []);

  function choose(next: Section) {
    setSection(next);
    const params = new URLSearchParams(searchParams);
    params.set('section', next);
    setSearchParams(params, { replace: true });
  }

  const active = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0];

  return (
    <div className="flex h-full">
      <nav className="w-60 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3" aria-label="Settings sections">
        <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Settings</p>
        <ul className="space-y-0.5">
          {SECTIONS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => choose(entry.id)}
                className={`w-full rounded-md px-2 py-2 text-left transition-colors ${
                  entry.id === section ? 'bg-accent/10 text-accent' : 'text-[var(--color-text)] hover:bg-[var(--color-hover)]'
                }`}
              >
                <span className="block text-sm font-medium">{entry.label}</span>
                <span className={`block text-[11px] ${entry.id === section ? 'text-accent/80' : 'text-[var(--color-text-tertiary)]'}`}>{entry.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {section === 'onboarding' ? (
        <div className="min-w-0 flex-1 overflow-hidden">
          <OnboardingPage />
        </div>
      ) : (
      <div className="min-w-0 flex-1 overflow-auto p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{active.label}</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{active.description}</p>
        </div>

        {error && (
          <Notice tone="error" className="mb-4">
            {error}
          </Notice>
        )}

        {section === 'clients' && <ClientsSection selectedClientSlug={selectedClientSlug} onSelectClientSlug={onSelectClientSlug} publicBaseUrl={summary?.ingest.publicBaseUrl ?? null} />}

        {section !== 'clients' && !summary && !error && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <Spinner /> Loading configuration…
          </div>
        )}
        {section === 'agent' && summary && <AgentSection summary={summary} />}
        {section === 'integrations' && summary && <IntegrationsSection summary={summary} />}
        {section === 'access' && <AccessSection />}
        {section === 'system' && summary && <SystemSection summary={summary} />}
      </div>
      )}
    </div>
  );
}

import { useState } from 'react';

import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Notice, Textarea } from '@/components/ui';
import { useClientAccounts } from '@/hooks/useClientAccounts';
import type { ClientAccountSummary, CreateClientAccountRequest } from '@/types';

interface ClientsSectionProps {
  selectedClientSlug: string | null;
  onSelectClientSlug: (slug: string | null) => void;
  publicBaseUrl: string | null;
}

const emptyForm: CreateClientAccountRequest = { name: '', slug: '', description: '' };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function CopyButton({ value }: Readonly<{ value: string }>) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function ClientRow({ client, selected, baseUrl, onSelect }: Readonly<{ client: ClientAccountSummary; selected: boolean; baseUrl: string; onSelect: () => void }>) {
  const [showSecret, setShowSecret] = useState(false);
  const webhookUrl = `${baseUrl}/api/webhook/azure-alerts/${client.webhookSecret}`;

  return (
    <div className={`rounded-md border p-3 ${selected ? 'border-accent bg-accent/5' : 'border-[var(--color-border)] bg-[var(--color-surface)]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--color-text)]">{client.name}</p>
            <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">{client.slug}</span>
            {!client.isActive && <Badge tone="neutral">inactive</Badge>}
          </div>
          {client.description && <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{client.description}</p>}
        </div>
        <Button size="sm" variant={selected ? 'primary' : 'secondary'} onClick={onSelect}>
          {selected ? 'Active scope' : 'Use as scope'}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 text-xs">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Action group webhook URL</p>
          <div className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text)]">{showSecret ? webhookUrl : webhookUrl.replace(client.webhookSecret, '•'.repeat(12))}</code>
            <Button size="sm" variant="ghost" onClick={() => setShowSecret((value) => !value)}>
              {showSecret ? 'Hide' : 'Reveal'}
            </Button>
            <CopyButton value={webhookUrl} />
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
            Paste into the Azure action group Webhook action with "Use common alert schema" on. Azure cannot add headers, so the secret travels in the path.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Clients are the scoping unit for alerts, comments and dashboards. Tenant access itself is granted
 * through Azure Lighthouse (docs/onboarding/DECISIONS.md), so there is no consent flow here.
 */
export function ClientsSection({ selectedClientSlug, onSelectClientSlug, publicBaseUrl }: Readonly<ClientsSectionProps>) {
  const { clients, isLoading, errorMessage, createClientAccount } = useClientAccounts();
  const [form, setForm] = useState<CreateClientAccountRequest>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const baseUrl = publicBaseUrl ?? window.location.origin;

  async function submit(): Promise<void> {
    setIsSubmitting(true);
    const created = await createClientAccount({ ...form, description: form.description || undefined });
    if (created) {
      onSelectClientSlug(created.slug);
      setForm(emptyForm);
    }
    setIsSubmitting(false);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <Card>
        <CardHeader
          eyebrow="Clients"
          title="Client accounts"
          description="Each client gets its own webhook URL so alerts land in the right scope. Azure access is delegated via Lighthouse; see the Integrations section."
          actions={
            <Button size="sm" variant={selectedClientSlug ? 'secondary' : 'primary'} onClick={() => onSelectClientSlug(null)}>
              All clients
            </Button>
          }
        />
        {errorMessage && (
          <Notice tone="warning" className="mb-3">
            {errorMessage}
          </Notice>
        )}
        {isLoading && clients.length === 0 && <p className="text-xs text-[var(--color-text-secondary)]">Loading…</p>}
        {!isLoading && clients.length === 0 && (
          <EmptyState>No client accounts yet. Until a database is configured, alerts are unscoped and use the global webhook secret from the environment.</EmptyState>
        )}
        <div className="grid gap-3">
          {clients.map((client) => (
            <ClientRow key={client.id} client={client} selected={client.slug === selectedClientSlug} baseUrl={baseUrl} onSelect={() => onSelectClientSlug(client.slug)} />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="New client" title="Add a client" description="Creates the client record and its webhook secret. Requires DATABASE_URL." />
        <div className="grid gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value, slug: form.slug || slugify(event.target.value) })} placeholder="Contoso Ltd" />
          </Field>
          <Field label="Slug" hint="Used in URLs and filters">
            <Input className="font-mono" value={form.slug} onChange={(event) => setForm({ ...form, slug: slugify(event.target.value) })} placeholder="contoso" />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <Button variant="primary" loading={isSubmitting} disabled={!form.name || !form.slug} onClick={() => void submit()}>
            Create client
          </Button>
        </div>
      </Card>
    </div>
  );
}

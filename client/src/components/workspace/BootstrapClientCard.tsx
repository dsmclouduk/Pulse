import { Button, Card, CardHeader, Field, Input, Textarea } from '@/components/ui';
import type { CreateClientAccountRequest } from '@/types';

interface BootstrapClientCardProps {
  formState: CreateClientAccountRequest;
  isSubmitting: boolean;
  onChange: (nextState: CreateClientAccountRequest) => void;
  onSubmit: () => Promise<void>;
}

export function BootstrapClientCard({ formState, isSubmitting, onChange, onSubmit }: Readonly<BootstrapClientCardProps>) {
  return (
    <Card>
      <CardHeader eyebrow="Onboarding" title="Create a client account" description="Generates a per-client webhook secret so Azure alerts land in the right scope." />

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Client name" className="md:col-span-2">
          <Input value={formState.name} onChange={(event) => onChange({ ...formState, name: event.target.value })} />
        </Field>

        <Field label="Client slug" hint="Lowercase, URL-safe">
          <Input className="font-mono" value={formState.slug} onChange={(event) => onChange({ ...formState, slug: event.target.value })} />
        </Field>

        <Field label="Primary tenant ID">
          <Input className="font-mono" value={formState.primaryTenantId ?? ''} onChange={(event) => onChange({ ...formState, primaryTenantId: event.target.value })} />
        </Field>

        <Field label="Default domain">
          <Input value={formState.defaultDomain ?? ''} onChange={(event) => onChange({ ...formState, defaultDomain: event.target.value })} />
        </Field>

        <Field label="Description" className="md:col-span-2">
          <Textarea rows={2} value={formState.description ?? ''} onChange={(event) => onChange({ ...formState, description: event.target.value })} />
        </Field>
      </div>

      <div className="mt-4">
        <Button variant="primary" loading={isSubmitting} disabled={!formState.name || !formState.slug} onClick={() => void onSubmit()}>
          Create client account
        </Button>
      </div>
    </Card>
  );
}

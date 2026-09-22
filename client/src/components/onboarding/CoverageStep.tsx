import { useCallback, useEffect, useState } from 'react';

import { Badge, Button, Card, CardHeader, Notice, Select, Spinner, StatTile } from '@/components/ui';
import type { CoverageReport, CoverageState } from '@/types';

/**
 * Step 3. What monitoring exists in Azure right now, read back rather than assumed. Pulse recognises
 * its own rules by the `pulse-managed` tag, so a client's pre-existing alerts are never counted as
 * our coverage.
 */

interface CoverageStepProps {
  clientSlug: string | null;
  clientName: string | null;
}

const STATE_TONE: Record<CoverageState, 'ok' | 'warning' | 'error' | 'neutral'> = {
  MONITORED: 'ok',
  PARTIAL: 'warning',
  UNMONITORED: 'error',
  BLOCKED_NO_IDENTITY: 'error',
  UNKNOWN: 'neutral'
};

const STATE_LABEL: Record<CoverageState, string> = {
  MONITORED: 'In place',
  PARTIAL: 'Partial',
  UNMONITORED: 'Missing',
  BLOCKED_NO_IDENTITY: 'Blocked',
  UNKNOWN: 'Unknown'
};

export function CoverageStep({ clientSlug, clientName }: Readonly<CoverageStepProps>) {
  const [tier, setTier] = useState('essential');
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientSlug) {
      setReport(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/onboarding/coverage?clientSlug=${encodeURIComponent(clientSlug)}&tier=${encodeURIComponent(tier)}`
      );
      const payload = (await response.json()) as CoverageReport & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Request failed with ${response.status}`);
      }

      setReport(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read coverage.');
    } finally {
      setLoading(false);
    }
  }, [clientSlug, tier]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!clientSlug) {
    return <Notice tone="warning">Pick a client on the Access step to read its coverage.</Notice>;
  }

  const missingRules = report?.rules.filter((rule) => !rule.present) ?? [];

  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}

      <Card>
        <CardHeader
          title={`What ${clientName ?? clientSlug} has monitored today`}
          description="Read from Azure, not from Pulse's own records, so a rule Pulse thinks exists but Azure has lost shows up here. Rules are recognised by the pulse-managed tag, so the client's own alerts are never counted."
          actions={
            <div className="flex items-center gap-2">
              <Select value={tier} onChange={(event) => setTier(event.target.value)} className="w-40">
                <option value="essential">Essential</option>
                <option value="standard">Standard</option>
                <option value="full">Full</option>
              </Select>
              <Button size="sm" variant="secondary" loading={loading} onClick={() => void load()}>
                Re-check
              </Button>
            </div>
          }
        />

        {loading && !report ? (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <Spinner /> Reading Azure…
          </div>
        ) : (
          report && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="Baseline rules"
                value={`${report.presentRuleCount} / ${report.expectedRuleCount}`}
                tone={report.presentRuleCount < report.expectedRuleCount ? 'warning' : 'ok'}
              />
              <StatTile label="VMs with the agent" value={`${report.vmsWithAgent} / ${report.vmsTotal}`} />
              <StatTile
                label="VMs blocked"
                value={report.vmsBlockedNoIdentity}
                tone={report.vmsBlockedNoIdentity > 0 ? 'error' : undefined}
                hint="no managed identity"
              />
              <StatTile label="Orphaned rules" value={report.orphanedRuleNames.length} hint="ours, no longer wanted" />
            </div>
          )
        )}

        {report && (
          <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
            Checked {new Date(report.checkedAt).toLocaleString()}
          </p>
        )}
      </Card>

      {report && (
        <Card>
          <CardHeader title="Checks" description="Each of these has to be true before an alert can reach Pulse at all." />
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  <th className="px-4 py-2 font-medium">Check</th>
                  <th className="px-4 py-2 font-medium">State</th>
                  <th className="px-4 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {report.checks.map((check) => (
                  <tr key={check.key} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-[var(--color-text)]">{check.label}</td>
                    <td className="px-4 py-2">
                      <Badge tone={STATE_TONE[check.state]}>{STATE_LABEL[check.state]}</Badge>
                    </td>
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">{check.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {missingRules.length > 0 && (
        <Card>
          <CardHeader
            title={`${missingRules.length} rules not deployed`}
            description="These are in the catalogue for this tier but absent from Azure. The Plan step will create them."
          />
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  <th className="px-4 py-2 font-medium">Rule</th>
                  <th className="px-4 py-2 font-medium">Applies to</th>
                  <th className="px-4 py-2 font-medium">Severity</th>
                </tr>
              </thead>
              <tbody>
                {missingRules.map((rule) => (
                  <tr key={rule.key} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-[var(--color-text)]">{rule.title}</td>
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                      {rule.resourceType === 'subscription' ? 'Subscription' : rule.resourceType.split('/').slice(1).join('/')}
                    </td>
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">Sev{rule.severity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {report && report.orphanedRuleNames.length > 0 && (
        <Card>
          <CardHeader
            title="Rules to remove"
            description="Pulse deployed these but the catalogue no longer wants them at this tier, usually after a tier change or a rule being renamed."
          />
          <ul className="space-y-1 font-mono text-xs text-[var(--color-text-secondary)]">
            {report.orphanedRuleNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

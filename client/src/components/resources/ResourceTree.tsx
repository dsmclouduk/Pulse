import { useMemo, useState } from 'react';

import type { AlertSeverity, ResourceSummary } from '@/types';

/**
 * Simple three-level tree: Client (or subscription when unscoped) → resource type → resource.
 * Selecting a node filters the resource table; selecting a resource opens it.
 */

export type TreeSelection =
  | { kind: 'all' }
  | { kind: 'client'; clientKey: string }
  | { kind: 'type'; clientKey: string; resourceType: string }
  | { kind: 'resource'; resourceId: string };

interface ResourceTreeProps {
  resources: ResourceSummary[];
  selection: TreeSelection;
  onSelect: (selection: TreeSelection) => void;
  onOpenResource: (resource: ResourceSummary) => void;
}

type SeverityCounts = Partial<Record<AlertSeverity, number>>;

interface TypeNode {
  resourceType: string;
  label: string;
  resources: ResourceSummary[];
  firing: number;
  bySeverity: SeverityCounts;
}

interface ClientNode {
  key: string;
  label: string;
  sublabel?: string;
  types: TypeNode[];
  total: number;
  firing: number;
  bySeverity: SeverityCounts;
}

const SEVERITY_DOT: Record<AlertSeverity, string> = {
  Sev0: 'bg-sev-critical',
  Sev1: 'bg-sev-error',
  Sev2: 'bg-sev-warning',
  Sev3: 'bg-sev-warning',
  Sev4: 'bg-sev-warning'
};

/** Counts a resource's worst firing severity once, so a node shows one chip per severity present. */
function countSeverity(counts: SeverityCounts, severity: AlertSeverity | null): void {
  if (severity) {
    counts[severity] = (counts[severity] ?? 0) + 1;
  }
}

export function clientKeyFor(resource: ResourceSummary): string {
  return resource.clientSlug ? `client:${resource.clientSlug}` : `sub:${resource.subscriptionId ?? 'unknown'}`;
}

/** Tenant/client display names come from onboarding records; fall back to the raw identifiers. */
function clientLabel(resource: ResourceSummary): string {
  return resource.clientName ?? resource.clientSlug ?? resource.subscriptionName ?? 'Unscoped alerts';
}

/** Tenant only: a client can hold many subscriptions, so naming one here would be misleading. */
function clientSublabel(resource: ResourceSummary): string | undefined {
  return resource.tenantName ?? (resource.tenantId ? `Tenant ${resource.tenantId.slice(0, 8)}…` : undefined);
}

export function buildTree(resources: ResourceSummary[]): ClientNode[] {
  const clients = new Map<string, ClientNode>();

  for (const resource of resources) {
    const key = clientKeyFor(resource);
    let client = clients.get(key);

    if (!client) {
      client = {
        key,
        label: clientLabel(resource),
        sublabel: clientSublabel(resource),
        types: [],
        total: 0,
        firing: 0,
        bySeverity: {}
      };
      clients.set(key, client);
    }

    let type = client.types.find((entry) => entry.resourceType === resource.resourceType);

    if (!type) {
      type = { resourceType: resource.resourceType, label: resource.resourceTypeLabel, resources: [], firing: 0, bySeverity: {} };
      client.types.push(type);
    }

    type.resources.push(resource);
    type.firing += resource.firingCount > 0 ? 1 : 0;
    countSeverity(type.bySeverity, resource.highestFiringSeverity);
    client.total += 1;
    client.firing += resource.firingCount > 0 ? 1 : 0;
    countSeverity(client.bySeverity, resource.highestFiringSeverity);
  }

  for (const client of clients.values()) {
    client.types.sort((left, right) => left.label.localeCompare(right.label));
    for (const type of client.types) {
      type.resources.sort((left, right) => left.name.localeCompare(right.name));
    }
  }

  return [...clients.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function Chevron({ open }: Readonly<{ open: boolean }>) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className={`flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">
      <path d="M3.5 2l3 3-3 3" />
    </svg>
  );
}

const SEVERITY_ORDER: AlertSeverity[] = ['Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'];

/** One chip per firing severity, worst first, then the total when it adds something. */
function CountPill({ firing, total, bySeverity }: Readonly<{ firing: number; total: number; bySeverity: SeverityCounts }>) {
  return (
    <span className="ml-auto flex items-center gap-1 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
      {SEVERITY_ORDER.filter((severity) => (bySeverity[severity] ?? 0) > 0).map((severity) => (
        <span
          key={severity}
          title={`${bySeverity[severity]} firing at ${severity}`}
          className={`inline-flex min-w-[1.125rem] items-center justify-center rounded-full px-1 font-semibold text-white ${SEVERITY_DOT[severity]}`}
        >
          {bySeverity[severity]}
        </span>
      ))}
      {total > firing ? <span>{total}</span> : null}
    </span>
  );
}

function isSelected(selection: TreeSelection, candidate: TreeSelection): boolean {
  if (selection.kind !== candidate.kind) return false;
  if (selection.kind === 'all') return true;
  if (selection.kind === 'client' && candidate.kind === 'client') return selection.clientKey === candidate.clientKey;
  if (selection.kind === 'type' && candidate.kind === 'type') return selection.clientKey === candidate.clientKey && selection.resourceType === candidate.resourceType;
  if (selection.kind === 'resource' && candidate.kind === 'resource') return selection.resourceId === candidate.resourceId;
  return false;
}

const rowBase = 'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors';
const rowIdle = 'text-[var(--color-text)] hover:bg-[var(--color-hover)]';
const rowActive = 'bg-accent/10 text-accent';

export function ResourceTree({ resources, selection, onSelect, onOpenResource }: Readonly<ResourceTreeProps>) {
  const tree = useMemo(() => buildTree(resources), [resources]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }


  return (
    <nav className="flex h-full flex-col overflow-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] p-2" aria-label="Resource tree">
      <button type="button" onClick={() => onSelect({ kind: 'all' })} className={`${rowBase} font-semibold ${isSelected(selection, { kind: 'all' }) ? rowActive : rowIdle}`}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="3" r="1.8" />
          <circle cx="3.5" cy="13" r="1.8" />
          <circle cx="12.5" cy="13" r="1.8" />
          <path d="M8 5v3M8 8l-4.5 3.5M8 8l4.5 3.5" />
        </svg>
        All resources
      </button>

      {tree.map((client) => {
        const clientOpen = !collapsed.has(client.key);
        const clientSel: TreeSelection = { kind: 'client', clientKey: client.key };

        return (
          <div key={client.key} className="mt-1">
            <div className="flex items-center">
              <button type="button" onClick={() => toggle(client.key)} className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]" title={clientOpen ? 'Collapse' : 'Expand'}>
                <Chevron open={clientOpen} />
              </button>
              <button type="button" onClick={() => onSelect(clientSel)} className={`${rowBase} font-semibold ${isSelected(selection, clientSel) ? rowActive : rowIdle}`} title={client.sublabel}>
                <span className="min-w-0 flex-1 truncate text-left">
                  <span className="block truncate">{client.label}</span>
                  {client.sublabel && (
                    <span className="block truncate text-[11px] font-normal text-[var(--color-text-tertiary)]">{client.sublabel}</span>
                  )}
                </span>
                <CountPill firing={client.firing} total={client.total} bySeverity={client.bySeverity} />
              </button>
            </div>

            {clientOpen &&
              client.types.map((type) => {
                const typeKey = `${client.key}|${type.resourceType}`;
                const typeOpen = !collapsed.has(typeKey);
                const typeSel: TreeSelection = { kind: 'type', clientKey: client.key, resourceType: type.resourceType };

                return (
                  <div key={typeKey} className="ml-3">
                    <div className="flex items-center">
                      <button type="button" onClick={() => toggle(typeKey)} className="rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text)]">
                        <Chevron open={typeOpen} />
                      </button>
                      <button type="button" onClick={() => onSelect(typeSel)} className={`${rowBase} ${isSelected(selection, typeSel) ? rowActive : rowIdle}`}>
                        <span className="truncate text-[var(--color-text-secondary)]">{type.label}</span>
                        <CountPill firing={type.firing} total={type.resources.length} bySeverity={type.bySeverity} />
                      </button>
                    </div>

                    {typeOpen &&
                      type.resources.map((resource) => {
                        const resourceSel: TreeSelection = { kind: 'resource', resourceId: resource.resourceId };
                        return (
                          <button
                            key={resource.resourceId}
                            type="button"
                            onClick={() => onSelect(resourceSel)}
                            onDoubleClick={() => onOpenResource(resource)}
                            title={`${resource.resourceId}\nDouble-click to open alerts`}
                            className={`${rowBase} ml-6 ${isSelected(selection, resourceSel) ? rowActive : rowIdle}`}
                          >
                            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${resource.highestFiringSeverity ? SEVERITY_DOT[resource.highestFiringSeverity] : 'bg-sev-ok'}`} />
                            <span className="truncate">{resource.name}</span>
                            <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">{resource.alertCount}</span>
                          </button>
                        );
                      })}
                  </div>
                );
              })}
          </div>
        );
      })}
    </nav>
  );
}

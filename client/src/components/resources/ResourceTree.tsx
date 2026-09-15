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

interface TypeNode {
  resourceType: string;
  label: string;
  resources: ResourceSummary[];
  firing: number;
  highest: AlertSeverity | null;
}

interface ClientNode {
  key: string;
  label: string;
  sublabel?: string;
  types: TypeNode[];
  total: number;
  firing: number;
  highest: AlertSeverity | null;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { Sev0: 0, Sev1: 1, Sev2: 2, Sev3: 3, Sev4: 4 };
const SEVERITY_DOT: Record<AlertSeverity, string> = {
  Sev0: 'bg-sev-critical',
  Sev1: 'bg-sev-error',
  Sev2: 'bg-sev-warning',
  Sev3: 'bg-sev-warning',
  Sev4: 'bg-sev-warning'
};

function higher(left: AlertSeverity | null, right: AlertSeverity | null): AlertSeverity | null {
  if (!left) return right;
  if (!right) return left;
  return SEVERITY_RANK[left] <= SEVERITY_RANK[right] ? left : right;
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
        highest: null
      };
      clients.set(key, client);
    }

    let type = client.types.find((entry) => entry.resourceType === resource.resourceType);

    if (!type) {
      type = { resourceType: resource.resourceType, label: resource.resourceTypeLabel, resources: [], firing: 0, highest: null };
      client.types.push(type);
    }

    type.resources.push(resource);
    type.firing += resource.firingCount > 0 ? 1 : 0;
    type.highest = higher(type.highest, resource.highestFiringSeverity);
    client.total += 1;
    client.firing += resource.firingCount > 0 ? 1 : 0;
    client.highest = higher(client.highest, resource.highestFiringSeverity);
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

function CountPill({ firing, total, highest }: Readonly<{ firing: number; total: number; highest: AlertSeverity | null }>) {
  return (
    <span className="ml-auto flex items-center gap-1 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
      {firing > 0 && highest ? (
        <span className={`inline-flex min-w-[1.125rem] items-center justify-center rounded-full px-1 font-semibold text-white ${SEVERITY_DOT[highest]}`}>{firing}</span>
      ) : null}
      {/* The plain total only earns its place when it says something the firing chip does not. */}
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

  const totalFiring = tree.reduce((sum, client) => sum + client.firing, 0);
  const totalHighest = tree.reduce<AlertSeverity | null>((best, client) => higher(best, client.highest), null);

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
        <CountPill firing={totalFiring} total={resources.length} highest={totalHighest} />
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
                <CountPill firing={client.firing} total={client.total} highest={client.highest} />
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
                        <CountPill firing={type.firing} total={type.resources.length} highest={type.highest} />
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

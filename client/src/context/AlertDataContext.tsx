import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { AlertStreamState } from '@/hooks/useAlertStream';
import type { AlertComment, AlertEnrichmentStatus } from '@/types';

const EMPTY_COMMENTS: AlertComment[] = [];

const AlertDataContext = createContext<AlertStreamState | null>(null);

export function AlertDataProvider({ value, children }: Readonly<{ value: AlertStreamState; children: ReactNode }>) {
  return <AlertDataContext.Provider value={value}>{children}</AlertDataContext.Provider>;
}

export function useAlertData(): AlertStreamState {
  const context = useContext(AlertDataContext);

  if (!context) {
    throw new Error('useAlertData must be used inside AlertDataProvider.');
  }

  return context;
}

export function useAlertComments(alertId: string | null | undefined): AlertComment[] {
  const { commentsByAlert } = useAlertData();
  return alertId ? commentsByAlert[alertId] ?? EMPTY_COMMENTS : EMPTY_COMMENTS;
}

export function useAlertEnrichment(alertId: string | null | undefined): AlertEnrichmentStatus | undefined {
  const { enrichmentByAlert } = useAlertData();
  return alertId ? enrichmentByAlert[alertId] : undefined;
}

/** Latest diagnosis comment for an alert, if the agent has produced one. */
export function useLatestDiagnosis(alertId: string | null | undefined): AlertComment | undefined {
  const comments = useAlertComments(alertId);

  return useMemo(() => {
    for (let index = comments.length - 1; index >= 0; index -= 1) {
      if (comments[index].kind === 'diagnosis') {
        return comments[index];
      }
    }

    return undefined;
  }, [comments]);
}

export function useActiveEnrichmentCount(): number {
  const { enrichmentByAlert } = useAlertData();

  return useMemo(
    () =>
      Object.values(enrichmentByAlert).filter((status) =>
        ['queued', 'fetching-history', 'analysing', 'diagnosing'].includes(status.state)
      ).length,
    [enrichmentByAlert]
  );
}

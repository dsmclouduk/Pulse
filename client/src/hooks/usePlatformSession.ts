import { useEffect, useState } from 'react';

import type { PlatformSession } from '@/types';

interface UsePlatformSessionState {
  session: PlatformSession | null;
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => Promise<void>;
}

export function usePlatformSession(): UsePlatformSessionState {
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/auth/session');
      if (!response.ok) {
        throw new Error(`Failed to load auth session: ${response.status}`);
      }

      setSession((await response.json()) as PlatformSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load auth session.');
    } finally {
      setIsLoading(false);
    }
  }

  return {
    session,
    isLoading,
    errorMessage,
    refresh
  };
}
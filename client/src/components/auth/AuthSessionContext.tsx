import { createContext, useContext } from 'react';

import type { PlatformSession } from '@/types';

interface AuthSessionContextValue {
  session: PlatformSession | null;
  isLoading: boolean;
  errorMessage: string | null;
}

export const AuthSessionContext = createContext<AuthSessionContextValue>({
  session: null,
  isLoading: true,
  errorMessage: null
});

export function useAuthSessionContext(): AuthSessionContextValue {
  return useContext(AuthSessionContext);
}
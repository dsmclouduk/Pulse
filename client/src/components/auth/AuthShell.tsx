import type { ReactNode } from 'react';

import { AuthSessionContext } from '@/components/auth/AuthSessionContext';
import { usePlatformSession } from '@/hooks/usePlatformSession';

interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: Readonly<AuthShellProps>) {
  const { session, isLoading, errorMessage } = usePlatformSession();

  return <AuthSessionContext.Provider value={{ session, isLoading, errorMessage }}>{children}</AuthSessionContext.Provider>;
}

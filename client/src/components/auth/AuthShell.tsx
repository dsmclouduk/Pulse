import type { ReactNode } from 'react';

import { AuthSessionContext } from '@/components/auth/AuthSessionContext';
import { usePlatformSession } from '@/hooks/usePlatformSession';

interface AuthShellProps {
  children: ReactNode;
}

function bannerTone(isConfigured: boolean): string {
  return isConfigured
    ? 'border-amber-400/40 bg-amber-500/10 text-amber-100'
    : 'border-cyan/40 bg-cyan/10 text-cyan';
}

export function AuthShell({ children }: Readonly<AuthShellProps>) {
  const { session, isLoading, errorMessage } = usePlatformSession();

  return (
    <AuthSessionContext.Provider value={{ session, isLoading, errorMessage }}>
      {children}
    </AuthSessionContext.Provider>
  );
}
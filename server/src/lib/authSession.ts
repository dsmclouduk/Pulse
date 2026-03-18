import type { PlatformSession } from '../../../shared/types.js';

function isPlatformAuthConfigured(): boolean {
  return Boolean(
    process.env.AZURE_PLATFORM_TENANT_ID
      && process.env.AZURE_PLATFORM_CLIENT_ID
      && process.env.APP_SERVICE_URL
  );
}

export function getPlatformSession(): PlatformSession {
  const authMode = isPlatformAuthConfigured() ? 'configured' : 'unconfigured';
  const devBypassEnabled = process.env.NODE_ENV !== 'production';

  if (authMode === 'configured') {
    return {
      authProvider: 'msal',
      authMode,
      authRequired: true,
      isAuthenticated: false,
      devBypassEnabled,
      message: 'Platform auth is configured. MSAL sign-in wiring is the remaining step.',
      user: null
    };
  }

  return {
    authProvider: 'msal',
    authMode,
    authRequired: false,
    isAuthenticated: false,
    devBypassEnabled,
    message: 'Platform auth is not configured yet. Development access remains open until MSAL wiring is completed.',
    user: null
  };
}
import type { TenantConnectionActionSummary } from '../../../shared/types.js';

function isPlatformConsentConfigured(): boolean {
  return Boolean(process.env.APP_SERVICE_URL && process.env.AZURE_PLATFORM_CLIENT_ID);
}

export function buildAdminConsentUrl(tenantId: string): string | null {
  if (!isPlatformConsentConfigured() || !process.env.APP_SERVICE_URL || !process.env.AZURE_PLATFORM_CLIENT_ID) {
    return null;
  }

  let redirectUri: string;

  try {
    redirectUri = new URL('/auth/callback', process.env.APP_SERVICE_URL).toString();
  } catch {
    return null;
  }

  return `https://login.microsoftonline.com/${tenantId}/adminconsent?client_id=${encodeURIComponent(process.env.AZURE_PLATFORM_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export function createConsentStartSummary(tenantConnectionId: string, tenantId: string): TenantConnectionActionSummary {
  const launchUrl = buildAdminConsentUrl(tenantId);
  const platformReady = Boolean(launchUrl);

  return {
    tenantConnectionId,
    consentStatus: platformReady ? 'CONSENT_REQUESTED' : 'PENDING',
    launchUrl,
    platformReady,
    nextStep: platformReady ? 'Complete tenant admin consent, then return to validate the tenant connection.' : 'Finish App Service and platform app configuration before launching admin consent.',
    message: platformReady
      ? 'Admin consent URL generated. Complete tenant consent and then run validation.'
      : 'Platform consent configuration is incomplete. Admin consent URL cannot be generated yet.'
  };
}

export function createConsentValidationSummary(tenantConnectionId: string, platformReady: boolean): TenantConnectionActionSummary {
  return {
    tenantConnectionId,
    consentStatus: platformReady ? 'PENDING_VALIDATION' : 'PENDING',
    launchUrl: null,
    platformReady,
    nextStep: platformReady
      ? 'Token and tenant access validation will be connected after MSAL and tenant permissions are finished.'
      : 'Configure the platform identity first, then validate the tenant connection.',
    message: platformReady
      ? 'Tenant connection moved to validation-ready state. Final token-based validation is not wired yet.'
      : 'Platform identity is not ready, so tenant validation cannot proceed yet.'
  };
}
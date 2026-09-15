interface AzureAccessTokenResponse {
  access_token: string;
  expires_in?: string;
  expires_on?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export const AZURE_MANAGEMENT_RESOURCE = 'https://management.azure.com/';
export const LOG_ANALYTICS_RESOURCE = 'https://api.loganalytics.io/';

/** One cached token per resource audience (ARM and Log Analytics need different tokens). */
const cachedTokens = new Map<string, CachedToken>();

export function isAzureMetricsConfigured(): boolean {
  return Boolean(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
}

export function isLogAnalyticsConfigured(): boolean {
  return isAzureMetricsConfigured() && Boolean(process.env.LOG_ANALYTICS_WORKSPACE_ID);
}

export async function getAzureToken(resource: string): Promise<string> {
  if (!isAzureMetricsConfigured()) {
    throw new Error('Azure credentials are not configured (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET).');
  }

  const cached = cachedTokens.get(resource);

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const response = await fetch(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.AZURE_CLIENT_ID ?? '',
      client_secret: process.env.AZURE_CLIENT_SECRET ?? '',
      resource
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to acquire Azure token for ${resource}: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as AzureAccessTokenResponse;
  const expiresAt = payload.expires_on
    ? Number.parseInt(payload.expires_on, 10) * 1000
    : Date.now() + Number.parseInt(payload.expires_in ?? '3600', 10) * 1000;

  cachedTokens.set(resource, {
    accessToken: payload.access_token,
    expiresAt
  });

  return payload.access_token;
}

export async function getAzureManagementToken(): Promise<string> {
  return getAzureToken(AZURE_MANAGEMENT_RESOURCE);
}

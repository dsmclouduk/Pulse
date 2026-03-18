interface AzureAccessTokenResponse {
  access_token: string;
  expires_in?: string;
  expires_on?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function isAzureMetricsConfigured(): boolean {
  return Boolean(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
}

export async function getAzureManagementToken(): Promise<string> {
  if (!isAzureMetricsConfigured()) {
    throw new Error('Azure metrics polling is not configured.');
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.AZURE_CLIENT_ID ?? '',
        client_secret: process.env.AZURE_CLIENT_SECRET ?? '',
        resource: 'https://management.azure.com/'
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to acquire Azure token: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as AzureAccessTokenResponse;
  const expiresAt = payload.expires_on
    ? Number.parseInt(payload.expires_on, 10) * 1000
    : Date.now() + Number.parseInt(payload.expires_in ?? '3600', 10) * 1000;

  cachedToken = {
    accessToken: payload.access_token,
    expiresAt
  };

  return payload.access_token;
}

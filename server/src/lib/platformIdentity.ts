import { DefaultAzureCredential } from '@azure/identity';

import type { PlatformIdentityValidationResult } from '../../../shared/types.js';

const ARM_SCOPE = 'https://management.azure.com/.default';

function createPlatformCredential(): DefaultAzureCredential {
  return new DefaultAzureCredential({
    managedIdentityClientId: process.env.AZURE_PLATFORM_CLIENT_ID || process.env.AZURE_CLIENT_ID || undefined
  });
}

export async function validatePlatformIdentity(): Promise<PlatformIdentityValidationResult> {
  try {
    const credential = createPlatformCredential();
    const token = await credential.getToken(ARM_SCOPE);

    return {
      isReady: true,
      scope: ARM_SCOPE,
      credentialMode: 'default-azure-credential',
      acquiredAt: new Date().toISOString(),
      expiresOn: token?.expiresOnTimestamp ? new Date(token.expiresOnTimestamp).toISOString() : null
    };
  } catch (error) {
    return {
      isReady: false,
      scope: ARM_SCOPE,
      credentialMode: 'default-azure-credential',
      acquiredAt: null,
      expiresOn: null,
      error: error instanceof Error ? error.message : 'Failed to acquire Azure platform token.'
    };
  }
}

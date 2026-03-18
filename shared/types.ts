export type AlertSeverity = 'Sev0' | 'Sev1' | 'Sev2' | 'Sev3' | 'Sev4';
export type AlertStatus = 'Fired' | 'Resolved';
export type SignalType = 'Metric' | 'Log' | 'ActivityLog';

export interface AlertEvent {
  id: string;
  clientAccountId?: string;
  clientSlug?: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  signalType: SignalType;
  resourceIds: string[];
  resourceGroup?: string;
  subscriptionId?: string;
  firedAt: string;
  resolvedAt: string | null;
  receivedAt: string;
  lagMs: number;
  metricName?: string;
  metricValue?: number;
  threshold?: number;
  description?: string;
  isSimulated: boolean;
}

export interface SSEMessage {
  type: 'init' | 'alert' | 'ping';
  alerts?: AlertEvent[];
  alert?: AlertEvent;
}

export interface AzureCommonAlertSchema {
  schemaId: 'azureMonitorCommonAlertSchema';
  data: {
    essentials: {
      alertId: string;
      alertRule: string;
      severity: AlertSeverity;
      signalType: SignalType;
      monitorCondition: AlertStatus;
      alertTargetIDs: string[];
      firedDateTime: string;
      resolvedDateTime: string | null;
      description?: string;
    };
    alertContext?: {
      condition?: {
        allOf?: Array<{
          metricName?: string;
          operator?: string;
          threshold?: string | number;
          metricValue?: string | number;
        }>;
      };
      description?: string;
    };
  };
}

export interface SimulateAlertRequest {
  clientSlug?: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  resourceId: string;
  metricName?: string;
  metricValue?: number;
  threshold?: number;
  description?: string;
}

export type MetricAggregation = 'Average' | 'Minimum' | 'Maximum' | 'Total' | 'Count';

export interface MetricPoint {
  timestamp: string;
  average?: number;
  minimum?: number;
  maximum?: number;
  total?: number;
  count?: number;
}

export interface MetricSeries {
  metricName: string;
  displayName: string;
  description?: string;
  unit: string;
  aggregation: MetricAggregation;
  namespace?: string;
  points: MetricPoint[];
  errorCode?: string;
  errorMessage?: string;
}

export interface ResourceMetricsContext {
  resourceId: string;
  fetchedAt: string | null;
  timespan: string | null;
  interval: string | null;
  status: 'disabled' | 'pending' | 'ready' | 'error';
  message?: string;
  isStale: boolean;
  series: MetricSeries[];
}

export interface CreateAzureSubscriptionRequest {
  externalSubscriptionId: string;
  displayName: string;
  tenantId?: string;
  tenantDisplayName?: string;
}

export interface CreateTenantConnectionRequest {
  tenantId: string;
  tenantDisplayName?: string;
}

export interface CreateClientAccountRequest {
  name: string;
  slug: string;
  description?: string;
  primaryTenantId?: string;
  defaultDomain?: string;
  subscriptions?: CreateAzureSubscriptionRequest[];
}

export interface OnboardedAzureSubscription {
  id: string;
  externalSubscriptionId: string;
  displayName: string;
  tenantId: string | null;
  status: string;
  onboardingStatus: string;
}

export interface TenantConnectionSummary {
  id: string;
  tenantId: string;
  tenantDisplayName: string | null;
  consentStatus: string;
  validatedSubscriptionCount: number;
  lastValidatedAt: string | null;
  lastValidationMessage?: string;
}

export interface TenantConnectionActionSummary {
  tenantConnectionId: string;
  consentStatus: string;
  launchUrl: string | null;
  platformReady: boolean;
  nextStep: string;
  message: string;
}

export interface TenantConnectionActionResult {
  client: ClientAccountSummary;
  action: TenantConnectionActionSummary;
}

export interface ClientAccountSummary {
  id: string;
  slug: string;
  name: string;
  description?: string;
  primaryTenantId: string | null;
  defaultDomain: string | null;
  onboardingStatus: string;
  webhookSecret: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  subscriptionCount: number;
  tenantConnectionCount: number;
  subscriptions?: OnboardedAzureSubscription[];
  tenantConnections?: TenantConnectionSummary[];
}

export interface PlatformIdentitySummary {
  authMode: 'federated-service-principal';
  appServiceUrl: string | null;
  platformTenantIdConfigured: boolean;
  platformClientIdConfigured: boolean;
  platformAppObjectIdConfigured: boolean;
  keyVaultUriConfigured: boolean;
}

export interface PlatformIdentityValidationResult {
  isReady: boolean;
  scope: string;
  credentialMode: 'default-azure-credential';
  acquiredAt: string | null;
  expiresOn: string | null;
  error?: string;
}

export interface PlatformSessionUser {
  id: string;
  displayName: string;
  email: string;
  roles: string[];
}

export interface PlatformSession {
  authProvider: 'msal';
  authMode: 'configured' | 'unconfigured';
  authRequired: boolean;
  isAuthenticated: boolean;
  devBypassEnabled: boolean;
  message: string;
  user: PlatformSessionUser | null;
}




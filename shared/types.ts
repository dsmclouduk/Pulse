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
  /** Metric dimensions from the alert condition, e.g. { mountId: 'C:' } for a per-disk alert. */
  dimensions?: Record<string, string>;
}

export interface SSEMessage {
  type: 'init' | 'alert' | 'ping' | 'comment' | 'enrichment';
  alerts?: AlertEvent[];
  alert?: AlertEvent;
  comment?: AlertComment;
  enrichment?: AlertEnrichmentStatus;
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
          dimensions?: Array<{ name: string; value: string }>;
        }>;
      };
      description?: string;
    };
  };
}

export type SimulateScenario =
  | 'disk-steady-growth'
  | 'disk-rapid-fill'
  | 'disk-flat'
  | 'cpu-sawtooth'
  | 'memory-leak'
  | 'custom';

export type SyntheticHistoryPattern = 'steady-growth' | 'rapid-fill' | 'flat' | 'sawtooth';

export interface SyntheticHistorySpec {
  pattern: SyntheticHistoryPattern;
  /** Days of history to generate. Default 90. */
  days?: number;
  /** Value at the start of the window. Default 55. */
  startPercent?: number;
  /** Value at the end of the window. Default metricValue ?? 95. */
  endPercent?: number;
  /** Gaussian noise std-dev in metric units. Default 0.8. */
  noise?: number;
  /** rapid-fill only: how many hours ago the jump started. Default 6. */
  jumpHoursAgo?: number;
  /** sawtooth only: period in days. Default 7. */
  periodDays?: number;
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
  /** Preset that fills rule/metric/threshold/history defaults when fields are absent. */
  scenario?: SimulateScenario;
  /** ISO timestamp override for firedDateTime (clamped to now). Lets you simulate lag. */
  firedAt?: string;
  /** When true a random nonce is mixed into the alert id so each fire creates a new alert. */
  unique?: boolean;
  /** Explicit salt for the alert id. */
  nonce?: string;
  signalType?: SignalType;
  operator?: string;
  dimensions?: Record<string, string>;
  /** Synthetic metric history registered for the alert so enrichment works offline. */
  syntheticHistory?: SyntheticHistorySpec;
  skipEnrichment?: boolean;
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

// ---------------------------------------------------------------------------
// Alert comments (agent diagnoses, operator notes, system status)
// ---------------------------------------------------------------------------

export type CommentAuthorKind = 'agent' | 'user' | 'system';
export type CommentKind = 'diagnosis' | 'note' | 'status';
export type DiagnosisUrgency = 'immediate' | 'soon' | 'planned' | 'informational';

export interface AlertCommentMetadata {
  provider?: string;
  model?: string;
  isFallback?: boolean;
  confidence?: number;
  urgency?: DiagnosisUrgency;
  recommendedActions?: string[];
  trend?: TrendSummary;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs?: number;
  enrichmentTrigger?: 'ingest' | 'rerun';
}

export interface AlertComment {
  id: string;
  /** Equals AlertEvent.id (the Azure alert id or simulated id). */
  alertId: string;
  clientAccountId?: string;
  clientSlug?: string;
  subscriptionId?: string;
  author: { kind: CommentAuthorKind; name: string };
  kind: CommentKind;
  /** Markdown body. */
  body: string;
  createdAt: string;
  metadata?: AlertCommentMetadata;
}

export interface CreateAlertCommentRequest {
  alertId: string;
  body: string;
  authorName?: string;
  clientSlug?: string;
}

// ---------------------------------------------------------------------------
// Metric history (long-range series fetched for an alert)
// ---------------------------------------------------------------------------

export type MetricHistorySource = 'arm' | 'log-analytics' | 'synthetic' | 'none';
export type MetricHistoryLabel = 'long-term' | 'zoom';

export interface MetricHistoryRequest {
  alertId: string;
  resourceId: string;
  source: MetricHistorySource;
  metricName: string;
  namespace?: string;
  aggregation?: MetricAggregation;
  filter?: string;
  dimensions?: Record<string, string>;
  timespan: { start: string; end: string };
  /** ISO-8601 duration, e.g. PT5M, PT1H, P1D. */
  interval: string;
  /** Upper bound of the metric (100 for percentages); enables time-to-full projection. */
  ceiling?: number;
  label: MetricHistoryLabel;
}

export interface MetricHistoryResult {
  request: MetricHistoryRequest;
  provider: string;
  fetchedAt: string;
  status: 'ready' | 'empty' | 'error' | 'unavailable';
  message?: string;
  /** How the values were derived, e.g. "used% = 100 - FreeSpacePercentage". */
  derivation?: string;
  series: MetricSeries[];
}

// ---------------------------------------------------------------------------
// Trend analysis
// ---------------------------------------------------------------------------

export type TrendPattern = 'rapid-fill' | 'steady-growth' | 'declining' | 'volatile' | 'flat' | 'insufficient-data';

export interface TrendAnomaly {
  timestamp: string;
  value: number;
  expected: number;
  zScore: number;
}

export interface TrendAnalysis {
  metricName: string;
  unit: string;
  windowStart: string;
  windowEnd: string;
  pointCount: number;
  spanDays: number;
  first: number;
  last: number;
  min: number;
  max: number;
  mean: number;
  slopePerDay: number;
  intercept: number;
  rSquared: number;
  residualStdDev: number;
  delta6h: number | null;
  delta24h: number | null;
  delta7d: number | null;
  recentRatePerDay: number | null;
  ceiling: number | null;
  projectedDaysToCeiling: number | null;
  projectedCeilingDate: string | null;
  recentProjectedDaysToCeiling: number | null;
  pattern: TrendPattern;
  suggestedUrgency: DiagnosisUrgency;
  anomalies: TrendAnomaly[];
  /** Deterministic human-readable facts, reused by the agent prompt and the UI. */
  notes: string[];
}

export type TrendSummary = Pick<
  TrendAnalysis,
  'pattern' | 'slopePerDay' | 'delta6h' | 'delta24h' | 'last' | 'projectedDaysToCeiling' | 'suggestedUrgency'
>;

// ---------------------------------------------------------------------------
// Enrichment status
// ---------------------------------------------------------------------------

export type EnrichmentState =
  | 'queued'
  | 'fetching-history'
  | 'analysing'
  | 'diagnosing'
  | 'complete'
  | 'failed'
  | 'skipped';

export interface AlertEnrichmentStatus {
  alertId: string;
  clientAccountId?: string;
  clientSlug?: string;
  subscriptionId?: string;
  state: EnrichmentState;
  trigger: 'ingest' | 'rerun';
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  message?: string;
  historySource?: MetricHistorySource;
  agentProvider?: string;
  agentModel?: string;
  urgency?: DiagnosisUrgency;
  trend?: TrendAnalysis | null;
  diagnosisCommentId?: string;
}

export interface AlertEnrichmentDetail extends AlertEnrichmentStatus {
  history: MetricHistoryResult[];
  comments: AlertComment[];
}

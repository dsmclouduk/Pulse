import { existsSync } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import express from 'express';

import { adminRouter } from './routes/admin.js';
import { alertEnrichmentRouter } from './routes/alertEnrichment.js';
import { authRouter } from './routes/auth.js';
import { hydrateEnrichmentStore } from './lib/enrichment/enrichmentStatusStore.js';
import { startMetricsPolling } from './lib/metricsService.js';
import { alertsRouter } from './routes/alerts.js';
import { metricsRouter } from './routes/metrics.js';
import { resourcesRouter } from './routes/resources.js';
import { settingsRouter } from './routes/settings.js';
import { simulateRouter } from './routes/simulate.js';
import { statsRouter } from './routes/stats.js';
import { sseRouter } from './routes/sse.js';
import { webhookRouter } from './routes/webhook.js';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env')
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/alerts', sseRouter);
app.use('/api/alerts', alertEnrichmentRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/stats', statsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/simulate', simulateRouter);

app.listen(port, () => {
  console.log(`[${new Date().toISOString()}] [server] Listening on http://localhost:${port}`);
  startMetricsPolling();
  hydrateEnrichmentStore()
    .then((count) => {
      if (count > 0) {
        console.log(`[${new Date().toISOString()}] [enrichment] restored ${count} persisted enrichment run(s)`);
      }
    })
    .catch((error: unknown) => {
      console.error(`[${new Date().toISOString()}] [enrichment] restore failed: ${error instanceof Error ? error.message : String(error)}`);
    });
});
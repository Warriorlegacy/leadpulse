import { Hono } from 'hono';
import { requestContext, securityHeaders, errorHandler, ok } from './security.js';
import { csrfGuard } from './auth.js';
import { dbInfo } from './db.js';
import { registerAuthRoutes, registerWorkspaceRoutes } from './routes/auth-workspace.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerWorkflowRoutes } from './routes/workflow.js';
import { registerDataRoutes } from './routes/data.js';
import { registerBillingRoutes } from './routes/billing.js';

export const APP_VERSION = '0.1.0';

export function createApp() {
  const app = new Hono();

  app.use('*', requestContext);
  app.use('*', securityHeaders);
  app.use('/api/*', csrfGuard);

  app.get('/api/v1/health', (c) => ok(c, {
    status: 'ok',
    version: APP_VERSION,
    database: dbInfo(),
    demoEnabled: String(process.env.ALLOW_DEMO ?? 'true').toLowerCase() !== 'false',
    time: new Date().toISOString(),
  }));

  registerAuthRoutes(app);
  registerWorkspaceRoutes(app);
  registerLeadRoutes(app);
  registerWorkflowRoutes(app);
  registerDataRoutes(app);
  registerBillingRoutes(app);

  app.notFound((c) => c.json(
    { error: { code: 'NOT_FOUND', message: 'No route matches this request.' }, requestId: c.get('requestId') },
    404,
  ));
  app.onError(errorHandler);
  return app;
}

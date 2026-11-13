import { ok, fail } from '../security.js';
import { requireAuth } from '../auth.js';
import { resolveTenant, requirePermission } from '../rbac.js';
import { parseBody } from '../validate.js';
import { z } from 'zod';
import {
  getBillingOverview,
  createCheckoutSession,
  createCustomerPortalSession,
  activateSubscriptionPlan,
  cancelSubscription,
  handleStripeWebhook,
  handleRazorpayWebhook,
} from '../billing-service.js';

const checkoutSchema = z.object({
  planId: z.enum(['solo', 'team', 'agency']),
  provider: z.enum(['stripe', 'razorpay']).default('stripe'),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
});

const activateSchema = z.object({
  planId: z.enum(['solo', 'team', 'agency']),
});

export function registerBillingRoutes(app) {
  // 1. Get Billing Overview
  app.get('/api/v1/billing', requireAuth, (c) => {
    const { org, role } = resolveTenant(c);
    if (!['workspace_owner', 'workspace_admin'].includes(role)) {
      fail(403, 'FORBIDDEN', 'Only workspace owners and admins can access billing.');
    }
    const overview = getBillingOverview(org.id);
    return ok(c, overview);
  });

  // 2. Initiate Checkout Session (Stripe / Razorpay / Simulation)
  app.post('/api/v1/billing/checkout', requireAuth, async (c) => {
    const { org, role, user } = resolveTenant(c);
    if (!['workspace_owner', 'workspace_admin'].includes(role)) {
      fail(403, 'FORBIDDEN', 'Only workspace owners and admins can manage billing.');
    }
    const body = await parseBody(c, checkoutSchema);

    const session = await createCheckoutSession({
      orgId: org.id,
      user,
      planId: body.planId,
      provider: body.provider,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });

    return ok(c, session);
  });

  // 3. Customer Portal for Managing Cards and Invoices
  app.post('/api/v1/billing/portal', requireAuth, async (c) => {
    const { org, role } = resolveTenant(c);
    if (!['workspace_owner', 'workspace_admin'].includes(role)) {
      fail(403, 'FORBIDDEN', 'Only workspace owners and admins can manage billing.');
    }
    const body = await c.req.json().catch(() => ({}));

    const portal = await createCustomerPortalSession({
      orgId: org.id,
      returnUrl: body.returnUrl,
    });

    return ok(c, portal);
  });

  // 4. Activate Simulated / Instant Upgrade (Dev / Test sandbox)
  app.post('/api/v1/billing/activate-simulated', requireAuth, async (c) => {
    const { org, role } = resolveTenant(c);
    if (!['workspace_owner', 'workspace_admin'].includes(role)) {
      fail(403, 'FORBIDDEN', 'Only workspace owners and admins can manage billing.');
    }
    const body = await parseBody(c, activateSchema);

    const updated = activateSubscriptionPlan(org.id, body.planId, 'manual');
    return ok(c, {
      message: `Successfully upgraded to ${body.planId} plan.`,
      subscription: updated,
    });
  });

  // 5. Cancel Subscription at Period End
  app.post('/api/v1/billing/cancel', requireAuth, async (c) => {
    const { org, role } = resolveTenant(c);
    if (role !== 'workspace_owner') {
      fail(403, 'FORBIDDEN', 'Only the workspace owner can cancel the subscription.');
    }

    const updated = await cancelSubscription(org.id);
    return ok(c, {
      message: 'Subscription marked to cancel at end of current period.',
      subscription: updated,
    });
  });

  // 6. Stripe Webhook (Automated public webhook)
  app.post('/api/v1/billing/webhook/stripe', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header('stripe-signature');

    try {
      const result = handleStripeWebhook(rawBody, signature);
      return c.json({ received: true, result });
    } catch (err) {
      console.warn('[leadpulse] Stripe webhook error:', err.message);
      return c.json({ error: { message: err.message } }, 400);
    }
  });

  // 7. Razorpay Webhook (Automated public webhook)
  app.post('/api/v1/billing/webhook/razorpay', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header('x-razorpay-signature');

    try {
      const result = handleRazorpayWebhook(rawBody, signature);
      return c.json({ received: true, result });
    } catch (err) {
      console.warn('[leadpulse] Razorpay webhook error:', err.message);
      return c.json({ error: { message: err.message } }, 400);
    }
  });
}

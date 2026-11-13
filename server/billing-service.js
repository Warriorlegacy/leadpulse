import crypto from 'node:crypto';
import { one, run, all, tx } from './context.js';
import { uid, nowIso, addMinutes, safeEqual } from './util.js';

export const PLANS = {
  solo: {
    id: 'solo',
    name: 'Solo Pilot',
    priceInr: 799,
    priceUsd: 19,
    maxSeats: 1,
    maxWorkspaces: 1,
    features: [
      'Single workspace',
      'Lead inbox and Kanban pipeline',
      'CSV import and export',
      'Public capture form',
      'Basic response timer',
    ],
  },
  team: {
    id: 'team',
    name: 'Team Growth',
    priceInr: 1999,
    priceUsd: 49,
    maxSeats: 10,
    maxWorkspaces: 1,
    features: [
      'Everything in Solo',
      'Up to 10 teammates',
      'Lead assignment queues',
      'SLA overdue alarms',
      'AI Speed-to-Lead briefing & response drafter',
      'Reports and audit trail',
    ],
  },
  agency: {
    id: 'agency',
    name: 'Agency Scale',
    priceInr: 3999,
    priceUsd: 99,
    maxSeats: 50,
    maxWorkspaces: 10,
    features: [
      'Everything in Team',
      'Multiple client workspaces',
      'Signed HMAC inbound webhooks (Zapier/Make)',
      'Document attachments (10MB)',
      'Full workspace JSON data backup',
      'Dedicated SLA policies',
    ],
  },
};

/** Ensure an organization has an authoritative subscription record */
export function getOrganizationSubscription(orgId) {
  let sub = one('SELECT * FROM organization_subscriptions WHERE organization_id = ?', [orgId]);
  if (!sub) {
    const now = nowIso();
    const future = addMinutes(now, 365 * 1440);
    run(
      `INSERT INTO organization_subscriptions(
         organization_id, plan_tier, status, billing_provider, customer_id,
         subscription_id, current_period_start, current_period_end, cancel_at_period_end,
         max_seats, max_workspaces, created_at, updated_at
       ) VALUES(?, 'solo', 'active', 'manual', NULL, NULL, ?, ?, 0, 1, 1, ?, ?)`,
      [orgId, now, future, now, now],
    );
    sub = one('SELECT * FROM organization_subscriptions WHERE organization_id = ?', [orgId]);
  }
  return sub;
}

/** Complete billing status overview including plans, seat count, and invoices */
export function getBillingOverview(orgId) {
  const sub = getOrganizationSubscription(orgId);
  const plan = PLANS[sub.plan_tier] || PLANS.solo;

  const seatCount = one(
    'SELECT COUNT(*) as n FROM memberships WHERE organization_id = ?',
    [orgId],
  )?.n ?? 1;

  const invoices = all(
    'SELECT * FROM billing_invoices WHERE organization_id = ? ORDER BY created_at DESC LIMIT 20',
    [orgId],
  );

  return {
    subscription: {
      ...sub,
      planName: plan.name,
      features: plan.features,
      isTrial: sub.status === 'trialing',
      isActive: ['active', 'trialing'].includes(sub.status),
    },
    plan,
    plans: Object.values(PLANS),
    seats: {
      used: seatCount,
      limit: sub.max_seats,
      available: Math.max(0, sub.max_seats - seatCount),
    },
    invoices,
    config: {
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      currency: 'INR',
    },
  };
}

/** Create a Stripe Checkout Session or simulated dev checkout URL */
export async function createCheckoutSession({ orgId, user, planId, provider = 'stripe', successUrl, cancelUrl }) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Invalid plan: ${planId}. Must be one of solo, team, agency.`);

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;

  if (provider === 'stripe' && stripeKey) {
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('customer_email', user.email);
    params.append('client_reference_id', orgId);
    params.append('metadata[orgId]', orgId);
    params.append('metadata[planId]', planId);
    params.append('subscription_data[metadata][orgId]', orgId);
    params.append('subscription_data[metadata][planId]', planId);
    params.append('success_url', successUrl || `${process.env.PUBLIC_BASE_URL || ''}/app/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', cancelUrl || `${process.env.PUBLIC_BASE_URL || ''}/app/settings?billing=cancelled`);

    params.append('line_items[0][price_data][currency]', 'inr');
    params.append('line_items[0][price_data][unit_amount]', String(plan.priceInr * 100));
    params.append('line_items[0][price_data][product_data][name]', `LeadPulse ${plan.name}`);
    params.append('line_items[0][price_data][product_data][description]', `LeadPulse CRM - ${plan.name} Monthly Subscription`);
    params.append('line_items[0][price_data][recurring][interval]', 'month');

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Stripe API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    return {
      provider: 'stripe',
      checkoutUrl: data.url,
      sessionId: data.id,
      mode: 'live',
    };
  }

  if (provider === 'razorpay' && razorpayKeyId && razorpaySecret) {
    // Razorpay payment link or subscription flow
    const authHeader = 'Basic ' + Buffer.from(`${razorpayKeyId}:${razorpaySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: plan.priceInr * 100,
        currency: 'INR',
        accept_partial: false,
        reference_id: `sub_${orgId}_${Date.now()}`,
        description: `LeadPulse ${plan.name} Monthly Subscription`,
        customer: {
          name: user.name || 'LeadPulse Customer',
          email: user.email,
        },
        notes: {
          orgId,
          planId,
        },
        callback_url: successUrl || `${process.env.PUBLIC_BASE_URL || ''}/app/settings?billing=success`,
        callback_method: 'get',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Razorpay API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    return {
      provider: 'razorpay',
      checkoutUrl: data.short_url,
      sessionId: data.id,
      mode: 'live',
    };
  }

  // Developer / Sandbox Simulation Mode (when live API keys are not supplied)
  // Generates a self-fulfilling simulated checkout session for local development and test automation.
  const simSessionId = `sim_cs_${uid('chk')}`;
  const simCheckoutUrl = `${successUrl || '/app/settings'}?simulated_checkout=success&plan=${planId}&session_id=${simSessionId}`;

  return {
    provider: provider || 'stripe',
    checkoutUrl: simCheckoutUrl,
    sessionId: simSessionId,
    mode: 'simulation',
    note: 'Running in developer simulation mode. Set STRIPE_SECRET_KEY or RAZORPAY_KEY_ID in production for live payment processing.',
  };
}

/** Simulate or execute plan upgrade (used by simulation checkout or manual admin grant) */
export function activateSubscriptionPlan(orgId, planId, provider = 'manual', customerId = null, subscriptionId = null) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Invalid plan: ${planId}`);

  const now = nowIso();
  const periodEnd = addMinutes(now, 30 * 1440); // 30 days

  getOrganizationSubscription(orgId); // Ensure exists

  run(
    `UPDATE organization_subscriptions
     SET plan_tier = ?, status = 'active', billing_provider = ?,
         customer_id = COALESCE(?, customer_id),
         subscription_id = COALESCE(?, subscription_id),
         current_period_start = ?, current_period_end = ?, cancel_at_period_end = 0,
         max_seats = ?, max_workspaces = ?, updated_at = ?
     WHERE organization_id = ?`,
    [
      planId, provider, customerId, subscriptionId,
      now, periodEnd, plan.maxSeats, plan.maxWorkspaces, now, orgId,
    ],
  );

  return getOrganizationSubscription(orgId);
}

/** Create a Customer Portal session for managing payments and receipts */
export async function createCustomerPortalSession({ orgId, returnUrl }) {
  const sub = getOrganizationSubscription(orgId);
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (stripeKey && sub.customer_id && sub.billing_provider === 'stripe') {
    const params = new URLSearchParams();
    params.append('customer', sub.customer_id);
    params.append('return_url', returnUrl || `${process.env.PUBLIC_BASE_URL || ''}/app/settings`);

    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (res.ok) {
      const data = await res.json();
      return { portalUrl: data.url };
    }
  }

  return { portalUrl: returnUrl || '/app/settings' };
}

/** Cancel subscription at current period end */
export async function cancelSubscription(orgId) {
  const sub = getOrganizationSubscription(orgId);
  const now = nowIso();

  run(
    `UPDATE organization_subscriptions
     SET cancel_at_period_end = 1, updated_at = ?
     WHERE organization_id = ?`,
    [now, orgId],
  );

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && sub.subscription_id && sub.billing_provider === 'stripe') {
    try {
      await fetch(`https://api.stripe.com/v1/subscriptions/${sub.subscription_id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'cancel_at_period_end=true',
      });
    } catch (err) {
      console.warn('[leadpulse] failed to notify Stripe of cancellation:', err.message);
    }
  }

  return getOrganizationSubscription(orgId);
}

/** Verify Stripe Webhook Signature */
export function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!secret) return true; // dev/test mode
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return safeEqual(signature, expected);
}

/** Verify Razorpay Webhook Signature */
export function verifyRazorpaySignature(rawBody, signatureHeader, secret) {
  if (!secret) return true; // dev/test mode
  if (!signatureHeader) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(signatureHeader, expected);
}

/** Process an incoming Stripe Webhook */
export function handleStripeWebhook(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret && !verifyStripeSignature(rawBody, signatureHeader, secret)) {
    throw new Error('Invalid Stripe webhook signature.');
  }

  let event;
  try {
    event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch {
    throw new Error('Invalid JSON payload.');
  }

  const eventId = event.id;
  const eventType = event.type;
  if (!eventId || !eventType) throw new Error('Missing event id or type.');

  // Idempotency check: don't process the same event twice
  const existing = one('SELECT id FROM billing_events WHERE event_id = ?', [eventId]);
  if (existing) {
    return { status: 'ignored', reason: 'already_processed', eventId };
  }

  const obj = event.data?.object || {};
  let affectedOrgId = obj.client_reference_id || obj.metadata?.orgId || null;

  tx(() => {
    if (eventType === 'checkout.session.completed') {
      const orgId = obj.client_reference_id || obj.metadata?.orgId;
      const planId = obj.metadata?.planId || 'team';
      const customerId = obj.customer;
      const subscriptionId = obj.subscription;

      if (orgId) {
        affectedOrgId = orgId;
        activateSubscriptionPlan(orgId, planId, 'stripe', customerId, subscriptionId);
      }
    } else if (eventType === 'customer.subscription.updated') {
      const subscriptionId = obj.id;
      const status = obj.status; // 'active', 'past_due', 'canceled', etc.
      const currentPeriodEnd = obj.current_period_end
        ? new Date(obj.current_period_end * 1000).toISOString()
        : addMinutes(nowIso(), 30 * 1440);
      const cancelAtPeriodEnd = obj.cancel_at_period_end ? 1 : 0;
      const planId = obj.metadata?.planId;

      const sub = one('SELECT * FROM organization_subscriptions WHERE subscription_id = ?', [subscriptionId]);
      if (sub) {
        affectedOrgId = sub.organization_id;
        const targetPlan = planId && PLANS[planId] ? planId : sub.plan_tier;
        const planConfig = PLANS[targetPlan];

        run(
          `UPDATE organization_subscriptions
           SET status = ?, plan_tier = ?, current_period_end = ?, cancel_at_period_end = ?,
               max_seats = ?, max_workspaces = ?, updated_at = ?
           WHERE organization_id = ?`,
          [
            status, targetPlan, currentPeriodEnd, cancelAtPeriodEnd,
            planConfig.maxSeats, planConfig.maxWorkspaces, nowIso(), sub.organization_id,
          ],
        );
      }
    } else if (eventType === 'customer.subscription.deleted') {
      const subscriptionId = obj.id;
      const sub = one('SELECT * FROM organization_subscriptions WHERE subscription_id = ?', [subscriptionId]);
      if (sub) {
        affectedOrgId = sub.organization_id;
        run(
          `UPDATE organization_subscriptions
           SET status = 'canceled', cancel_at_period_end = 0, updated_at = ?
           WHERE organization_id = ?`,
          [nowIso(), sub.organization_id],
        );
      }
    } else if (eventType === 'invoice.payment_succeeded') {
      const customerId = obj.customer;
      const invoiceId = obj.id;
      const amountPaid = obj.amount_paid || 0;
      const currency = (obj.currency || 'inr').toUpperCase();
      const hostedUrl = obj.hosted_invoice_url || '';
      const pdfUrl = obj.invoice_pdf || '';

      const sub = one('SELECT * FROM organization_subscriptions WHERE customer_id = ?', [customerId]);
      if (sub) {
        affectedOrgId = sub.organization_id;
        const exists = one('SELECT id FROM billing_invoices WHERE invoice_id = ?', [invoiceId]);
        if (!exists) {
          run(
            `INSERT INTO billing_invoices(
               id, organization_id, provider, invoice_id, amount_paid, currency,
               status, hosted_invoice_url, invoice_pdf, paid_at, created_at
             ) VALUES(?, ?, 'stripe', ?, ?, ?, 'paid', ?, ?, ?, ?)`,
            [
              uid('inv'), sub.organization_id, invoiceId, amountPaid, currency,
              hostedUrl, pdfUrl, nowIso(), nowIso(),
            ],
          );
        }
      }
    }

    // Record billing event for audit & idempotency
    run(
      `INSERT INTO billing_events(id, organization_id, provider, event_id, event_type, status, payload, created_at)
       VALUES(?, ?, 'stripe', ?, ?, 'processed', ?, ?)`,
      [uid('bev'), affectedOrgId, eventId, eventType, JSON.stringify(event), nowIso()],
    );
  });

  return { status: 'success', eventId, eventType, orgId: affectedOrgId };
}

/** Process an incoming Razorpay Webhook */
export function handleRazorpayWebhook(rawBody, signatureHeader) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (secret && !verifyRazorpaySignature(rawBody, signatureHeader, secret)) {
    throw new Error('Invalid Razorpay webhook signature.');
  }

  let event;
  try {
    event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch {
    throw new Error('Invalid JSON payload.');
  }

  const eventId = event.event_id || event.id || `rzp_${Date.now()}`;
  const eventType = event.event;
  if (!eventType) throw new Error('Missing event type in Razorpay payload.');

  const existing = one('SELECT id FROM billing_events WHERE event_id = ?', [eventId]);
  if (existing) {
    return { status: 'ignored', reason: 'already_processed', eventId };
  }

  let affectedOrgId = null;

  tx(() => {
    const payload = event.payload || {};
    const payment = payload.payment?.entity;
    const subscription = payload.subscription?.entity;

    const notes = payment?.notes || subscription?.notes || {};
    const orgId = notes.orgId;
    const planId = notes.planId || 'team';

    if (orgId) {
      affectedOrgId = orgId;
      if (['subscription.activated', 'subscription.charged', 'payment.captured'].includes(eventType)) {
        activateSubscriptionPlan(
          orgId,
          planId,
          'razorpay',
          payment?.customer_id || subscription?.customer_id,
          subscription?.id || payment?.id,
        );

        if (payment && payment.amount) {
          const invoiceId = payment.id;
          const exists = one('SELECT id FROM billing_invoices WHERE invoice_id = ?', [invoiceId]);
          if (!exists) {
            run(
              `INSERT INTO billing_invoices(
                 id, organization_id, provider, invoice_id, amount_paid, currency,
                 status, hosted_invoice_url, invoice_pdf, paid_at, created_at
               ) VALUES(?, ?, 'razorpay', ?, ?, ?, 'paid', ?, ?, ?, ?)`,
              [
                uid('inv'), orgId, invoiceId, payment.amount, (payment.currency || 'INR').toUpperCase(),
                '', '', nowIso(), nowIso(),
              ],
            );
          }
        }
      } else if (eventType === 'subscription.cancelled') {
        run(
          `UPDATE organization_subscriptions
           SET status = 'canceled', updated_at = ?
           WHERE organization_id = ?`,
          [nowIso(), orgId],
        );
      }
    }

    run(
      `INSERT INTO billing_events(id, organization_id, provider, event_id, event_type, status, payload, created_at)
       VALUES(?, ?, 'razorpay', ?, ?, 'processed', ?, ?)`,
      [uid('bev'), affectedOrgId, eventId, eventType, JSON.stringify(event), nowIso()],
    );
  });

  return { status: 'success', eventId, eventType, orgId: affectedOrgId };
}

import { beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

let app: any;
let run: any;
let one: any;
let all: any;

interface Reply { status: number; body: any; headers: Headers; text: string }

function client(ip: string) {
  const jar = new Map<string, string>();
  let csrf = '';
  const request = async (method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply> => {
    const headers: Record<string, string> = { 'X-Forwarded-For': ip, ...extra };
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined && typeof body !== 'string') headers['Content-Type'] = 'application/json';
    if (csrf && !['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrf;
    const res = await app.request(`http://localhost${url}`, {
      method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const setCookies: string[] = typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie() : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /^Max-Age=0/i.test(raw)) jar.delete(name); else jar.set(name, value);
    }
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* raw */ }
    if (parsed?.data?.csrfToken) csrf = parsed.data.csrfToken;
    return { status: res.status, body: parsed, headers: res.headers, text };
  };
  return { request, getCsrf: () => csrf };
}

const unique = () => crypto.randomBytes(5).toString('hex');

async function signup(name: string, ip: string) {
  const c = client(ip);
  const email = `${name}-${unique()}@example.org`;
  const res = await c.request('POST', '/api/v1/auth/signup', {
    name, email, password: 'test-password-123', workspaceName: `${name} Workspace`,
  });
  if (res.status !== 201) throw new Error(`signup failed ${res.status}: ${res.text}`);
  return { c, email, org: res.body.data.currentOrganization, user: res.body.data.user };
}

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `leadpulse-billing-test-${process.pid}-${Date.now()}`);
  process.env.DATA_DIR = dir;
  process.env.DB_FILE = path.join(dir, 'test-billing.db');
  process.env.ALLOW_DEMO = 'false';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_123';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_test_secret_456';

  const db = await import('../server/db.js');
  await db.initDb();
  const context = await import('../server/context.js');
  run = context.run;
  one = context.one;
  all = context.all;

  const appModule = await import('../server/app.js');
  app = appModule.createApp();
});

describe('Automated Billing & Subscription Management', () => {
  it('retrieves default organization subscription overview', async () => {
    const owner = await signup('BillOwner', '10.0.1.1');
    const res = await owner.c.request('GET', '/api/v1/billing');
    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toBeDefined();
    expect(res.body.data.subscription.plan_tier).toBe('solo');
    expect(res.body.data.subscription.status).toBe('active');
    expect(res.body.data.plans.length).toBe(3);
    expect(res.body.data.seats.limit).toBe(1);
    expect(res.body.data.seats.used).toBe(1);
  });

  it('creates checkout session and validates plan tier', async () => {
    const owner = await signup('CheckoutOwner', '10.0.1.2');

    // Invalid plan
    const invalid = await owner.c.request('POST', '/api/v1/billing/checkout', { planId: 'super_enterprise' });
    expect(invalid.status).toBe(400);

    // Valid plan checkout
    const valid = await owner.c.request('POST', '/api/v1/billing/checkout', { planId: 'team' });
    expect(valid.status).toBe(200);
    expect(valid.body.data.checkoutUrl).toBeDefined();
    expect(valid.body.data.sessionId).toBeDefined();
  });

  it('supports simulated plan activation in sandbox/dev environments', async () => {
    const owner = await signup('UpgradeOwner', '10.0.1.3');

    // Upgrade to agency
    const upgrade = await owner.c.request('POST', '/api/v1/billing/activate-simulated', { planId: 'agency' });
    expect(upgrade.status).toBe(200);
    expect(upgrade.body.data.subscription.plan_tier).toBe('agency');
    expect(upgrade.body.data.subscription.max_seats).toBe(50);
    expect(upgrade.body.data.subscription.max_workspaces).toBe(10);

    // Verify overview reflects agency tier
    const overview = await owner.c.request('GET', '/api/v1/billing');
    expect(overview.body.data.subscription.plan_tier).toBe('agency');
    expect(overview.body.data.seats.limit).toBe(50);
  });

  it('processes Stripe checkout.session.completed webhook idempotently', async () => {
    const owner = await signup('StripeOwner', '10.0.1.4');
    const orgId = owner.org.id;
    const eventId = `evt_stripe_${unique()}`;

    const stripeEvent = {
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: orgId,
          customer: 'cus_test_customer_123',
          subscription: 'sub_test_sub_456',
          metadata: { orgId, planId: 'team' },
        },
      },
    };

    const raw = JSON.stringify(stripeEvent);
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET!)
      .update(`${timestamp}.${raw}`)
      .digest('hex');

    const res1 = await owner.c.request(
      'POST',
      '/api/v1/billing/webhook/stripe',
      raw,
      { 'stripe-signature': `t=${timestamp},v1=${sig}`, 'Content-Type': 'application/json' },
    );
    expect(res1.status).toBe(200);
    expect(res1.body.received).toBe(true);

    // Verify database was updated
    const sub = one('SELECT * FROM organization_subscriptions WHERE organization_id = ?', [orgId]);
    expect(sub.plan_tier).toBe('team');
    expect(sub.customer_id).toBe('cus_test_customer_123');
    expect(sub.subscription_id).toBe('sub_test_sub_456');
    expect(sub.max_seats).toBe(10);

    // Idempotent retry: must return ignored without failing
    const res2 = await owner.c.request(
      'POST',
      '/api/v1/billing/webhook/stripe',
      raw,
      { 'stripe-signature': `t=${timestamp},v1=${sig}`, 'Content-Type': 'application/json' },
    );
    expect(res2.status).toBe(200);
    expect(res2.body.result.reason).toBe('already_processed');
  });

  it('records invoices from Stripe invoice.payment_succeeded webhook', async () => {
    const owner = await signup('InvoiceOwner', '10.0.1.5');
    const orgId = owner.org.id;

    // First assign a customer_id
    run('UPDATE organization_subscriptions SET customer_id = ? WHERE organization_id = ?', ['cus_inv_cust_789', orgId]);

    const invoiceEvent = {
      id: `evt_inv_${unique()}`,
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: `in_test_${unique()}`,
          customer: 'cus_inv_cust_789',
          amount_paid: 199900,
          currency: 'inr',
          hosted_invoice_url: 'https://pay.stripe.com/invoice/test-receipt',
          invoice_pdf: 'https://pay.stripe.com/invoice/test-receipt.pdf',
        },
      },
    };

    const raw = JSON.stringify(invoiceEvent);
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET!)
      .update(`${timestamp}.${raw}`)
      .digest('hex');

    const res = await owner.c.request(
      'POST',
      '/api/v1/billing/webhook/stripe',
      raw,
      { 'stripe-signature': `t=${timestamp},v1=${sig}`, 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(200);

    // Verify invoice is retrievable in billing overview
    const overview = await owner.c.request('GET', '/api/v1/billing');
    expect(overview.body.data.invoices.length).toBe(1);
    expect(overview.body.data.invoices[0].amount_paid).toBe(199900);
    expect(overview.body.data.invoices[0].hosted_invoice_url).toContain('test-receipt');
  });

  it('processes Razorpay subscription.activated webhook with HMAC verification', async () => {
    const owner = await signup('RazorpayOwner', '10.0.1.6');
    const orgId = owner.org.id;

    const rzpEvent = {
      event_id: `rzp_evt_${unique()}`,
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: {
            id: 'sub_rzp_987',
            customer_id: 'cust_rzp_654',
            notes: { orgId, planId: 'agency' },
          },
        },
      },
    };

    const raw = JSON.stringify(rzpEvent);
    const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(raw)
      .digest('hex');

    const res = await owner.c.request(
      'POST',
      '/api/v1/billing/webhook/razorpay',
      raw,
      { 'x-razorpay-signature': sig, 'Content-Type': 'application/json' },
    );
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const sub = one('SELECT * FROM organization_subscriptions WHERE organization_id = ?', [orgId]);
    expect(sub.plan_tier).toBe('agency');
    expect(sub.billing_provider).toBe('razorpay');
    expect(sub.subscription_id).toBe('sub_rzp_987');
  });

  it('rejects webhooks with invalid signatures when secret is configured', async () => {
    const owner = await signup('FraudOwner', '10.0.1.7');
    const raw = JSON.stringify({ id: 'evt_fake', type: 'checkout.session.completed' });

    // Bad Stripe signature
    const stripeRes = await owner.c.request(
      'POST',
      '/api/v1/billing/webhook/stripe',
      raw,
      { 'stripe-signature': 't=123,v1=invalidsig123', 'Content-Type': 'application/json' },
    );
    expect(stripeRes.status).toBe(400);

    // Bad Razorpay signature
    const rzpRes = await owner.c.request(
      'POST',
      '/api/v1/billing/webhook/razorpay',
      raw,
      { 'x-razorpay-signature': 'invalidsig456', 'Content-Type': 'application/json' },
    );
    expect(rzpRes.status).toBe(400);
  });

  it('supports marking subscription cancel at period end', async () => {
    const owner = await signup('CancelOwner', '10.0.1.8');
    const res = await owner.c.request('POST', '/api/v1/billing/cancel');
    expect(res.status).toBe(200);
    expect(res.body.data.subscription.cancel_at_period_end).toBe(1);

    const sub = one('SELECT cancel_at_period_end FROM organization_subscriptions WHERE organization_id = ?', [owner.org.id]);
    expect(sub.cancel_at_period_end).toBe(1);
  });
});


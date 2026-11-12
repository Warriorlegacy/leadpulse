import React from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../ui';
import { useAuth } from '../App';

function PublicHeader() {
  const { auth } = useAuth();
  return (
    <header className="public-header">
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div className="brand-mark" style={{ background: '#12202f', color: '#f0a63a' }}><Icon name="pulse" size={18} /></div>
        <span className="brand-name" style={{ color: '#12202f' }}>LeadPulse</span>
      </Link>
      <nav className="public-nav">
        <Link to="/pricing">Pricing</Link>
        <Link to="/privacy">Privacy</Link>
        {auth
          ? <Link className="btn btn-primary btn-small" to="/app">Open workspace</Link>
          : <><Link to="/login">Sign in</Link><Link className="btn btn-primary btn-small" to="/signup">Start a pilot</Link></>}
      </nav>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>© {new Date().getFullYear()} LeadPulse — a focused product experiment.</span>
      <span><Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/pricing">Pricing</Link></span>
    </footer>
  );
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'clock', title: 'Response time you can see', body: 'The clock starts the moment a lead arrives and stops at the first logged human response. A median, not a guess.' },
  { icon: 'users', title: 'No lead without an owner', body: 'Assignment is explicit. Agents see their own leads and, when permitted, the unassigned queue. Nothing falls through silently.' },
  { icon: 'chart', title: 'Sources that actually pay', body: 'Every lead carries its source and campaign. Reports group conversions by source using persisted stage events.' },
];

export function Landing() {
  const steps = [
    { title: 'Enquiry captured', sub: 'Public form, CSV, webhook or manual entry' },
    { title: 'Owner and next action', sub: 'Assignment plus a dated follow-up task' },
    { title: 'First response measured', sub: 'Logged once, never rewritten' },
  ];
  return (
    <div className="public">
      <PublicHeader />
      <section className="hero">
        <div>
          <p className="eyebrow">Lead-response CRM for small teams</p>
          <h1>Every lead has an owner, a next action and <em>a measurable response time.</em></h1>
          <p className="hero-lead">
            LeadPulse is a narrow CRM for agencies and local service businesses that lose enquiries between
            the inbox and the first call. It tracks who owns each lead, what happens next, and how long
            the team actually took to respond.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/signup">Start a pilot <Icon name="arrow" size={16} /></Link>
            <Link className="btn" to="/pricing">See pricing hypothesis</Link>
          </div>
          <p className="hero-note">No credit card. No automated messaging. CSV, manual and signed webhook capture work without any third-party keys.</p>
        </div>
        <div className="hero-panel">
          <p className="hero-panel-title">How a lead moves through LeadPulse</p>
          {steps.map((s, i) => (
            <div className="hero-row" key={s.title}>
              <span className="pulse-dot" />
              <div>
                <div>{i + 1}. {s.title}</div>
                <div className="hero-row-sub">{s.sub}</div>
              </div>
              <span className="hero-row-time">{['t0', '+1m', '+12m'][i]}</span>
            </div>
          ))}
          <p className="hero-row-sub" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.09)' }}>
            Illustration of the workflow — not live customer data.
          </p>
        </div>
      </section>
      <section className="feature-band">
        <div className="features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="feature-icon"><Icon name={f.icon} size={19} /></div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}

const PLANS = [
  { name: 'Solo', price: '₹799', detail: 'One person, one pipeline', items: ['Single workspace', 'Lead inbox and pipeline', 'CSV import and export', 'Public capture form'] },
  { name: 'Team', price: '₹1,999', detail: 'Small teams with shared ownership', items: ['Everything in Solo', 'Up to 10 teammates', 'Assignments and follow-up tasks', 'Reports and audit log'] },
  { name: 'Agency', price: '₹3,999', detail: 'Multiple client pipelines', items: ['Everything in Team', 'Multiple workspaces', 'Signed inbound webhooks', 'Workspace data export'] },
];

export function Pricing() {
  return (
    <div className="public">
      <PublicHeader />
      <section className="public-section">
        <p className="eyebrow">Pricing</p>
        <h2>A hypothesis, not an offer</h2>
        <p>These numbers are a starting point for buyer conversations. They have not been validated, billing is not configured, and no payment can be taken in this build.</p>
        <div className="notice notice-info" style={{ marginBottom: 24 }}>
          <Icon name="alert" size={18} />
          <span>Pricing is experimental. The current pilot is manually managed and free of charge. No payment provider is connected.</span>
        </div>
        <div className="price-grid">
          {PLANS.map((p) => (
            <div className="price-card" key={p.name}>
              <h3>{p.name}</h3>
              <div className="price">{p.price}<span className="small muted"> / month (hypothesis)</span></div>
              <p className="small muted">{p.detail}</p>
              <ul>{p.items.map((i) => <li key={i}>· {i}</li>)}</ul>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 28 }}>
          <Link className="btn btn-primary" to="/signup">Start a free pilot</Link>
          <span className="small muted">Pilot access is provisioned manually and includes synthetic demo data.</span>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}

export function Privacy() {
  return (
    <div className="public">
      <PublicHeader />
      <section className="public-section prose">
        <p className="eyebrow">Legal</p>
        <h2>Privacy notice</h2>
        <p>This is a plain-language description of how this pilot build handles data. It is not legal advice and has not been reviewed by counsel.</p>
        <h3>What is stored</h3>
        <p>Account email and name, a one-way password hash, session records, workspace settings, and the lead contact details you enter. Lead activity, tasks, stage changes and audit events are retained so the response-time metrics can be computed.</p>
        <h3>What is not done</h3>
        <ul>
          <li>No lead data is sent to an AI provider, email service, analytics service or ad platform in this build — all optional integrations are disabled.</li>
          <li>No automated email, SMS or WhatsApp message is sent. Activities and tasks are logged records only.</li>
          <li>No payment or card data is collected.</li>
          <li>Secrets, tokens and full webhook payloads are not written to application logs.</li>
        </ul>
        <h3>Your controls</h3>
        <p>Workspace owners can export all workspace data as JSON or CSV, and can permanently delete a workspace after typing its slug to confirm. Leads are archived rather than deleted in normal use. Session cookies expire after 30 days.</p>
        <h3>Demo data</h3>
        <p>The seeded demo workspace contains synthetic names, reserved example domains and 555 phone numbers. Do not enter real customer data into a publicly shared demo deployment.</p>
        <h3>Contact</h3>
        <p>Data-handling questions should be raised with the workspace owner. A formal privacy policy, retention schedule and jurisdiction-specific compliance review are still required before a commercial launch.</p>
      </section>
      <PublicFooter />
    </div>
  );
}

export function Terms() {
  return (
    <div className="public">
      <PublicHeader />
      <section className="public-section prose">
        <p className="eyebrow">Legal</p>
        <h2>Terms of use</h2>
        <p>This software is an early product experiment provided as-is, without warranty. It is not yet offered as a commercial subscription.</p>
        <h3>Acceptable use</h3>
        <ul>
          <li>Only enter data you are legally permitted to process, and obtain any required consent from the people whose details you store.</li>
          <li>Do not use the public capture form or inbound webhook endpoints to send unlawful, unsolicited or harmful content.</li>
          <li>Do not attempt to access another workspace's records. Tenant isolation is enforced server-side and violations are audit-logged.</li>
        </ul>
        <h3>Service limits</h3>
        <p>This build runs as a single Node process with a file-backed SQLite database. There is no uptime commitment, no managed backup service and no disaster-recovery guarantee. Free-tier hosting quotas apply and may change. Export your data regularly.</p>
        <h3>No automated messaging</h3>
        <p>Logging a call or email records that a human said it happened. The system does not send it. A user-initiated click-to-chat link is offered for WhatsApp; no unofficial automation is used.</p>
        <h3>Changes</h3>
        <p>Terms and product scope may change as buyer validation progresses. Material changes should be communicated to pilot participants before they take effect.</p>
      </section>
      <PublicFooter />
    </div>
  );
}

export function NotFound() {
  return (
    <div className="public">
      <PublicHeader />
      <section className="public-section" style={{ textAlign: 'center' }}>
        <p className="eyebrow">404</p>
        <h2>That page does not exist</h2>
        <p>The link may be outdated, or the public form may have been rotated.</p>
        <div style={{ marginTop: 26 }}><Link className="btn btn-primary" to="/">Back to home</Link></div>
      </section>
      <PublicFooter />
    </div>
  );
}

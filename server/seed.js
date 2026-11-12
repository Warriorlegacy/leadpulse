import { one, run, all, tx } from './context.js';
import { uid, nowIso, addMinutes, hashPassword } from './util.js';
import {
  createWorkspaceForUser, ensureSource, createLead, logActivity,
  transitionStage, setTags,
} from './leads-service.js';

const DEMO_OWNER = 'demo@leadpulse.example';
const DEMO_AGENT = 'agent@leadpulse.example';
const DEMO_PASSWORD = 'demo12345';

const DEMO_LEADS = [
  { name: 'Aarav Mehta', company: '[DEMO] Maple Interiors', email: 'aarav.mehta@example.com', phone: '+15550100001', source: 'Website form', campaign: 'Diwali-2026', priority: 'urgent', tags: ['hot'], stage: 2, owner: 'owner', amount: 480000, days: 1, response: 12 },
  { name: 'Priya Nair', company: '[DEMO] Lotus Dental', email: 'priya.nair@example.org', phone: '+15550100002', source: 'Google Ads', campaign: 'implant-consult', priority: 'high', tags: ['callback'], stage: 3, owner: 'agent', amount: 220000, days: 2, response: 35 },
  { name: 'Rohan Gupta', company: '[DEMO] Skyline Plumbers', email: 'rohan.gupta@example.net', phone: '+15550100003', source: 'Referral', priority: 'normal', tags: [], stage: 1, owner: 'owner', amount: 95000, days: 3, response: 74 },
  { name: 'Sana Kapoor', company: '[DEMO] Bright Path Academy', email: 'sana.kapoor@example.com', phone: '+15550100004', source: 'Website form', campaign: 'open-house', priority: 'high', tags: ['hot', 'campaign-q4'], stage: 4, owner: 'agent', amount: 320000, days: 5, response: 8, won: true },
  { name: 'Vikram Rao', company: '[DEMO] Greenfield Realty', email: 'vikram.rao@example.org', phone: '+15550100005', source: 'Phone', priority: 'normal', tags: [], stage: 5, owner: 'owner', amount: 180000, days: 6, response: 140, lost: true },
  { name: 'Meera Iyer', company: '[DEMO] Cedar Clinic', email: 'meera.iyer@example.net', phone: '+15550100006', source: 'Google Ads', campaign: 'branded-search', priority: 'urgent', tags: ['hot'], stage: 0, owner: null, amount: 75000, days: 0, response: null },
  { name: 'Dev Sharma', company: '[DEMO] Falcon Logistics', email: 'dev.sharma@example.com', phone: '+15550100007', source: 'CSV import', priority: 'normal', tags: [], stage: 0, owner: 'agent', amount: 140000, days: 0, response: null },
  { name: 'Ananya Sen', company: '[DEMO] Studio Nine', email: 'ananya.sen@example.org', phone: '+15550100008', source: 'Website form', campaign: 'portfolio-launch', priority: 'high', tags: ['callback'], stage: 1, owner: 'owner', amount: 210000, days: 4, response: 22 },
  { name: 'Kabir Malhotra', company: '[DEMO] Urban Fitness', email: 'kabir.malhotra@example.net', phone: '+15550100009', source: 'Referral', priority: 'normal', tags: [], stage: 2, owner: 'agent', amount: 165000, days: 7, response: 310 },
  { name: 'Ishita Verma', company: '[DEMO] Bloom Cafe', email: 'ishita.verma@example.com', phone: '+15550100010', source: 'Phone', priority: 'low', tags: [], stage: 3, owner: 'owner', amount: 88000, days: 9, response: 55 },
  { name: 'Nikhil Joshi', company: '[DEMO] Atlas Legal', email: 'nikhil.joshi@example.org', phone: '+15550100011', source: 'Google Ads', campaign: 'retargeting', priority: 'normal', tags: ['campaign-q4'], stage: 1, owner: null, amount: 260000, days: 11, response: null },
  { name: 'Tara Dsouza', company: '[DEMO] Riverside Realty', email: 'tara.dsouza@example.net', phone: '+15550100012', source: 'Website form', priority: 'high', tags: ['hot'], stage: 0, owner: 'owner', amount: 510000, days: 0, response: null },
];

/** Seeds clearly labelled synthetic data only. Idempotent; gated by ALLOW_DEMO. */
export function seedDemo() {
  if (String(process.env.ALLOW_DEMO ?? 'true').toLowerCase() === 'false') return { seeded: false, reason: 'ALLOW_DEMO=false' };
  if (one('SELECT id FROM users WHERE email = ?', [DEMO_OWNER])) {
    return { seeded: false, reason: 'demo data already present' };
  }

  // Atomic: a failed seed must never leave a half-populated demo workspace.
  return tx(() => {
  const ts = nowIso();
  const ownerId = uid('usr');
  const agentId = uid('usr');
  run('INSERT INTO users(id, email, name, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)',
    [ownerId, DEMO_OWNER, 'Demo Owner', hashPassword(DEMO_PASSWORD), ts, ts]);
  run('INSERT INTO users(id, email, name, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)',
    [agentId, DEMO_AGENT, 'Demo Agent', hashPassword(DEMO_PASSWORD), ts, ts]);

  const org = createWorkspaceForUser(ownerId, 'Northstar Home Services (DEMO)', { isDemo: true });
  run('INSERT INTO memberships(id, organization_id, user_id, role, can_view_unassigned, created_at) VALUES(?, ?, ?, ?, ?, ?)',
    [uid('mem'), org.id, agentId, 'agent', 1, ts]);
  run('INSERT INTO notification_preferences(user_id, organization_id, in_app, email) VALUES(?, ?, 1, 0)', [agentId, org.id]);

  // A second workspace makes tenant switching and isolation easy to exercise.
  const orgB = createWorkspaceForUser(ownerId, 'Riverside Realty (DEMO B)', { isDemo: true, timezone: 'Asia/Kolkata' });

  run(`UPDATE capture_forms SET title = ?, intro = ?, consent_notice = ? WHERE organization_id = ?`,
    ['Request a callback', 'Tell us what you need and our team will get back to you. This is a demo form with synthetic data.',
      'I agree to be contacted about my enquiry. (Demo workspace — do not submit real personal data.)', org.id]);

  const stages = all('SELECT id FROM pipeline_stages WHERE organization_id = ? ORDER BY position', [org.id]);
  for (const [index, def] of DEMO_LEADS.entries()) {
    const ownerUserId = def.owner === 'owner' ? ownerId : def.owner === 'agent' ? agentId : null;
    const created = new Date(Date.now() - def.days * 86400000 - index * 3600000).toISOString();
    ensureSource(org.id, def.source, def.source === 'Website form' ? 'form' : def.source === 'CSV import' ? 'csv' : 'manual');
    const lead = createLead(org, {
      lead: {
        name: def.name, company: def.company, email: def.email, phone: def.phone,
        campaign: def.campaign || '', priority: def.priority, amount: def.amount,
        ownerId: ownerUserId, consent: 'granted',
        notes: 'Synthetic demo record. Not a real person or customer.',
        nextFollowUpAt: def.days > 3 ? addMinutes(created, 60 * 24 * 2) : null,
      },
      sourceName: def.source, sourceKind: def.source === 'Website form' ? 'form' : def.source === 'CSV import' ? 'csv' : 'manual',
      createdBy: ownerId, originLabel: 'synthetic demo seed',
    });
    setTags(org.id, lead.id, def.tags);
    run('UPDATE leads SET created_at = ?, updated_at = ? WHERE id = ?', [created, created, lead.id]);
    run('UPDATE stage_events SET created_at = ? WHERE lead_id = ?', [created, lead.id]);
    run('UPDATE activities SET created_at = ? WHERE lead_id = ?', [created, lead.id]);
    if (def.response != null) {
      logActivity(org, lead.id, ownerUserId || agentId, 'call', 'Logged an outbound call. No message was sent by the system.');
      run('UPDATE leads SET first_response_at = ? WHERE id = ?', [addMinutes(created, def.response), lead.id]);
    }
    // Closed stages may not transition directly to another closed stage.
    const path = def.won ? [1, 2, 3, 4] : def.lost ? [1, 2, 3, 5]
      : Array.from({ length: def.stage }, (_, i) => i + 1);
    let currentStage = stages[0].id;
    for (const target of path) {
      transitionStage(org.id, { ...lead, stage_id: currentStage }, stages[target].id, ownerId, 'Synthetic demo progression');
      currentStage = stages[target].id;
    }
    run('UPDATE stage_events SET created_at = ? WHERE lead_id = ?', [created, lead.id]);
    run('UPDATE activities SET created_at = ? WHERE lead_id = ?', [created, lead.id]);
  }

  const leadIds = all('SELECT id, name FROM leads WHERE organization_id = ?', [org.id]);
  const taskDefs = [
    { title: 'Call back about the quote', due: -2, priority: 'urgent', owner: ownerId },
    { title: 'Send proposal document', due: 0, priority: 'high', owner: agentId },
    { title: 'Schedule site visit', due: 1, priority: 'normal', owner: ownerId },
    { title: 'Confirm consent preference', due: 3, priority: 'low', owner: agentId },
    { title: 'Follow up after demo', due: -1, priority: 'high', owner: ownerId, completed: true },
  ];
  taskDefs.forEach((t, i) => {
    const due = new Date(Date.now() + t.due * 86400000).toISOString();
    run(
      `INSERT INTO tasks(id, organization_id, lead_id, title, owner_id, due_at, priority, reminder, completed_at, created_by, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid('tsk'), org.id, leadIds[i % leadIds.length]?.id ?? null, t.title, t.owner, due, t.priority, 'in_app',
        t.completed ? ts : null, ownerId, ts, ts],
    );
  });

  run(`INSERT INTO notifications(id, organization_id, user_id, kind, message, created_at)
       VALUES(?, ?, ?, ?, ?, ?)`,
    [uid('ntf'), org.id, ownerId, 'system', 'Welcome to LeadPulse. This workspace contains synthetic demo data only.', ts]);

  // Two leads in workspace B to prove the tenant boundary in the UI.
  createLead(orgB, {
    lead: { name: 'Workspace B Contact', company: '[DEMO] Isolated Org', email: 'isolation@example.org', phone: '+15550109999', ownerId: ownerId, notes: 'Synthetic record in a separate workspace.' },
    sourceName: 'Manual', createdBy: ownerId, originLabel: 'synthetic demo seed',
  });

  return {
    seeded: true,
    owner: { email: DEMO_OWNER, password: DEMO_PASSWORD },
    agent: { email: DEMO_AGENT, password: DEMO_PASSWORD },
    workspaces: [org.name, orgB.name],
    leads: DEMO_LEADS.length,
  };
  });
}

import { one, run } from './context.js';
import { uid, nowIso } from './util.js';

/**
 * LeadPulse Email Service.
 * Follows the adapter pattern: supports 'console' (default for dev/testing),
 * 'resend' (when RESEND_API_KEY is configured), and standard SMTP.
 */

export function getEmailSettings(orgId) {
  if (!orgId) return defaultEmailSettings();
  try {
    const row = one('SELECT * FROM organization_email_settings WHERE organization_id = ?', [orgId]);
    if (row) {
      return {
        provider: row.provider || 'console',
        fromName: row.from_name || 'LeadPulse CRM',
        fromEmail: row.from_email || 'notifications@leadpulse.example',
        replyTo: row.reply_to || '',
      };
    }
  } catch {
    // Table not created yet or fallback
  }
  return defaultEmailSettings();
}

function defaultEmailSettings() {
  return {
    provider: process.env.RESEND_API_KEY ? 'resend' : 'console',
    fromName: process.env.EMAIL_FROM_NAME || 'LeadPulse CRM',
    fromEmail: process.env.EMAIL_FROM || 'notifications@leadpulse.example',
    replyTo: process.env.EMAIL_REPLY_TO || '',
  };
}

export async function sendMail({ to, subject, text, html, orgId = null }) {
  const settings = getEmailSettings(orgId);
  const from = `${settings.fromName} <${settings.fromEmail}>`;

  if (settings.provider === 'resend' && process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text,
          html: html || text,
          ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.warn('[leadpulse:email] Resend API error:', data);
        return { ok: false, error: data.message || 'Resend error' };
      }
      return { ok: true, provider: 'resend', id: data.id };
    } catch (err) {
      console.warn('[leadpulse:email] Resend delivery failed, falling back to console:', err.message);
    }
  }

  // Console driver (zero-cost, safe, transparent for local development and test environments)
  const id = uid('msg');
  console.log(`\n------------------ [LEADPULSE EMAIL (${settings.provider})] ------------------`);
  console.log(`Message-ID: <${id}@leadpulse.local>`);
  console.log(`To: ${to}`);
  console.log(`From: ${from}`);
  console.log(`Subject: ${subject}`);
  console.log('Body:');
  console.log(text);
  console.log('------------------------------------------------------------------\n');

  return { ok: true, provider: 'console', id };
}

export async function sendPasswordResetEmail({ to, name, resetUrl, expiresInMinutes = 60 }) {
  const subject = 'Reset your LeadPulse password';
  const text = `Hello ${name || 'there'},\n\n` +
    `A password reset was requested for your LeadPulse account.\n` +
    `Click the link below to set a new password (valid for ${expiresInMinutes} minutes):\n\n` +
    `${resetUrl}\n\n` +
    `If you did not request this, you can safely ignore this email.\n\n` +
    `The LeadPulse Team`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #1c1917;">
      <h2 style="font-family: Georgia, serif; font-size: 20px; color: #1c1917; margin-bottom: 16px;">Reset your LeadPulse password</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #44403c;">Hello ${name || 'there'},</p>
      <p style="font-size: 14px; line-height: 1.6; color: #44403c;">A password reset was requested for your LeadPulse account. Click the button below to choose a new password. This link expires in ${expiresInMinutes} minutes.</p>
      <div style="margin: 28px 0;">
        <a href="${resetUrl}" style="background-color: #d97706; color: #ffffff; padding: 10px 20px; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 4px; display: inline-block;">Reset Password</a>
      </div>
      <p style="font-size: 12px; line-height: 1.5; color: #78716c;">Or copy and paste this URL into your browser:<br/><span style="word-break: break-all;">${resetUrl}</span></p>
      <p style="font-size: 12px; line-height: 1.5; color: #a8a29e; margin-top: 32px; border-top: 1px solid #e7e5e4; padding-top: 16px;">If you did not request this change, you can safely ignore this message.</p>
    </div>
  `;

  return sendMail({ to, subject, text, html });
}

export async function sendInvitationEmail({ to, inviterName, workspaceName, role, inviteUrl }) {
  const roleLabel = role.replace('workspace_', '').replace('_', ' ');
  const subject = `You've been invited to join ${workspaceName} on LeadPulse`;
  const text = `Hello,\n\n` +
    `${inviterName} has invited you to join the "${workspaceName}" workspace on LeadPulse as a ${roleLabel}.\n\n` +
    `Accept your invitation here:\n${inviteUrl}\n\n` +
    `LeadPulse helps teams respond faster and keep lead ownership clear.\n\n` +
    `The LeadPulse Team`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #1c1917;">
      <h2 style="font-family: Georgia, serif; font-size: 20px; color: #1c1917; margin-bottom: 16px;">Join ${workspaceName} on LeadPulse</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #44403c;"><strong>${inviterName}</strong> has invited you to collaborate as a <strong>${roleLabel}</strong>.</p>
      <div style="margin: 28px 0;">
        <a href="${inviteUrl}" style="background-color: #d97706; color: #ffffff; padding: 10px 20px; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invitation</a>
      </div>
      <p style="font-size: 12px; line-height: 1.5; color: #78716c;">Or open this link:<br/><span style="word-break: break-all;">${inviteUrl}</span></p>
    </div>
  `;

  return sendMail({ to, subject, text, html });
}


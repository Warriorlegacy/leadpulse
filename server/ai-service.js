import { one, run } from './context.js';
import { nowIso } from './util.js';

/**
 * LeadPulse AI Service.
 * Implements real AI speed-to-lead capabilities using Google Gemini Flash or Groq.
 * Strictly opt-in per workspace; no hallucinated outputs; honest fallback when unconfigured.
 */

export function getAiSettings(orgId) {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const hasAnyKey = hasGemini || hasGroq;

  let row = null;
  if (orgId) {
    try {
      row = one('SELECT * FROM organization_ai_settings WHERE organization_id = ?', [orgId]);
    } catch {
      // Table may be pending initial migration
    }
  }

  const enabled = Boolean(row?.enabled);
  const provider = row?.provider || (hasGemini ? 'gemini' : hasGroq ? 'groq' : 'gemini');

  return {
    enabled,
    active: Boolean(enabled && hasAnyKey),
    provider,
    leadSummaryEnabled: row ? Boolean(row.lead_summary_enabled) : true,
    draftResponseEnabled: row ? Boolean(row.draft_response_enabled) : true,
    availableProviders: {
      gemini: hasGemini,
      groq: hasGroq,
      workersAi: false,
    },
    configured: hasAnyKey,
  };
}

export function saveAiSettings(orgId, { enabled, provider, leadSummaryEnabled, draftResponseEnabled }) {
  const ts = nowIso();
  const existing = one('SELECT organization_id FROM organization_ai_settings WHERE organization_id = ?', [orgId]);
  if (existing) {
    run(
      `UPDATE organization_ai_settings
       SET enabled = ?, provider = ?, lead_summary_enabled = ?, draft_response_enabled = ?, updated_at = ?
       WHERE organization_id = ?`,
      [
        enabled ? 1 : 0,
        provider || 'gemini',
        leadSummaryEnabled ? 1 : 0,
        draftResponseEnabled ? 1 : 0,
        ts,
        orgId,
      ],
    );
  } else {
    run(
      `INSERT INTO organization_ai_settings(organization_id, enabled, provider, lead_summary_enabled, draft_response_enabled, updated_at)
       VALUES(?, ?, ?, ?, ?, ?)`,
      [
        orgId,
        enabled ? 1 : 0,
        provider || 'gemini',
        leadSummaryEnabled ? 1 : 0,
        draftResponseEnabled ? 1 : 0,
        ts,
      ],
    );
  }
  return getAiSettings(orgId);
}

/**
 * Call Gemini Flash API with structured prompt.
 */
async function callGemini(systemPrompt, userPrompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1000,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return text.trim();
}

/**
 * Call Groq API with OpenAI compatible endpoint.
 */
async function callGroq(systemPrompt, userPrompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not configured');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from Groq');
  return text.trim();
}

async function executeLlm(systemPrompt, userPrompt, preferredProvider = 'gemini') {
  if (preferredProvider === 'groq' && process.env.GROQ_API_KEY) {
    return callGroq(systemPrompt, userPrompt);
  }
  if (process.env.GEMINI_API_KEY) {
    return callGemini(systemPrompt, userPrompt);
  }
  if (process.env.GROQ_API_KEY) {
    return callGroq(systemPrompt, userPrompt);
  }
  throw new Error('No AI provider credentials configured in environment.');
}

/**
 * Generate a 3-point actionable lead brief.
 */
export async function generateLeadBrief(orgId, lead, activities = [], stageName = 'New') {
  const settings = getAiSettings(orgId);
  if (!settings.enabled) {
    return {
      available: false,
      reason: 'AI features must be enabled in Workspace Settings by an administrator before generating briefs.',
    };
  }
  if (!settings.configured) {
    return {
      available: false,
      reason: 'No AI provider credentials (GEMINI_API_KEY or GROQ_API_KEY) are configured in the environment.',
    };
  }

  const activitySummary = activities.slice(0, 5).map(
    (a) => `[${a.type}] ${a.body.slice(0, 140)}`
  ).join('\n') || 'None recorded yet.';

  const systemPrompt = `You are LeadPulse AI, an executive sales assistant for marketing agencies and local service businesses.
Your goal is to provide concise, factual, high-signal analysis of incoming sales leads.
Rules:
1. Strictly avoid fluff, buzzwords, or speculation.
2. Only infer facts from provided lead details and logged activities.
3. Keep the output structured with exactly three sections:
   - Summary of Intent (2 sentences max)
   - Buying Signals & Urgency (Bullet points)
   - Recommended Next Action (1 clear actionable sentence)
Tone: Professional, direct, editorial.`;

  const userPrompt = `Analyze this lead:
Name: ${lead.name}
Company: ${lead.company || 'Not provided'}
Email: ${lead.email || 'Not provided'}
Phone: ${lead.phone || 'Not provided'}
Source: ${lead.source_name || lead.source || 'Direct'}
Campaign: ${lead.campaign || 'None'}
Current Stage: ${stageName}
Priority: ${lead.priority}
Notes: ${lead.notes || 'None'}
Recent Activities:
${activitySummary}

Provide the structured 3-part brief now.`;

  try {
    const briefText = await executeLlm(systemPrompt, userPrompt, settings.provider);
    return {
      available: true,
      provider: settings.provider,
      brief: briefText,
      generatedAt: nowIso(),
    };
  } catch (err) {
    console.error('[leadpulse:ai] Lead brief generation failed:', err.message);
    return {
      available: false,
      error: 'AI service temporarily unavailable. Please verify API quotas.',
    };
  }
}

/**
 * Generate speed-to-lead response draft (Email, SMS, or WhatsApp message).
 */
export async function generateDraftResponse(orgId, lead, { channel = 'email', tone = 'professional', instructions = '' } = {}) {
  const settings = getAiSettings(orgId);
  if (!settings.enabled) {
    return {
      available: false,
      reason: 'AI features must be enabled in Workspace Settings by an administrator before drafting responses.',
    };
  }
  if (!settings.configured) {
    return {
      available: false,
      reason: 'No AI provider credentials (GEMINI_API_KEY or GROQ_API_KEY) are configured in the environment.',
    };
  }

  const systemPrompt = `You are a sales copy expert for local service businesses and agencies.
Write a personalized first-response message to an inbound lead.
Rules:
1. Adhere strictly to the requested channel:
   - 'email': Include a punchy, non-spammy Subject line and clean body paragraphs with clear call-to-action.
   - 'sms' / 'whatsapp': Concise (under 160 characters if SMS, under 300 characters if WhatsApp), friendly, direct, asking a single question to prompt a reply.
2. Channel: ${channel}
3. Desired Tone: ${tone}
4. NO AI slop: Do NOT use phrases like "I hope this email finds you well", "In today's fast-paced world", or "game-changer".
5. Speak human-to-human. State who you are, acknowledge their inquiry, and propose the immediate next step (e.g. quick 10-minute discovery call).`;

  const userPrompt = `Lead details:
Name: ${lead.name}
Company: ${lead.company || ''}
Inquiry notes: ${lead.notes || 'General service inquiry'}
Source: ${lead.source_name || lead.source || 'Website'}
Additional agent instructions: ${instructions || 'None'}

Draft the message now.`;

  try {
    const draftText = await executeLlm(systemPrompt, userPrompt, settings.provider);
    return {
      available: true,
      provider: settings.provider,
      channel,
      tone,
      draft: draftText,
      generatedAt: nowIso(),
    };
  } catch (err) {
    console.error('[leadpulse:ai] Response draft generation failed:', err.message);
    return {
      available: false,
      error: 'AI service temporarily unavailable. Please verify API quotas.',
    };
  }
}


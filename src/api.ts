export type Role = 'platform_admin' | 'workspace_owner' | 'workspace_admin' | 'manager' | 'agent';

export interface User {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin?: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  industry: string;
  currency: string;
  working_hours_start: string;
  working_hours_end: string;
  working_days: string;
  sla_target_minutes: number;
  sla_business_hours_only: number;
  is_demo: number;
  created_at: string;
}

export interface MembershipOrg {
  id: string;
  name: string;
  slug: string;
  is_demo: number;
  role: Role;
  can_view_unassigned: number;
}

export interface AuthPayload {
  user: User;
  organizations: MembershipOrg[];
  currentOrganization: Organization | null;
  csrfToken?: string;
}

export interface Lead {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  campaign: string;
  stage_id: string;
  stage_name: string;
  stage_kind: string;
  stage_color: string;
  source_name: string;
  owner_id: string | null;
  owner_name: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  consent: string;
  notes: string;
  amount: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  next_follow_up_at: string | null;
  first_response_at: string | null;
  archived_at: string | null;
  reasons?: string[];
}

export interface Stage {
  id: string;
  name: string;
  position: number;
  kind: 'open' | 'won' | 'lost';
  color: string;
}

export interface Task {
  id: string;
  title: string;
  lead_id: string | null;
  lead_name?: string;
  owner_id: string | null;
  owner_name?: string;
  due_at: string;
  priority: string;
  completed_at: string | null;
}

export interface Activity {
  id: string;
  type: string;
  body: string;
  actor_name: string | null;
  created_at: string;
}

let csrfToken = '';
export const setCsrfToken = (value: string) => { csrfToken = value || ''; };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken && !['GET', 'HEAD'].includes(method.toUpperCase())) headers['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and retry.', 0, 'NETWORK');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(payload?.error?.message || `Request failed (${response.status})`, response.status, payload?.error?.code || 'UNKNOWN');
  }
  return (payload?.data ?? null) as T;
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.error?.message || 'Download failed', response.status, 'DOWNLOAD');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const fmtDate = (value: string | null | undefined, withTime = false): string => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
};

export const fmtMoney = (value: number | null, currency = 'INR'): string => {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch { return `${currency} ${value.toLocaleString('en-IN')}`; }
};

export const relative = (value: string | null | undefined): string => {
  if (!value) return '—';
  const diff = Date.now() - Date.parse(value);
  if (Number.isNaN(diff)) return '—';
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (mins > 0 && mins < 60) return `${mins}m ago`;
  if (mins > 0 && mins < 1440) return `${Math.round(mins / 60)}h ago`;
  if (mins > 0) return `${Math.round(mins / 1440)}d ago`;
  const future = Math.abs(mins);
  if (future < 60) return `in ${future}m`;
  if (future < 1440) return `in ${Math.round(future / 60)}h`;
  return `in ${Math.round(future / 1440)}d`;
};

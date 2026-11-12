import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, type AuthPayload } from '../api';
import { Icon, Field, Spinner } from '../ui';
import { useAuth } from '../App';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isSignup = mode === 'signup';
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const payload = await api<AuthPayload>(isSignup ? '/auth/signup' : '/auth/login', {
        method: 'POST',
        body: isSignup ? { name, email, password, workspaceName } : { email, password },
      });
      setAuth(payload);
      const next = searchParams.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/app', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-art">
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="brand-mark"><Icon name="pulse" size={19} /></div>
          <span className="brand-name">LeadPulse</span>
        </Link>
        <blockquote>Every lead has an owner, a next action and a measurable response time.</blockquote>
        <small>Speed-to-lead CRM for small teams · synthetic demo data available</small>
      </div>
      <div className="auth-form">
        <div className="auth-card">
          <h2>{isSignup ? 'Start your workspace' : 'Welcome back'}</h2>
          <p>{isSignup ? 'Create a workspace with a default pipeline. You can invite teammates later.' : 'Sign in to pick up where your team left off.'}</p>
          {error && <div className="notice notice-error" style={{ marginBottom: 16 }} role="alert"><Icon name="alert" size={17} /><span>{error}</span></div>}
          <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {isSignup && (
              <>
                <Field label="Your name" htmlFor="name">
                  <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Priya Nair" />
                </Field>
                <Field label="Workspace name" htmlFor="workspaceName" hint="You can rename and configure this in Settings.">
                  <input id="workspaceName" className="input" required minLength={2} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="e.g. Northstar Home Services" />
                </Field>
              </>
            )}
            <Field label="Email" htmlFor="email">
              <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
            </Field>
            <Field label="Password" htmlFor="password" hint={isSignup ? 'At least 8 characters.' : undefined}>
              <input id="password" className="input" type="password" required minLength={isSignup ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSignup ? 'new-password' : 'current-password'} />
            </Field>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 4 }}>
              {busy ? 'Working…' : isSignup ? 'Create workspace' : 'Sign in'} {!busy && <Icon name="arrow" size={15} />}
            </button>
          </form>
          <p style={{ marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
            {isSignup ? 'Already have an account?' : 'New to LeadPulse?'}{' '}
            <Link to={`${isSignup ? '/login' : '/signup'}${searchParams.get('next') ? `?next=${encodeURIComponent(searchParams.get('next') || '')}` : ''}`}
              style={{ color: 'var(--accent-dark)', fontWeight: 600 }}>
              {isSignup ? 'Sign in' : 'Create a workspace'}
            </Link>
          </p>
          <div className="demo-credentials">
            <strong>Demo accounts</strong> (synthetic data only)<br />
            <code>demo@leadpulse.example</code> — owner · <code>agent@leadpulse.example</code> — agent<br />
            Password for both: <code>demo12345</code>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Invitation links land here. Acceptance requires a session with the invited email. */
export function AcceptInvitePage() {
  const { token } = useParams();
  const { auth, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!auth || !token || status !== 'idle') return;
    setStatus('working');
    api(`/invitations/${token}/accept`, { method: 'POST', body: {} })
      .then(() => { setStatus('done'); setMessage('You have joined the workspace. Open it below.'); })
      .catch((err) => { setStatus('error'); setMessage(err instanceof ApiError ? err.message : 'This invitation could not be accepted.'); });
  }, [auth, token, status]);

  const next = `/accept/${token || ''}`;
  return (
    <div className="public capture-page">
      <div className="capture-card">
        <div className="card card-pad">
          <h2>Workspace invitation</h2>
          {authLoading || status === 'working' ? <Spinner label="Checking invitation" /> : null}
          {!authLoading && !auth && status === 'idle' && (
            <>
              <p className="muted" style={{ margin: '10px 0 18px' }}>
                Sign in, or create an account, using <strong>the exact email address the invitation was sent to</strong>.
                You will be joined to the workspace automatically afterwards.
              </p>
              <div className="row">
                <Link className="btn btn-primary" to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>
                <Link className="btn" to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
              </div>
            </>
          )}
          {status === 'done' && <div className="notice notice-success" style={{ marginTop: 16 }}><Icon name="check" size={17} /><span>{message}</span></div>}
          {status === 'error' && <div className="notice notice-error" style={{ marginTop: 16 }}><Icon name="alert" size={17} /><span>{message}</span></div>}
          {(status === 'done' || status === 'error') && <p style={{ marginTop: 16 }}><Link className="btn" to="/app">Go to workspace</Link></p>}
        </div>
      </div>
    </div>
  );
}

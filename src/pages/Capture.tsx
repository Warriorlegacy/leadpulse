import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Field, Icon, Spinner, ErrorNotice } from '../ui';

interface FormConfig {
  form: { title: string; intro: string; consentNotice: string; fields: string[] };
}

const LABELS: Record<string, string> = {
  name: 'Your name', email: 'Email address', phone: 'Phone number',
  company: 'Company / organisation', message: 'How can we help?',
};

export function CapturePage() {
  const { publicId } = useParams();
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({ name: '', email: '', phone: '', company: '', message: '', website: '' });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  React.useEffect(() => {
    if (!publicId || config || loadError) return;
    api<FormConfig>(`/public/forms/${publicId}`)
      .then(setConfig)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'This form could not be loaded.'));
  }, [publicId, config, loadError]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const result = await api<{ reference: string }>(`/public/forms/${publicId}`, {
        method: 'POST',
        body: {
          name: values.name, email: values.email, phone: values.phone,
          company: values.company, message: values.message, consent, website: values.website,
        },
      });
      setReference(result.reference);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Your enquiry could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public capture-page">
      <div className="capture-card">
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 22 }}>
          <div className="brand-mark" style={{ background: '#12202f', color: '#f0a63a' }}><Icon name="pulse" size={17} /></div>
          <span className="brand-name" style={{ color: '#12202f' }}>LeadPulse</span>
        </Link>
        <div className="card card-pad">
          {!config && !loadError && <Spinner label="Loading form" />}
          {loadError && <ErrorNotice message={loadError} />}
          {reference ? (
            <div style={{ textAlign: 'center', padding: '18px 0' }}>
              <div className="empty-icon" style={{ background: 'var(--success-soft)', color: 'var(--success)', borderColor: '#c6e3de' }}><Icon name="check" size={26} /></div>
              <h3>Enquiry recorded</h3>
              <p className="muted small" style={{ marginTop: 8 }}>Your reference is <span className="mono">{reference}</span>. No automated message was sent — a person will follow up.</p>
              <p className="muted small" style={{ marginTop: 18 }}><Link to="/">Back to LeadPulse</Link></p>
            </div>
          ) : config && (
            <form onSubmit={(e) => void submit(e)}>
              <h2>{config.form.title}</h2>
              {config.form.intro && <p className="muted small" style={{ margin: '8px 0 22px' }}>{config.form.intro}</p>}
              {error && <div style={{ marginBottom: 16 }}><ErrorNotice message={error} /></div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {config.form.fields.map((field) => (
                  <Field key={field} label={LABELS[field] || field} htmlFor={`f-${field}`}>
                    {field === 'message' ? (
                      <textarea id={`f-${field}`} className="textarea" value={values[field]}
                        onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))} />
                    ) : (
                      <input id={`f-${field}`} className="input" type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                        required={field === 'name' || (field === 'email' && !values.phone) || (field === 'phone' && !values.email)}
                        value={values[field] || ''}
                        onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                        autoComplete={field === 'name' ? 'name' : field === 'email' ? 'email' : undefined} />
                    )}
                  </Field>
                ))}
                {/* Honeypot: hidden from people, attractive to naive bots. */}
                <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
                  <label htmlFor="f-website">Website</label>
                  <input id="f-website" tabIndex={-1} autoComplete="off" value={values.website}
                    onChange={(e) => setValues((v) => ({ ...v, website: e.target.value }))} />
                </div>
              </div>
              <p className="hint" style={{ marginTop: 14 }}>Provide an email address or a phone number so we can reply.</p>
              <label className="checkbox-row" style={{ marginTop: 16 }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
                <span>{config.form.consentNotice}</span>
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy || !consent} style={{ marginTop: 20, width: '100%' }}>
                {busy ? 'Sending…' : 'Send enquiry'} {!busy && <Icon name="arrow" size={15} />}
              </button>
              <p className="hint" style={{ marginTop: 12, textAlign: 'center' }}>Powered by LeadPulse · submissions are rate-limited to prevent abuse.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

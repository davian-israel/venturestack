'use client';
import { use, useEffect, useState } from 'react';
import { authed, session } from '@/lib/api';

interface Field { key: string; label: string; type: 'text' | 'textarea' | 'url' | 'list' | 'secret'; required?: boolean }
interface Data {
  product: { name: string; slug: string };
  fields: Field[];
  config: Record<string, any>;
  consentRequired: string | null;
  consentAt: string | null;
  ready: boolean;
  deliveries: { id: string; title: string; body: any; created_at: string }[];
}

const CONSENT_TEXT: Record<string, string> = {
  'voice-consent': 'I confirm I am the person whose voice will be cloned (or hold their written authority), and I consent to my voice being cloned solely to produce Spanish versions of my own content.',
  'audit-authorization': 'I own or am authorised to grant access to this repository and authorise a code-level security review of it. No live systems will be tested.',
  'data-processing': 'I agree that my data and connected accounts are processed solely to deliver this service, and can be deleted on request or 30 days after cancellation.',
};

export default function ProductPortal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<number>(0);
  const [form, setForm] = useState<Record<string, string>>({});
  const [consentName, setConsentName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [answer, setAnswer] = useState<any>(null);

  async function load() {
    const r = await authed<Data>(`/portal/${slug}`);
    setStatus(r.status);
    if (r.data && r.status === 200) {
      setData(r.data);
      setForm(Object.fromEntries(r.data.fields.map((f) => [f.key, Array.isArray(r.data!.config[f.key]) ? r.data!.config[f.key].join(', ') : (r.data!.config[f.key] ?? '')])));
    }
  }
  useEffect(() => { if (!session.get()) window.location.href = '/login'; else load(); }, []);

  if (status === 401) return <p style={{ marginTop: 48 }}><a href="/login">Please sign in.</a></p>;
  if (status === 403) return (
    <>
      <h1>This system isn't active on your account</h1>
      <p className="notice">Your subscription is inactive or a payment failed. Reactivate to continue.</p>
      <p><a className="btn" href={`/p/${slug}`}>Subscribe</a> <a className="btn secondary" href="/portal">Back</a></p>
    </>
  );
  if (!data) return <p style={{ marginTop: 48 }}>Loading…</p>;

  return (
    <>
      <h1>{data.product.name}</h1>
      {data.ready ? <p className="ok">Live — results arrive by email and below.</p> : <p className="notice">Finish setup below and we'll start right away.</p>}

      <h2>Setup</h2>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await authed<{ ready: boolean }>(`/portal/${slug}/onboarding`, { method: 'PUT', body: JSON.stringify({ config: form, consentName: consentName || undefined }) });
        setMsg(r.data?.ready ? 'Saved — your first run is queued.' : 'Saved. Some required items are still missing.');
        load();
      }}>
        {data.fields.map((f) => (
          <div key={f.key}>
            <label htmlFor={f.key}>{f.label}{f.required ? ' *' : ''}</label>
            {f.type === 'textarea'
              ? <textarea id={f.key} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              : <input id={f.key} type={f.type === 'secret' ? 'password' : f.type === 'url' ? 'url' : 'text'} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
          </div>
        ))}
        {data.consentRequired && !data.consentAt && (
          <div className="card" style={{ marginTop: 20 }}>
            <p style={{ margin: 0 }}>{CONSENT_TEXT[data.consentRequired]}</p>
            <label htmlFor="consent">Type your full name to sign</label>
            <input id="consent" value={consentName} onChange={(e) => setConsentName(e.target.value)} />
          </div>
        )}
        {data.consentAt && <p className="muted">Consent signed {new Date(data.consentAt).toLocaleString()}.</p>}
        <p><button className="btn" type="submit">Save</button> {data.ready && <button type="button" className="btn secondary" onClick={async () => { await authed(`/portal/${slug}/run`, { method: 'POST' }); setMsg('Run queued — check back in a few minutes.'); }}>Run now</button>}</p>
        {msg && <p className="ok">{msg}</p>}
      </form>

      {slug === 'digital-archive' && data.ready && (
        <>
          <h2>Ask your files</h2>
          <form onSubmit={async (e) => { e.preventDefault(); const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value; setAnswer({ loading: true }); const r = await authed(`/portal/${slug}/ask`, { method: 'POST', body: JSON.stringify({ question: q }) }); setAnswer(r.data); }}>
            <input name="q" placeholder="e.g. What was the lease term for 14 High St in 2021?" />
          </form>
          {answer?.answer && <div className="card" style={{ marginTop: 12 }}><p style={{ whiteSpace: 'pre-wrap' }}>{answer.answer}</p>{answer.documents?.map((d: any) => <div key={d.id}><a href={d.url} target="_blank">{d.title}</a></div>)}</div>}
        </>
      )}

      <h2>Deliveries</h2>
      {data.deliveries.length === 0 && <p className="muted">Nothing yet.</p>}
      {data.deliveries.map((d) => (
        <details key={d.id} className="card" style={{ marginBottom: 10 }}>
          <summary><b>{d.title}</b> <span className="muted">· {new Date(d.created_at).toLocaleString()}</span></summary>
          {Array.isArray(d.body.threads) ? d.body.threads.map((t: any) => (
            <div className="thread" key={t.id}><a href={t.url} target="_blank">{t.title}</a> <span className="muted">({t.community})</span><blockquote>{t.reply}</blockquote></div>
          )) : <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{JSON.stringify(d.body, null, 2)}</pre>}
        </details>
      ))}
    </>
  );
}

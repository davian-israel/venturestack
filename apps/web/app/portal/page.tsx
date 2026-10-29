'use client';
import { useEffect, useState } from 'react';
import { bySlug } from '@vs/catalog';
import { authed, session } from '@/lib/api';

interface Me { tenant: { email: string }; entitlements: { product_slug: string; status: string; service_url: string | null; grace_until: string | null }[] }

export default function Portal() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'out' | 'in'>('loading');
  useEffect(() => {
    if (!session.get()) return setState('out');
    authed<Me>('/me').then(({ status, data }) => {
      if (status === 401) { session.clear(); return setState('out'); }
      setMe(data); setState('in');
    });
  }, []);
  if (state === 'loading') return <p style={{ marginTop: 48 }}>Loading…</p>;
  if (state === 'out') return <><h1>Client portal</h1><p><a className="btn" href="/login">Sign in</a></p></>;
  return (
    <>
      <h1>Your systems</h1>
      <p className="muted">{me?.tenant.email}</p>
      <div className="grid">
        {me?.entitlements.map((e) => {
          const p = bySlug(e.product_slug);
          return (
            <a key={e.product_slug} className="card" href={`/portal/${e.product_slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <h3>{p?.name}</h3>
              <p>Status: <b>{e.status}</b>{e.status === 'past_due' && e.grace_until ? ` — update your card before ${new Date(e.grace_until).toLocaleDateString()}` : ''}</p>
            </a>
          );
        })}
        {me?.entitlements.length === 0 && <p>No active systems yet. <a href="/#systems">Browse the systems.</a></p>}
      </div>
      <button className="btn secondary" onClick={async () => { const { data } = await authed<{ url: string }>('/billing/portal', { method: 'POST' }); if (data?.url) window.location.href = data.url; }}>
        Billing, invoices &amp; cancellation
      </button>{' '}
      <button className="btn secondary" onClick={() => { session.clear(); window.location.href = '/'; }}>Sign out</button>
    </>
  );
}

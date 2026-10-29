'use client';
import './admin.css';
import { useEffect, useState } from 'react';
import { API } from '@/lib/api';
import Dashboard, { Metrics } from './Dashboard';

const KEY = 'vs_admin';
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* unavailable */ } },
  clear: () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Metrics | null>(null);
  const [state, setState] = useState<'loading' | 'signin' | 'sent' | 'ready' | 'error'>('loading');

  async function load(t: string) {
    const r = await fetch(`${API}/admin/metrics`, { headers: { Authorization: `Bearer ${t}` } });
    if (r.status === 401) { store.clear(); setState('signin'); return; }
    if (!r.ok) { setState('error'); return; }
    setData(await r.json());
    setState('ready');
  }

  useEffect(() => {
    const magic = new URLSearchParams(window.location.search).get('token');
    (async () => {
      let t = store.get();
      if (magic) {
        const r = await fetch(`${API}/admin/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: magic }) });
        if (r.ok) { t = (await r.json()).session as string; store.set(t); }
        window.history.replaceState(null, '', '/admin');
      }
      if (!t) return setState('signin');
      setToken(t);
      await load(t);
    })();
    const id = setInterval(() => { const t = store.get(); if (t) load(t); }, 5 * 60_000); // refresh every 5 min
    return () => clearInterval(id);
  }, []);

  if (state === 'loading') return <p style={{ marginTop: 48 }}>Loading dashboard…</p>;
  if (state === 'error') return <p className="notice" style={{ marginTop: 48 }}>The API is not reachable right now.</p>;
  if (state === 'signin' || state === 'sent') {
    return (
      <div style={{ maxWidth: 440 }}>
        <h1>Business dashboard</h1>
        {state === 'sent' ? (
          <p className="ok">A sign-in link has been sent to the owner's email address.</p>
        ) : (
          <>
            <p className="lead">Owner only. A sign-in link goes to the owner email set on the server.</p>
            <button className="btn" onClick={async () => { await fetch(`${API}/admin/magic`, { method: 'POST' }); setState('sent'); }}>Email me a sign-in link</button>
          </>
        )}
      </div>
    );
  }
  return <Dashboard data={data!} token={token!} reload={() => load(token!)} />;
}

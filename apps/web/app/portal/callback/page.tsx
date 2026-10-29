'use client';
import { useEffect, useState } from 'react';
import { API, session } from '@/lib/api';

export default function Callback() {
  const [error, setError] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    fetch(`${API}/auth/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { session.set(j.session); window.location.replace('/portal'); })
      .catch(() => setError(true));
  }, []);
  return error ? <p className="notice" style={{ marginTop: 48 }}>That link has expired. <a href="/login">Get a new one.</a></p> : <p style={{ marginTop: 48 }}>Signing you in…</p>;
}

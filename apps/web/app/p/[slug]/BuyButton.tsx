'use client';
import { useState } from 'react';
import { API } from '@/lib/api';

export default function BuyButton({ slug, label, oneOff, secondary }: { slug: string; label: string; oneOff?: boolean; secondary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/checkout/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oneOff: !!oneOff }),
      });
      const j = await res.json();
      if (!res.ok || !j.url) throw new Error(j.message ?? 'Checkout is not available right now.');
      window.location.href = j.url;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <>
      <button className={`btn${secondary ? ' secondary' : ''}`} onClick={go} disabled={busy}>{busy ? 'Opening checkout…' : label}</button>
      {error && <p className="notice" style={{ marginTop: 10 }}>{error}</p>}
    </>
  );
}

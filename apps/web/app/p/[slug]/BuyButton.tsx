'use client';
import { useState } from 'react';
import { API } from '@/lib/api';

/** Carries the prospect ref and channel from the landing URL into Stripe metadata for attribution. */
function attribution() {
  const q = new URLSearchParams(window.location.search);
  return { ref: q.get('ref') ?? undefined, source: q.get('utm_source') ?? undefined };
}

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
        body: JSON.stringify({ oneOff: !!oneOff, ...attribution() }),
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

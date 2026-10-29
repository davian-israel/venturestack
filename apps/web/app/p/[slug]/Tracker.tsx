'use client';
import { useEffect } from 'react';
import { API } from '@/lib/api';

/** Counts a landing-page view (no cookies, no personal data). */
export default function Tracker({ product }: { product: string }) {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    fetch(`${API}/t`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'page_view', product, ref: q.get('ref') ?? undefined, source: q.get('utm_source') ?? undefined }),
      keepalive: true,
    }).catch(() => undefined);
  }, [product]);
  return null;
}

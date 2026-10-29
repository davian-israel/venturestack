'use client';
import { useState } from 'react';
import { API } from '@/lib/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <div style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      {sent ? (
        <p className="ok">If that email has an account, a sign-in link is on its way. It works for 15 minutes.</p>
      ) : (
        <form onSubmit={async (e) => { e.preventDefault(); await fetch(`${API}/auth/magic`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); setSent(true); }}>
          <label htmlFor="email">Email used at checkout</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <p><button className="btn" type="submit">Email me a link</button></p>
        </form>
      )}
    </div>
  );
}

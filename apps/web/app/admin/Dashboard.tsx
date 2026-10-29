'use client';
import { useState } from 'react';
import { usd } from '@vs/catalog';
import { API } from '@/lib/api';
import { BarChart, LineChart } from './charts';

export interface Metrics {
  asOf: string;
  target: { monthlyRevenueCents: number; recurringCents: number; date: string };
  kpis: {
    mrrCents: number; runRateRevenueCents: number; cashMtdCents: number; costsMtdCents: number; profitMtdCents: number;
    runRateCostsCents: number; runRateProfitCents: number; marginPct: number | null; payingClients: number;
    signups7: number; signups30: number; churn30: number; churnRatePct: number; progressPct: number;
  };
  pace: { gapCents: number; clientsNeeded: number; requiredPerWeek: number; actualPerWeek: number; weeksAtCurrentPace: number | null; status: string };
  products: {
    slug: string; name: string; wave: number; promoted: boolean; paused: boolean; clients: number; targetClients: number;
    mrrCents: number; targetMrrCents: number; revenue30Cents: number; cost30Cents: number; profit30Cents: number; signups30: number; churn30: number;
  }[];
  trend: { day: string; mrr_cents: number }[];
  weeklyRevenue: { week: string; cents: number }[];
  funnel: { slug: string; name: string; stages: { stage: string; n: number }[]; bounced: number; unsubscribed: number; pageViews: number }[];
  variants: { id: string; product_slug: string; subject: string; status: string; source: string; sends: number; opens: number; replies: number }[];
  costBreakdown: { kind: string; cents: number }[];
  runs: { started: string; minutes: number | null; stats: Record<string, any> }[];
  log: { week: string; kind: string; product_slug: string | null; summary: string }[];
  settings: { dailySendCap: number; maxWave: number; paused: string[]; targetDate: string; fixedMonthlyCostCents: number; weights: Record<string, number> };
  integrations: Record<string, boolean>;
}

const STATUS: Record<string, { label: string; color: string; icon: string }> = {
  hit: { label: 'Target hit', color: 'var(--good)', icon: '✓' },
  on_track: { label: 'On track', color: 'var(--good)', icon: '✓' },
  behind: { label: 'Behind', color: 'var(--warning)', icon: '!' },
  off_track: { label: 'Off track', color: 'var(--critical)', icon: '✕' },
};
const COST_LABEL: Record<string, string> = {
  ai: 'AI tokens (delivery)', ai_marketing: 'AI tokens (marketing)', prospecting: 'Prospect data',
  stripe_fees_est: 'Stripe fees (est.)', delivery_est: 'Hosting & delivery (est.)', fixed: 'Fixed tools & infra',
};
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : '—');

function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.behind;
  return <span className="badge"><i style={{ background: s.color }}>{s.icon}</i>{s.label}</span>;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="tile"><div className="label">{label}</div><div className="value">{value}</div>{note && <div className="note">{note}</div>}</div>;
}

function DataToggle({ rows, cols }: { rows: (string | number)[][]; cols: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Hide data' : 'Show data'}</button>
      {open && (
        <div className="scroll"><table className="data" style={{ marginTop: 8 }}>
          <thead><tr>{cols.map((c, i) => <th key={c} className={i ? 'num' : ''}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? 'num' : ''}>{v}</td>)}</tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

export default function Dashboard({ data: m, token, reload }: { data: Metrics; token: string; reload: () => void }) {
  const promoted = m.funnel.filter((f) => m.products.find((p) => p.slug === f.slug)?.promoted);
  const [funnelSlug, setFunnelSlug] = useState(promoted[0]?.slug ?? m.funnel[0]?.slug);
  const [msg, setMsg] = useState<string | null>(null);
  const k = m.kpis;
  const api = (path: string, method: string, body?: unknown) =>
    fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const setPaused = async (slug: string, pause: boolean) => {
    const paused = pause ? [...m.settings.paused, slug] : m.settings.paused.filter((s) => s !== slug);
    await api('/admin/settings', 'PUT', { paused });
    reload();
  };
  const raw = m.funnel.find((f) => f.slug === funnelSlug) ?? m.funnel[0];
  // Nested path to purchase. Replies are a side outcome (people also buy straight from the proof page), shown as a rate.
  const ORDER = ['Prospects found', 'Proof built', 'Emailed', 'Opened', 'Proof page visits', 'Checkout started', 'Paid'];
  const funnel = { ...raw, stages: ORDER.map((st) => raw.stages.find((x) => x.stage === st) ?? { stage: st, n: 0 }) };
  const replied = raw.stages.find((x) => x.stage === 'Replied')?.n ?? 0;
  const emailed = raw.stages.find((x) => x.stage === 'Emailed')?.n ?? 0;
  const fmax = Math.max(1, ...funnel.stages.map((s) => s.n));
  const weeks = m.log.reduce<Record<string, typeof m.log>>((acc, l) => ((acc[l.week] ??= []).push(l), acc), {});
  const costMax = Math.max(1, ...m.costBreakdown.map((c) => c.cents));
  const costTotal = m.costBreakdown.reduce((s, c) => s + c.cents, 0);

  return (
    <div className="viz-root">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Business dashboard</h1>
          <div className="sub">Updated {new Date(m.asOf).toLocaleString('en-GB')} · refreshes every 5 minutes</div>
        </div>
        <button className="btn secondary" onClick={async () => { await api('/admin/optimise', 'POST'); setMsg('Weekly review queued — results appear below and in your inbox in a few minutes.'); }}>Run weekly review now</button>
      </div>
      {msg && <p className="ok" style={{ marginTop: 12 }}>{msg}</p>}

      {/* Headline: progress to target */}
      <div className="hero">
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div className="sub">Monthly revenue run-rate vs target ({usd(m.target.monthlyRevenueCents)} by {new Date(m.target.date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })})</div>
          <Badge status={m.pace.status} />
        </div>
        <div className="big">{usd(k.runRateRevenueCents)}<span className="sub" style={{ fontSize: 18, fontWeight: 500 }}> /mo · {k.progressPct}%</span></div>
        <div className="meter" role="meter" aria-valuenow={k.progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to revenue target"><div style={{ width: `${Math.min(100, k.progressPct)}%` }} /></div>
        <div className="sub">
          {m.pace.status === 'hit' ? 'Target reached.' : <>Gap {usd(m.pace.gapCents)}/mo ≈ {m.pace.clientsNeeded} more clients. Need <b>{m.pace.requiredPerWeek}</b> new clients/week; averaging <b>{m.pace.actualPerWeek}</b>{m.pace.weeksAtCurrentPace ? ` (≈${m.pace.weeksAtCurrentPace} weeks at this pace)` : ''}.</>}
        </div>
      </div>

      <div className="tiles">
        <Tile label="MRR" value={usd(k.mrrCents)} note={`target ${usd(m.target.recurringCents)}`} />
        <Tile label="Cash collected this month" value={usd(k.cashMtdCents)} />
        <Tile label="Profit (run-rate)" value={usd(k.runRateProfitCents)} note={k.marginPct === null ? 'no revenue yet' : `${k.marginPct}% margin · costs ${usd(k.runRateCostsCents)}/mo`} />
        <Tile label="Profit this month" value={usd(k.profitMtdCents)} note={`costs so far ${usd(k.costsMtdCents)}`} />
        <Tile label="Paying clients" value={String(k.payingClients)} />
        <Tile label="New sign-ups" value={String(k.signups7)} note={`last 7 days · ${k.signups30} in 30`} />
        <Tile label="Churn (30 days)" value={String(k.churn30)} note={`${k.churnRatePct}% of clients`} />
      </div>

      <div className="two wide" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>MRR over time</h2>
          <LineChart points={m.trend.map((t) => ({ x: t.day, y: t.mrr_cents }))} target={m.target.recurringCents} targetLabel="MRR target" />
          <DataToggle cols={['Day', 'MRR']} rows={m.trend.map((t) => [t.day, usd(t.mrr_cents)])} />
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Cash collected per week</h2>
          <BarChart bars={m.weeklyRevenue.map((w) => ({ x: w.week, y: w.cents }))} />
          <DataToggle cols={['Week of', 'Collected']} rows={m.weeklyRevenue.map((w) => [w.week, usd(w.cents)])} />
        </div>
      </div>

      <h2>Products</h2>
      <div className="panel scroll">
        <table className="data">
          <thead><tr><th>Product</th><th>Outreach</th><th>Clients / target</th><th className="num">MRR</th><th className="num">Revenue 30d</th><th className="num">Cost 30d</th><th className="num">Profit 30d</th><th className="num">Sign-ups 30d</th><th className="num">Churn 30d</th><th className="num">Daily sends</th></tr></thead>
          <tbody>
            {m.products.map((p) => (
              <tr key={p.slug}>
                <td><b>{p.name}</b></td>
                <td>
                  {p.paused ? <span className="badge"><i style={{ background: 'var(--critical)' }}>❚❚</i>Paused</span>
                    : p.promoted ? <span className="badge"><i style={{ background: 'var(--good)' }}>▶</i>Promoting</span>
                    : <span className="sub">Wave {p.wave} — not yet</span>}
                  {p.promoted || p.paused ? <> <button className="linkbtn" onClick={() => setPaused(p.slug, !p.paused)}>{p.paused ? 'Resume' : 'Pause'}</button></> : null}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{p.clients} / {p.targetClients}<span className="mini" aria-hidden><span style={{ width: `${Math.min(100, (p.clients / p.targetClients) * 100)}%` }} /></span></td>
                <td className="num">{usd(p.mrrCents)}</td>
                <td className="num">{usd(p.revenue30Cents)}</td>
                <td className="num">{usd(p.cost30Cents)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{p.profit30Cents < 0 ? '−' : ''}{usd(Math.abs(p.profit30Cents))}</td>
                <td className="num">{p.signups30}</td>
                <td className="num">{p.churn30}</td>
                <td className="num">{p.promoted ? Math.round(m.settings.dailySendCap * (m.settings.weights[p.slug] ?? 1 / Math.max(1, m.products.filter((x) => x.promoted).length))) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="two" style={{ marginTop: 8 }}>
        <div>
          <h2>Campaign funnel (last 28 days)</h2>
          <div className="panel">
            <div className="chips" role="group" aria-label="Product">
              {m.funnel.map((f) => <button key={f.slug} className="chip" aria-pressed={f.slug === funnelSlug} onClick={() => setFunnelSlug(f.slug)}>{f.name}</button>)}
            </div>
            {funnel.stages.map((s, i) => (
              <div key={s.stage}>
                {i > 0 && <div className="fn-conv">{s.n <= funnel.stages[i - 1].n ? `↓ ${pct(s.n, funnel.stages[i - 1].n)}` : '↑ includes visits from forwarded links'}</div>}
                <div className="fn-row">
                  <span>{s.stage}</span>
                  <div><div className="fn-bar" style={{ width: `${(s.n / fmax) * 100}%` }} title={`${s.stage}: ${s.n}`} /></div>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.n.toLocaleString()}</span>
                </div>
              </div>
            ))}
            <div className="sub" style={{ marginTop: 10 }}><b>Replies {replied}</b> ({pct(replied, emailed)} of emailed) · Bounced {funnel.bounced} · Unsubscribed {funnel.unsubscribed} · Landing-page views {funnel.pageViews}</div>
          </div>
        </div>
        <div>
          <h2>Costs (monthly run-rate)</h2>
          <div className="panel">
            {m.costBreakdown.map((c) => (
              <div className="fn-row" key={c.kind} style={{ gridTemplateColumns: '170px 1fr 80px' }}>
                <span>{COST_LABEL[c.kind] ?? c.kind}</span>
                <div><div className="fn-bar" style={{ width: `${(c.cents / costMax) * 100}%`, opacity: c.cents ? 1 : 0 }} /></div>
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{usd(c.cents)}</span>
              </div>
            ))}
            <div className="sub" style={{ marginTop: 10 }}>Total {usd(costTotal)}/mo. AI and prospecting are measured; fees and hosting are estimates.</div>
          </div>
        </div>
      </div>

      <h2>Subject-line tests</h2>
      <div className="panel scroll">
        <table className="data">
          <thead><tr><th>Product</th><th>Subject</th><th>Status</th><th className="num">Sent</th><th className="num">Open rate</th><th className="num">Reply rate</th></tr></thead>
          <tbody>
            {m.variants.length === 0 && <tr><td colSpan={6} className="sub">The first variants appear after the first marketing run.</td></tr>}
            {m.variants.map((v) => (
              <tr key={v.id} style={{ opacity: v.status === 'retired' ? 0.6 : 1 }}>
                <td>{m.products.find((p) => p.slug === v.product_slug)?.name}</td>
                <td>{v.subject}{v.source === 'optimiser' ? <span className="sub"> · AI challenger</span> : ''}</td>
                <td>{v.status === 'active' ? 'Testing' : 'Retired'}</td>
                <td className="num">{v.sends}</td>
                <td className="num">{pct(v.opens, v.sends)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{pct(v.replies, v.sends)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Weekly reviews &amp; automatic changes</h2>
      <div className="panel">
        {Object.keys(weeks).length === 0 && <p className="sub">The first review runs on Monday at 05:00 (London).</p>}
        {Object.entries(weeks).map(([week, items]) => (
          <div key={week} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 650, margin: '6px 0' }}>Week of {new Date(week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            {items.map((l, i) => (
              <div className="log-item" key={i}>
                <span>{l.kind === 'review' ? <span className="badge"><i style={{ background: 'var(--series-1)' }}>≡</i>Review</span>
                  : l.kind === 'change' ? <span className="badge"><i style={{ background: 'var(--good)' }}>↻</i>Changed</span>
                  : <span className="badge"><i style={{ background: 'var(--warning)' }}>!</i>Your call</span>}</span>
                <span>{l.summary}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="two" style={{ marginTop: 8 }}>
        <div>
          <h2>03:00 marketing runs</h2>
          <div className="panel scroll">
            <table className="data">
              <thead><tr><th>Started</th><th className="num">Min</th><th className="num">Prospects</th><th className="num">Emailed</th><th className="num">Posts</th><th className="num">Errors</th></tr></thead>
              <tbody>
                {m.runs.length === 0 && <tr><td colSpan={6} className="sub">No runs yet.</td></tr>}
                {m.runs.map((r) => (
                  <tr key={r.started}><td>{r.started}</td><td className="num">{r.minutes ?? '—'}</td><td className="num">{r.stats.prospects_added ?? 0}</td><td className="num">{r.stats.enrolled ?? 0}</td><td className="num">{(r.stats.social_posts ?? 0) + (r.stats.blog_posts ?? 0)}</td><td className="num">{r.stats.errors?.length ?? 0}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2>Settings</h2>
          <form className="panel" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await api('/admin/settings', 'PUT', {
              targetDate: f.get('targetDate'), fixedMonthlyCostUsd: Number(f.get('fixed')), maxWave: Number(f.get('wave')), dailySendCap: Number(f.get('cap')),
            });
            setMsg('Settings saved.'); reload();
          }}>
            <div className="form-row">
              <div><label htmlFor="targetDate">Target date</label><input id="targetDate" name="targetDate" type="date" defaultValue={m.settings.targetDate} /></div>
              <div><label htmlFor="fixed">Fixed costs ($/mo)</label><input id="fixed" name="fixed" type="number" min="0" defaultValue={m.settings.fixedMonthlyCostCents / 100} /></div>
              <div><label htmlFor="wave">Products promoted</label>
                <select id="wave" name="wave" defaultValue={m.settings.maxWave}>
                  <option value={1}>Wave 1 — Agent Reach only</option><option value={2}>Waves 1–2 (5 products)</option><option value={3}>All 8</option>
                </select></div>
              <div><label htmlFor="cap">New prospects / day</label><input id="cap" name="cap" type="number" min="10" defaultValue={m.settings.dailySendCap} /></div>
            </div>
            <p style={{ marginBottom: 0 }}><button className="btn" type="submit">Save</button></p>
            <p className="sub">The weekly review can still adjust wave, send cap and split within safe limits; every change is logged above.</p>
          </form>
          <h2>Connections</h2>
          <div className="chips">
            {Object.entries(m.integrations).map(([name, on]) => (
              <span key={name} className="badge"><i style={{ background: on ? 'var(--good)' : 'var(--critical)' }}>{on ? '✓' : '✕'}</i>{name}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { ask } from '../../ai/claude';
import { esc } from '../../mail/mailer';
import { ProductHandler } from '../types';

/**
 * Executive KPI Dashboard on the client's own Metabase. Setup (connecting QuickBooks/CRM/ads and
 * building the 5–10 cards) happens in their Metabase; every Monday this handler reads each card's
 * current value through the Metabase API and writes the briefing email.
 */
async function metabaseSession(url: string, user: string, password: string): Promise<string> {
  const res = await fetch(`${url}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password }),
  });
  if (!res.ok) throw new Error(`Metabase login ${res.status}`);
  return ((await res.json()) as any).id;
}

export const kpiDashboards: ProductHandler = {
  slug: 'kpi-dashboards',
  schedule: '0 7 * * 1', // Monday 07:00 London
  onboardingFields: [
    { key: 'kpis', label: 'The 5–10 numbers you check every Monday', type: 'list', required: true },
    { key: 'sources', label: 'Where they live (QuickBooks, HubSpot, Google Ads...)', type: 'list', required: true },
    { key: 'metabaseUser', label: 'Metabase admin email (set during setup)', type: 'text' },
    { key: 'metabasePassword', label: 'Metabase admin password', type: 'secret' },
    { key: 'dashboardId', label: 'Dashboard ID (set during setup)', type: 'text' },
  ],
  async run(ctx) {
    if (!ctx.serviceUrl || !ctx.config.dashboardId || !ctx.config.metabaseUser) return null; // setup not finished
    const token = await metabaseSession(ctx.serviceUrl, ctx.config.metabaseUser, ctx.config.metabasePassword);
    const h = { 'X-Metabase-Session': token, 'Content-Type': 'application/json' };
    const dash = (await (await fetch(`${ctx.serviceUrl}/api/dashboard/${ctx.config.dashboardId}`, { headers: h })).json()) as any;

    const values: { name: string; value: unknown }[] = [];
    for (const dc of (dash.dashcards ?? dash.ordered_cards ?? []).slice(0, 12)) {
      if (!dc.card?.id) continue;
      const r = await fetch(`${ctx.serviceUrl}/api/card/${dc.card.id}/query`, { method: 'POST', headers: h });
      if (!r.ok) continue;
      const j = (await r.json()) as any;
      values.push({ name: dc.card.name, value: j.data?.rows?.slice(0, 12) });
    }

    const briefing = await ask(
      'Write a Monday briefing for a business owner from these KPI results: one line per KPI with the number and what changed, then the 2 things to look at this week. Plain English, under 200 words.',
      JSON.stringify(values),
      800,
    );
    return {
      title: `Monday KPI briefing — ${new Date().toLocaleDateString('en-GB')}`,
      body: { values, briefing },
      emailHtml: `<h2>Your Monday numbers</h2><pre style="white-space:pre-wrap">${esc(briefing)}</pre><p><a href="${esc(ctx.serviceUrl)}/dashboard/${esc(ctx.config.dashboardId)}">Open dashboard</a></p>`,
    };
  },
};

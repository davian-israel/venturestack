import { ask, askJson } from '../../ai/claude';
import { esc } from '../../mail/mailer';
import { ProductHandler } from '../types';

/**
 * AI Sales Department. On first run it generates a Claude skills pack from the client's playbook
 * (installed on their own Claude Team/Enterprise plan). Every weekday it writes call-prep briefs for
 * deals with activity today; on Mondays it adds a pipeline summary. CRM: HubSpot (private app token) or Close (API key).
 */
async function hubspotDeals(token: string) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'hs_is_closed', operator: 'EQ', value: 'false' }] }],
      properties: ['dealname', 'amount', 'dealstage', 'closedate', 'notes_next_activity_date', 'hs_lastmodifieddate', 'description'],
      limit: 100,
    }),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}`);
  return ((await res.json()) as any).results.map((d: any) => ({ id: d.id, ...d.properties }));
}

async function closeDeals(apiKey: string) {
  const res = await fetch('https://api.close.com/api/v1/opportunity/?status_type=active&_limit=100', {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` },
  });
  if (!res.ok) throw new Error(`Close ${res.status}`);
  return ((await res.json()) as any).data.map((o: any) => ({
    id: o.id,
    dealname: o.lead_name,
    amount: o.value ? o.value / 100 : null,
    dealstage: o.status_label,
    closedate: o.date_won ?? o.expected_date,
    notes_next_activity_date: o.expected_date,
    description: o.note,
  }));
}

export const salesDept: ProductHandler = {
  slug: 'sales-dept',
  schedule: '30 6 * * 1-5', // weekdays 06:30 London
  onboardingFields: [
    { key: 'crm', label: 'CRM (hubspot or close)', type: 'text', required: true },
    { key: 'crmToken', label: 'HubSpot private-app token or Close API key', type: 'secret', required: true },
    { key: 'playbook', label: 'Paste your sales playbook / ICP / objection handling', type: 'textarea', required: true },
  ],
  async run(ctx) {
    const deals = ctx.config.crm === 'close' ? await closeDeals(ctx.config.crmToken) : await hubspotDeals(ctx.config.crmToken);
    const today = new Date().toISOString().slice(0, 10);
    const isMonday = new Date().getDay() === 1;
    const configPatch: Record<string, unknown> = {};

    let skillsPack: Record<string, string> | undefined;
    if (!ctx.config.skillsPackGenerated) {
      skillsPack = await askJson<Record<string, string>>(
        'You write Claude Agent Skills (SKILL.md files with YAML frontmatter: name, description) for a B2B sales team.',
        `Create 3 skills as a JSON object of {"<skill-name>/SKILL.md": "<file content>"}: call-prep (2-minute brief), follow-up-email (draft from call notes), pipeline-summary (weekly). Ground them in this playbook:\n${ctx.config.playbook}`,
        6000,
      );
      configPatch.skillsPackGenerated = true;
    }

    const todays = deals.filter((d: any) => (d.notes_next_activity_date ?? '').slice(0, 10) === today).slice(0, 10);
    const briefs: { deal: string; brief: string }[] = [];
    for (const d of todays) {
      briefs.push({
        deal: d.dealname,
        brief: await ask(
          `Write a 2-minute call-prep brief (max 150 words): context, likely objections, the one question to ask, next step. Use this playbook:\n${ctx.config.playbook}`,
          JSON.stringify(d),
          500,
        ),
      });
    }

    let summary: string | undefined;
    if (isMonday) {
      summary = await ask(
        'Write a Monday pipeline summary for a VP of Sales: total open value, deals at risk (stale or slipping close dates), top 5 to push this week. Under 250 words, plain text.',
        JSON.stringify(deals.slice(0, 100)),
        900,
      );
    }
    if (!briefs.length && !summary && !skillsPack) return null;

    const html =
      (summary ? `<h2>Pipeline this week</h2><pre style="white-space:pre-wrap">${esc(summary)}</pre>` : '') +
      (briefs.length ? `<h2>Today's call prep</h2>` + briefs.map((b) => `<h3>${esc(b.deal)}</h3><pre style="white-space:pre-wrap">${esc(b.brief)}</pre>`).join('') : '') +
      (skillsPack ? `<h2>Your skills pack is ready</h2><p>Download it from your portal and add it to your Claude workspace.</p>` : '');
    return {
      title: summary ? 'Monday pipeline + call prep' : skillsPack ? 'Skills pack ready' : `Call prep for ${briefs.length} deals`,
      body: { briefs, summary, skillsPack, configPatch },
      emailHtml: html,
    };
  },
};

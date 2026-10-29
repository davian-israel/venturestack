import { ask } from '../../ai/claude';
import { esc } from '../../mail/mailer';
import { ProductHandler, ProductContext } from '../types';
import { aging, daysOverdue, OpenInvoice, reminderDue } from './aging';

/**
 * AR Recovery on the client's own Invoice Ninja. Invoice Ninja sends the payment-link reminder
 * emails itself; this handler decides which invoice gets which step each day, drafts escalation
 * notices with Claude for 30+ days, and sends the weekly aging report on Mondays.
 */
const headers = (ctx: ProductContext) => ({ 'X-API-TOKEN': ctx.config.ninjaToken, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' });

async function openInvoices(ctx: ProductContext): Promise<OpenInvoice[]> {
  const res = await fetch(`${ctx.serviceUrl}/api/v1/invoices?client_status=unpaid,overdue&per_page=500&include=client`, { headers: headers(ctx) });
  if (!res.ok) throw new Error(`Invoice Ninja ${res.status}`);
  return ((await res.json()) as any).data.map((i: any) => ({
    id: i.id,
    number: i.number,
    client: i.client?.display_name ?? i.client_id,
    balance: Number(i.balance),
    dueDate: i.due_date,
  }));
}

export const arRecovery: ProductHandler = {
  slug: 'ar-recovery',
  schedule: '0 8 * * 1-5', // weekdays 08:00 London
  onboardingFields: [
    { key: 'ninjaToken', label: 'Invoice Ninja API token (set during setup)', type: 'secret' },
    { key: 'escalationTone', label: 'How firm should escalations be?', type: 'text' },
    { key: 'escalationEmail', label: 'Who signs escalation notices (name + email)', type: 'text' },
  ],
  async run(ctx) {
    if (!ctx.serviceUrl || !ctx.config.ninjaToken) return null;
    const invoices = await openInvoices(ctx);
    const actions: { invoice: string; client: string; days: number; step: string; draft?: string }[] = [];

    for (const inv of invoices) {
      const d = daysOverdue(inv.dueDate);
      const step = reminderDue(d);
      if (!step) continue;
      if (step === 'reminder') {
        // Native reminder email with payment link.
        await fetch(`${ctx.serviceUrl}/api/v1/invoices/bulk`, {
          method: 'POST',
          headers: headers(ctx),
          body: JSON.stringify({ action: 'email', ids: [inv.id], template: d >= 14 ? 'reminder3' : d >= 7 ? 'reminder2' : 'reminder1' }),
        });
        actions.push({ invoice: inv.number, client: inv.client, days: d, step: 'reminder sent' });
      } else {
        const draft = await ask(
          `Draft a firm but professional escalation email about an overdue invoice. Tone: ${ctx.config.escalationTone ?? 'firm, polite'}. Signed by ${ctx.config.escalationEmail ?? 'Accounts'}. Under 150 words. No legal threats.`,
          JSON.stringify({ ...inv, daysOverdue: d }),
          500,
        );
        actions.push({ invoice: inv.number, client: inv.client, days: d, step: 'escalation drafted', draft });
      }
    }

    const isMonday = new Date().getDay() === 1;
    const report = aging(invoices);
    if (!actions.length && !isMonday) return null;

    const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const html =
      (isMonday ? `<h2>Receivables aging</h2><table>${Object.entries(report.totals).map(([b, v]) => `<tr><td>${b}</td><td>${fmt(v)}</td></tr>`).join('')}</table><p><b>Overdue total: ${fmt(report.overdue)}</b></p>` : '') +
      (actions.length
        ? `<h2>Today</h2><ul>${actions.map((a) => `<li>${esc(a.client)} #${esc(a.invoice)} — ${a.days} days — ${a.step}${a.draft ? `<pre style="white-space:pre-wrap">${esc(a.draft)}</pre>` : ''}</li>`).join('')}</ul>`
        : '');
    return { title: isMonday ? `AR aging: ${fmt(report.overdue)} overdue` : `${actions.length} collection actions today`, body: { actions, report }, emailHtml: html };
  },
};

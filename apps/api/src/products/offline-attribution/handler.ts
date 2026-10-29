import { config } from '../../config';
import { esc } from '../../mail/mailer';
import { ProductHandler } from '../types';

/**
 * Offline Ad Attribution on Dub. Each placement (a mailer drop, a yard-sign batch, a van wrap)
 * gets its own short link + QR code, tagged with the client. Monthly report: clicks/scans per
 * placement and cost per scan, using the spend the client entered.
 */
interface Placement {
  name: string;
  destination: string;
  monthlySpend?: number;
  linkId?: string;
  shortLink?: string;
}

async function dub(path: string, init: RequestInit = {}) {
  if (!config.DUB_API_KEY) throw new Error('DUB_API_KEY not set');
  const res = await fetch(`${config.DUB_API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.DUB_API_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Dub ${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

export const offlineAttribution: ProductHandler = {
  slug: 'offline-attribution',
  schedule: '0 7 1 * *', // 1st of each month, 07:00 London
  onboardingFields: [
    { key: 'placements', label: 'Placements: one per line as "name | landing URL | monthly spend"', type: 'textarea', required: true },
  ],
  async run(ctx) {
    const placements: Placement[] = (ctx.config.parsedPlacements ??
      String(ctx.config.placements ?? '')
        .split('\n')
        .map((l) => l.split('|').map((s) => s.trim()))
        .filter((p) => p[0] && p[1])
        .map(([name, destination, spend]) => ({ name, destination, monthlySpend: spend ? Number(spend.replace(/[^0-9.]/g, '')) : undefined }))) as Placement[];

    // Create links for any new placement.
    for (const p of placements) {
      if (p.linkId) continue;
      const link = await dub('/links', {
        method: 'POST',
        body: JSON.stringify({
          url: p.destination,
          externalId: `${ctx.tenantId}:${p.name}`.slice(0, 255),
          tagNames: [`tenant-${ctx.tenantId.slice(0, 8)}`],
          utm_source: 'offline',
          utm_campaign: p.name,
        }),
      });
      p.linkId = link.id;
      p.shortLink = link.shortLink;
    }

    const rows: { name: string; scans: number; spend?: number; costPerScan?: number; shortLink?: string; qr: string }[] = [];
    for (const p of placements) {
      const a = await dub(`/analytics?event=clicks&groupBy=count&interval=30d&linkId=${encodeURIComponent(p.linkId!)}`);
      const scans = typeof a === 'number' ? a : (a?.clicks ?? 0);
      rows.push({
        name: p.name,
        scans,
        spend: p.monthlySpend,
        costPerScan: p.monthlySpend && scans ? Math.round((p.monthlySpend / scans) * 100) / 100 : undefined,
        shortLink: p.shortLink,
        qr: `https://api.dub.co/qr?url=${encodeURIComponent(p.shortLink ?? '')}`,
      });
    }
    rows.sort((x, y) => (x.costPerScan ?? Infinity) - (y.costPerScan ?? Infinity));

    const html = `<h2>Which placements worked (last 30 days)</h2><table cellpadding="6"><tr><th align="left">Placement</th><th>Scans</th><th>Spend</th><th>Cost per scan</th></tr>${rows
      .map((r) => `<tr><td>${esc(r.name)}</td><td align="right">${r.scans}</td><td align="right">${r.spend ?? '—'}</td><td align="right">${r.costPerScan ?? '—'}</td></tr>`)
      .join('')}</table>`;
    return { title: `Offline ROI report — ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`, body: { rows, configPatch: { parsedPlacements: placements } }, emailHtml: html };
  },
};

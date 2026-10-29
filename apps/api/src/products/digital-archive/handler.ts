import { ask } from '../../ai/claude';
import { ProductHandler, ProductContext } from '../types';

/**
 * Digital Archive on the client's own Paperless-ngx (OCR, auto-tagging, auto-filing are native).
 * This adds "ask your files": full-text search in Paperless, then Claude answers from the top documents.
 */
function auth(ctx: ProductContext) {
  return { Authorization: `Token ${ctx.config.paperlessToken}` };
}

export async function askArchive(ctx: ProductContext, question: string) {
  if (!ctx.serviceUrl || !ctx.config.paperlessToken) throw new Error('Archive not set up yet');
  const u = new URL(`${ctx.serviceUrl}/api/documents/`);
  u.searchParams.set('query', question);
  u.searchParams.set('page_size', '6');
  const res = await fetch(u, { headers: auth(ctx) });
  if (!res.ok) throw new Error(`Paperless ${res.status}`);
  const docs = ((await res.json()) as any).results as any[];
  const context = docs.map((d) => `[doc ${d.id}] ${d.title} (${d.created})\n${String(d.content ?? '').slice(0, 3000)}`).join('\n\n');
  const answer = await ask(
    'Answer the question using only these documents. Cite document ids like [doc 12]. If the answer is not in them, say so.',
    `Question: ${question}\n\n${context}`,
    800,
  );
  return { answer, documents: docs.map((d) => ({ id: d.id, title: d.title, created: d.created, url: `${ctx.serviceUrl}/documents/${d.id}/details` })) };
}

export const digitalArchive: ProductHandler = {
  slug: 'digital-archive',
  schedule: '0 7 * * 1', // weekly archive health report
  onboardingFields: [
    { key: 'paperlessToken', label: 'Paperless API token (set during setup)', type: 'secret' },
    { key: 'scanVolumeBoxes', label: 'Roughly how many boxes/files of paper records?', type: 'text' },
  ],
  async run(ctx) {
    if (!ctx.serviceUrl || !ctx.config.paperlessToken) return null;
    const stats = (await (await fetch(`${ctx.serviceUrl}/api/statistics/`, { headers: auth(ctx) })).json()) as any;
    const inbox = stats.documents_inbox ?? 0;
    return {
      title: `Archive: ${stats.documents_total} documents, ${inbox} awaiting review`,
      body: { stats },
      emailHtml: `<h2>Your archive this week</h2><p>${stats.documents_total} documents searchable. ${inbox} new documents are in the inbox waiting for a quick check.</p>`,
    };
  },
};

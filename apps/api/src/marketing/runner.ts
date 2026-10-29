import { randomBytes } from 'crypto';
import { PRODUCTS, Product, usd } from '@vs/catalog';
import { config, integrations } from '../config';
import { one, q } from '../db/db';
import { ask, askJson, claudeAvailable } from '../ai/claude';
import { sendMail, esc } from '../mail/mailer';
import { findIntent } from '../products/agent-reach/intent';
import { unsubscribeUrl } from './unsubscribe';
import { findProspects, Prospect } from './prospecting';
import { applyClaimsToggle, footer, sequenceFor } from './sequences';
import { assertFilled, blockReason, fill, inRunWindow } from './guardrails';
import { campaignFor, postToLinkedIn, postToX, pushToInstantly } from './channels';
import { GrowthSettings, getSettings } from '../growth/settings';
import { recordCost, withCostContext } from '../growth/costs';

interface Stats {
  [k: string]: number | string[] | undefined;
  errors?: string[];
}

class Clock {
  private readonly end: number;
  constructor(minutes: number) {
    this.end = Date.now() + minutes * 60_000 - 60_000; // keep 1 minute for the report
  }
  left(): number {
    return this.end - Date.now();
  }
  ok(minMs = 20_000): boolean {
    return this.left() > minMs;
  }
}

const bump = (s: Stats, k: string, n = 1) => (s[k] = ((s[k] as number) ?? 0) + n);
const err = (s: Stats, msg: string) => (s.errors ??= []).push(msg.slice(0, 300));

/** Products being promoted: wave ≤ maxWave (1 = Agent Reach only, the video's advice) and not paused by the optimiser. */
export function activeProducts(s: Pick<GrowthSettings, 'maxWave' | 'paused'>): Product[] {
  return PRODUCTS.filter((p) => p.wave <= s.maxWave && !s.paused.includes(p.slug));
}

/** Daily new-prospect budget per product from the optimiser's weights (equal split by default). */
export function allocate(products: Product[], cap: number, weights: Record<string, number>): Record<string, number> {
  const w = products.map((p) => weights[p.slug] ?? 1 / products.length);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(products.map((p, i) => [p.slug, Math.max(1, Math.round((cap * w[i]) / sum))]));
}

/** Picks a step-1 subject variant (uniform among active ones), seeding the default on first use. */
async function pickVariant(product: Product): Promise<{ id: string; subject: string }> {
  let active = await q<{ id: string; subject: string }>(`SELECT id, subject FROM sequence_variants WHERE product_slug=$1 AND step=1 AND status='active'`, [product.slug]);
  if (active.length === 0) {
    const subject = sequenceFor(product.slug)[0].subject;
    active = await q(`INSERT INTO sequence_variants (product_slug, step, subject, source) VALUES ($1,1,$2,'default') RETURNING id, subject`, [product.slug, subject]);
  }
  return active[Math.floor(Math.random() * active.length)];
}

async function suppressed(email: string) {
  return !!(await one('SELECT 1 FROM suppression WHERE email=$1', [email.toLowerCase()]));
}

// ---------------- 1. prospects ----------------
async function pullProspects(products: Product[], budget: Record<string, number>, clock: Clock, s: Stats) {
  for (const p of products) {
    if (!clock.ok()) return;
    let found: Prospect[] = [];
    try {
      found = await findProspects(p.slug, Math.ceil(budget[p.slug] * 1.5)); // over-fetch: some get skipped for lack of proof
      await recordCost('prospecting', found.length * Number(process.env.PROSPECT_COST_CENTS ?? 1), p.slug, { n: found.length });
    } catch (e: any) {
      err(s, `prospects ${p.slug}: ${e.message}`);
      continue;
    }
    for (const r of found) {
      if (await suppressed(r.email)) continue;
      const ins = await q(
        `INSERT INTO prospects (product_slug, email, first_name, company, domain, niche, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (product_slug, email) DO NOTHING RETURNING id`,
        [p.slug, r.email, r.firstName ?? null, r.company ?? null, r.domain ?? null, r.niche ?? null, r.source],
      );
      if (ins.length) bump(s, 'prospects_added');
    }
  }
}

// ---------------- 2. proof ----------------
async function buildProof(product: Product, pr: { company: string; niche: string | null; domain: string | null }) {
  if (product.slug === 'agent-reach') {
    const threads = await findIntent(
      { company: pr.company, whatTheySell: pr.niche ?? pr.company, keywords: (pr.niche ?? pr.company).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 4) },
      { top: 3, days: 7 },
    );
    return { kind: 'threads', threads: threads.map(({ body, ...t }) => t) };
  }
  // Other products: a tailored sample the prospect can judge, built only from what we know (company, niche).
  // It is labelled as a sample and makes no claims about their internal numbers.
  const sample = await askJson<{ headline: string; sections: { title: string; points: string[] }[] }>(
    `You write a short, specific, honest sample deliverable for a prospective client of "${product.name}" (${product.tagline}).
Deliverables: ${product.deliverables.join('; ')}.
Rules: do not state facts about the prospect you were not given; frame anything specific as an example or a question; no prices.`,
    `Prospect: ${pr.company} (${pr.domain ?? 'no domain'}), sector: ${pr.niche ?? 'unknown'}. Return {headline, sections:[{title, points[]}]} with 3 sections.`,
    1500,
  );
  return { kind: 'sample', ...sample };
}

async function gatherProof(products: Product[], clock: Clock, s: Stats) {
  if (!claudeAvailable()) return;
  for (const p of products) {
    const rows = await q<{ id: string; company: string | null; niche: string | null; domain: string | null }>(
      `SELECT id, company, niche, domain FROM prospects WHERE product_slug=$1 AND status='new' ORDER BY created_at LIMIT 15`,
      [p.slug],
    );
    for (const r of rows) {
      if (!clock.ok(60_000)) return;
      try {
        const proof = await withCostContext({ product: p.slug, kind: 'marketing' }, () =>
          buildProof(p, { company: r.company ?? r.domain ?? 'your company', niche: r.niche, domain: r.domain }),
        );
        const real = proof.kind === 'threads' ? (proof as any).threads.length : 0;
        if (proof.kind === 'threads' && real < 2) {
          await q(`UPDATE prospects SET status='skipped', proof=$2 WHERE id=$1`, [r.id, proof]);
          bump(s, 'skipped_no_threads');
          continue;
        }
        await q(`UPDATE prospects SET status='proofed', proof=$2, proof_slug=$3 WHERE id=$1`, [r.id, proof, randomBytes(9).toString('base64url')]);
        bump(s, 'proofed');
      } catch (e: any) {
        err(s, `proof ${p.slug}: ${e.message}`);
      }
    }
  }
}

// ---------------- 3. sequences ----------------
export function renderSequence(product: Product, pr: any, step1Subject?: string): { subject: string; body: string }[] {
  const proof = pr.proof ?? {};
  const threads: any[] = proof.kind === 'threads' ? proof.threads : [];
  const threadBlock = threads
    .slice(0, 3)
    .map((t) => `${t.community}: "${t.title}"\n${t.url}\nSuggested reply: "${t.reply}"`)
    .join('\n\n');
  const vars: Record<string, string | undefined> = {
    firstName: pr.first_name ?? undefined,
    company: pr.company ?? undefined,
    competitor: pr.competitor ?? 'your competitors',
    threadCount: threads.length ? String(threads.length) : undefined,
    threadBlock: threadBlock || undefined,
    freshThreadTitle: threads.at(-1)?.title,
    freshThreadUrl: threads.at(-1)?.url,
    monthly: usd(product.monthlyCents),
    bookingUrl: config.MARKETING_BOOKING_URL,
    proofUrl: pr.proof_slug ? `${config.PUBLIC_WEB_URL}/for/${pr.proof_slug}` : undefined,
    checkoutUrl: `${config.PUBLIC_WEB_URL}/p/${product.slug}`,
    senderName: config.MARKETING_SENDER_NAME,
    senderTitle: config.MARKETING_SENDER_TITLE,
  };
  const foot = footer(config.MARKETING_POSTAL_ADDRESS ?? '{{postalAddress}}', unsubscribeUrl(pr.email));
  return sequenceFor(product.slug).map((st, i) => {
    const subject = fill(i === 0 && step1Subject ? step1Subject : st.subject, vars);
    const body = applyClaimsToggle(fill(st.body, vars), config.MARKETING_CLIENT_CLAIMS) + foot;
    assertFilled(subject);
    assertFilled(body);
    return { subject, body };
  });
}

async function enrolSequences(products: Product[], allocation: Record<string, number>, clock: Clock, s: Stats) {
  if (!integrations().instantly) return;
  for (const p of products) {
    const campaign = campaignFor(p.slug);
    if (!campaign) continue;
    let budget = allocation[p.slug] ?? 0;
    const rows = await q(`SELECT * FROM prospects WHERE product_slug=$1 AND status='proofed' ORDER BY created_at LIMIT $2`, [p.slug, budget]);
    for (const pr of rows) {
      if (!clock.ok()) return;
      if (budget <= 0) break;
      const reason = blockReason({
        email: pr.email,
        suppressed: await suppressed(pr.email),
        status: pr.status,
        realThreads: pr.proof?.kind === 'threads' ? pr.proof.threads.length : 0,
        requiresProof: p.slug === 'agent-reach',
      });
      if (reason) {
        await q(`UPDATE prospects SET status='skipped' WHERE id=$1`, [pr.id]);
        bump(s, `blocked:${reason}`);
        continue;
      }
      try {
        const variant = await pickVariant(p);
        const steps = renderSequence(p, pr, variant.subject);
        await pushToInstantly(campaign, { email: pr.email, firstName: pr.first_name, company: pr.company, steps });
        await q(`UPDATE prospects SET status='sequencing', step=1, enrolled_at=now(), variant_id=$2 WHERE id=$1`, [pr.id, variant.id]);
        budget--;
        bump(s, 'enrolled');
      } catch (e: any) {
        await q(`UPDATE prospects SET status='skipped' WHERE id=$1`, [pr.id]);
        err(s, `enrol ${pr.email}: ${e.message}`);
      }
    }
  }
}

// ---------------- 4. owned content ----------------
async function ownedContent(products: Product[], clock: Clock, s: Stats) {
  if (!claudeAvailable()) return;
  const weekday = new Date().getUTCDay();
  for (const [i, p] of products.entries()) {
    if (!clock.ok(90_000)) return;
    try {
      await withCostContext({ product: p.slug, kind: 'marketing' }, async () => {
      const post = await ask(
        `Write one social post for our own company page promoting "${p.name}" to ${p.audience}. Lead with a specific, useful insight about the problem (${p.hook}). One concrete tip they can use without buying. End with a soft CTA to ${config.PUBLIC_WEB_URL}/p/${p.slug}. No hashtags spam (max 2), no emojis, under 600 characters. Do not invent client results or statistics.`,
        `Day ${new Date().toISOString().slice(0, 10)}; vary the angle from previous days.`,
        400,
      );
      const xId = await postToX(post.length > 280 ? post.slice(0, post.lastIndexOf(' ', 270)) + '…' : post).catch((e) => (err(s, `x: ${e.message}`), undefined));
      const liId = await postToLinkedIn(post).catch((e) => (err(s, `linkedin: ${e.message}`), undefined));
      await q(`INSERT INTO content_posts (product_slug, channel, body, external_id) VALUES ($1,'social',$2,$3)`, [p.slug, post, [xId, liId].filter(Boolean).join(',') || null]);
      bump(s, 'social_posts');

      // One SEO article per product per week, spread across the week.
      if (i % 7 === weekday) {
        const art = await askJson<{ title: string; slug: string; markdown: string }>(
          `Write an SEO article (900-1200 words, markdown) for ${p.audience} about the problem "${p.name}" solves. Practical, specific, no invented statistics or client stories. Mention ${p.name} once near the end with a link to ${config.PUBLIC_WEB_URL}/p/${p.slug}.`,
          `Pick a long-tail question this audience actually searches. Return {title, slug, markdown}.`,
          4000,
        );
        const slug = `${art.slug.replace(/[^a-z0-9-]/g, '').slice(0, 70)}-${randomBytes(2).toString('hex')}`;
        await q(`INSERT INTO content_posts (product_slug, channel, slug, title, body) VALUES ($1,'blog',$2,$3,$4)`, [p.slug, slug, art.title, art.markdown]);
        bump(s, 'blog_posts');
      }
      });
    } catch (e: any) {
      err(s, `content ${p.slug}: ${e.message}`);
    }
  }
}

// ---------------- 5. report ----------------
async function report(runId: string, s: Stats) {
  const funnel = await q(`SELECT product_slug, status, count(*)::int AS n FROM prospects GROUP BY 1,2 ORDER BY 1,2`);
  const paying = await q(`SELECT product_slug, count(*)::int AS n FROM entitlements WHERE status IN ('active','trialing','one_off') GROUP BY 1`);
  await q(`UPDATE marketing_runs SET finished_at=now(), stats=$2 WHERE id=$1`, [runId, s]);
  const html = `<h2>03:00 marketing run</h2><pre>${esc(JSON.stringify(s, null, 2))}</pre>
<h3>Paying clients</h3><pre>${esc(JSON.stringify(paying, null, 2))}</pre>
<h3>Prospect funnel</h3><pre>${esc(JSON.stringify(funnel, null, 2))}</pre>
<h3>Integrations</h3><pre>${esc(JSON.stringify(integrations(), null, 2))}</pre>`;
  await sendMail(config.OWNER_EMAIL, `Marketing run: ${s.enrolled ?? 0} enrolled, ${s.social_posts ?? 0} posts`, html).catch(() => undefined);
}

export async function runMarketing(opts: { force?: boolean } = {}): Promise<Stats> {
  if (!opts.force && !inRunWindow(new Date(), config.MARKETING_TZ, config.MARKETING_START_HOUR)) {
    return { skipped_outside_window: 1 } as Stats;
  }
  if (!config.MARKETING_ENABLED && !opts.force) return { disabled: 1 } as Stats;

  // Single-run lock (the cron fires at 02:00 and 03:00 UTC to cover BST/GMT).
  const lock = await one<{ ok: boolean }>(`SELECT pg_try_advisory_lock(424242) AS ok`);
  if (!lock?.ok) return { skipped_locked: 1 } as Stats;
  const already = await one(`SELECT 1 FROM marketing_runs WHERE started_at > now() - interval '20 hours' AND finished_at IS NOT NULL`);
  if (already && !opts.force) return { skipped_already_ran: 1 } as Stats;

  const run = (await one<{ id: string }>(`INSERT INTO marketing_runs DEFAULT VALUES RETURNING id`))!;
  const clock = new Clock(config.MARKETING_BUDGET_MINUTES);
  const s: Stats = {};
  const settings = await getSettings(); // levers tuned weekly by the optimiser
  const products = activeProducts(settings);
  const allocation = allocate(products, settings.dailySendCap, settings.weights);
  s.products = products.map((p) => p.slug) as unknown as string[];
  (s as any).allocation = allocation;

  const phases: [string, () => Promise<void>][] = [
    ['prospects', () => pullProspects(products, allocation, clock, s)],
    ['proof', () => gatherProof(products, clock, s)],
    ['sequences', () => enrolSequences(products, allocation, clock, s)],
    ['content', () => ownedContent(products, clock, s)],
  ];
  for (const [name, fn] of phases) {
    if (!clock.ok()) break;
    try {
      await fn();
    } catch (e: any) {
      err(s, `${name}: ${e.message}`);
    }
  }
  await report(run.id, s);
  await q(`SELECT pg_advisory_unlock(424242)`);
  return s;
}


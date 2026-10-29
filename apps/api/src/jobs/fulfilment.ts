import { bySlug } from '@vs/catalog';
import { config } from '../config';
import { one, q } from '../db/db';
import { isEntitled, EntitlementRow } from '../billing/entitlement-rules';
import { signMagic } from '../auth/auth';
import { sendMail, esc } from '../mail/mailer';
import { handlerFor, HANDLERS } from '../products/registry';
import { provision, suspend } from '../provisioning/provisioning';
import { openAll } from '../security/secrets';
import { fulfilQueue, FulfilJob } from './queue';
import { withCostContext } from '../growth/costs';
import { snapshotMrr } from '../growth/metrics';
import { runOptimiser } from '../growth/optimiser';

/** Onboarding is complete when required fields are filled and the product's consent gate is signed. */
export function onboardingComplete(slug: string, cfg: Record<string, any>, consentAt: Date | null): boolean {
  const product = bySlug(slug);
  const handler = handlerFor(slug);
  if (!product || !handler) return false;
  if (product.consentGate && !consentAt) return false;
  return handler.onboardingFields.filter((f) => f.required).every((f) => {
    const v = cfg[f.key];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '';
  });
}

export async function processJob(job: FulfilJob): Promise<unknown> {
  switch (job.type) {
    case 'welcome':
      return welcome(job.tenantId, job.productSlug);
    case 'provision':
      return provision(job.tenantId, job.productSlug);
    case 'suspend':
      return suspend(job.tenantId, job.productSlug);
    case 'run':
      return withCostContext({ product: job.productSlug, kind: 'delivery' }, () => runProduct(job.tenantId, job.productSlug));
    case 'snapshot':
      return snapshotMrr();
    case 'optimise':
      return runOptimiser();
    case 'schedule-all':
      return syncSchedules();
  }
}

async function welcome(tenantId: string, slug: string) {
  const t = await one<{ email: string }>('SELECT email FROM tenants WHERE id=$1', [tenantId]);
  if (!t) return;
  const product = bySlug(slug)!;
  const link = `${config.PUBLIC_WEB_URL}/portal/callback?token=${signMagic({ tenantId, email: t.email })}`;
  await sendMail(
    t.email,
    `You're in — set up ${product.name}`,
    `<p>Thanks for buying ${esc(product.name)}.</p><p>Two minutes of setup and we take it from there: <a href="${link}">open your portal</a> (link valid for 15 minutes; you can request a new one any time).</p>`,
  );
}

export async function runProduct(tenantId: string, slug: string) {
  const handler = handlerFor(slug);
  if (!handler) return;
  const ent = await one<EntitlementRow>('SELECT status, grace_until FROM entitlements WHERE tenant_id=$1 AND product_slug=$2', [tenantId, slug]);
  if (!isEntitled(ent)) return { skipped: 'not entitled' }; // paywall applies to fulfilment too

  const row = await one<{ email: string; company: string | null; config: Record<string, any>; consent_at: Date | null; consent_name: string | null; url: string | null }>(
    `SELECT t.email, t.company, COALESCE(o.config,'{}'::jsonb) AS config, o.consent_at, o.consent_name, ps.url
     FROM tenants t
     LEFT JOIN onboarding o ON o.tenant_id=t.id AND o.product_slug=$2
     LEFT JOIN provisioned_services ps ON ps.tenant_id=t.id AND ps.product_slug=$2
     WHERE t.id=$1`,
    [tenantId, slug],
  );
  if (!row) return;
  if (!onboardingComplete(slug, row.config, row.consent_at)) return { skipped: 'onboarding incomplete' };

  const cfg = { ...openAll(row.config), consent: row.consent_at ? { name: row.consent_name, at: row.consent_at } : undefined };
  const result = await handler.run({ tenantId, email: row.email, company: row.company, config: cfg, serviceUrl: row.url });
  if (!result) return { skipped: 'nothing to deliver' };

  const { configPatch, ...body } = result.body as Record<string, any>;
  await q('INSERT INTO deliveries (tenant_id, product_slug, title, body) VALUES ($1,$2,$3,$4)', [tenantId, slug, result.title, body]);
  if (configPatch) {
    await q(`UPDATE onboarding SET config = config || $3::jsonb WHERE tenant_id=$1 AND product_slug=$2`, [tenantId, slug, JSON.stringify(configPatch)]);
  }
  if (result.emailHtml) {
    await sendMail(row.email, result.title, `${result.emailHtml}<hr><p><a href="${config.PUBLIC_WEB_URL}/portal">Your portal</a></p>`);
  }
  return { delivered: result.title };
}

/** Keeps one repeatable BullMQ scheduler per (entitled tenant × scheduled product); removes the rest. */
export async function syncSchedules() {
  const queue = fulfilQueue();
  const rows = await q<{ tenant_id: string; product_slug: string; status: string; grace_until: Date | null }>(
    'SELECT tenant_id, product_slug, status, grace_until FROM entitlements',
  );
  const wanted = new Set<string>();
  for (const r of rows) {
    const h = HANDLERS[r.product_slug as keyof typeof HANDLERS];
    if (!h?.schedule || !isEntitled(r)) continue;
    const id = `run__${r.tenant_id}__${r.product_slug}`;
    wanted.add(id);
    await queue.upsertJobScheduler(
      id,
      { pattern: h.schedule, tz: 'Europe/London' },
      { name: 'run', data: { type: 'run', tenantId: r.tenant_id, productSlug: r.product_slug } },
    );
  }
  for (const s of await queue.getJobSchedulers(0, 10_000)) {
    if (s.key.startsWith("run__") && !wanted.has(s.key)) await queue.removeJobScheduler(s.key);
  }
  return { schedules: wanted.size };
}

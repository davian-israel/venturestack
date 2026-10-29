import {
  Body, Controller, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Param, Post, Put, Query, Req, UseGuards, BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PRODUCTS, bySlug } from '@vs/catalog';
import { config, integrations } from '../config';
import { one, q } from '../db/db';
import { BillingService } from '../billing/billing.service';
import { EntitlementGuard, Paywalled, Session, SessionGuard, signMagic, signSession, verify } from '../auth/auth';
import { sendMail } from '../mail/mailer';
import { enqueue } from '../jobs/queue';
import { onboardingComplete } from '../jobs/fulfilment';
import { handlerFor } from '../products/registry';
import { askArchive } from '../products/digital-archive/handler';
import { openAll, seal } from '../security/secrets';
import { unsubSig, validUnsubSig } from '../marketing/unsubscribe';

type AuthedRequest = Request & { session: Session; rawBody?: Buffer };

@Controller()
export class PublicController {
  constructor(private readonly billing: BillingService) {}

  @Get('health')
  health() {
    return { ok: true, integrations: integrations() };
  }

  @Get('catalog')
  catalog() {
    return PRODUCTS;
  }

  @Post('checkout/:slug')
  checkout(@Param('slug') slug: string, @Body() body: { email?: string; oneOff?: boolean; ref?: string; source?: string }) {
    return this.billing.createCheckout(slug, { email: body?.email, oneOff: !!body?.oneOff, ref: body?.ref, source: body?.source });
  }

  /** Lightweight first-party analytics (no cookies, no personal data). */
  @Post('t')
  @HttpCode(204)
  async track(@Body() body: { type?: string; product?: string; ref?: string; source?: string }) {
    if (body?.type !== 'page_view') return;
    const product = body.product && bySlug(body.product) ? body.product : null;
    const clean = (v?: string) => (v && /^[\w.-]{1,40}$/.test(v) ? v : null);
    await q(`INSERT INTO funnel_events (type, product_slug, ref, source) VALUES ('page_view',$1,$2,$3)`, [product, clean(body.ref), clean(body.source)]);
  }

  @Post('billing/webhook')
  @HttpCode(200)
  async webhook(@Req() req: AuthedRequest, @Headers('stripe-signature') sig?: string) {
    if (!req.rawBody) throw new BadRequestException('raw body missing');
    const event = this.billing.verifyWebhook(req.rawBody, sig);
    const processed = await this.billing.handleEvent(event);
    return { received: true, processed };
  }

  @Post('auth/magic')
  @HttpCode(200)
  async magic(@Body() body: { email: string }) {
    const t = await one<{ id: string; email: string }>('SELECT id, email FROM tenants WHERE email=lower($1)', [body?.email ?? '']);
    if (t) {
      const link = `${config.PUBLIC_WEB_URL}/portal/callback?token=${signMagic({ tenantId: t.id, email: t.email })}`;
      await sendMail(t.email, 'Your sign-in link', `<p><a href="${link}">Sign in to your portal</a>. The link works for 15 minutes.</p>`);
    }
    return { ok: true }; // same answer either way: no account enumeration
  }

  @Post('auth/exchange')
  @HttpCode(200)
  exchange(@Body() body: { token: string }) {
    const s = verify(body?.token ?? '', 'magic');
    return { session: signSession(s) };
  }

  /** Public proof page for a prospect: the real threads found for them that morning. */
  @Get('proof/:slug')
  async proof(@Param('slug') slug: string) {
    const p = await one<{ company: string; product_slug: string; proof: any }>('SELECT company, product_slug, proof FROM prospects WHERE proof_slug=$1', [slug]);
    if (!p) throw new NotFoundException();
    await q(`INSERT INTO funnel_events (type, product_slug, ref, source) VALUES ('proof_view',$1,$2,'email')`, [p.product_slug, slug]);
    return { company: p.company, product: bySlug(p.product_slug), proof: p.proof };
  }

  @Get('unsubscribe')
  async unsubscribe(@Query('e') email: string, @Query('sig') sig: string) {
    if (!email || !sig || !validUnsubSig(email, sig)) throw new BadRequestException('invalid link');
    await q(`INSERT INTO suppression (email, reason) VALUES (lower($1), 'unsubscribed') ON CONFLICT DO NOTHING`, [email]);
    await q(`UPDATE prospects SET status='unsubscribed' WHERE email=lower($1)`, [email]);
    return { ok: true, message: 'You will not hear from us again.' };
  }

  /** Instantly webhook: replies / unsubscribes / bounces stop the sequence immediately. */
  @Post('webhooks/instantly')
  @HttpCode(200)
  async instantly(@Body() body: { event_type?: string; lead_email?: string; email?: string; step?: number }, @Query('key') key?: string) {
    if (!config.INSTANTLY_API_KEY || key !== unsubSig('instantly-webhook')) throw new ForbiddenException();
    const email = (body.lead_email ?? body.email ?? '').toLowerCase();
    if (!email) return { ok: true };
    const ev = body.event_type ?? '';
    const kind = /reply/.test(ev) ? 'replied' : /open/.test(ev) ? 'opened' : /click/.test(ev) ? 'clicked' : /bounce/.test(ev) ? 'bounced'
      : /unsub/.test(ev) ? 'unsubscribed' : /sent/.test(ev) ? 'sent' : null;
    if (kind) {
      await q(
        `INSERT INTO campaign_events (email, product_slug, event, step, variant_id)
         SELECT $1, p.product_slug, $2, $3, p.variant_id FROM (SELECT 1) x
         LEFT JOIN LATERAL (SELECT product_slug, variant_id FROM prospects WHERE email=$1 ORDER BY enrolled_at DESC NULLS LAST LIMIT 1) p ON true`,
        [email, kind, Number((body as any).step) || null],
      );
    }
    if (/reply/.test(ev)) await q(`UPDATE prospects SET status='replied' WHERE email=$1`, [email]);
    if (/unsub|bounce|complain/.test(ev)) {
      await q(`INSERT INTO suppression (email, reason) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [email, ev]);
      await q(`UPDATE prospects SET status='unsubscribed' WHERE email=$1`, [email]);
    }
    return { ok: true };
  }

  /** GPU worker callback when a Spanish video is published. */
  @Post('webhooks/voice')
  @HttpCode(200)
  async voice(@Body() body: { tenantId: string; videoId: string; spanishUrl: string }, @Headers('authorization') auth?: string) {
    if (!config.GPU_DUB_TOKEN || auth !== `Bearer ${config.GPU_DUB_TOKEN}`) throw new ForbiddenException();
    await q('INSERT INTO deliveries (tenant_id, product_slug, title, body) VALUES ($1,$2,$3,$4)', [
      body.tenantId, 'voice-studio', 'Spanish video published', body,
    ]);
    return { ok: true };
  }

  @Get('blog')
  blog() {
    return q(`SELECT product_slug, slug, title, created_at FROM content_posts WHERE channel='blog' ORDER BY created_at DESC LIMIT 100`);
  }

  @Get('blog/:slug')
  async post(@Param('slug') slug: string) {
    const p = await one(`SELECT product_slug, slug, title, body, created_at FROM content_posts WHERE channel='blog' AND slug=$1`, [slug]);
    if (!p) throw new NotFoundException();
    return p;
  }
}

@Controller()
@UseGuards(SessionGuard, EntitlementGuard)
export class PortalController {
  constructor(private readonly billing: BillingService) {}

  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const { tenantId } = req.session;
    const tenant = await one('SELECT id, email, company FROM tenants WHERE id=$1', [tenantId]);
    const entitlements = await q(
      `SELECT e.product_slug, e.status, e.current_period_end, e.grace_until, ps.state AS service_state, ps.url AS service_url
       FROM entitlements e LEFT JOIN provisioned_services ps ON ps.tenant_id=e.tenant_id AND ps.product_slug=e.product_slug
       WHERE e.tenant_id=$1`,
      [tenantId],
    );
    return { tenant, entitlements };
  }

  @Post('billing/portal')
  portal(@Req() req: AuthedRequest) {
    return this.billing.portalSession(req.session.tenantId);
  }

  @Get('portal/:slug')
  @Paywalled()
  async product(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    const handler = handlerFor(slug)!;
    const ob = await one<{ config: Record<string, any>; consent_at: Date | null }>(
      'SELECT config, consent_at FROM onboarding WHERE tenant_id=$1 AND product_slug=$2',
      [req.session.tenantId, slug],
    );
    const cfg = ob?.config ?? {};
    const masked = Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('enc:') ? '••••••' : v]));
    const deliveries = await q(
      'SELECT id, title, body, created_at FROM deliveries WHERE tenant_id=$1 AND product_slug=$2 ORDER BY created_at DESC LIMIT 30',
      [req.session.tenantId, slug],
    );
    return {
      product: bySlug(slug),
      fields: handler.onboardingFields,
      config: masked,
      consentRequired: bySlug(slug)!.consentGate ?? null,
      consentAt: ob?.consent_at ?? null,
      ready: onboardingComplete(slug, cfg, ob?.consent_at ?? null),
      deliveries,
    };
  }

  @Put('portal/:slug/onboarding')
  @Paywalled()
  async saveOnboarding(@Req() req: AuthedRequest, @Param('slug') slug: string, @Body() body: { config: Record<string, any>; consentName?: string }) {
    const handler = handlerFor(slug)!;
    const product = bySlug(slug)!;
    const existing = (await one<{ config: Record<string, any> }>('SELECT config FROM onboarding WHERE tenant_id=$1 AND product_slug=$2', [req.session.tenantId, slug]))?.config ?? {};
    const next: Record<string, any> = { ...existing };
    for (const f of handler.onboardingFields) {
      const v = body?.config?.[f.key];
      if (v === undefined || v === '••••••') continue;
      if (f.type === 'secret') next[f.key] = v ? seal(String(v)) : '';
      else if (f.type === 'list') next[f.key] = Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);
      else next[f.key] = String(v);
    }
    const consentName = product.consentGate && body?.consentName?.trim() ? body.consentName.trim() : null;
    await q(
      `INSERT INTO onboarding (tenant_id, product_slug, config, consent_type, consent_name, consent_at)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END)
       ON CONFLICT (tenant_id, product_slug) DO UPDATE SET config=EXCLUDED.config,
         consent_type=COALESCE(EXCLUDED.consent_type, onboarding.consent_type),
         consent_name=COALESCE(EXCLUDED.consent_name, onboarding.consent_name),
         consent_at=COALESCE(onboarding.consent_at, EXCLUDED.consent_at)`,
      [req.session.tenantId, slug, next, consentName ? product.consentGate : null, consentName],
    );
    const ob = await one<{ consent_at: Date | null }>('SELECT consent_at FROM onboarding WHERE tenant_id=$1 AND product_slug=$2', [req.session.tenantId, slug]);
    const ready = onboardingComplete(slug, next, ob?.consent_at ?? null);
    if (ready) await enqueue({ type: 'run', tenantId: req.session.tenantId, productSlug: slug });
    return { ready };
  }

  @Post('portal/:slug/run')
  @Paywalled()
  async runNow(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    await enqueue({ type: 'run', tenantId: req.session.tenantId, productSlug: slug });
    return { queued: true };
  }

  @Post('portal/:slug/ask')
  @Paywalled()
  async ask(@Req() req: AuthedRequest, @Param('slug') slug: string, @Body() body: { question: string }) {
    if (slug !== 'digital-archive') throw new NotFoundException();
    const row = await one<{ config: Record<string, any>; url: string | null; email: string; company: string | null }>(
      `SELECT o.config, ps.url, t.email, t.company FROM tenants t
       LEFT JOIN onboarding o ON o.tenant_id=t.id AND o.product_slug=$2
       LEFT JOIN provisioned_services ps ON ps.tenant_id=t.id AND ps.product_slug=$2 WHERE t.id=$1`,
      [req.session.tenantId, slug],
    );
    return askArchive(
      { tenantId: req.session.tenantId, email: row!.email, company: row!.company, config: openAll(row?.config ?? {}), serviceUrl: row?.url },
      String(body?.question ?? '').slice(0, 500),
    );
  }
}


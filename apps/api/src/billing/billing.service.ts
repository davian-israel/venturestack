import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';
import { bySlug } from '@vs/catalog';
import { config } from '../config';
import { one, q } from '../db/db';
import { enqueue } from '../jobs/queue';
import { stripe } from './stripe.client';
import { fromStripeStatus, graceUntil, lookupKey } from './entitlement-rules';
import { stripeFeeCents } from '../growth/costs';

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  /** Creates a Stripe Checkout session: setup fee + monthly subscription in one payment. */
  async createCheckout(productSlug: string, opts: { email?: string; oneOff?: boolean; ref?: string; source?: string }) {
    const product = bySlug(productSlug);
    if (!product) throw new NotFoundException('Unknown product');
    if (opts.oneOff && !product.oneOffCents) throw new BadRequestException('No one-off option for this product');

    const s = stripe();
    const keys = opts.oneOff
      ? [lookupKey(product.slug, 'oneoff')]
      : [lookupKey(product.slug, 'setup'), lookupKey(product.slug, 'monthly')];
    const prices = await s.prices.list({ lookup_keys: keys, active: true }).catch((e) => {
      this.log.error(`Stripe unavailable: ${e.message}`);
      throw new ServiceUnavailableException('Checkout is temporarily unavailable. Please try again shortly.');
    });
    if (prices.data.length !== keys.length) {
      throw new BadRequestException('Stripe prices missing — run `npm run stripe:bootstrap`.');
    }

    const ref = opts.ref && /^[\w-]{4,40}$/.test(opts.ref) ? opts.ref : '';
    const source = opts.source && /^[\w.-]{1,40}$/.test(opts.source) ? opts.source : '';
    const metadata = { product_slug: product.slug, ref, source };
    const session = await s.checkout.sessions.create({
      mode: opts.oneOff ? 'payment' : 'subscription',
      line_items: prices.data.map((p) => ({ price: p.id, quantity: 1 })),
      customer_email: opts.email,
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      metadata,
      ...(opts.oneOff
        ? { payment_intent_data: { metadata }, customer_creation: 'always' as const }
        : { subscription_data: { metadata } }),
      success_url: `${config.PUBLIC_WEB_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.PUBLIC_WEB_URL}/p/${product.slug}?cancelled=1`,
    });
    await q(`INSERT INTO funnel_events (type, product_slug, ref, source) VALUES ('checkout_started',$1,$2,$3)`, [product.slug, ref || null, source || null]);
    return { url: session.url };
  }

  /** Stripe Customer Portal for cards, invoices and cancellation. */
  async portalSession(tenantId: string) {
    const t = await one<{ stripe_customer_id: string | null }>('SELECT stripe_customer_id FROM tenants WHERE id=$1', [tenantId]);
    if (!t?.stripe_customer_id) throw new NotFoundException('No billing account');
    const session = await stripe().billingPortal.sessions.create({
      customer: t.stripe_customer_id,
      return_url: `${config.PUBLIC_WEB_URL}/portal`,
    });
    return { url: session.url };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    if (!config.STRIPE_WEBHOOK_SECRET) throw new BadRequestException('Webhook secret not configured');
    if (!signature) throw new BadRequestException('Missing signature');
    try {
      return stripe().webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new BadRequestException('Invalid signature');
    }
  }

  /** Idempotent webhook processing. Returns false if the event was already handled. */
  async handleEvent(event: Stripe.Event): Promise<boolean> {
    const inserted = await q('INSERT INTO stripe_events (id, type) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id', [
      event.id,
      event.type,
    ]);
    if (inserted.length === 0) return false;

    try {
      await this.dispatch(event);
    } catch (e) {
      // Let Stripe's retry reprocess this event.
      await q('DELETE FROM stripe_events WHERE id=$1', [event.id]);
      throw e;
    }
    return true;
  }

  private async dispatch(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.onSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionChanged(event.data.object as Stripe.Subscription, true);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.paid':
        await this.onInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }
  }

  private async upsertTenant(email: string, customerId: string | null, company?: string | null): Promise<string> {
    // A returning Stripe customer keeps their tenant even if they changed email.
    if (customerId) {
      const byCustomer = await one<{ id: string }>('SELECT id FROM tenants WHERE stripe_customer_id=$1', [customerId]);
      if (byCustomer) return byCustomer.id;
    }
    const row = await one<{ id: string }>(
      `INSERT INTO tenants (email, stripe_customer_id, company) VALUES (lower($1), $2, $3)
       ON CONFLICT (email) DO UPDATE SET stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, tenants.stripe_customer_id),
                                         company = COALESCE(tenants.company, EXCLUDED.company)
       RETURNING id`,
      [email, customerId, company ?? null],
    );
    return row!.id;
  }

  private async onCheckoutCompleted(session: Stripe.Checkout.Session) {
    const slug = session.metadata?.product_slug;
    const email = session.customer_details?.email ?? session.customer_email;
    if (!slug || !email || !bySlug(slug)) {
      this.log.warn(`checkout ${session.id} missing product or email`);
      return;
    }
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return;

    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
    const tenantId = await this.upsertTenant(email, customerId, session.customer_details?.name);
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;

    await q(
      `INSERT INTO entitlements (tenant_id, product_slug, status, stripe_subscription_id, source_ref)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, product_slug) DO UPDATE
         SET status=EXCLUDED.status, stripe_subscription_id=COALESCE(EXCLUDED.stripe_subscription_id, entitlements.stripe_subscription_id),
             grace_until=NULL, canceled_at=NULL, updated_at=now(), source_ref=COALESCE(entitlements.source_ref, EXCLUDED.source_ref)`,
      [tenantId, slug, session.mode === 'payment' ? 'one_off' : 'active', subId, session.metadata?.ref || null],
    );
    const ref = session.metadata?.ref || null;
    await q(`INSERT INTO funnel_events (type, product_slug, ref, source) VALUES ('checkout_completed',$1,$2,$3)`, [slug, ref, session.metadata?.source || null]);
    if (ref) await q(`UPDATE prospects SET status='won', won_at=now() WHERE proof_slug=$1`, [ref]);
    if (session.mode === 'payment' && session.amount_total) {
      await q(
        `INSERT INTO payments (id, tenant_id, product_slug, amount_cents, fee_cents_est, kind) VALUES ($1,$2,$3,$4,$5,'one_off') ON CONFLICT DO NOTHING`,
        [session.id, tenantId, slug, session.amount_total, stripeFeeCents(session.amount_total)],
      );
    }
    await enqueue({ type: 'welcome', tenantId, productSlug: slug }, { jobId: `welcome__${session.id}` });
    await enqueue({ type: 'provision', tenantId, productSlug: slug }, { jobId: `provision__${tenantId}__${slug}` });
  }

  private async onSubscriptionChanged(sub: Stripe.Subscription, deleted = false) {
    const slug = sub.metadata?.product_slug;
    if (!slug) return;
    const status = deleted ? 'canceled' : fromStripeStatus(sub.status);
    // Since Stripe API 2025-03, the period end lives on subscription items.
    const periodEnd =
      (sub.items?.data?.[0] as unknown as { current_period_end?: number })?.current_period_end ??
      (sub as unknown as { current_period_end?: number }).current_period_end;

    const rows = await q<{ tenant_id: string }>(
      `UPDATE entitlements SET status=$2, current_period_end=to_timestamp($3), updated_at=now(),
              canceled_at = CASE WHEN $2 = 'canceled' THEN COALESCE(canceled_at, now()) ELSE NULL END,
              grace_until = CASE WHEN $2 = 'past_due' THEN COALESCE(grace_until, now() + make_interval(days => $4)) ELSE NULL END
       WHERE stripe_subscription_id=$1 RETURNING tenant_id`,
      [sub.id, status, periodEnd ?? null, config.PAST_DUE_GRACE_DAYS],
    );
    if (status === 'canceled') {
      for (const r of rows) await enqueue({ type: 'suspend', tenantId: r.tenant_id, productSlug: slug });
    }
  }

  private subscriptionIdOf(inv: Stripe.Invoice): string | null {
    const legacy = (inv as unknown as { subscription?: string | { id: string } }).subscription;
    const modern = (inv as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent
      ?.subscription_details?.subscription;
    const s = modern ?? legacy;
    return !s ? null : typeof s === 'string' ? s : s.id;
  }

  private async onPaymentFailed(inv: Stripe.Invoice) {
    const subId = this.subscriptionIdOf(inv);
    if (!subId) return;
    await q(
      `UPDATE entitlements SET status='past_due', grace_until=COALESCE(grace_until, $2), updated_at=now()
       WHERE stripe_subscription_id=$1`,
      [subId, graceUntil(new Date(), config.PAST_DUE_GRACE_DAYS)],
    );
  }

  private async onInvoicePaid(inv: Stripe.Invoice) {
    const subId = this.subscriptionIdOf(inv);
    if (!subId) return;
    const ent = await one<{ tenant_id: string; product_slug: string }>('SELECT tenant_id, product_slug FROM entitlements WHERE stripe_subscription_id=$1', [subId]);
    const amount = (inv as unknown as { amount_paid?: number }).amount_paid ?? 0;
    if (amount > 0 && inv.id) {
      await q(
        `INSERT INTO payments (id, tenant_id, product_slug, amount_cents, fee_cents_est, kind) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [inv.id, ent?.tenant_id ?? null, ent?.product_slug ?? null, amount, stripeFeeCents(amount), inv.billing_reason === 'subscription_create' ? 'first' : 'recurring'],
      );
    }
    const rows = await q<{ tenant_id: string; product_slug: string; was: string }>(
      `UPDATE entitlements e SET status='active', grace_until=NULL, updated_at=now()
       FROM (SELECT id, status AS was FROM entitlements WHERE stripe_subscription_id=$1) old
       WHERE e.id = old.id RETURNING e.tenant_id, e.product_slug, old.was`,
      [subId],
    );
    // Back from suspension: bring their service back up.
    for (const r of rows) {
      if (r.was === 'canceled' || r.was === 'past_due') {
        await enqueue({ type: 'provision', tenantId: r.tenant_id, productSlug: r.product_slug });
      }
    }
  }
}

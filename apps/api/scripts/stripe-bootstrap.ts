/**
 * Creates (or updates) the 8 Stripe Products and their Prices from the catalog, and the webhook
 * endpoint. Idempotent: prices are found by lookup key; changed amounts get a new price and the
 * lookup key is transferred to it.
 *
 *   STRIPE_SECRET_KEY=sk_test_... PUBLIC_API_URL=https://api.example.com npm run stripe:bootstrap
 */
import { PRODUCTS } from '@vs/catalog';
import { stripe } from '../src/billing/stripe.client';
import { lookupKey } from '../src/billing/entitlement-rules';
import { config } from '../src/config';

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

async function ensurePrice(productId: string, key: string, cents: number, recurring: boolean) {
  const s = stripe();
  const found = (await s.prices.list({ lookup_keys: [key], active: true })).data[0];
  if (found && found.unit_amount === cents && !!found.recurring === recurring) return found.id;
  const price = await s.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: cents,
    lookup_key: key,
    transfer_lookup_key: true,
    ...(recurring ? { recurring: { interval: 'month' as const } } : {}),
  });
  if (found) await s.prices.update(found.id, { active: false });
  return price.id;
}

async function main() {
  const s = stripe();
  for (const p of PRODUCTS) {
    const existing = await s.products.search({ query: `metadata['product_slug']:'${p.slug}'` });
    const product =
      existing.data[0] ??
      (await s.products.create({ name: p.name, description: p.tagline, metadata: { product_slug: p.slug } }));
    if (existing.data[0]) await s.products.update(product.id, { name: p.name, description: p.tagline });

    await ensurePrice(product.id, lookupKey(p.slug, 'setup'), p.setupFeeCents, false);
    await ensurePrice(product.id, lookupKey(p.slug, 'monthly'), p.monthlyCents, true);
    if (p.oneOffCents) await ensurePrice(product.id, lookupKey(p.slug, 'oneoff'), p.oneOffCents, false);
    console.log(`✓ ${p.name}`);
  }

  const url = `${config.PUBLIC_API_URL}/billing/webhook`;
  const hooks = await s.webhookEndpoints.list({ limit: 100 });
  if (!hooks.data.some((h) => h.url === url)) {
    const hook = await s.webhookEndpoints.create({ url, enabled_events: [...WEBHOOK_EVENTS] });
    console.log(`✓ webhook created — set STRIPE_WEBHOOK_SECRET=${hook.secret} on the api service`);
  } else {
    console.log('✓ webhook already exists');
  }

  await s.billingPortal.configurations.create({
    business_profile: { headline: 'Manage your subscription' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
    },
    default_return_url: `${config.PUBLIC_WEB_URL}/portal`,
  }).catch(() => undefined);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});

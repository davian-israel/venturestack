import { AsyncLocalStorage } from 'async_hooks';
import { q } from '../db/db';

/**
 * Attributes costs to a product without threading arguments everywhere:
 * runProduct() and the marketer wrap their work in withCostContext({ product, kind }).
 */
export interface CostCtx {
  product?: string;
  kind: 'delivery' | 'marketing';
}
export const costContext = new AsyncLocalStorage<CostCtx>();
export const withCostContext = <T>(ctx: CostCtx, fn: () => Promise<T>) => costContext.run(ctx, fn);

// USD per million tokens (override with env when pricing changes).
const IN_PER_MTOK = Number(process.env.ANTHROPIC_INPUT_USD_PER_MTOK ?? 3);
const OUT_PER_MTOK = Number(process.env.ANTHROPIC_OUTPUT_USD_PER_MTOK ?? 15);

export function tokenCostCents(inputTokens: number, outputTokens: number): number {
  return ((inputTokens * IN_PER_MTOK + outputTokens * OUT_PER_MTOK) / 1_000_000) * 100;
}

export async function recordCost(kind: string, cents: number, product?: string | null, meta?: Record<string, unknown>) {
  if (!(cents > 0)) return;
  await q('INSERT INTO cost_events (kind, amount_cents, product_slug, meta) VALUES ($1,$2,$3,$4)', [kind, cents, product ?? null, meta ?? null]).catch(
    () => undefined, // cost tracking must never break delivery
  );
}

export async function recordAiUsage(inputTokens: number, outputTokens: number) {
  const ctx = costContext.getStore();
  await recordCost(ctx?.kind === 'marketing' ? 'ai_marketing' : 'ai', tokenCostCents(inputTokens, outputTokens), ctx?.product, {
    in: inputTokens,
    out: outputTokens,
  });
}

/** Stripe standard pricing estimate (card, domestic). Override with env for your account. */
export function stripeFeeCents(amountCents: number): number {
  const pct = Number(process.env.STRIPE_FEE_PCT ?? 2.9);
  const fixed = Number(process.env.STRIPE_FEE_FIXED_CENTS ?? 30);
  return Math.round((amountCents * pct) / 100 + fixed);
}

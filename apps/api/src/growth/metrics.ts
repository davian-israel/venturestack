import { PRODUCTS, bySlug, targetMonthlyRevenueCents } from '@vs/catalog';
import { integrations } from '../config';
import { q } from '../db/db';
import { getSettings } from './settings';

const LIVE = `status IN ('active','trialing','past_due')`;

/** Daily snapshot of clients and MRR per product (for the trend chart). */
export async function snapshotMrr() {
  const rows = await q<{ product_slug: string; n: number }>(
    `SELECT product_slug, count(*)::int AS n FROM entitlements WHERE ${LIVE} GROUP BY 1`,
  );
  const counts = new Map(rows.map((r) => [r.product_slug, r.n]));
  for (const p of PRODUCTS) {
    const n = counts.get(p.slug) ?? 0;
    await q(
      `INSERT INTO mrr_snapshots (day, product_slug, clients, mrr_cents) VALUES (CURRENT_DATE,$1,$2,$3)
       ON CONFLICT (day, product_slug) DO UPDATE SET clients=EXCLUDED.clients, mrr_cents=EXCLUDED.mrr_cents`,
      [p.slug, n, n * p.monthlyCents],
    );
  }
  return { snapshot: rows.length };
}

/** Pure pacing maths (unit-tested): how many new clients a week are needed to hit target by the date. */
export function pace(input: { currentMonthlyCents: number; targetMonthlyCents: number; avgNewClientMonthlyCents: number; weeksLeft: number; newClientsLast4Weeks: number }) {
  const gap = Math.max(0, input.targetMonthlyCents - input.currentMonthlyCents);
  const perClient = Math.max(1, input.avgNewClientMonthlyCents);
  const clientsNeeded = Math.ceil(gap / perClient);
  const requiredPerWeek = input.weeksLeft > 0 ? clientsNeeded / input.weeksLeft : clientsNeeded;
  const actualPerWeek = input.newClientsLast4Weeks / 4;
  const weeksAtCurrentPace = actualPerWeek > 0 ? Math.ceil(clientsNeeded / actualPerWeek) : null;
  const status = gap === 0 ? 'hit' : actualPerWeek >= requiredPerWeek ? 'on_track' : actualPerWeek >= requiredPerWeek * 0.6 ? 'behind' : 'off_track';
  return { gapCents: gap, clientsNeeded, requiredPerWeek: Math.round(requiredPerWeek * 10) / 10, actualPerWeek: Math.round(actualPerWeek * 10) / 10, weeksAtCurrentPace, status };
}

export async function computeMetrics() {
  const settings = await getSettings();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const monthFraction = now.getUTCDate() / daysInMonth;

  // ---- clients & revenue per product
  const live = await q<{ product_slug: string; n: number }>(`SELECT product_slug, count(*)::int n FROM entitlements WHERE ${LIVE} GROUP BY 1`);
  const signups = await q<{ product_slug: string; d7: number; d30: number; d28: number }>(
    `SELECT product_slug,
            count(*) FILTER (WHERE created_at > now() - interval '7 days')::int d7,
            count(*) FILTER (WHERE created_at > now() - interval '28 days')::int d28,
            count(*) FILTER (WHERE created_at > now() - interval '30 days')::int d30
     FROM entitlements GROUP BY 1`,
  );
  const churn = await q<{ product_slug: string; n: number }>(
    `SELECT product_slug, count(*)::int n FROM entitlements WHERE canceled_at > now() - interval '30 days' GROUP BY 1`,
  );
  const cash = await q<{ product_slug: string | null; mtd: number; d30: number; fees_mtd: number; fees30: number; oneoff30: number }>(
    `SELECT product_slug,
            COALESCE(sum(amount_cents) FILTER (WHERE paid_at >= $1),0)::int mtd,
            COALESCE(sum(amount_cents) FILTER (WHERE paid_at > now() - interval '30 days'),0)::int d30,
            COALESCE(sum(fee_cents_est) FILTER (WHERE paid_at >= $1),0)::int fees_mtd,
            COALESCE(sum(fee_cents_est) FILTER (WHERE paid_at > now() - interval '30 days'),0)::int fees30,
            COALESCE(sum(amount_cents) FILTER (WHERE paid_at > now() - interval '30 days' AND kind = 'one_off'),0)::int oneoff30
     FROM payments GROUP BY 1`,
    [monthStart],
  );
  const costs = await q<{ product_slug: string | null; kind: string; mtd: number; d30: number }>(
    `SELECT product_slug, kind,
            COALESCE(sum(amount_cents) FILTER (WHERE day >= $1::date),0)::float mtd,
            COALESCE(sum(amount_cents) FILTER (WHERE day > CURRENT_DATE - 30),0)::float d30
     FROM cost_events GROUP BY 1,2`,
    [monthStart],
  );

  const get = <T extends { product_slug: string | null }>(rows: T[], slug: string) => rows.find((r) => r.product_slug === slug);
  const products = PRODUCTS.map((p) => {
    const clients = get(live, p.slug)?.n ?? 0;
    const mrr = clients * p.monthlyCents;
    const c = get(cash, p.slug);
    const measured = costs.filter((r) => r.product_slug === p.slug).reduce((s, r) => s + r.d30, 0);
    const delivery = clients * p.estCostPerClientCents;
    const cost30 = Math.round(measured + delivery + (c?.fees30 ?? 0));
    const revenue30 = c?.d30 ?? 0;
    return {
      slug: p.slug,
      name: p.name,
      wave: p.wave,
      promoted: p.wave <= settings.maxWave && !settings.paused.includes(p.slug),
      paused: settings.paused.includes(p.slug),
      clients,
      targetClients: p.targetClients,
      mrrCents: mrr,
      targetMrrCents: p.targetClients * p.monthlyCents,
      revenue30Cents: revenue30,
      cost30Cents: cost30,
      profit30Cents: revenue30 - cost30,
      signups7: get(signups, p.slug)?.d7 ?? 0,
      signups30: get(signups, p.slug)?.d30 ?? 0,
      churn30: get(churn, p.slug)?.n ?? 0,
    };
  });

  const mrr = products.reduce((s, p) => s + p.mrrCents, 0);
  const paying = products.reduce((s, p) => s + p.clients, 0);
  const oneOff30 = cash.reduce((s, r) => s + r.oneoff30, 0);
  // Same basis as the $26,100 target: recurring MRR + one-off audits sold in the last 30 days.
  // Setup fees are cash (shown in cash collected) but are not recurring revenue.
  const runRateRevenue = mrr + oneOff30;
  const cashMtd = cash.reduce((s, r) => s + r.mtd, 0);
  const measuredMtd = costs.reduce((s, r) => s + r.mtd, 0);
  const feesMtd = cash.reduce((s, r) => s + r.fees_mtd, 0);
  const deliveryMonthly = products.reduce((s, p) => s + p.clients * (bySlug(p.slug)!.estCostPerClientCents), 0);
  const costsMtd = Math.round(measuredMtd + feesMtd + (deliveryMonthly + settings.fixedMonthlyCostCents) * monthFraction);
  const measured30 = costs.reduce((s, r) => s + r.d30, 0);
  const fees30 = cash.reduce((s, r) => s + r.fees30, 0);
  const runRateCosts = Math.round(measured30 + fees30 + deliveryMonthly + settings.fixedMonthlyCostCents);
  const signups7 = products.reduce((s, p) => s + p.signups7, 0);
  const signups28 = signups.reduce((s, r) => s + r.d28, 0);
  const churn30 = products.reduce((s, p) => s + p.churn30, 0);

  const targetCents = targetMonthlyRevenueCents();
  const weeksLeft = Math.max(0, (Date.parse(settings.targetDate) - now.getTime()) / (7 * 86_400_000));
  const avgNew = PRODUCTS.filter((p) => p.wave <= settings.maxWave).reduce((s, p, _, a) => s + p.monthlyCents / a.length, 0);

  // ---- trend (daily snapshots, last 120 days)
  const trend = await q<{ day: string; mrr_cents: number; clients: number }>(
    `SELECT to_char(day,'YYYY-MM-DD') AS day, sum(mrr_cents)::int mrr_cents, sum(clients)::int clients
     FROM mrr_snapshots WHERE day > CURRENT_DATE - 120 GROUP BY day ORDER BY day`,
  );
  const weeklyRevenue = await q<{ week: string; cents: number }>(
    `SELECT to_char(date_trunc('week', paid_at),'YYYY-MM-DD') week, sum(amount_cents)::int cents
     FROM payments WHERE paid_at > now() - interval '16 weeks' GROUP BY 1 ORDER BY 1`,
  );

  // ---- funnel (last 28 days) per product
  const prospectF = await q<{ product_slug: string; added: number; proofed: number; enrolled: number; won: number }>(
    `SELECT product_slug,
            count(*) FILTER (WHERE created_at > now() - interval '28 days')::int added,
            count(*) FILTER (WHERE proof_slug IS NOT NULL AND created_at > now() - interval '28 days')::int proofed,
            count(*) FILTER (WHERE enrolled_at > now() - interval '28 days')::int enrolled,
            count(*) FILTER (WHERE won_at > now() - interval '28 days')::int won
     FROM prospects GROUP BY 1`,
  );
  const campF = await q<{ product_slug: string; event: string; n: number }>(
    `SELECT product_slug, event, count(DISTINCT email)::int n FROM campaign_events WHERE created_at > now() - interval '28 days' GROUP BY 1,2`,
  );
  const webF = await q<{ product_slug: string; type: string; n: number }>(
    `SELECT product_slug, type, count(*)::int n FROM funnel_events WHERE created_at > now() - interval '28 days' GROUP BY 1,2`,
  );
  const funnel = PRODUCTS.map((p) => {
    const pf = get(prospectF, p.slug);
    const ce = (e: string) => campF.find((r) => r.product_slug === p.slug && r.event === e)?.n ?? 0;
    const we = (t: string) => webF.find((r) => r.product_slug === p.slug && r.type === t)?.n ?? 0;
    return {
      slug: p.slug,
      name: p.name,
      stages: [
        { stage: 'Prospects found', n: pf?.added ?? 0 },
        { stage: 'Proof built', n: pf?.proofed ?? 0 },
        { stage: 'Emailed', n: pf?.enrolled ?? 0 },
        { stage: 'Opened', n: ce('opened') },
        { stage: 'Replied', n: ce('replied') },
        { stage: 'Proof page visits', n: we('proof_view') },
        { stage: 'Checkout started', n: we('checkout_started') },
        { stage: 'Paid', n: we('checkout_completed') },
      ],
      bounced: ce('bounced'),
      unsubscribed: ce('unsubscribed'),
      pageViews: we('page_view'),
    };
  });

  // ---- subject-line variants
  const variants = await q(
    `SELECT v.id, v.product_slug, v.subject, v.status, v.source, to_char(v.created_at,'YYYY-MM-DD') created,
            count(DISTINCT p.id)::int sends,
            count(DISTINCT ce.email) FILTER (WHERE ce.event='opened')::int opens,
            count(DISTINCT ce.email) FILTER (WHERE ce.event='replied')::int replies
     FROM sequence_variants v
     LEFT JOIN prospects p ON p.variant_id=v.id AND p.enrolled_at IS NOT NULL
     LEFT JOIN campaign_events ce ON ce.variant_id=v.id
     GROUP BY v.id ORDER BY v.product_slug, v.status, v.created_at`,
  );

  const costBreakdown = [
    ...['ai', 'ai_marketing', 'prospecting'].map((k) => ({ kind: k, cents: Math.round(costs.filter((r) => r.kind === k).reduce((s, r) => s + r.d30, 0)) })),
    { kind: 'stripe_fees_est', cents: fees30 },
    { kind: 'delivery_est', cents: deliveryMonthly },
    { kind: 'fixed', cents: settings.fixedMonthlyCostCents },
  ];

  const runs = await q(
    `SELECT to_char(started_at,'YYYY-MM-DD HH24:MI') started, round(extract(epoch FROM finished_at - started_at)/60)::int minutes, stats
     FROM marketing_runs ORDER BY started_at DESC LIMIT 14`,
  );
  const log = await q(
    `SELECT to_char(week,'YYYY-MM-DD') week, kind, product_slug, summary, detail FROM optimiser_log ORDER BY created_at DESC LIMIT 40`,
  );

  return {
    asOf: now.toISOString(),
    target: { monthlyRevenueCents: targetCents, recurringCents: products.reduce((s, p) => s + p.targetMrrCents, 0), date: settings.targetDate },
    kpis: {
      mrrCents: mrr,
      runRateRevenueCents: runRateRevenue,
      cashMtdCents: cashMtd,
      costsMtdCents: costsMtd,
      profitMtdCents: cashMtd - costsMtd,
      runRateCostsCents: runRateCosts,
      runRateProfitCents: runRateRevenue - runRateCosts,
      marginPct: runRateRevenue > 0 ? Math.round(((runRateRevenue - runRateCosts) / runRateRevenue) * 100) : null,
      payingClients: paying,
      signups7,
      signups30: products.reduce((s, p) => s + p.signups30, 0),
      churn30,
      churnRatePct: paying + churn30 > 0 ? Math.round((churn30 / (paying + churn30)) * 1000) / 10 : 0,
      progressPct: Math.round((runRateRevenue / targetCents) * 1000) / 10,
    },
    pace: pace({ currentMonthlyCents: runRateRevenue, targetMonthlyCents: targetCents, avgNewClientMonthlyCents: avgNew, weeksLeft, newClientsLast4Weeks: signups28 }),
    products,
    trend,
    weeklyRevenue,
    funnel,
    variants,
    costBreakdown,
    runs,
    log,
    settings,
    integrations: integrations(),
  };
}

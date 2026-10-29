import { PRODUCTS, bySlug, usd } from '@vs/catalog';
import { config } from '../config';
import { one, q } from '../db/db';
import { askJson, claudeAvailable } from '../ai/claude';
import { esc, sendMail } from '../mail/mailer';
import { withCostContext } from './costs';
import { computeMetrics } from './metrics';
import { BOUNDS, GrowthSettings, getSettings, saveSettings } from './settings';

/**
 * Weekly growth review. Runs Monday 05:00 London. It may change ONLY:
 *   - the daily send cap (±10/week, within [10, ceiling])
 *   - how that cap is split between promoted products
 *   - pausing a product's outreach when bounces/unsubscribes signal list or deliverability trouble
 *   - unlocking the next wave of products
 *   - retiring a losing subject line and adding a new challenger
 * Prices, offers, client claims and legal guardrails are never changed automatically — those
 * become recommendations in the weekly review email and on the dashboard.
 */

export interface ProductStats {
  slug: string;
  wave: number;
  clients: number;
  targetClients: number;
  enrolled: number; // last 28 days
  replies: number;
  won: number;
  bounced: number;
  unsubscribed: number;
  revenue30: number;
  cost30: number;
}
export interface VariantStats {
  id: string;
  product: string;
  subject: string;
  status: string;
  sends: number;
  replies: number;
}
export interface Decision {
  settings: GrowthSettings;
  changes: { product?: string; summary: string; detail?: Record<string, unknown> }[];
  recommendations: { product?: string; summary: string; detail?: Record<string, unknown> }[];
  retire: string[];
  challengers: { product: string; winnerSubject: string; loserSubject?: string }[];
}

/** One-sided two-proportion z statistic: how sure are we that a beats b? */
export function zScore(aSucc: number, aN: number, bSucc: number, bN: number): number {
  if (aN === 0 || bN === 0) return 0;
  const p = (aSucc + bSucc) / (aN + bN);
  const se = Math.sqrt(p * (1 - p) * (1 / aN + 1 / bN));
  return se === 0 ? 0 : (aSucc / aN - bSucc / bN) / se;
}

export function decide(input: {
  settings: GrowthSettings;
  products: ProductStats[];
  variants: VariantStats[];
  pace: { status: string; requiredPerWeek: number };
  runRateProfitCents: number;
  now?: Date;
}): Decision {
  const s: GrowthSettings = JSON.parse(JSON.stringify(input.settings));
  const d: Decision = { settings: s, changes: [], recommendations: [], retire: [], challengers: [] };
  const now = input.now ?? new Date();
  const rate = (a: number, b: number) => (b > 0 ? a / b : 0);

  // 1. Deliverability guard — pause a product whose list is hurting the sending domain.
  for (const p of input.products) {
    if (p.enrolled < 30 || s.paused.includes(p.slug)) continue;
    const bounce = rate(p.bounced, p.enrolled);
    const unsub = rate(p.unsubscribed, p.enrolled);
    if (bounce > 0.05 || unsub > 0.03) {
      s.paused.push(p.slug);
      d.changes.push({
        product: p.slug,
        summary: `Paused outreach for ${bySlug(p.slug)?.name}: bounce ${(bounce * 100).toFixed(1)}%, unsubscribe ${(unsub * 100).toFixed(1)}% (limits 5% / 3%).`,
        detail: { bounce, unsub },
      });
      d.recommendations.push({ product: p.slug, summary: `Check the prospect source for ${bySlug(p.slug)?.name}, then un-pause it from the dashboard.` });
    }
  }

  // 2. Send-cap ramp: grow while the list is clean and the capacity is being used; shrink on trouble.
  const tot = input.products.reduce(
    (a, p) => ({ enrolled: a.enrolled + p.enrolled, bounced: a.bounced + p.bounced }),
    { enrolled: 0, bounced: 0 },
  );
  const overallBounce = rate(tot.bounced, tot.enrolled);
  const usedCapacity = tot.enrolled >= s.dailySendCap * 28 * 0.8;
  const prevCap = s.dailySendCap;
  if (overallBounce > 0.05) s.dailySendCap = Math.max(BOUNDS.dailySendCapMin, s.dailySendCap - BOUNDS.weeklyCapStep);
  else if (overallBounce < 0.03 && usedCapacity && input.pace.status !== 'hit')
    s.dailySendCap = Math.min(BOUNDS.dailySendCapCeiling, s.dailySendCap + BOUNDS.weeklyCapStep);
  if (s.dailySendCap !== prevCap) {
    d.changes.push({ summary: `Daily send cap ${prevCap} → ${s.dailySendCap} (overall bounce ${(overallBounce * 100).toFixed(1)}%).`, detail: { overallBounce } });
  } else if (s.dailySendCap >= BOUNDS.dailySendCapCeiling && input.pace.status === 'off_track') {
    d.recommendations.push({ summary: `Send cap is at its ceiling (${BOUNDS.dailySendCapCeiling}/day) and revenue is off track: add warmed inboxes and raise MARKETING_SEND_CAP_CEILING, or add a channel.` });
  }

  // 3. Wave unlock: start with one offer (the video's advice); add the next wave when the current
  //    one is half-way to its client target, or after 8 weeks off-track (diversify).
  const current = input.products.filter((p) => p.wave <= s.maxWave);
  const currentClients = current.reduce((a, p) => a + p.clients, 0);
  const currentTarget = current.reduce((a, p) => a + p.targetClients, 0);
  const lastWaveChange = (s as any).lastWaveChange ? Date.parse((s as any).lastWaveChange) : 0;
  const weeksSinceWave = (now.getTime() - lastWaveChange) / (7 * 86_400_000);
  if (s.maxWave < 3 && (currentClients >= currentTarget * 0.5 || (input.pace.status === 'off_track' && weeksSinceWave >= 8 && lastWaveChange > 0))) {
    s.maxWave += 1;
    (s as any).lastWaveChange = now.toISOString().slice(0, 10);
    const added = PRODUCTS.filter((p) => p.wave === s.maxWave).map((p) => p.name);
    d.changes.push({ summary: `Unlocked wave ${s.maxWave}: now promoting ${added.join(', ')} (${currentClients}/${currentTarget} clients on current offers).` });
  } else if (!lastWaveChange) {
    (s as any).lastWaveChange = now.toISOString().slice(0, 10);
  }

  // 4. Split the cap: weight by reply + win rate (smoothed), lower weight once a product reaches its client target.
  const promoted = PRODUCTS.filter((p) => p.wave <= s.maxWave && !s.paused.includes(p.slug)).map((p) => p.slug);
  const scores = promoted.map((slug) => {
    const p = input.products.find((x) => x.slug === slug);
    const score = ((p?.replies ?? 0) + 5 * (p?.won ?? 0) + 1) / ((p?.enrolled ?? 0) + 20);
    const atTarget = p && p.clients >= p.targetClients;
    return { slug, score: score * (atTarget ? 0.3 : 1) };
  });
  const sum = scores.reduce((a, x) => a + x.score, 0) || 1;
  let weights = Object.fromEntries(scores.map((x) => [x.slug, Math.max(BOUNDS.minWeight, x.score / sum)]));
  const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  weights = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Math.round((v / wsum) * 1000) / 1000]));
  const moved = Object.keys(weights).some((k) => Math.abs((s.weights[k] ?? 0) - weights[k]) >= 0.05) || Object.keys(s.weights).some((k) => !(k in weights));
  if (moved && promoted.length > 1) {
    d.changes.push({ summary: `Rebalanced daily sends: ${Object.entries(weights).map(([k, v]) => `${bySlug(k)?.name} ${Math.round(v * 100)}%`).join(', ')}.`, detail: { weights } });
  }
  s.weights = weights;

  // 5. Subject-line A/B: keep 2 active variants per promoted product; retire a clear loser.
  for (const slug of promoted) {
    const active = input.variants.filter((v) => v.product === slug && v.status === 'active');
    if (active.length >= 2 && active.every((v) => v.sends >= 80)) {
      const sorted = [...active].sort((a, b) => rate(b.replies, b.sends) - rate(a.replies, a.sends));
      const best = sorted[0];
      const worst = sorted.at(-1)!;
      const z = zScore(best.replies, best.sends, worst.replies, worst.sends);
      if (z >= 1.64) {
        d.retire.push(worst.id);
        d.challengers.push({ product: slug, winnerSubject: best.subject, loserSubject: worst.subject });
        d.changes.push({
          product: slug,
          summary: `Subject test (${bySlug(slug)?.name}): "${best.subject}" beat "${worst.subject}" (${(rate(best.replies, best.sends) * 100).toFixed(1)}% vs ${(rate(worst.replies, worst.sends) * 100).toFixed(1)}% replies). Loser retired, new challenger added.`,
          detail: { z },
        });
      }
    } else if (active.length === 1) {
      d.challengers.push({ product: slug, winnerSubject: active[0].subject });
    }
  }

  // 6. Profitability & pace — recommendations only (pricing is a human decision).
  for (const p of input.products) {
    if (p.clients >= 2 && p.revenue30 > 0 && p.revenue30 - p.cost30 < 0) {
      d.recommendations.push({
        product: p.slug,
        summary: `${bySlug(p.slug)?.name} lost ${usd(p.cost30 - p.revenue30)} over 30 days: review delivery cost or price (currently ${usd(bySlug(p.slug)!.monthlyCents)}/mo).`,
      });
    }
    if (p.enrolled >= 150 && p.replies / p.enrolled < 0.01) {
      d.recommendations.push({ product: p.slug, summary: `${bySlug(p.slug)?.name}: reply rate under 1% on ${p.enrolled} emails — the audience or the hook needs changing, not just the subject line.` });
    }
  }
  if (input.runRateProfitCents < 0) {
    d.recommendations.push({ summary: `Running at a loss of ${usd(-input.runRateProfitCents)}/month: cut fixed tools you are not using, or concentrate sends on the best-converting offer.` });
  }
  if (input.pace.status === 'off_track' || input.pace.status === 'behind') {
    d.recommendations.push({ summary: `Revenue is ${input.pace.status.replace('_', ' ')}: you need about ${input.pace.requiredPerWeek} new clients a week to hit the target date.` });
  }
  return d;
}

// ------------------------------------------------------------------ runner
export async function runOptimiser() {
  return withCostContext({ kind: 'marketing' }, async () => {
    const week = new Date().toISOString().slice(0, 10);
    const already = await one(`SELECT 1 FROM optimiser_log WHERE week=$1 AND kind='review'`, [week]);
    if (already) return { skipped: 'already reviewed this week' };

    const m = await computeMetrics();
    const settings = await getSettings();
    const products: ProductStats[] = m.products.map((p) => {
      const f = m.funnel.find((x) => x.slug === p.slug)!;
      const st = (name: string) => f.stages.find((x) => x.stage === name)?.n ?? 0;
      return {
        slug: p.slug, wave: p.wave, clients: p.clients, targetClients: p.targetClients,
        enrolled: st('Emailed'), replies: st('Replied'), won: st('Paid'),
        bounced: f.bounced, unsubscribed: f.unsubscribed, revenue30: p.revenue30Cents, cost30: p.cost30Cents,
      };
    });
    const variants: VariantStats[] = (m.variants as any[]).map((v) => ({ id: v.id, product: v.product_slug, subject: v.subject, status: v.status, sends: v.sends, replies: v.replies }));
    const d = decide({ settings, products, variants, pace: m.pace, runRateProfitCents: m.kpis.runRateProfitCents });

    await saveSettings(d.settings);
    for (const id of d.retire) await q(`UPDATE sequence_variants SET status='retired', retired_at=now() WHERE id=$1`, [id]);
    if (claudeAvailable()) {
      for (const c of d.challengers) {
        try {
          const product = bySlug(c.product)!;
          const out = await askJson<{ subject: string }>(
            `You write cold-email subject lines for "${product.name}" (${product.tagline}) aimed at ${product.audience}.
Rules: under 60 characters; specific; no clickbait, no ALL CAPS, no emojis, no "Re:" or "Fwd:" tricks, no claims about results or clients.
Allowed placeholders: {{company}}, {{firstName}}${c.product === 'agent-reach' ? ', {{threadCount}}' : ''}.`,
            `Current best subject: "${c.winnerSubject}"${c.loserSubject ? `\nJust lost: "${c.loserSubject}"` : ''}\nWrite ONE new challenger with a different angle. Return {"subject": "..."}.`,
            200,
          );
          const subject = String(out.subject ?? '').trim().slice(0, 80);
          if (subject && !/\b(re|fwd):/i.test(subject)) {
            await q(`INSERT INTO sequence_variants (product_slug, step, subject, source) VALUES ($1,1,$2,'optimiser')`, [c.product, subject]);
          }
        } catch {
          /* challenger generation is best-effort */
        }
      }
    }

    for (const c of d.changes) await q(`INSERT INTO optimiser_log (week, kind, product_slug, summary, detail) VALUES ($1,'change',$2,$3,$4)`, [week, c.product ?? null, c.summary, c.detail ?? null]);
    for (const r of d.recommendations) await q(`INSERT INTO optimiser_log (week, kind, product_slug, summary, detail) VALUES ($1,'recommendation',$2,$3,$4)`, [week, r.product ?? null, r.summary, r.detail ?? null]);

    const k = m.kpis;
    const headline = `Run-rate ${usd(k.runRateRevenueCents)}/mo of ${usd(m.target.monthlyRevenueCents)} target (${k.progressPct}%) · ${k.payingClients} clients · ${k.signups7} new this week · profit ${usd(k.runRateProfitCents)}/mo`;
    await q(`INSERT INTO optimiser_log (week, kind, summary, detail) VALUES ($1,'review',$2,$3)`, [week, headline, { kpis: k, pace: m.pace }]);

    const list = (xs: { summary: string }[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x.summary)}</li>`).join('')}</ul>` : '<p>None.</p>');
    await sendMail(
      config.OWNER_EMAIL,
      `Weekly growth review — ${usd(k.runRateRevenueCents)}/mo (${k.progressPct}% of target)`,
      `<h2>Week of ${week}</h2><p>${esc(headline)}</p>
<p>Pace: <b>${esc(m.pace.status.replace('_', ' '))}</b> — need ${m.pace.requiredPerWeek} new clients/week, averaging ${m.pace.actualPerWeek}.</p>
<h3>Changes made automatically</h3>${list(d.changes)}
<h3>Your decisions</h3>${list(d.recommendations)}
<p><a href="${config.PUBLIC_WEB_URL}/admin">Open the dashboard</a></p>`,
    ).catch(() => undefined);

    return { changes: d.changes.length, recommendations: d.recommendations.length };
  });
}

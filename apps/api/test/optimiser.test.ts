import './env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS } from '@vs/catalog';
import { decide, zScore, ProductStats } from '../src/growth/optimiser';
import { pace } from '../src/growth/metrics';
import { allocate, activeProducts } from '../src/marketing/runner';
import { BOUNDS } from '../src/growth/settings';

const base = { dailySendCap: 60, maxWave: 1, weights: {}, paused: [] as string[], targetDate: '2027-04-30', fixedMonthlyCostCents: 20_000 };
const stats = (o: Partial<ProductStats> & { slug: string }): ProductStats => ({
  wave: PRODUCTS.find((p) => p.slug === o.slug)!.wave, clients: 0, targetClients: 10, enrolled: 0, replies: 0, won: 0, bounced: 0, unsubscribed: 0, revenue30: 0, cost30: 0, ...o,
});
const all = (over: Record<string, Partial<ProductStats>> = {}) => PRODUCTS.map((p) => stats({ slug: p.slug, targetClients: p.targetClients, ...(over[p.slug] ?? {}) }));
const now = new Date('2026-11-02T05:00:00Z');

test('pacing: clients needed per week to close the gap', () => {
  const r = pace({ currentMonthlyCents: 400_000, targetMonthlyCents: 2_610_000, avgNewClientMonthlyCents: 40_000, weeksLeft: 26, newClientsLast4Weeks: 4 });
  assert.equal(r.clientsNeeded, 56);
  assert.equal(r.requiredPerWeek, 2.2);
  assert.equal(r.actualPerWeek, 1);
  assert.equal(r.status, 'off_track');
  assert.equal(pace({ currentMonthlyCents: 3_000_000, targetMonthlyCents: 2_610_000, avgNewClientMonthlyCents: 40_000, weeksLeft: 10, newClientsLast4Weeks: 0 }).status, 'hit');
});

test('deliverability guard pauses a product with high bounces', () => {
  const d = decide({ settings: base, products: all({ 'agent-reach': { enrolled: 200, bounced: 14 } }), variants: [], pace: { status: 'behind', requiredPerWeek: 2 }, runRateProfitCents: 0, now });
  assert.ok(d.settings.paused.includes('agent-reach'));
  assert.ok(d.changes.some((c) => /Paused outreach/.test(c.summary)));
  assert.ok(d.settings.dailySendCap < 60, 'cap shrinks when overall bounce > 5%');
});

test('send cap ramps by 10/week only when clean and fully used, never past the ceiling', () => {
  const used = { enrolled: 60 * 28, bounced: 10, replies: 30 };
  const d = decide({ settings: base, products: all({ 'agent-reach': used }), variants: [], pace: { status: 'behind', requiredPerWeek: 2 }, runRateProfitCents: 0, now });
  assert.equal(d.settings.dailySendCap, 70);
  const atCeiling = decide({ settings: { ...base, dailySendCap: BOUNDS.dailySendCapCeiling }, products: all({ 'agent-reach': { ...used, enrolled: BOUNDS.dailySendCapCeiling * 28 } }), variants: [], pace: { status: 'off_track', requiredPerWeek: 5 }, runRateProfitCents: 0, now });
  assert.equal(atCeiling.settings.dailySendCap, BOUNDS.dailySendCapCeiling);
  assert.ok(atCeiling.recommendations.some((r) => /ceiling/.test(r.summary)));
  const unused = decide({ settings: base, products: all({ 'agent-reach': { enrolled: 100 } }), variants: [], pace: { status: 'behind', requiredPerWeek: 2 }, runRateProfitCents: 0, now });
  assert.equal(unused.settings.dailySendCap, 60, 'no ramp when capacity is not used');
});

test('wave 2 unlocks once Agent Reach reaches half its client target', () => {
  const no = decide({ settings: base, products: all({ 'agent-reach': { clients: 4 } }), variants: [], pace: { status: 'behind', requiredPerWeek: 2 }, runRateProfitCents: 0, now });
  assert.equal(no.settings.maxWave, 1);
  const yes = decide({ settings: base, products: all({ 'agent-reach': { clients: 5 } }), variants: [], pace: { status: 'behind', requiredPerWeek: 2 }, runRateProfitCents: 0, now });
  assert.equal(yes.settings.maxWave, 2);
  assert.ok(yes.changes.some((c) => /Unlocked wave 2/.test(c.summary)));
});

test('weights favour the better-converting product but keep a 10% floor', () => {
  const d = decide({
    settings: { ...base, maxWave: 2 },
    products: all({ 'agent-reach': { enrolled: 400, replies: 30, won: 4 }, 'ar-recovery': { enrolled: 400, replies: 2, won: 0 } }),
    variants: [], pace: { status: 'behind', requiredPerWeek: 2 }, runRateProfitCents: 0, now,
  });
  const w = d.settings.weights;
  assert.ok(w['agent-reach'] > w['ar-recovery']);
  assert.ok(Object.values(w).every((x) => x >= 0.09));
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 0.01);
});

test('subject A/B: a significant loser is retired and a challenger requested', () => {
  assert.ok(zScore(20, 200, 5, 200) > 1.64);
  assert.ok(zScore(8, 200, 6, 200) < 1.64);
  const variants = [
    { id: 'a', product: 'agent-reach', subject: 'A', status: 'active', sends: 200, replies: 20 },
    { id: 'b', product: 'agent-reach', subject: 'B', status: 'active', sends: 200, replies: 5 },
  ];
  const d = decide({ settings: base, products: all(), variants, pace: { status: 'behind', requiredPerWeek: 2 }, runRateProfitCents: 0, now });
  assert.deepEqual(d.retire, ['b']);
  assert.equal(d.challengers[0].winnerSubject, 'A');
  const close = decide({ settings: base, products: all(), variants: [variants[0], { ...variants[1], replies: 17 }], pace: { status: 'behind', requiredPerWeek: 2 }, runRateProfitCents: 0, now });
  assert.deepEqual(close.retire, [], 'no retirement without significance');
});

test('pricing is never changed automatically — losses become recommendations', () => {
  const d = decide({ settings: base, products: all({ 'agent-reach': { clients: 3, revenue30: 120_000, cost30: 150_000 } }), variants: [], pace: { status: 'on_track', requiredPerWeek: 1 }, runRateProfitCents: -5_000, now });
  assert.ok(d.recommendations.some((r) => /review delivery cost or price/.test(r.summary)));
  assert.ok(d.recommendations.some((r) => /Running at a loss/.test(r.summary)));
  assert.equal(JSON.stringify(Object.keys(d.settings).sort()), JSON.stringify([...Object.keys(base), 'lastWaveChange'].sort()));
});

test('marketer split follows weights and skips paused products', () => {
  const prods = activeProducts({ maxWave: 2, paused: ['ar-recovery'] });
  assert.ok(!prods.some((p) => p.slug === 'ar-recovery'));
  const a = allocate(prods, 100, { 'agent-reach': 0.5 });
  assert.ok(a['agent-reach'] > a['offline-attribution']);
});

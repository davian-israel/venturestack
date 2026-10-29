import './env';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bySlug, PRODUCTS } from '@vs/catalog';
import { assertFilled, blockReason, fill, inRunWindow, isBusinessEmail } from '../src/marketing/guardrails';
import { applyClaimsToggle, sequenceFor, STEP_DAYS } from '../src/marketing/sequences';
import { renderSequence } from '../src/marketing/runner';
import { aging, bucketOf, daysOverdue, reminderDue } from '../src/products/ar-recovery/aging';

test('03:00 London window holds across BST and GMT', () => {
  assert.equal(inRunWindow(new Date('2026-07-15T02:10:00Z'), 'Europe/London', 3), true); // BST: 03:10
  assert.equal(inRunWindow(new Date('2026-07-15T03:10:00Z'), 'Europe/London', 3), false); // BST: 04:10
  assert.equal(inRunWindow(new Date('2026-10-29T03:05:00Z'), 'Europe/London', 3), true); // GMT: 03:05
  assert.equal(inRunWindow(new Date('2026-10-29T02:05:00Z'), 'Europe/London', 3), false); // GMT: 02:05
});

test('only researched business addresses are emailed', () => {
  assert.equal(isBusinessEmail('jane@acme.io'), true);
  assert.equal(isBusinessEmail('jane@gmail.com'), false);
  assert.equal(isBusinessEmail('info@acme.io'), false);
  assert.equal(isBusinessEmail('not-an-email'), false);
});

test('send is blocked for suppression, replies and missing proof', () => {
  const base = { email: 'jane@acme.io', suppressed: false, status: 'proofed', realThreads: 3, requiresProof: true };
  assert.equal(blockReason(base), null);
  assert.equal(blockReason({ ...base, suppressed: true }), 'suppressed');
  assert.equal(blockReason({ ...base, status: 'replied' }), 'status:replied');
  assert.equal(blockReason({ ...base, realThreads: 1 }), 'fewer than 2 real threads');
});

test('unfilled slots stop a send', () => {
  assert.throws(() => assertFilled(fill('Hi {{firstName}} at {{company}}', { firstName: 'Jane' })), /company/);
  assert.doesNotThrow(() => assertFilled(fill('Hi {{firstName}}', { firstName: 'Jane' })));
});

test('client claims are removed until switched on', () => {
  const t = 'A\n\n[[clients]]Most teams we work with love it.[[/clients]]\n\nB';
  assert.equal(applyClaimsToggle(t, false).includes('teams we work with'), false);
  assert.equal(applyClaimsToggle(t, true).includes('Most teams we work with love it.'), true);
});

test('every product has a 4-step Day 1/4/8/13 sequence', () => {
  for (const p of PRODUCTS) assert.deepEqual(sequenceFor(p.slug).map((s) => s.day), STEP_DAYS);
});

test('Agent Reach sequence renders fully from real threads, with footer and unsubscribe', () => {
  const steps = renderSequence(bySlug('agent-reach')!, {
    email: 'jane@acme.io',
    first_name: 'Jane',
    company: 'Acme',
    competitor: 'Hubspot',
    proof_slug: 'abc',
    proof: {
      kind: 'threads',
      threads: [
        { community: 'r/SaaS', title: 'Alternative to X?', url: 'https://reddit.com/1', reply: 'Try Acme.' },
        { community: 'Hacker News', title: 'Need a tool for Y', url: 'https://news.ycombinator.com/item?id=2', reply: 'Acme does this.' },
      ],
    },
  });
  assert.equal(steps.length, 4);
  assert.match(steps[0].subject, /2 people looking for Acme/);
  assert.match(steps[0].body, /r\/SaaS: "Alternative to X\?"/);
  assert.match(steps[2].body, /cal\.example\.com/);
  assert.match(steps[3].body, /example\.com\/for\/abc/);
  for (const s of steps) assert.match(s.body, /1 Example Street, London[\s\S]*unsubscribe/i);
  assert.equal(steps[1].body.includes('teams we work with'), false);
});

test('AR aging buckets and reminder cadence', () => {
  const now = new Date('2026-10-29T10:00:00Z');
  assert.equal(daysOverdue('2026-10-26', now), 3);
  assert.equal(bucketOf(0), 'current');
  assert.equal(bucketOf(45), '31-60');
  assert.equal(bucketOf(120), '90+');
  assert.equal(reminderDue(3), 'reminder');
  assert.equal(reminderDue(14), 'reminder');
  assert.equal(reminderDue(30), 'escalation');
  assert.equal(reminderDue(44), 'escalation');
  assert.equal(reminderDue(5), null);
  const r = aging([
    { id: '1', number: 'A', client: 'c', balance: 1000, dueDate: '2026-11-10' },
    { id: '2', number: 'B', client: 'c', balance: 500, dueDate: '2026-08-01' },
  ], now);
  assert.equal(r.overdue, 500);
  assert.equal(r.totals['61-90'] + r.totals['90+'], 500);
});

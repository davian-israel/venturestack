import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEntitled, fromStripeStatus, graceUntil, lookupKey } from '../src/billing/entitlement-rules';
import { onboardingComplete } from '../src/jobs/fulfilment';

const now = new Date('2026-10-29T03:00:00Z');

test('active, trialing and one-off purchases pass the paywall', () => {
  for (const status of ['active', 'trialing', 'one_off']) assert.equal(isEntitled({ status, grace_until: null }, now), true);
});

test('no entitlement, canceled or incomplete are blocked', () => {
  assert.equal(isEntitled(undefined, now), false);
  assert.equal(isEntitled({ status: 'canceled', grace_until: null }, now), false);
  assert.equal(isEntitled({ status: 'incomplete', grace_until: null }, now), false);
});

test('past_due is allowed only inside the grace window', () => {
  assert.equal(isEntitled({ status: 'past_due', grace_until: graceUntil(now, 7) }, now), true);
  assert.equal(isEntitled({ status: 'past_due', grace_until: new Date('2026-10-28T00:00:00Z') }, now), false);
  assert.equal(isEntitled({ status: 'past_due', grace_until: null }, now), false);
});

test('stripe statuses map correctly', () => {
  assert.equal(fromStripeStatus('active'), 'active');
  assert.equal(fromStripeStatus('unpaid'), 'past_due');
  assert.equal(fromStripeStatus('incomplete_expired'), 'canceled');
  assert.equal(fromStripeStatus('paused'), 'canceled');
});

test('lookup keys are stable', () => {
  assert.equal(lookupKey('agent-reach', 'monthly'), 'agent-reach__monthly');
});

test('fulfilment waits for required onboarding fields and the consent gate', () => {
  const cfg = { whatTheySell: 'CRM for plumbers', keywords: ['plumber crm'] };
  assert.equal(onboardingComplete('agent-reach', cfg, null), false, 'consent missing');
  assert.equal(onboardingComplete('agent-reach', cfg, now), true);
  assert.equal(onboardingComplete('agent-reach', { ...cfg, keywords: [] }, now), false);
  // Voice cloning never runs without signed consent
  assert.equal(onboardingComplete('voice-studio', { sourceChannelId: 'x', spanishChannelRefreshToken: 'enc:x', voiceSampleUrl: 'u' }, null), false);
});

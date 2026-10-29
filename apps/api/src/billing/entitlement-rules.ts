/**
 * Pure paywall rules — no I/O, so they are unit-tested directly.
 */

export type EntitlementStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'one_off' | 'incomplete';

export interface EntitlementRow {
  status: EntitlementStatus | string;
  grace_until: Date | string | null;
  current_period_end?: Date | string | null;
}

/** Can this client use the product right now? */
export function isEntitled(row: EntitlementRow | undefined, now: Date = new Date()): boolean {
  if (!row) return false;
  switch (row.status) {
    case 'active':
    case 'trialing':
    case 'one_off':
      return true;
    case 'past_due':
      return !!row.grace_until && new Date(row.grace_until).getTime() > now.getTime();
    default:
      return false;
  }
}

/** Map a Stripe subscription status onto our entitlement status. */
export function fromStripeStatus(stripeStatus: string): EntitlementStatus {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'incomplete':
      return 'incomplete';
    default:
      // canceled, incomplete_expired, paused
      return 'canceled';
  }
}

export function graceUntil(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/** Stripe lookup keys used for every product's prices. */
export const lookupKey = (slug: string, kind: 'setup' | 'monthly' | 'oneoff') => `${slug}__${kind}`;

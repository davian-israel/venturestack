/** Pure receivables-aging logic (unit-tested). */

export interface OpenInvoice {
  id: string;
  number: string;
  client: string;
  balance: number;
  dueDate: string; // YYYY-MM-DD
}

export const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;
export type Bucket = (typeof BUCKETS)[number];

export function daysOverdue(dueDate: string, now = new Date()): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.floor((today - due) / 86_400_000);
}

export function bucketOf(days: number): Bucket {
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function aging(invoices: OpenInvoice[], now = new Date()) {
  const totals: Record<Bucket, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const inv of invoices) totals[bucketOf(daysOverdue(inv.dueDate, now))] += inv.balance;
  const overdue = totals['1-30'] + totals['31-60'] + totals['61-90'] + totals['90+'];
  return { totals, overdue };
}

/** The reminder cadence from the offer: 3, 7, 14 and 30 days past due. Escalations from 30. */
export const REMINDER_DAYS = [3, 7, 14, 30];
export function reminderDue(days: number): 'reminder' | 'escalation' | null {
  if (days >= 30 && (days - 30) % 14 === 0) return 'escalation';
  if (REMINDER_DAYS.includes(days)) return 'reminder';
  return null;
}

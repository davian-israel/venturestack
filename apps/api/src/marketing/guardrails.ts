/**
 * Pure rules the marketer must pass before any send. Unit-tested.
 */

export const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com',
  'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'yandex.com', 'zoho.com',
]);

/** B2B-only: corporate mailboxes. Free-mail addresses are often individuals/sole traders (PECR consent needed). */
export function isBusinessEmail(email: string): boolean {
  const m = email.toLowerCase().match(/^[^@\s]+@([^@\s]+\.[a-z]{2,})$/);
  if (!m) return false;
  if (FREE_MAIL.has(m[1])) return false;
  // Role inboxes are not a person we researched.
  return !/^(info|hello|contact|sales|support|admin|office|enquiries|team)@/.test(email.toLowerCase());
}

/** London-time clock check: true only during the configured start hour. Works across BST/GMT. */
export function inRunWindow(now: Date, tz: string, startHour: number): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(now));
  return hour === startHour;
}

/** Throws if any {{slot}} is left unfilled — prevents sending a broken or half-invented email. */
export function assertFilled(text: string): void {
  const left = text.match(/\{\{[^}]+\}\}/g);
  if (left) throw new Error(`unfilled slots: ${[...new Set(left)].join(', ')}`);
}

export function fill(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, k) => (vars[k] !== undefined && vars[k] !== '' ? String(vars[k]) : all));
}

export interface SendCheck {
  email: string;
  suppressed: boolean;
  status: string;
  realThreads: number;
  requiresProof: boolean;
}

/** Every send passes through here. Returns a reason string when the send must be skipped. */
export function blockReason(c: SendCheck): string | null {
  if (c.suppressed) return 'suppressed';
  if (['replied', 'unsubscribed', 'done', 'skipped'].includes(c.status)) return `status:${c.status}`;
  if (!isBusinessEmail(c.email)) return 'not a business address';
  if (c.requiresProof && c.realThreads < 2) return 'fewer than 2 real threads';
  return null;
}

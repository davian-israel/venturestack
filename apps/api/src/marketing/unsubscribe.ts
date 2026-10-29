import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

/** Signed one-click unsubscribe links (no login needed, cannot be forged for other addresses). */
export function unsubSig(email: string): string {
  return createHmac('sha256', config.JWT_SECRET).update(email.toLowerCase()).digest('base64url').slice(0, 22);
}

export function validUnsubSig(email: string, sig: string): boolean {
  const a = Buffer.from(unsubSig(email));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const unsubscribeUrl = (email: string) =>
  `${config.PUBLIC_API_URL}/unsubscribe?e=${encodeURIComponent(email)}&sig=${unsubSig(email)}`;

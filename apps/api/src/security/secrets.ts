import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { config } from '../config';

/** AES-256-GCM for client credentials (CRM tokens, GitHub tokens...) stored in onboarding config. */
const key = () => createHash('sha256').update(process.env.ENCRYPTION_KEY ?? config.JWT_SECRET).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `enc:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
}

export function open(sealed: string): string {
  if (!sealed.startsWith('enc:')) return sealed;
  const buf = Buffer.from(sealed.slice(4), 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Decrypts every sealed string value in a config object (one level deep). */
export function openAll(cfg: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(cfg)) out[k] = typeof v === 'string' && v.startsWith('enc:') ? open(v) : v;
  return out;
}

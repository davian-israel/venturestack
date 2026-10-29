import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { pool } from './db';
import { config } from '../config';

/** Runs every .sql file in apps/api/sql in name order. Files are idempotent. */
export async function migrate(): Promise<void> {
  const dir = join(__dirname, '..', '..', '..', 'sql');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await pool.query(readFileSync(join(dir, f), 'utf8'));
  }
  await ensureSecrets();
}

/**
 * If JWT_SECRET / ENCRYPTION_KEY are not set as variables, generate them once and keep them in
 * the database, so every process (api, worker, marketer) shares the same values across restarts.
 */
async function ensureSecrets() {
  for (const [env, key] of [['JWT_SECRET', 'jwt'], ['ENCRYPTION_KEY', 'encryption']] as const) {
    if (process.env[env]) continue;
    await pool.query('INSERT INTO app_secrets (key, value) VALUES ($1,$2) ON CONFLICT DO NOTHING', [key, randomBytes(48).toString('base64url')]);
    const { rows } = await pool.query('SELECT value FROM app_secrets WHERE key=$1', [key]);
    process.env[env] = rows[0].value;
    if (env === 'JWT_SECRET') (config as { JWT_SECRET: string }).JWT_SECRET = rows[0].value;
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('migrations applied');
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './db';

/** Runs every .sql file in apps/api/sql in name order. Files are idempotent. */
export async function migrate(): Promise<void> {
  const dir = join(__dirname, '..', '..', '..', 'sql');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await pool.query(readFileSync(join(dir, f), 'utf8'));
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

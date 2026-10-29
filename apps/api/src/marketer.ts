/**
 * Railway cron service entrypoint. Railway cron schedules are UTC, so the service is scheduled
 * "0 2,3 * * *" and runMarketing() only proceeds when it is 03:xx in Europe/London — correct in
 * both BST and GMT. The process exits when done (required for Railway cron) and is hard-killed
 * at the 60-minute budget.
 */
import { config } from './config';
import { migrate } from './db/migrate';
import { pool } from './db/db';
import { runMarketing } from './marketing/runner';

const hardStop = setTimeout(() => {
  console.error('marketing budget exceeded — exiting');
  process.exit(0);
}, config.MARKETING_BUDGET_MINUTES * 60_000);
hardStop.unref();

(async () => {
  await migrate();
  const stats = await runMarketing({ force: process.argv.includes('--force') });
  console.log(JSON.stringify(stats));
  await pool.end();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

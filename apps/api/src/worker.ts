import { Worker } from 'bullmq';
import { migrate } from './db/migrate';
import { FULFIL_QUEUE, FulfilJob, fulfilQueue, redisConnection } from './jobs/queue';
import { processJob } from './jobs/fulfilment';

/**
 * Starts the fulfilment worker. Runs standalone (`npm run start:worker`) or inside the api process
 * when RUN_WORKER=true (fits Railway's free-plan service limit).
 */
export async function startWorker() {
  await migrate();
  const worker = new Worker<FulfilJob>(FULFIL_QUEUE, async (job) => processJob(job.data), {
    connection: redisConnection(),
    concurrency: 4,
  });
  worker.on('failed', (job, err) => console.error(`[fulfil] ${job?.name} ${job?.id} failed: ${err.message}`));
  worker.on('completed', (job, res) => console.log(`[fulfil] ${job.name} ${job.id}`, res ?? ''));

  // Re-sync per-client schedules every hour (and now), so new/cancelled subscriptions take effect.
  await fulfilQueue().upsertJobScheduler('schedule-all', { every: 3_600_000 }, { name: 'schedule-all', data: { type: 'schedule-all' } });
  await fulfilQueue().add('schedule-all', { type: 'schedule-all' });
  // Daily MRR snapshot for trend charts, and the weekly growth review (Monday 05:00 London, after the 03:00 marketing run).
  await fulfilQueue().upsertJobScheduler('snapshot', { pattern: '5 0 * * *', tz: 'Europe/London' }, { name: 'snapshot', data: { type: 'snapshot' } });
  await fulfilQueue().upsertJobScheduler('optimise', { pattern: '0 5 * * 1', tz: 'Europe/London' }, { name: 'optimise', data: { type: 'optimise' } });
  await fulfilQueue().add('snapshot', { type: 'snapshot' });
  // Daily 03:00 London marketing run, unless a separate Railway cron service runs it (MARKETING_SCHEDULER=cron).
  if ((process.env.MARKETING_SCHEDULER ?? 'queue') === 'queue') {
    await fulfilQueue().upsertJobScheduler('marketing', { pattern: '0 3 * * *', tz: 'Europe/London' }, { name: 'marketing', data: { type: 'marketing' } }, );
  } else {
    await fulfilQueue().removeJobScheduler('marketing');
  }
  console.log('worker ready');

  return worker;
}

if (require.main === module) {
  startWorker()
    .then((worker) => {
      const shutdown = async () => {
        await worker.close();
        process.exit(0);
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

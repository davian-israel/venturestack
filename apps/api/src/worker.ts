import { Worker } from 'bullmq';
import { migrate } from './db/migrate';
import { FULFIL_QUEUE, FulfilJob, fulfilQueue, redisConnection } from './jobs/queue';
import { processJob } from './jobs/fulfilment';

async function main() {
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
  console.log('worker ready');

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

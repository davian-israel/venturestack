import { Queue } from 'bullmq';
import { config } from '../config';

export type FulfilJob =
  | { type: 'provision'; tenantId: string; productSlug: string }
  | { type: 'suspend'; tenantId: string; productSlug: string }
  | { type: 'welcome'; tenantId: string; productSlug: string }
  | { type: 'run'; tenantId: string; productSlug: string }
  | { type: 'schedule-all' }
  | { type: 'snapshot' }
  | { type: 'optimise' };

export const FULFIL_QUEUE = 'fulfil';

export function redisConnection() {
  const u = new URL(config.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    family: 0, // Railway private networking is IPv6
    maxRetriesPerRequest: null,
  };
}

let queue: Queue<FulfilJob> | undefined;
export function fulfilQueue(): Queue<FulfilJob> {
  queue ??= new Queue<FulfilJob>(FULFIL_QUEUE, { connection: redisConnection() });
  return queue;
}

export async function enqueue(job: FulfilJob, opts: { delayMs?: number; jobId?: string } = {}) {
  await fulfilQueue().add(job.type, job, {
    delay: opts.delayMs,
    jobId: opts.jobId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

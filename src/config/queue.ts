import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './env';

if (process.env.NODE_ENV === 'production') {
  console.warn = () => {};
}

// ioredis connection for BullMQ
// Uses your BULLMQ_REDIS_URL (rediss:// format from Upstash)
export const queueRedis = new IORedis(config.BULLMQ_REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: config.BULLMQ_REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

// The scoring queue — shared between producer (submitApplication) and worker
export const scoreQueue = new Queue(config.AI_QUEUE_NAME, {
  connection: queueRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export type ScoreJobData = { applicationId: string };
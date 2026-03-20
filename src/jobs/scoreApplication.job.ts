import { Worker, Job } from 'bullmq';
import { queueRedis, ScoreJobData } from '../config/queue';
import { scoreApplication } from '../services/aiScoring.service';
import { config } from '../config/env';
import prisma from '../lib/prisma';

export function startScoringWorker() {
  const worker = new Worker<ScoreJobData>(
    config.AI_QUEUE_NAME,
    async (job: Job<ScoreJobData>) => {
      const { applicationId } = job.data;
      console.log(`[Worker] Processing score job: ${applicationId}`);
      await scoreApplication(applicationId);
    },
    {
      connection: queueRedis,
      concurrency: 3, // Max 3 submissions scored simultaneously
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] ■ Scored: ${job.data.applicationId}`);
  });

  worker.on('failed', async (job, err) => {
    console.error(`[Worker] ■ Failed: ${job?.data.applicationId}`, err.message);

    // On final retry failure, mark FAILED in DB
    if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
      await prisma.application.update({
        where: { id: job.data.applicationId },
        data: { ai_score_status: 'FAILED', ai_summary: `Error: ${err.message}` },
      }).catch(console.error);
    }
  });

  console.log('[Worker] AI Scoring Worker started (concurrency: 3)');
  return worker;
}

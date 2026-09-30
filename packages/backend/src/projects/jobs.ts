import type { PgBoss } from "pg-boss";
import { ensureQueue, QUEUES } from "../jobs/queue.ts";
import { processWindArticle } from "./service.ts";

export async function registerWindJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.windMonitor);
  await boss.work<{ articleId: string }>(QUEUES.windMonitor, { localConcurrency: 2, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (job) return processWindArticle(job.data.articleId);
  });
}

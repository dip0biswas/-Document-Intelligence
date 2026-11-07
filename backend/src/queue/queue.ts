import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";

export const DOCUMENT_QUEUE = "document-processing";
export type DocumentJobData = { documentId: string };

export function createQueueConnection(): IORedis {
  return new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

export const documentQueue = new Queue<DocumentJobData>(DOCUMENT_QUEUE, {
  connection: createQueueConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 2_000 }
  }
});

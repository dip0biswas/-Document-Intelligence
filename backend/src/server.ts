import fs from "node:fs/promises";
import mongoose from "mongoose";
import IORedis from "ioredis";
import { app } from "./app";
import { config } from "./config";
import { connectDatabase } from "./db";
import { documentQueue } from "./queue/queue";

async function start(): Promise<void> {
  await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
  await connectDatabase();
  const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  await redis.connect();
  await redis.ping();
  await redis.quit();

  const server = app.listen(config.PORT, () => {
    console.info(`Document API listening on port ${config.PORT}.`);
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await documentQueue.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

start().catch((error: unknown) => {
  console.error("Unable to start document API:", error);
  process.exitCode = 1;
});

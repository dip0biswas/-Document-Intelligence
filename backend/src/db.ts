import mongoose from "mongoose";
import { config } from "./config";

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000
  });
}

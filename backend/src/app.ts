import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { config } from "./config";
import documentsRouter from "./routes/documents";

export const app = express();

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: config.FRONTEND_ORIGIN,
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 600
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.use("/api/documents", documentsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found." });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("API request failed:", error);
  if (res.headersSent) return;
  if (error instanceof multer.MulterError) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  if (message.startsWith("Unsupported file type:")) {
    res.status(415).json({ error: message });
    return;
  }
  res.status(500).json({
    error: config.NODE_ENV === "production" ? "Internal server error." : message
  });
};

app.use(errorHandler);

import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import mongoose from "mongoose";
import { config } from "../config";
import { DocumentModel } from "../models/document";
import { DOCUMENT_QUEUE, type DocumentJobData } from "./queue";
import { embedText, extractInvoice, type InvoiceExtraction } from "../services/extraction";
import { validateExtraction } from "../services/validation";
import { getGeminiFallbackMessage, isPermanentProcessingError } from "./processing-errors";

type ProcessorResponse = {
  text: string;
  tables: unknown[];
  page_count?: number;
  warnings?: string[];
};

function emptyExtraction(): InvoiceExtraction {
  return {
    invoiceNumber: null,
    invoiceDate: null,
    supplierName: null,
    customerName: null,
    subtotal: null,
    tax: null,
    total: null,
    currency: null,
    lineItems: []
  };
}

function hasUsableEmbedding(embedding: number[] | undefined): embedding is number[] {
  return Boolean(
    embedding &&
    embedding.length === config.GEMINI_EMBEDDING_DIMENSIONS &&
    embedding.every(Number.isFinite)
  );
}

async function processDocument(job: Job<DocumentJobData>): Promise<void> {
  const document = await DocumentModel.findById(job.data.documentId);
  if (!document) throw new Error(`Document ${job.data.documentId} no longer exists.`);

  const processingToken = randomUUID();
  document.status = "processing";
  document.set("processingToken", processingToken);
  document.set("processingProgress", {
    stage: "reading",
    label: "Preparing source file",
    percent: 5,
    completedUnits: 0,
    totalUnits: 0,
    updatedAt: new Date()
  });
  document.validationErrors = [];
  document.processingHistory.push({ status: "processing", message: "Document processing started.", at: new Date() });
  await document.save();

  const filePath = path.join(config.UPLOAD_DIR, document.storedName);
  try {
    let processed: ProcessorResponse;
    const hasSavedOcr = Boolean(document.extractedText.trim() || document.tables.length > 0);
    if (hasSavedOcr) {
      processed = { text: document.extractedText, tables: document.tables };
      console.info(`Reusing saved OCR output for document ${document.id}.`);
    } else {
      const file = await readFile(filePath);
      const form = new FormData();
      form.append("file", new Blob([file], { type: document.mimeType }), document.originalName);
      form.append("document_id", document.id);
      form.append("processing_token", processingToken);
      const processorResponse = await fetch(`${config.PROCESSOR_URL}/process`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(180_000)
      });
      if (!processorResponse.ok) {
        const detail = await processorResponse.text();
        throw new Error(`Document processor failed (${processorResponse.status}): ${detail.slice(0, 500)}`);
      }
      processed = await processorResponse.json() as ProcessorResponse;
      if (typeof processed.text !== "string" || !Array.isArray(processed.tables)) {
        throw new Error("Document processor returned an invalid response.");
      }
      processed = { ...processed, text: processed.text.slice(0, 200_000) };
      document.extractedText = processed.text;
      document.tables = processed.tables;
    }

    document.set("processingProgress", {
      stage: "ai_extraction",
      label: hasSavedOcr ? "Retrying extraction from saved OCR" : "Extracting invoice fields",
      percent: 58,
      completedUnits: 0,
      totalUnits: 0,
      updatedAt: new Date()
    });
    await document.save();
    const embeddingText = [
      processed.text,
      ...processed.tables.map((table) => JSON.stringify(table))
    ].join("\n").slice(0, 20_000);
    const embeddingPromise = hasUsableEmbedding(document.embedding ?? undefined)
      ? Promise.resolve(document.embedding)
      : embedText(embeddingText).then(async (embedding) => {
        await DocumentModel.updateOne({ _id: document.id }, { $set: { embedding } });
        return embedding;
      });
    const [extractionResult, embeddingResult] = await Promise.allSettled([
      extractInvoice(processed.text, processed.tables),
      embeddingPromise
    ]);
    if (embeddingResult.status === "fulfilled") {
      document.embedding = embeddingResult.value;
      await document.save();
    }
    const extractionFallbackMessage = extractionResult.status === "rejected"
      ? getGeminiFallbackMessage(extractionResult.reason)
      : undefined;
    if (extractionResult.status === "rejected" && !extractionFallbackMessage) throw extractionResult.reason;
    let aiResult;
    if (extractionResult.status === "fulfilled") {
      aiResult = extractionResult.value;
      console.info(`Gemini extraction succeeded using model ${aiResult.model} for document ${document.id}.`);
    } else {
      if (!extractionFallbackMessage) throw extractionResult.reason;
      aiResult = {
        extraction: emptyExtraction(),
        errors: [extractionFallbackMessage]
      };
    }
    document.set("processingProgress", {
      stage: "validation",
      label: "Validating extracted fields",
      percent: 88,
      completedUnits: 0,
      totalUnits: 0,
      updatedAt: new Date()
    });
    await document.save();
    const validationErrors = [
      ...aiResult.errors,
      ...await validateExtraction(aiResult.extraction, document.id)
    ];

    document.extractedText = processed.text.slice(0, 200_000);
    document.tables = processed.tables;
    document.set("extraction", aiResult.extraction);
    document.validationErrors = validationErrors;
    document.status = validationErrors.length ? "requires_review" : "completed";
    document.set("processingToken", undefined);
    document.set("processingProgress", {
      stage: "complete",
      label: document.status === "requires_review" ? "Extraction complete — review needed" : "Processing complete",
      percent: 100,
      completedUnits: 1,
      totalUnits: 1,
      updatedAt: new Date()
    });
    const processingWarnings = [...(processed.warnings ?? [])];
    if (extractionFallbackMessage) {
      processingWarnings.push("Source text was extracted successfully, but invoice fields need manual review. " + extractionFallbackMessage);
    }
    if (embeddingResult.status === "rejected") {
      processingWarnings.push("Invoice extraction succeeded, but a search embedding could not be generated.");
      console.warn(`Document ${document.id} was extracted without a search embedding:`, embeddingResult.reason);
    }
    document.processingHistory.push({
      status: document.status,
      message: processingWarnings.join(" ") || "Document extraction finished.",
      at: new Date()
    });
    await document.save();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown document processing error.";
    document.processingHistory.push({ status: "processing", message: `Attempt ${job.attemptsMade + 1}: ${message}`, at: new Date() });
    document.set("processingToken", undefined);
    await document.save();
    if (isPermanentProcessingError(error)) {
      throw new UnrecoverableError(message);
    }
    throw error;
  }
}

async function startWorker(): Promise<void> {
  await mongoose.connect(config.MONGODB_URI);
  const worker = new Worker<DocumentJobData>(DOCUMENT_QUEUE, processDocument, {
    connection: new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null }),
    concurrency: 3
  });
  worker.on("failed", async (job, error) => {
    if (!job) return;
    console.error(`Document job ${job.id} failed:`, error);
    if (error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await DocumentModel.findByIdAndUpdate(job.data.documentId, {
        $set: {
          status: "failed",
          processingProgress: {
            stage: "failed",
            label: "Processing failed",
            percent: 0,
            completedUnits: 0,
            totalUnits: 0,
            updatedAt: new Date()
          }
        },
        $unset: { processingToken: 1 },
        $push: {
          processingHistory: {
            status: "failed",
            message: error.message.slice(0, 1_000),
            at: new Date()
          }
        }
      });
    }
  });
  worker.on("error", (error) => console.error("Queue worker error:", error));
  console.info("Document processing worker started.");

  const shutdown = async (): Promise<void> => {
    await worker.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

startWorker().catch((error: unknown) => {
  console.error("Unable to start document worker:", error);
  process.exitCode = 1;
});

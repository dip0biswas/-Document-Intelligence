import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { Types } from "mongoose";
import { z } from "zod";
import { config } from "../config";
import { DocumentModel } from "../models/document";
import { documentQueue } from "../queue/queue";
import { embedText, normalizeExtraction } from "../services/extraction";
import { rankByCosine } from "../services/semantic-search";
import { validateExtraction } from "../services/validation";
import { Express } from 'express';

const router = Router();
const supportedExtensions = new Set([".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".xlsx", ".xls", ".csv"]);

function safeOriginalName(name: string): string {
  return path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 180) || "document";
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, config.UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.MAX_UPLOAD_BYTES,
    files: config.MAX_FILES_PER_UPLOAD
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      callback(new Error(`Unsupported file type: ${extension || "unknown"}`));
      return;
    }
    callback(null, true);
  }
});

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

router.post("/upload", upload.array("files", config.MAX_FILES_PER_UPLOAD), async (req, res, next) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) {
    res.status(400).json({ error: "Select at least one supported file in the 'files' field." });
    return;
  }

  const accepted: Array<{ documentId: string; jobId: string; originalName: string }> = [];
  const failures: Array<{ originalName: string; error: string }> = [];
  for (const file of files) {
    const documentId = new Types.ObjectId().toString();
    const jobId = `document-${documentId}-${randomUUID()}`;
    try {
      const document = await DocumentModel.create({
        _id: documentId,
        originalName: safeOriginalName(file.originalname),
        storedName: file.filename,
        mimeType: file.mimetype || "application/octet-stream",
        jobId,
        status: "pending",
        processingProgress: {
          stage: "queued",
          label: "Waiting in queue",
          percent: 0,
          completedUnits: 0,
          totalUnits: 0,
          updatedAt: new Date()
        },
        processingHistory: [{ status: "pending", message: "File accepted and queued.", at: new Date() }]
      });
      accepted.push({ documentId, jobId, originalName: document.originalName });
      await documentQueue.add("process", { documentId }, { jobId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create or enqueue this document.";
      const document = await DocumentModel.findById(documentId);
      if (document) {
        document.status = "failed";
        document.processingHistory.push({ status: "failed", message: "Unable to enqueue document processing.", at: new Date() });
        await document.save();
      } else {
        await fs.unlink(file.path).catch((cleanupError: unknown) => {
          console.error("Unable to remove unregistered upload:", cleanupError);
        });
      }
      failures.push({ originalName: safeOriginalName(file.originalname), error: message });
    }
  }
  if (!accepted.length) {
    res.status(503).json({ error: "No files could be queued.", failures });
    return;
  }
  res.status(202).json({ documents: accepted, failures });
});

router.get("/status/:jobId", async (req, res, next) => {
  try {
    const document = await DocumentModel.findOne({ jobId: req.params.jobId }).lean();
    if (!document) {
      res.status(404).json({ error: "Document job not found." });
      return;
    }
    const job = await documentQueue.getJob(req.params.jobId);
    const queueState = job ? await job.getState() : "unknown";
    res.json({
      jobId: document.jobId,
      documentId: document._id,
      status: document.status,
      processingProgress: document.processingProgress,
      queueState,
      validationErrors: document.validationErrors,
      updatedAt: document.updatedAt
    });
  } catch (error) {
    next(error);
  }
});

const ProcessingProgressSchema = z.object({
  token: z.string().uuid(),
  stage: z.enum(["reading", "ocr"]),
  label: z.string().trim().min(1).max(100),
  percent: z.number().int().min(1).max(54),
  completedUnits: z.number().int().min(0),
  totalUnits: z.number().int().min(0)
}).strict();

router.post("/:documentId/progress", async (req, res, next) => {
  try {
    const parsed = ProcessingProgressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid processing progress." });
      return;
    }
    const document = await DocumentModel.findById(req.params.documentId).select("+processingToken");
    if (!document || document.status !== "processing" || document.processingToken !== parsed.data.token) {
      res.status(409).json({ error: "This processing update is no longer active." });
      return;
    }
    document.set("processingProgress", {
      stage: parsed.data.stage,
      label: parsed.data.label,
      percent: parsed.data.percent,
      completedUnits: parsed.data.completedUnits,
      totalUnits: parsed.data.totalUnits,
      updatedAt: new Date()
    });
    await document.save();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/results", async (req, res, next) => {
  try {
    const parsed = pagination.extend({
      status: z.enum(["pending", "processing", "completed", "failed", "requires_review"]).optional()
    }).safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid pagination." });
      return;
    }
    const { page, limit, status } = parsed.data;
    const filter = status ? { status } : {};
    const [documents, total] = await Promise.all([
      DocumentModel.find(filter)
        .select("-embedding -extractedText -tables")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DocumentModel.countDocuments(filter)
    ]);
    res.json({ documents, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
});

router.get("/search", async (req, res, next) => {
  try {
    const querySchema = pagination.extend({
      q: z.string().trim().min(1).max(500),
      mode: z.enum(["keyword", "semantic"]).default("keyword"),
      status: z.enum(["pending", "processing", "completed", "failed", "requires_review"]).optional(),
      supplier: z.string().trim().max(200).optional()
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid search request." });
      return;
    }
    const { q, mode, page, limit, status, supplier } = parsed.data;
    const filters = [
      ...(status ? [{ status }] : []),
      ...(supplier ? [{ "extraction.supplierName": new RegExp(supplier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }] : [])
    ];

    if (mode === "semantic") {
      let queryVector: number[];
      try {
        queryVector = await embedText(q);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown embedding service error.";
        res.status(502).json({ error: `Semantic search could not generate a query embedding: ${message}` });
        return;
      }
      const candidates = await DocumentModel.find(filters.length ? { $and: filters } : {})
        .select("_id originalName mimeType status jobId extraction createdAt embedding")
        .sort({ createdAt: -1 })
        .lean();
      const ranked = rankByCosine(candidates, queryVector, page, limit);
      const documents = ranked.documents.map(({ embedding: _embedding, ...document }) => document);
      res.json({
        documents,
        page,
        limit,
        total: ranked.total,
        pages: ranked.pages,
        mode: "semantic",
        unindexedDocuments: candidates.length - ranked.total
      });
      return;
    }
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keywordFilter = {
      $and: [
        ...filters,
        {
          $or: [
            { extractedText: new RegExp(escaped, "i") },
            { "extraction.invoiceNumber": new RegExp(escaped, "i") },
            { "extraction.supplierName": new RegExp(escaped, "i") },
            { "extraction.customerName": new RegExp(escaped, "i") }
          ]
        }
      ]
    };
    const [documents, total] = await Promise.all([
      DocumentModel.find(keywordFilter).select("-embedding -extractedText -tables")
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      DocumentModel.countDocuments(keywordFilter)
    ]);
    res.json({ documents, page, limit, total, pages: Math.ceil(total / limit), mode: "keyword" });
  } catch (error) {
    next(error);
  }
});

router.get("/:documentId", async (req, res, next) => {
  try {
    const document = await DocumentModel.findById(req.params.documentId).select("-embedding").lean();
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const job = await documentQueue.getJob(document.jobId);
    const queueState = job ? await job.getState() : "unknown";
    res.json({ document, queueState });
  } catch (error) {
    next(error);
  }
});

router.get("/:documentId/file", async (req, res, next) => {
  try {
    const document = await DocumentModel.findById(req.params.documentId).select("storedName originalName mimeType").lean();
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const filePath = path.resolve(config.UPLOAD_DIR, document.storedName);
    if (path.dirname(filePath) !== config.UPLOAD_DIR) {
      res.status(400).json({ error: "Invalid stored document path." });
      return;
    }
    res.setHeader("Content-Disposition", `inline; filename="${document.originalName.replace(/["\\]/g, "_")}"`);
    res.type(document.mimeType);
    res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    next(error);
  }
});

const CorrectionSchema = z.object({ extraction: z.record(z.string(), z.unknown()) }).strict();

router.put("/corrections/:documentId", async (req, res, next) => {
  try {
    const body = CorrectionSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid correction payload." });
      return;
    }
    const document = await DocumentModel.findById(req.params.documentId);
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const current = document.get("extraction");
    const currentExtraction = {
      invoiceNumber: current.invoiceNumber,
      invoiceDate: current.invoiceDate,
      supplierName: current.supplierName,
      customerName: current.customerName,
      subtotal: current.subtotal,
      tax: current.tax,
      total: current.total,
      currency: current.currency,
      lineItems: current.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount
      }))
    };
    const normalized = normalizeExtraction({ ...currentExtraction, ...body.data.extraction });
    const errors = [...normalized.errors, ...await validateExtraction(normalized.extraction, document.id)];
    document.set("extraction", normalized.extraction);
    document.validationErrors = errors;
    document.status = errors.length ? "requires_review" : "completed";
    document.processingHistory.push({
      status: document.status,
      message: "Manual corrections saved and validation rerun.",
      at: new Date()
    });
    await document.save();
    res.json({ document: document.toJSON() });
  } catch (error) {
    next(error);
  }
});

router.post("/reprocess/:documentId", async (req, res, next) => {
  try {
    const document = await DocumentModel.findById(req.params.documentId);
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const existingJob = await documentQueue.getJob(document.jobId);
    const queueState = existingJob ? await existingJob.getState() : "unknown";
    const failedJobStillMarkedActive = ["pending", "processing"].includes(document.status) && queueState === "failed";
    if (document.status !== "failed" && !failedJobStillMarkedActive) {
      res.status(409).json({ error: "Only failed documents can be reprocessed." });
      return;
    }
    try {
      await fs.access(path.join(config.UPLOAD_DIR, document.storedName));
    } catch {
      res.status(410).json({ error: "The original source file is no longer available for reprocessing." });
      return;
    }
    const jobId = `document-${document.id}-${randomUUID()}`;
    document.jobId = jobId;
    document.status = "pending";
    document.validationErrors = [];
    document.processingHistory.push({ status: "pending", message: "Reprocessing requested.", at: new Date() });
    await document.save();
    try {
      await documentQueue.add("process", { documentId: document.id }, { jobId });
    } catch (error) {
      document.status = "failed";
      document.processingHistory.push({
        status: "failed",
        message: "Unable to enqueue the reprocessing request.",
        at: new Date()
      });
      await document.save();
      throw error;
    }
    res.status(202).json({ documentId: document.id, jobId, status: document.status });
  } catch (error) {
    next(error);
  }
});

export default router;

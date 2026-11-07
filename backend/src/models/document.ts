import { Schema, model } from "mongoose";
import type { InvoiceExtraction } from "../services/extraction";

export type DocumentStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "requires_review";

const lineItemSchema = new Schema(
  {
    description: { type: String, default: "" },
    quantity: { type: Number, default: null },
    unitPrice: { type: Number, default: null },
    amount: { type: Number, default: null }
  },
  { _id: false }
);

const extractionSchema = new Schema(
  {
    invoiceNumber: { type: String, default: null },
    invoiceDate: { type: String, default: null },
    supplierName: { type: String, default: null },
    customerName: { type: String, default: null },
    subtotal: { type: Number, default: null },
    tax: { type: Number, default: null },
    total: { type: Number, default: null },
    currency: { type: String, default: null },
    lineItems: { type: [lineItemSchema], default: [] }
  },
  { _id: false }
);

const processingProgressSchema = new Schema(
  {
    stage: { type: String, default: "queued" },
    label: { type: String, default: "Waiting in queue" },
    percent: { type: Number, min: 0, max: 100, default: 0 },
    completedUnits: { type: Number, min: 0, default: 0 },
    totalUnits: { type: Number, min: 0, default: 0 },
    updatedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const documentSchema = new Schema(
  {
    originalName: { type: String, required: true },
    storedName: { type: String, required: true, unique: true },
    mimeType: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "requires_review"],
      default: "pending",
      index: true
    },
    jobId: { type: String, required: true, index: true },
    processingProgress: { type: processingProgressSchema, default: () => ({}) },
    processingToken: { type: String, select: false },
    extraction: { type: extractionSchema, default: () => ({}) },
    extractedText: { type: String, default: "" },
    tables: { type: [Schema.Types.Mixed], default: [] },
    validationErrors: { type: [String], default: [] },
    processingHistory: {
      type: [{ status: String, message: String, at: { type: Date, default: Date.now } }],
      default: []
    },
    embedding: { type: [Number], default: undefined }
  },
  { timestamps: true, minimize: false }
);

documentSchema.index({ "extraction.invoiceNumber": 1, "extraction.supplierName": 1 });
documentSchema.index({
  "extraction.invoiceNumber": "text",
  "extraction.supplierName": "text",
  "extraction.customerName": "text",
  extractedText: "text"
});

export const DocumentModel = model("Document", documentSchema);
export type { InvoiceExtraction };

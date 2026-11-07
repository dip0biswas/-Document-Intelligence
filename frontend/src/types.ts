export type InvoiceLineItem = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
};

export type InvoiceExtraction = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierName: string | null;
  customerName: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string | null;
  lineItems: InvoiceLineItem[];
};

export type DocumentStatus = "pending" | "processing" | "completed" | "failed" | "requires_review";

export type ProcessingProgress = {
  stage: string;
  label: string;
  percent: number;
  completedUnits: number;
  totalUnits: number;
  updatedAt: string;
};

export type DocumentRecord = {
  _id: string;
  originalName: string;
  mimeType: string;
  status: DocumentStatus;
  jobId: string;
  queueState?: string;
  processingProgress?: ProcessingProgress;
  extraction: InvoiceExtraction;
  validationErrors: string[];
  processingHistory?: Array<{ status: string; message: string; at: string }>;
  extractedText?: string;
  tables?: Array<{ name: string; columns: string[]; rows: Array<Record<string, unknown>> }>;
  createdAt: string;
};

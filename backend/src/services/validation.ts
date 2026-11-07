import { DocumentModel } from "../models/document";
import type { InvoiceExtraction } from "./extraction";

function cents(value: number): number {
  return Math.round(value * 100);
}

function withinOneCent(left: number, right: number): boolean {
  return Math.abs(cents(left) - cents(right)) <= 1;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function validateExtraction(
  extraction: InvoiceExtraction,
  excludeDocumentId?: string
): Promise<string[]> {
  const errors: string[] = [];
  if (!extraction.invoiceNumber) errors.push("Invoice number is missing.");
  if (!extraction.invoiceDate) {
    errors.push("Invoice date is missing.");
  } else if (
    !/^\d{4}-\d{2}-\d{2}$/.test(extraction.invoiceDate) ||
    Number.isNaN(Date.parse(extraction.invoiceDate)) ||
    new Date(`${extraction.invoiceDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== extraction.invoiceDate
  ) {
    errors.push("Invoice date must be a valid YYYY-MM-DD date.");
  }
  if (!extraction.supplierName) errors.push("Supplier name is missing.");
  if (extraction.total === null) errors.push("Total amount is missing.");
  if (!extraction.currency) errors.push("Currency is missing.");

  if (extraction.subtotal !== null && extraction.tax !== null && extraction.total !== null &&
      !withinOneCent(extraction.subtotal + extraction.tax, extraction.total)) {
    errors.push("Subtotal plus tax does not equal the total.");
  }

  const knownLineAmounts = extraction.lineItems.map((item) => item.amount);
  if (knownLineAmounts.length > 0 && knownLineAmounts.every((amount): amount is number => amount !== null)) {
    const lineSum = knownLineAmounts.reduce((sum, amount) => sum + amount, 0);
    if (extraction.subtotal !== null && !withinOneCent(lineSum, extraction.subtotal)) {
      errors.push("Sum of line-item amounts does not equal the subtotal.");
    }
    if (extraction.subtotal === null && extraction.tax !== null && extraction.total !== null &&
        !withinOneCent(lineSum + extraction.tax, extraction.total)) {
      errors.push("Sum of line-item amounts plus tax does not equal the total.");
    }
  }

  for (const [index, item] of extraction.lineItems.entries()) {
    if (item.quantity !== null && item.unitPrice !== null && item.amount !== null &&
        !withinOneCent(item.quantity * item.unitPrice, item.amount)) {
      errors.push(`Line item ${index + 1} quantity times unit price does not equal its amount.`);
    }
  }

  if (extraction.invoiceNumber && extraction.supplierName) {
    const duplicate = await DocumentModel.findOne({
      _id: excludeDocumentId ? { $ne: excludeDocumentId } : { $exists: true },
      "extraction.invoiceNumber": new RegExp(`^${escapeRegex(extraction.invoiceNumber)}$`, "i"),
      "extraction.supplierName": new RegExp(`^${escapeRegex(extraction.supplierName)}$`, "i"),
      status: { $in: ["completed", "requires_review"] }
    }).select("_id").lean();
    if (duplicate) errors.push("A document with this supplier and invoice number already exists.");
  }
  return [...new Set(errors)];
}

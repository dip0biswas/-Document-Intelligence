import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config", () => ({
  config: {
    GEMINI_API_KEY: "test-secret-key",
    GEMINI_MODEL: "gemini-3.8-flash",
    GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite",
    GEMINI_EMBEDDING_MODEL: "gemini-embedding-001",
    GEMINI_EMBEDDING_DIMENSIONS: 768
  }
}));

import { extractInvoice, GeminiExtractionError, normalizeExtraction } from "./extraction";

const sample = {
  invoiceNumber: "INV-12",
  invoiceDate: "2026-03-01",
  supplierName: "Example Co",
  customerName: null,
  subtotal: 100,
  tax: 5,
  total: 105,
  currency: "usd",
  lineItems: [{ description: "Consulting", quantity: 2, unitPrice: 50, amount: 100 }]
};

describe("normalizeExtraction", () => {
  it("normalizes currency and preserves explicit missing fields", () => {
    const result = normalizeExtraction(sample);
    expect(result.errors).toEqual([]);
    expect(result.extraction.currency).toBe("USD");
    expect(result.extraction.customerName).toBeNull();
  });

  it("flags invalid numeric strings rather than coercing them", () => {
    const result = normalizeExtraction({ ...sample, total: "$105.00" });
    expect(result.extraction.total).toBeNull();
    expect(result.errors).toContain("Total has an invalid numeric format.");
  });
});

describe("extractInvoice model fallback", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([429, 500, 502, 503, 504])("retries primary HTTP %i with exponential backoff, then returns fallback JSON and model", async (status) => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary failure", { status }))
      .mockResolvedValueOnce(new Response("temporary failure", { status }))
      .mockResolvedValueOnce(new Response("temporary failure", { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(sample) }] } }]
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const resultPromise = extractInvoice("invoice OCR text", []);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.model).toBe("gemini-3.5-flash-lite");
    expect(result.extraction.total).toBe(105);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(timerSpy.mock.calls.map((call) => call[1])).toEqual([500, 1_000]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/gemini-3.8-flash:");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("/gemini-3.5-flash-lite:");
  });

  it("retries both models for temporary failures and returns a safe retryable error", async () => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.fn().mockImplementation(() => new Response("temporary test-secret-key failure", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const resultPromise = extractInvoice("invoice OCR text", []);
    const errorPromise = resultPromise.catch((reason: unknown) => reason);
    await vi.runAllTimersAsync();
    const error = await errorPromise;
    if (!(error instanceof GeminiExtractionError)) throw new Error("Expected a Gemini extraction error.");
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("test-secret-key");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(timerSpy.mock.calls.map((call) => call[1])).toEqual([500, 1_000, 500, 1_000]);
  });

  it("does not switch models for a permanent primary error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("model not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractInvoice("invoice OCR text", [])).rejects.toMatchObject({
      name: "GeminiExtractionError",
      retryable: false
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry transient Gemini errors as permanent queue failures", () => {
    expect(new GeminiExtractionError("both models unavailable", true).retryable).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { GeminiExtractionError } from "../services/extraction";
import { getGeminiFallbackMessage, isPermanentProcessingError } from "./processing-errors";

describe("isPermanentProcessingError", () => {
  it("does not retry unsupported models or invalid document requests", () => {
    expect(isPermanentProcessingError(new Error("Gemini extraction request failed (404): model not found"))).toBe(true);
    expect(isPermanentProcessingError(new Error("Document processor failed (422): invalid PDF"))).toBe(true);
  });

  it("does not retry when the Gemini key is missing", () => {
    expect(isPermanentProcessingError(new Error("GEMINI_API_KEY is not configured."))).toBe(true);
  });

  it("does not retry when the source file is missing", () => {
    expect(isPermanentProcessingError(Object.assign(new Error("source file not found"), { code: "ENOENT" }))).toBe(true);
  });

  it("retries throttling, server errors, and timeouts", () => {
    expect(isPermanentProcessingError(new Error("Gemini extraction request failed (429): rate limit"))).toBe(false);
    expect(isPermanentProcessingError(new Error("Gemini extraction request failed (503): unavailable"))).toBe(false);
    expect(isPermanentProcessingError(new Error("The operation was aborted due to timeout"))).toBe(false);
    expect(isPermanentProcessingError(new GeminiExtractionError("both Gemini models unavailable", true))).toBe(false);
    expect(isPermanentProcessingError(new GeminiExtractionError("both Gemini models rejected the request", false))).toBe(true);
  });

  it("preserves OCR output when Gemini daily quota is exhausted or the service is unavailable", () => {
    expect(getGeminiFallbackMessage(new Error("Quota exceeded for metric: generate_content_free_tier_requests"))).toMatch(/daily request quota/);
    expect(getGeminiFallbackMessage(new Error("Gemini extraction request failed (503): service unavailable"))).toMatch(/temporarily unavailable/);
    expect(getGeminiFallbackMessage(new Error("Request rate limit exceeded"))).toBeUndefined();
  });
});

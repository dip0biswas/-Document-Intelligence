import { GeminiExtractionError } from "../services/extraction";

export function isPermanentProcessingError(error: unknown): boolean {
  if (error instanceof GeminiExtractionError) return !error.retryable;
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("GEMINI_API_KEY is not configured.")) return true;

  const status = message.match(/failed \((\d{3})\)/)?.[1];
  if (!status) return false;
  const code = Number(status);
  return code >= 400 && code < 500 && code !== 408 && code !== 429;
}

export function getGeminiFallbackMessage(error: unknown): string | undefined {
  if (error instanceof GeminiExtractionError && error.retryable) return undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (/free_tier_requests|per day limit exceeded|daily quota/i.test(message)) {
    return "Automatic extraction was skipped because the Gemini daily request quota is exhausted. Enter invoice details manually or retry after the quota resets.";
  }
  if (/Gemini extraction request failed \(503\)/i.test(message)) {
    return "Automatic extraction was skipped because the Gemini service is temporarily unavailable. The OCR text is ready for manual review.";
  }
  return undefined;
}

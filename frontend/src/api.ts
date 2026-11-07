import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 30_000
});

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError<{ error?: string; detail?: string }>(error)) {
    return error.response?.data?.error ?? error.response?.data?.detail ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

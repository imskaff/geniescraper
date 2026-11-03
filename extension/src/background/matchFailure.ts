import type { ServiceMatch } from "../shared/messages";

/** A failed half, with the reason in its words and in the worker's console (chrome://extensions, service worker). */
export function failedWith(service: string, reason: unknown): ServiceMatch {
  const text = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "unknown reason";
  console.warn(`[Géniescraper] ${service} look-up failed: ${text}`);
  return { status: "failed", message: `${service}: ${text}` };
}

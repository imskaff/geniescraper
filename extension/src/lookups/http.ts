// The one place the extension fetches third-party data. It only ever talks to hosts it has been given permission
// for, sends no cookies and no referrer, and turns every failure into null so a lookup can never break a read.
import type { GetJson } from "./itunes";

/** Hosts a lookup may contact. A new host needs the owner's approval and a manifest permission. */
export const LOOKUP_HOSTS: ReadonlySet<string> = new Set(["itunes.apple.com"]);

const TIMEOUT_MS = 10_000;

export const fetchJson: GetJson = async (url) => {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" || !LOOKUP_HOSTS.has(target.hostname)) return null;
    const response = await fetch(target, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
};

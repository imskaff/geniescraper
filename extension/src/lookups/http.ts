// The one place the extension fetches third-party data. It only ever talks to hosts it has been given permission
// for, sends no cookies and no referrer, refuses redirects, and turns every failure into null so a lookup can
// never break a read.
import type { GetJson } from "./itunes";

/** Lookup hosts the manifest grants outright. */
export const REQUIRED_LOOKUP_HOSTS: ReadonlySet<string> = new Set(["itunes.apple.com"]);

/** Lookup hosts the user turns on in Settings; Chrome asks for each one, and the user can take it back. */
export const OPTIONAL_LOOKUP_HOSTS = { deezer: "api.deezer.com", youtube: "www.youtube.com" } as const;

export type OptionalHost = keyof typeof OPTIONAL_LOOKUP_HOSTS;

/** The manifest match pattern for an optional host. */
export const hostOrigin = (host: OptionalHost): string => `https://${OPTIONAL_LOOKUP_HOSTS[host]}/*`;

/** Hosts a lookup may contact. A new host needs the owner's approval and a manifest permission. */
export const LOOKUP_HOSTS: ReadonlySet<string> = new Set([
  ...REQUIRED_LOOKUP_HOSTS,
  ...Object.values(OPTIONAL_LOOKUP_HOSTS),
]);

/** Whether the user has granted Chrome's permission for a match pattern right now. */
export type Granted = (origin: string) => Promise<boolean>;

const TIMEOUT_MS = 10_000;

/**
 * A fetcher that checks, at the moment of each request, that the host is allowed: always for a required host,
 * and only while the permission is granted for an optional one (the user may revoke it at any time).
 * Redirects are refused, so a response can never come from a host that was not checked.
 */
export function createFetchJson(granted: Granted): GetJson {
  const optional = new Map<string, OptionalHost>(
    (Object.keys(OPTIONAL_LOOKUP_HOSTS) as OptionalHost[]).map((key) => [OPTIONAL_LOOKUP_HOSTS[key], key]),
  );
  return async (url) => {
    try {
      const target = new URL(url);
      if (target.protocol !== "https:") return null;
      const optionalHost = optional.get(target.hostname);
      const allowed =
        REQUIRED_LOOKUP_HOSTS.has(target.hostname) || (!!optionalHost && (await granted(hostOrigin(optionalHost))));
      if (!allowed) return null;
      const response = await fetch(target, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    } catch {
      return null;
    }
  };
}

export const fetchJson: GetJson = createFetchJson((origin) => chrome.permissions.contains({ origins: [origin] }));

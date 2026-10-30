// The one place the extension fetches third-party data. It only ever talks to hosts it has been given permission
// for, sends no cookies and no referrer, refuses redirects, and turns every failure into null so a lookup can
// never break a read.
import type { GetJson } from "./itunes";

/** Lookup hosts the manifest grants outright. */
export const REQUIRED_LOOKUP_HOSTS: ReadonlySet<string> = new Set(["itunes.apple.com", "genius.com"]);

/** Lookup hosts the user turns on in Settings; Chrome asks for each one, and the user can take it back. */
export const OPTIONAL_LOOKUP_HOSTS = {
  deezer: "api.deezer.com",
  youtube: "www.youtube.com",
  /** Google's official YouTube service, used only when the user has entered their own key. */
  youtubeApi: "www.googleapis.com",
} as const;

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

/** Fetch a URL as text; resolves null on any failure. Never throws. */
export type GetText = (url: string) => Promise<string | null>;

/** Longest page read as text, so a runaway response cannot fill the worker's memory. */
const MAX_TEXT_CHARS = 8_000_000;

/**
 * A fetcher that checks, at the moment of each request, that the host is allowed: always for a required host,
 * and only while the permission is granted for an optional one (the user may revoke it at any time).
 * Redirects are refused, so a response can never come from a host that was not checked.
 */
function createFetcher<T>(
  granted: Granted,
  read: (response: Response) => Promise<T | null>,
  readErrors = false,
): (url: string, headers?: Record<string, string>, post?: string) => Promise<T | null> {
  const optional = new Map<string, OptionalHost>(
    (Object.keys(OPTIONAL_LOOKUP_HOSTS) as OptionalHost[]).map((key) => [OPTIONAL_LOOKUP_HOSTS[key], key]),
  );
  return async (url, headers, post) => {
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
        ...(headers ? { headers } : {}),
        ...(post === undefined ? {} : { method: "POST", body: post }),
      });
      if (!response.ok && !readErrors) return null;
      return await read(response);
    } catch {
      return null;
    }
  };
}

export const createFetchJson = (granted: Granted): GetJson =>
  createFetcher<unknown>(granted, async (response) => (await response.json()) as unknown);

export const createFetchText = (granted: Granted): GetText =>
  createFetcher<string>(granted, async (response) => {
    const text = await response.text();
    return text.length <= MAX_TEXT_CHARS ? text : null;
  });

/** An answer with its status, for a service whose error bodies say what went wrong (a bad key, a used-up quota). */
export interface FetchResult {
  status: number;
  body: unknown;
}

export type GetResult = (url: string, headers?: Record<string, string>) => Promise<FetchResult | null>;

export const createFetchResult = (granted: Granted): GetResult =>
  createFetcher<FetchResult>(
    granted,
    async (response) => {
      const body = (await response.json().catch(() => null)) as unknown;
      return { status: response.status, body };
    },
    true,
  );

/** Send JSON and read JSON back: the way YouTube's own web app asks its search and player endpoints. */
export type PostJson = (url: string, body: unknown) => Promise<unknown>;

export const createFetchPost = (granted: Granted): PostJson => {
  const send = createFetcher<unknown>(granted, async (response) => (await response.json()) as unknown);
  return (url, body) => send(url, { "content-type": "application/json" }, JSON.stringify(body));
};

const chromeGranted: Granted = (origin) => chrome.permissions.contains({ origins: [origin] });

export const fetchJson: GetJson = createFetchJson(chromeGranted);
export const fetchText: GetText = createFetchText(chromeGranted);
export const fetchResult: GetResult = createFetchResult(chromeGranted);
export const fetchPost: PostJson = createFetchPost(chromeGranted);

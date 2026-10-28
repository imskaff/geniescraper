// The worker's YouTube lookup behind an interface, so the router can be tested without the network.
import { fetchResult, fetchText, hostOrigin, type GetResult, type GetText, type PostJson } from "../lookups/http";
import { innertubePages } from "../lookups/innertube";
import { apiPages } from "../lookups/youtubeApi";
import { extractVar, findYoutube, type YoutubeLink, type YoutubePages } from "../lookups/youtube";
import { Limiter } from "./serial";

/** A link, and why the user's key could not be used for it ("" when it was not involved or worked). */
export interface YoutubeResult extends YoutubeLink {
  keyProblem: "" | "key" | "quota" | "not-enabled";
}

export interface YoutubeService {
  /** The link for this song, or an empty link when none is found or YouTube may not be contacted. */
  find(title: string, artist: string): Promise<YoutubeResult>;
  /** True while YouTube is being left alone because it stopped answering. */
  throttled(): boolean;
}

export const NO_YOUTUBE: YoutubeService = {
  find: () => Promise.resolve({ url: "", isMusicVideo: false, keyProblem: "" }),
  throttled: () => false,
};

/**
 * How politely YouTube is asked. Google answers a burst of requests with a "sorry" interstitial (a redirect, which
 * the fetcher refuses), measured at about 50 requests in 13 seconds from one machine: an album read three tracks at
 * a time would trigger it. So requests are few at once, spaced apart, shared by every track being read, and after a
 * run of failures YouTube is left alone for a while instead of being hammered.
 */
export interface GateOptions {
  /** Requests in flight at once, across every track. */
  maxInFlight: number;
  /** The least time between the starts of two requests. */
  gapMs: number;
  /** This many failures in a row put the gate in cool-down. */
  failuresToTrip: number;
  cooldownMs: number;
}

export const DEFAULT_GATE: GateOptions = { maxInFlight: 2, gapMs: 300, failuresToTrip: 3, cooldownMs: 60_000 };

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class YoutubeGate {
  private readonly limit: Limiter;
  private nextStart = 0;
  private failures = 0;
  private blockedUntil = 0;

  constructor(
    private readonly options: GateOptions = DEFAULT_GATE,
    private readonly clock: Clock = REAL_CLOCK,
  ) {
    this.limit = new Limiter(options.maxInFlight);
  }

  /** True while the gate is cooling down after repeated failures. */
  get coolingDown(): boolean {
    return this.clock.now() < this.blockedUntil;
  }

  /** Run one request through the limit and the spacing; null (a failed request) counts towards the cool-down. */
  async run<T>(job: () => Promise<T | null>): Promise<T | null> {
    if (this.coolingDown) return null;
    return this.limit.run(async () => {
      if (this.coolingDown) return null;
      const now = this.clock.now();
      const start = Math.max(now, this.nextStart);
      this.nextStart = start + this.options.gapMs;
      if (start > now) await this.clock.sleep(start - now);
      const result = await job();
      if (result !== null) this.failures = 0;
      else if (++this.failures >= this.options.failuresToTrip) {
        this.blockedUntil = this.clock.now() + this.options.cooldownMs;
        this.failures = 0;
      }
      return result;
    });
  }
}

/**
 * The pages of YouTube, read as text and parsed, every request going through one shared gate. While the permission
 * is not granted nothing is asked and nothing counts as a failure, so a read before the user turns the look-up on
 * cannot leave it cooling down afterwards.
 */
export function youtubePages(
  getText: GetText,
  gate: YoutubeGate,
  granted: () => Promise<boolean> = () => Promise.resolve(true),
  post?: PostJson,
): YoutubePages {
  const page = async (url: string, name: string): Promise<unknown> => {
    if (!(await granted().catch(() => false))) return null;
    return gate.run(async () => {
      const html = await getText(url);
      return html === null ? null : extractVar(html, name);
    });
  };
  const html: YoutubePages = {
    search: (query) =>
      page(
        `https://www.youtube.com/results?${new URLSearchParams({ search_query: query }).toString()}`,
        "ytInitialData",
      ),
    watch: (id) =>
      page(`https://www.youtube.com/watch?${new URLSearchParams({ v: id }).toString()}`, "ytInitialPlayerResponse"),
  };
  if (!post) return html;
  // YouTube's JSON endpoints first; the HTML pages only when they give nothing (the endpoint changed, or it refused).
  const json = innertubePages(async (url, body) => {
    if (!(await granted().catch(() => false))) return null;
    return gate.run(() => post(url, body));
  });
  return {
    search: async (query) => (await json.search(query)) ?? (await html.search(query)),
    watch: async (id) => (await json.watch(id)) ?? (await html.watch(id)),
  };
}

/** The most queries either phase sends through the Data API: one for the video, one for the audio. */
export const API_QUERIES_PER_PHASE = 1;

const youtubeGranted = (): Promise<boolean> => chrome.permissions.contains({ origins: [hostOrigin("youtube")] });
const apiGranted = (): Promise<boolean> => chrome.permissions.contains({ origins: [hostOrigin("youtubeApi")] });

export interface YoutubeOptions {
  getText?: GetText;
  /**
   * YouTube's JSON endpoints; when absent only the HTML pages are used. Off in the real extension: from an extension
   * page the browser sends the extension's origin, which YouTube refuses at once (403), so the extra request would
   * only count as a failure. See section 26 of docs/extension-plan.md.
   */
  post?: PostJson;
  granted?: () => Promise<boolean>;
  /** The user's own YouTube key; "" when they have none. */
  getKey?: () => Promise<string>;
  getResult?: GetResult;
  apiGranted?: () => Promise<boolean>;
}

/**
 * The lookup. With the user's key (and Chrome's permission for Google's API host) it asks Google's official service,
 * which is not subject to the page-reading limit and is authoritative: no result there means no result. Without a
 * key, or when the key could not be used (wrong, quota used up, service not switched on), it reads YouTube's pages
 * as before, so a bad key never leaves the user worse off.
 */
export function realYoutube(options: YoutubeOptions = {}): YoutubeService {
  const {
    getText = fetchText,
    post,
    granted = youtubeGranted,
    getKey = () => Promise.resolve(""),
    getResult = fetchResult,
    apiGranted: apiAllowed = apiGranted,
  } = options;
  const gate = new YoutubeGate();
  const pages = youtubePages(getText, gate, granted, post);
  const api = new Limiter(2);
  return {
    async find(title, artist) {
      let keyProblem: YoutubeResult["keyProblem"] = "";
      const key = await getKey().catch(() => "");
      if (key && (await apiAllowed().catch(() => false))) {
        const viaApi = apiPages(getResult, key);
        const limited: YoutubePages = {
          search: (query) => api.run(() => viaApi.search(query)),
          watch: (id) => api.run(() => viaApi.watch(id)),
        };
        // Google's service is metered (a search costs 100 of the 10,000 free units a day): at most two searches a song.
        const link = await findYoutube(limited, title, artist, { queriesPerPhase: API_QUERIES_PER_PHASE });
        const problem = viaApi.problem();
        if (link.url || problem === "" || problem === "failed") return { ...link, keyProblem: "" };
        keyProblem = problem;
      }
      return { ...(await findYoutube(pages, title, artist)), keyProblem };
    },
    throttled: () => gate.coolingDown,
  };
}

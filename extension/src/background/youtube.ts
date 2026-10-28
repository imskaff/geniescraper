// The worker's YouTube lookup behind an interface, so the router can be tested without the network.
import { fetchText, hostOrigin, type GetText } from "../lookups/http";
import { extractVar, findYoutube, type YoutubeLink, type YoutubePages } from "../lookups/youtube";
import { Limiter } from "./serial";

export interface YoutubeService {
  /** The link for this song, or an empty link when none is found or YouTube may not be contacted. */
  find(title: string, artist: string): Promise<YoutubeLink>;
  /** True while YouTube is being left alone because it stopped answering. */
  throttled(): boolean;
}

export const NO_YOUTUBE: YoutubeService = {
  find: () => Promise.resolve({ url: "", isMusicVideo: false }),
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
): YoutubePages {
  const page = async (url: string, name: string): Promise<unknown> => {
    if (!(await granted().catch(() => false))) return null;
    return gate.run(async () => {
      const html = await getText(url);
      return html === null ? null : extractVar(html, name);
    });
  };
  return {
    search: (query) =>
      page(
        `https://www.youtube.com/results?${new URLSearchParams({ search_query: query }).toString()}`,
        "ytInitialData",
      ),
    watch: (id) =>
      page(`https://www.youtube.com/watch?${new URLSearchParams({ v: id }).toString()}`, "ytInitialPlayerResponse"),
  };
}

const youtubeGranted = (): Promise<boolean> => chrome.permissions.contains({ origins: [hostOrigin("youtube")] });

export function realYoutube(
  getText: GetText = fetchText,
  granted: () => Promise<boolean> = youtubeGranted,
): YoutubeService {
  const gate = new YoutubeGate();
  const pages = youtubePages(getText, gate, granted);
  return { find: (title, artist) => findYoutube(pages, title, artist), throttled: () => gate.coolingDown };
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YoutubeGate, realYoutube, youtubePages } from "../../src/background/youtube";
import { createFetchPost, type PostJson } from "../../src/lookups/http";
import { innertubePages } from "../../src/lookups/innertube";
import { findYoutube } from "../../src/lookups/youtube";

const TESTS = join(import.meta.dirname, "..", "..", "..", "tests");
interface Golden {
  id: string;
  title: string;
  artist: string;
  accept: string[];
  is_music_video: boolean;
}
interface Fixture {
  searches: Record<string, unknown>;
  watch: Record<string, unknown>;
}
const golden = JSON.parse(readFileSync(join(TESTS, "golden", "youtube.json"), "utf-8")) as Golden[];
const fixture = (id: string): Fixture =>
  JSON.parse(readFileSync(join(TESTS, "fixtures", "lookups", "youtube", `${id}.json`), "utf-8")) as Fixture;

interface Call {
  url: string;
  body: Record<string, unknown>;
}

describe("YouTube's JSON endpoints", () => {
  it("search with the web client's identity and the query, and ask for a video's details with its id", async () => {
    const calls: Call[] = [];
    const post: PostJson = (url, body) => {
      calls.push({ url, body: body as Record<string, unknown> });
      return Promise.resolve({ ok: true });
    };
    const pages = innertubePages(post);
    expect(await pages.search('"SOS" "SZA - Topic"')).toEqual({ ok: true });
    await pages.watch("tafAB36p2sc");
    expect(calls.map((c) => c.url)).toEqual([
      "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    ]);
    expect(calls[0]?.body).toMatchObject({ query: '"SOS" "SZA - Topic"', context: { client: { clientName: "WEB" } } });
    expect(calls[1]?.body).toMatchObject({ videoId: "tafAB36p2sc", context: { client: { clientName: "WEB" } } });
  });

  it("send no key, in the URL or anywhere else", async () => {
    const urls: string[] = [];
    await innertubePages((url) => {
      urls.push(url);
      return Promise.resolve(null);
    }).search("x");
    expect(urls.join()).not.toMatch(/key=/);
  });

  it.each(golden.map((g) => [g.id, g] as const))(
    "%s gets an accepted video through the JSON path, answered in the saved pages' shape",
    async (_id, g) => {
      const saved = fixture(g.id);
      const pages = innertubePages((url, body) => {
        const b = body as { query?: string; videoId?: string };
        return Promise.resolve(
          url.includes("/search") ? (saved.searches[b.query ?? ""] ?? null) : (saved.watch[b.videoId ?? ""] ?? null),
        );
      });
      const link = await findYoutube(pages, g.title, g.artist);
      expect(g.accept, link.url).toContain(link.url.split("=").pop() ?? "");
      expect(link.isMusicVideo).toBe(g.is_music_video);
    },
  );
});

describe("createFetchPost", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const stub = (status = 200, body: unknown = { a: 1 }) => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal("fetch", (input: URL | string, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
    });
    return calls;
  };

  it("posts the JSON with its content type, no cookies, no referrer, and no redirects, and reads JSON back", async () => {
    const calls = stub();
    const post = createFetchPost(() => Promise.resolve(true));
    expect(await post("https://www.youtube.com/youtubei/v1/search", { query: "x" })).toEqual({ a: 1 });
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      body: '{"query":"x"}',
      headers: { "content-type": "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
  });

  it("asks nothing of YouTube while its permission is not granted", async () => {
    const calls = stub();
    expect(
      await createFetchPost(() => Promise.resolve(false))("https://www.youtube.com/youtubei/v1/search", {}),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it("gives null for an error status and for a host it does not know", async () => {
    stub(429, {});
    const post = createFetchPost(() => Promise.resolve(true));
    expect(await post("https://www.youtube.com/youtubei/v1/search", {})).toBeNull();
    expect(await post("https://example.com/x", {})).toBeNull();
  });
});

describe("the pages with the JSON endpoints first", () => {
  const gate = () => new YoutubeGate({ maxInFlight: 2, gapMs: 0, failuresToTrip: 99, cooldownMs: 0 });
  const html = (name: string) => `<script>var ${name} = {"from":"html"};</script>`;

  it("use the JSON answer, and never fetch the HTML page, when the JSON endpoint answers", async () => {
    const pages: string[] = [];
    const p = youtubePages(
      (url) => {
        pages.push(url);
        return Promise.resolve(html("ytInitialData"));
      },
      gate(),
      () => Promise.resolve(true),
      () => Promise.resolve({ from: "json" }),
    );
    expect(await p.search("x")).toEqual({ from: "json" });
    expect(await p.watch("abcDEF_-123")).toEqual({ from: "json" });
    expect(pages).toEqual([]);
  });

  it("fall back to the HTML page when the JSON endpoint gives nothing", async () => {
    const p = youtubePages(
      () => Promise.resolve(html("ytInitialData")),
      gate(),
      () => Promise.resolve(true),
      () => Promise.resolve(null),
    );
    expect(await p.search("x")).toEqual({ from: "html" });
  });

  it("use only the HTML pages when no JSON fetcher is given", async () => {
    const p = youtubePages(() => Promise.resolve(html("ytInitialData")), gate());
    expect(await p.search("x")).toEqual({ from: "html" });
  });

  it("ask nothing at all while the permission is not granted", async () => {
    let asked = 0;
    const p = youtubePages(
      () => {
        asked++;
        return Promise.resolve(null);
      },
      gate(),
      () => Promise.resolve(false),
      () => {
        asked++;
        return Promise.resolve({});
      },
    );
    expect(await p.search("x")).toBeNull();
    expect(asked).toBe(0);
  });

  it("go through the shared gate: at most two JSON requests at once", async () => {
    let active = 0;
    let peak = 0;
    const p = youtubePages(
      () => Promise.resolve(null),
      gate(),
      () => Promise.resolve(true),
      async () => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return { ok: true };
      },
    );
    await Promise.all(Array.from({ length: 10 }, (_, i) => p.search(String(i))));
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("the service over the JSON endpoints", () => {
  it("finds a link through the JSON path alone, with no key and no HTML", async () => {
    const g = golden.find((x) => x.id === "sza-sos-t1");
    if (!g) throw new Error("missing golden case");
    const saved = fixture(g.id);
    let htmlFetched = 0;
    const yt = realYoutube({
      getText: () => {
        htmlFetched++;
        return Promise.resolve(null);
      },
      granted: () => Promise.resolve(true),
      post: (url, body) => {
        const b = body as { query?: string; videoId?: string };
        return Promise.resolve(
          url.includes("/search") ? (saved.searches[b.query ?? ""] ?? null) : (saved.watch[b.videoId ?? ""] ?? null),
        );
      },
    });
    const found = await yt.find(g.title, g.artist);
    expect(g.accept).toContain(found.url.split("=").pop());
    expect(htmlFetched).toBe(0);
  });
});

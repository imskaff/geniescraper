import { describe, expect, it } from "vitest";
import { realYoutube } from "../../src/background/youtube";
import { createFetchResult, type FetchResult, type GetResult } from "../../src/lookups/http";
import {
  apiPages,
  checkKey,
  decodeEntities,
  problemOf,
  searchAsPage,
  videoAsPlayer,
} from "../../src/lookups/youtubeApi";
import { findYoutube, listVideos, type YoutubePages } from "../../src/lookups/youtube";
import { cleanKey, loadYoutubeKey, looksLikeApiKey, saveYoutubeKey } from "../../src/shared/secrets";
import { isKeyCheck, isWorkerRequest, isYoutubeAnswer } from "../../src/shared/messages";
import { memoryStore } from "../ui/fakes";

const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";

const error = (reason: string, message = "x") => ({ error: { message, errors: [{ reason }] } });

describe("problemOf", () => {
  it.each([
    [200, {}, ""],
    [403, error("quotaExceeded"), "quota"],
    [403, error("dailyLimitExceeded"), "quota"],
    [429, error("rateLimitExceeded"), "quota"],
    [403, error("accessNotConfigured"), "not-enabled"],
    [
      403,
      error("forbidden", "YouTube Data API v3 has not been used in project 1 before or it is disabled."),
      "not-enabled",
    ],
    [400, error("badRequest", "API key not valid. Please pass a valid API key."), "key"],
    [400, error("keyInvalid"), "key"],
    [403, error("ipRefererBlocked"), "key"],
    [401, {}, "key"],
    [500, {}, "failed"],
    [503, null, "failed"],
  ])("status %i with %j is %j", (status, body, expected) => {
    expect(problemOf(status, body)).toBe(expected);
  });
});

describe("decodeEntities", () => {
  it.each([
    ["Don&#39;t Start Now", "Don't Start Now"],
    ["Beyonc&eacute;", "Beyonc&eacute;"],
    ["A &amp; B &quot;C&quot; &lt;D&gt;", 'A & B "C" <D>'],
    ["&#x1F3B5; song", "\u{1F3B5} song"],
    ["&#99999999999; &#0; &#xZZ; plain", "&#99999999999; &#0; &#xZZ; plain"],
    ["no entities", "no entities"],
  ])("%j becomes %j", (input, output) => {
    expect(decodeEntities(input)).toBe(output);
  });
});

describe("rewriting the API's answers for the scorer", () => {
  const search = {
    items: [
      {
        id: { kind: "youtube#video", videoId: "abcDEF_-123" },
        snippet: {
          title: "SZA - SOS (Official Audio)",
          channelTitle: "SZA &amp; Co",
          description: "Provided to YouTube by RCA",
        },
      },
      { id: { kind: "youtube#channel", channelId: "UC1" }, snippet: { title: "A channel" } },
      "junk",
      null,
    ],
  };

  it("turns a search into the results page the page-reading lookup scores", () => {
    expect(listVideos(searchAsPage(search))).toEqual([
      {
        id: "abcDEF_-123",
        title: "SZA - SOS (Official Audio)",
        channel: "SZA & Co",
        officialArtist: false,
        verified: false,
        snippet: "Provided to YouTube by RCA",
      },
    ]);
  });

  it.each([null, undefined, 5, "x", {}, { items: "x" }, { items: [] }])(
    "turns the malformed search %j into no videos",
    (body) => {
      expect(listVideos(searchAsPage(body))).toEqual([]);
    },
  );

  it("reads a video's description from the videos answer, or gives an empty one", () => {
    expect(videoAsPlayer({ items: [{ snippet: { description: "Directed by X &amp; Y" } }] })).toEqual({
      videoDetails: { shortDescription: "Directed by X & Y" },
    });
    expect(videoAsPlayer({ items: [] })).toEqual({ videoDetails: { shortDescription: "" } });
    expect(videoAsPlayer(null)).toEqual({ videoDetails: { shortDescription: "" } });
  });
});

/** A fake Google: answers search and videos requests from a table, recording every request. */
function fakeGoogle(answers: { search?: (q: string) => FetchResult; videos?: (id: string) => FetchResult }) {
  const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
  const getResult: GetResult = (url, headers) => {
    calls.push({ url, headers });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/search")) {
      return Promise.resolve(
        answers.search?.(parsed.searchParams.get("q") ?? "") ?? { status: 200, body: { items: [] } },
      );
    }
    return Promise.resolve(
      answers.videos?.(parsed.searchParams.get("id") ?? "") ?? { status: 200, body: { items: [] } },
    );
  };
  return { calls, getResult };
}

const hit = (id: string, title: string, channel: string, description = "") => ({
  id: { videoId: id },
  snippet: { title, channelTitle: channel, description },
});

describe("apiPages", () => {
  it("sends the key in a header and never in the URL", async () => {
    const google = fakeGoogle({});
    const pages = apiPages(google.getResult, KEY);
    await pages.search("SZA SOS");
    await pages.watch("abcDEF_-123");
    expect(google.calls).toHaveLength(2);
    for (const call of google.calls) {
      expect(call.url).not.toContain(KEY);
      expect(call.url).not.toContain("key=");
      expect(call.headers).toEqual({ "X-Goog-Api-Key": KEY });
      expect(call.url.startsWith("https://www.googleapis.com/youtube/v3/")).toBe(true);
    }
    expect(new URL(google.calls[0]?.url ?? "").searchParams.get("q")).toBe("SZA SOS");
  });

  it("remembers why the last request had no answer, and forgets it after a good one", async () => {
    let answer: FetchResult = { status: 403, body: error("quotaExceeded") };
    const pages = apiPages(() => Promise.resolve(answer), KEY);
    expect(await pages.search("x")).toBeNull();
    expect(pages.problem()).toBe("quota");
    answer = { status: 200, body: { items: [] } };
    await pages.search("x");
    expect(pages.problem()).toBe("");
  });

  it("calls an unreachable service a plain failure", async () => {
    const pages = apiPages(() => Promise.resolve(null), KEY);
    expect(await pages.search("x")).toBeNull();
    expect(pages.problem()).toBe("failed");
  });
});

describe("checkKey", () => {
  it.each([
    [{ status: 200, body: { items: [] } }, "ok"],
    [{ status: 400, body: error("badRequest", "API key not valid") }, "key"],
    [{ status: 403, body: error("quotaExceeded") }, "quota"],
    [{ status: 403, body: error("accessNotConfigured") }, "not-enabled"],
    [{ status: 500, body: null }, "failed"],
    [null, "failed"],
  ])("answers %j with %s", async (result, expected) => {
    expect(await checkKey(() => Promise.resolve(result), KEY)).toBe(expected);
  });

  it("uses the cheapest request, with the key in a header", async () => {
    const google = fakeGoogle({});
    await checkKey(google.getResult, KEY);
    expect(google.calls).toHaveLength(1);
    expect(google.calls[0]?.url).toContain("/videos?");
    expect(google.calls[0]?.url).not.toContain(KEY);
    expect(google.calls[0]?.headers).toEqual({ "X-Goog-Api-Key": KEY });
  });
});

describe("picking a video through the API, by the same rules as through the pages", () => {
  const pagesFor = (search: (q: string) => FetchResult): YoutubePages =>
    apiPages(fakeGoogle({ search }).getResult, KEY);

  it("finds a Topic upload for a song with no music video", async () => {
    const pages = pagesFor((q) =>
      q.includes("official music video")
        ? { status: 200, body: { items: [hit("aaaaaaaaaaa", "SZA - SOS Where The Hell Have You Been ?", "SZA")] } }
        : { status: 200, body: { items: [hit("tafAB36p2sc", "SOS", "SZA - Topic", "Provided to YouTube by RCA")] } },
    );
    expect(await findYoutube(pages, "SOS", "SZA")).toEqual({
      url: "https://www.youtube.com/watch?v=tafAB36p2sc",
      isMusicVideo: false,
    });
  });

  it("finds the official video on the artist's channel", async () => {
    const pages = pagesFor((q) =>
      q.includes("official music video")
        ? {
            status: 200,
            body: { items: [hit("gNi_6U5Pm_o", "Olivia Rodrigo - good 4 u (Official Video)", "OliviaRodrigoVEVO")] },
          }
        : { status: 200, body: { items: [] } },
    );
    expect(await findYoutube(pages, "good 4 u", "Olivia Rodrigo")).toEqual({
      url: "https://www.youtube.com/watch?v=gNi_6U5Pm_o",
      isMusicVideo: true,
    });
  });

  it("decodes entities before matching, so an apostrophe in a title does not hide it", async () => {
    const pages = pagesFor(() => ({
      status: 200,
      body: {
        items: [hit("abcDEF_-123", "Billie Eilish - Don&#39;t Smile at Me (Official Audio)", "Billie Eilish - Topic")],
      },
    }));
    const link = await findYoutube(pages, "Don't Smile at Me", "Billie Eilish");
    expect(link.url).toBe("https://www.youtube.com/watch?v=abcDEF_-123");
  });
});

describe("the service with a key", () => {
  const FOUND = hit("tafAB36p2sc", "SOS", "SZA - Topic", "Provided to YouTube by RCA");
  const okSearch = { status: 200, body: { items: [FOUND] } };

  function service(options: { key?: string; apiAllowed?: boolean; result?: FetchResult; pageHtml?: string | null }) {
    const scraped: string[] = [];
    const google = fakeGoogle({ search: () => options.result ?? okSearch });
    const yt = realYoutube({
      getText: (url) => {
        scraped.push(url);
        return Promise.resolve(options.pageHtml ?? null);
      },
      granted: () => Promise.resolve(true),
      getKey: () => Promise.resolve(options.key ?? ""),
      getResult: google.getResult,
      apiGranted: () => Promise.resolve(options.apiAllowed ?? true),
    });
    return { yt, scraped, google };
  }

  it("asks Google's service, not YouTube's pages, and finds the link", async () => {
    const { yt, scraped, google } = service({ key: KEY });
    expect(await yt.find("SOS", "SZA")).toEqual({
      url: "https://www.youtube.com/watch?v=tafAB36p2sc",
      isMusicVideo: false,
      keyProblem: "",
    });
    expect(scraped).toEqual([]);
    expect(google.calls.length).toBeGreaterThan(0);
  });

  it("does not read YouTube's pages when Google answered and simply had nothing", async () => {
    const { yt, scraped } = service({ key: KEY, result: { status: 200, body: { items: [] } } });
    expect(await yt.find("SOS", "SZA")).toEqual({ url: "", isMusicVideo: false, keyProblem: "" });
    expect(scraped).toEqual([]);
  });

  it.each([
    [{ status: 400, body: error("badRequest", "API key not valid") }, "key"],
    [{ status: 403, body: error("quotaExceeded") }, "quota"],
    [{ status: 403, body: error("accessNotConfigured") }, "not-enabled"],
  ] as const)(
    "falls back to YouTube's pages when the key cannot be used (%j), and says why",
    async (result, problem) => {
      const { yt, scraped } = service({ key: KEY, result });
      const found = await yt.find("SOS", "SZA");
      expect(scraped.length).toBeGreaterThan(0);
      expect(found.keyProblem).toBe(problem);
    },
  );

  it("forgets a problem once a later lookup works", async () => {
    let result: FetchResult = { status: 403, body: error("quotaExceeded") };
    const google = fakeGoogle({ search: () => result });
    const yt = realYoutube({
      getText: () => Promise.resolve(null),
      granted: () => Promise.resolve(true),
      getKey: () => Promise.resolve(KEY),
      getResult: google.getResult,
      apiGranted: () => Promise.resolve(true),
    });
    expect((await yt.find("SOS", "SZA")).keyProblem).toBe("quota");
    result = okSearch;
    expect((await yt.find("SOS", "SZA")).keyProblem).toBe("");
  });

  it("gives every concurrent lookup its own key problem, not the latest lookup's", async () => {
    const google = fakeGoogle({
      search: (q) => (q.includes("BAD") ? { status: 403, body: error("quotaExceeded") } : okSearch),
    });
    const yt = realYoutube({
      getText: () => Promise.resolve(null),
      granted: () => Promise.resolve(true),
      getKey: () => Promise.resolve(KEY),
      getResult: google.getResult,
      apiGranted: () => Promise.resolve(true),
    });
    const [bad, good] = await Promise.all([yt.find("BAD", "SZA"), yt.find("SOS", "SZA")]);
    expect(bad.keyProblem).toBe("quota");
    expect(good.keyProblem).toBe("");
  });

  it("uses only the pages, and sends nothing to Google, without a key or without Chrome's permission", async () => {
    const noKey = service({});
    await noKey.yt.find("SOS", "SZA");
    expect(noKey.google.calls).toEqual([]);
    expect(noKey.scraped.length).toBeGreaterThan(0);
    const noPermission = service({ key: KEY, apiAllowed: false });
    await noPermission.yt.find("SOS", "SZA");
    expect(noPermission.google.calls).toEqual([]);
  });

  it("has at most two requests to Google in flight at once", async () => {
    let active = 0;
    let peak = 0;
    const yt = realYoutube({
      getText: () => Promise.resolve(null),
      granted: () => Promise.resolve(true),
      getKey: () => Promise.resolve(KEY),
      apiGranted: () => Promise.resolve(true),
      getResult: async (url) => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 3));
        active--;
        return url.includes("/search")
          ? { status: 200, body: { items: [hit("abcDEF_-123", "Song", "Artist - Topic", "Provided to YouTube by X")] } }
          : { status: 200, body: { items: [] } };
      },
    });
    await Promise.all(["a", "b", "c", "d", "e"].map((t) => yt.find(t, "Artist")));
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("createFetchResult", () => {
  const stub = (status: number, body: unknown) => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = ((input: URL | string, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
    }) as typeof fetch;
    return calls;
  };

  it("passes the headers, keeps the status of an error answer and its body, and refuses redirects", async () => {
    const calls = stub(403, { error: "x" });
    const result = await createFetchResult(() => Promise.resolve(true))(
      "https://www.googleapis.com/youtube/v3/search",
      {
        "X-Goog-Api-Key": KEY,
      },
    );
    expect(result).toEqual({ status: 403, body: { error: "x" } });
    expect(calls[0]?.init).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      headers: { "X-Goog-Api-Key": KEY },
    });
  });

  it("never contacts Google's service while its permission is not granted", async () => {
    const calls = stub(200, {});
    expect(
      await createFetchResult(() => Promise.resolve(false))("https://www.googleapis.com/youtube/v3/search"),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it("gives a null body, not a failure, for an answer that is not JSON", async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("html")),
      })) as unknown as typeof fetch;
    expect(await createFetchResult(() => Promise.resolve(true))("https://www.googleapis.com/x")).toEqual({
      status: 502,
      body: null,
    });
  });
});

describe("the stored key", () => {
  it("accepts a real-looking key and nothing else", () => {
    expect(looksLikeApiKey(KEY)).toBe(true);
    for (const bad of [
      "",
      "AIza",
      KEY.slice(0, -1),
      `${KEY}x`,
      KEY.replace("AIza", "BIza"),
      `${KEY.slice(0, -1)} `,
      "a b",
    ]) {
      expect(looksLikeApiKey(bad), bad).toBe(false);
    }
  });

  it("tidies what was pasted: spaces, line breaks and quotes", () => {
    expect(cleanKey(`  ${KEY}\n`)).toBe(KEY);
    expect(cleanKey(`"${KEY}"`)).toBe(KEY);
    expect(cleanKey(`'${KEY}'`)).toBe(KEY);
    expect(cleanKey("")).toBe("");
  });

  it("is saved, read back, and ignored when it is not a key", async () => {
    const store = memoryStore();
    expect(await loadYoutubeKey(store)).toBe("");
    await saveYoutubeKey(store, KEY);
    expect(await loadYoutubeKey(store)).toBe(KEY);
    await saveYoutubeKey(store, "tampered");
    expect(await loadYoutubeKey(store)).toBe("");
    await saveYoutubeKey(store, "");
    expect(await loadYoutubeKey(store)).toBe("");
  });

  it("is read as empty when storage fails", async () => {
    expect(await loadYoutubeKey({ get: () => Promise.reject(new Error("x")), set: () => Promise.resolve() })).toBe("");
  });
});

describe("the messages about the key", () => {
  it("accepts a key check with a key, and rejects the malformed ones", () => {
    expect(isWorkerRequest({ type: "youtube-key-check", key: KEY })).toBe(true);
    for (const bad of [
      { type: "youtube-key-check" },
      { type: "youtube-key-check", key: 5 },
      { type: "youtube-key-check", key: "x".repeat(300) },
    ]) {
      expect(isWorkerRequest(bad)).toBe(false);
    }
  });

  it("validates the answers", () => {
    for (const ok of ["ok", "key", "quota", "not-enabled", "failed"]) expect(isKeyCheck(ok)).toBe(true);
    for (const bad of ["", "OK", 1, null, {}]) expect(isKeyCheck(bad)).toBe(false);
    const answer = { url: "", isMusicVideo: false, throttled: false, keyProblem: "" };
    expect(isYoutubeAnswer(answer)).toBe(true);
    expect(isYoutubeAnswer({ ...answer, keyProblem: "quota" })).toBe(true);
    expect(isYoutubeAnswer({ ...answer, keyProblem: "nonsense" })).toBe(false);
    expect(isYoutubeAnswer({ url: "", isMusicVideo: false, throttled: false })).toBe(false);
  });
});

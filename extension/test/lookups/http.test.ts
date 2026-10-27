import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOOKUP_HOSTS,
  OPTIONAL_LOOKUP_HOSTS,
  REQUIRED_LOOKUP_HOSTS,
  createFetchJson,
  fetchJson,
  hostOrigin,
} from "../../src/lookups/http";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: () => Promise<unknown>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal("fetch", (input: URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response();
  });
  return calls;
}

const ok = (body: unknown) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

describe("fetchJson", () => {
  it("fetches an allowed host without cookies or a referrer", async () => {
    const calls = stubFetch(ok({ a: 1 }));
    expect(await fetchJson("https://itunes.apple.com/lookup?id=1")).toEqual({ a: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    "https://example.com/x",
    "https://itunes.apple.com.evil.example/lookup",
    "http://itunes.apple.com/lookup",
    "not a url",
    "",
  ])("never contacts %j", async (url) => {
    const calls = stubFetch(ok({}));
    expect(await fetchJson(url)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("gives null for an error status, bad JSON, and a thrown error", async () => {
    stubFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ a: 1 }) }));
    expect(await fetchJson("https://itunes.apple.com/lookup")).toBeNull();
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.reject(new Error("not json")) }));
    expect(await fetchJson("https://itunes.apple.com/lookup")).toBeNull();
    stubFetch(() => Promise.reject(new Error("offline")));
    expect(await fetchJson("https://itunes.apple.com/lookup")).toBeNull();
  });

  it("refuses a redirect, so a response never comes from a host that was not checked", async () => {
    const calls = stubFetch(ok({ a: 1 }));
    await fetchJson("https://itunes.apple.com/lookup");
    expect(calls[0]?.init?.redirect).toBe("error");
  });

  it("lists exactly the hosts the manifest grants, one required and two optional", () => {
    expect([...REQUIRED_LOOKUP_HOSTS]).toEqual(["itunes.apple.com"]);
    expect(Object.values(OPTIONAL_LOOKUP_HOSTS)).toEqual(["api.deezer.com", "www.youtube.com"]);
    expect([...LOOKUP_HOSTS].sort()).toEqual(["api.deezer.com", "itunes.apple.com", "www.youtube.com"]);
  });
});

describe("an optional host", () => {
  const URLS = { deezer: "https://api.deezer.com/search?q=x", youtube: "https://www.youtube.com/results?q=x" };

  it.each(["deezer", "youtube"] as const)("is never contacted while %s is not granted", async (host) => {
    const calls = stubFetch(ok({}));
    const asked: string[] = [];
    const get = createFetchJson((origin) => {
      asked.push(origin);
      return Promise.resolve(false);
    });
    expect(await get(URLS[host])).toBeNull();
    expect(calls).toEqual([]);
    expect(asked).toEqual([hostOrigin(host)]);
  });

  it.each(["deezer", "youtube"] as const)("is contacted once %s is granted", async (host) => {
    const calls = stubFetch(ok({ ok: true }));
    expect(await createFetchJson(() => Promise.resolve(true))(URLS[host])).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("is checked at every request, so a permission taken back stops the next lookup", async () => {
    const calls = stubFetch(ok({}));
    let granted = true;
    const get = createFetchJson(() => Promise.resolve(granted));
    await get(URLS.deezer);
    granted = false;
    expect(await get(URLS.deezer)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("is never asked about for a host that is not in the list, and the required host needs no grant", async () => {
    stubFetch(ok({ a: 1 }));
    const asked: string[] = [];
    const get = createFetchJson((origin) => {
      asked.push(origin);
      return Promise.resolve(true);
    });
    expect(await get("https://example.com/x")).toBeNull();
    expect(await get("https://api.deezer.com.evil.example/x")).toBeNull();
    expect(await get("https://itunes.apple.com/lookup")).toEqual({ a: 1 });
    expect(asked).toEqual([]);
  });

  it("gives null when the permission check itself throws", async () => {
    stubFetch(ok({}));
    const get = createFetchJson(() => Promise.reject(new Error("no chrome")));
    expect(await get(URLS.deezer)).toBeNull();
  });
});

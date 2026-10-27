import { afterEach, describe, expect, it, vi } from "vitest";
import { LOOKUP_HOSTS, fetchJson } from "../../src/lookups/http";

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
    "https://api.deezer.com/search",
    "https://www.youtube.com/results",
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

  it("allows exactly the hosts the manifest grants for lookups so far", () => {
    expect([...LOOKUP_HOSTS]).toEqual(["itunes.apple.com"]);
  });
});

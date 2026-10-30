import { describe, expect, it } from "vitest";
import { createUpdateService, type UpdateDeps } from "../../src/background/updates";
import { createRouter } from "../../src/background/router";
import { PasteService } from "../../src/background/paste";
import { CHECK_INTERVAL_MS, SNOOZE_MS, UPDATE_KEY, releaseUrl } from "../../src/core/updates";
import { OPTIONAL_LOOKUP_HOSTS, createFetchResult, type FetchResult } from "../../src/lookups/http";
import { isOfferedUpdate, isWorkerRequest } from "../../src/shared/messages";
import { memoryStore } from "../ui/fakes";
import { FAST_CLIENT, fakeBrowser } from "./fakePorts";

const T0 = 1_800_000_000_000;

const release = (version: string): Record<string, unknown> => ({
  tag_name: `extension-v${version}`,
  draft: false,
  prerelease: false,
  assets: [{ name: `geniescraper-extension-${version}.zip` }],
});

interface Harness {
  deps: UpdateDeps;
  service: ReturnType<typeof createUpdateService>;
  local: ReturnType<typeof memoryStore>;
  /** Addresses asked of GitHub. */
  asked: string[];
  clock: { now: number };
  granted: { value: boolean };
  answer: { value: FetchResult | null };
}

function harness(
  options: { settings?: unknown; installed?: string; eligible?: boolean; answer?: FetchResult | null } = {},
): Harness {
  const asked: string[] = [];
  const clock = { now: T0 };
  const granted = { value: true };
  const answer = {
    value: options.answer === undefined ? { status: 200, body: [release("0.7.0")] } : options.answer,
  };
  const local = memoryStore();
  const deps: UpdateDeps = {
    settings: memoryStore({ settings: options.settings ?? { onboarded: true, checkUpdates: true } }),
    local,
    getResult: (url) => {
      asked.push(url);
      return Promise.resolve(answer.value);
    },
    granted: () => Promise.resolve(granted.value),
    installed: options.installed ?? "0.6.0",
    eligible: options.eligible ?? true,
    now: () => clock.now,
  };
  return { deps, service: createUpdateService(deps), local, asked, clock, granted, answer };
}

describe("the update service", () => {
  it("offers the newer release with its page and asks GitHub for the releases list only", async () => {
    const h = harness();
    expect(await h.service.check()).toEqual({ version: "0.7.0", url: releaseUrl("0.7.0") });
    expect(h.asked).toEqual(["https://api.github.com/repos/imskaff/geniescraper/releases?per_page=30"]);
  });

  it("offers nothing when the installed version is current", async () => {
    const h = harness({ installed: "0.7.0" });
    expect(await h.service.check()).toBeNull();
  });

  it("does nothing, and sends nothing, while the setting is off", async () => {
    for (const settings of [{ onboarded: true }, { checkUpdates: false }, undefined]) {
      const h = harness({ settings: settings ?? "garbage" });
      expect(await h.service.check()).toBeNull();
      expect(await h.service.check(true)).toBeNull();
      expect(h.asked).toEqual([]);
      expect(h.local.data.size).toBe(0);
    }
  });

  it("does nothing, and sends nothing, while the host is not allowed, and looks once it is", async () => {
    const h = harness();
    h.granted.value = false;
    expect(await h.service.check()).toBeNull();
    expect(h.asked).toEqual([]);
    expect(h.local.data.size).toBe(0);
    h.granted.value = true;
    expect((await h.service.check())?.version).toBe("0.7.0");
  });

  it("does nothing for an install the browser updates itself", async () => {
    const h = harness({ eligible: false });
    expect(await h.service.check(true)).toBeNull();
    expect(h.asked).toEqual([]);
  });

  it("looks at most once a day, then answers from what it kept", async () => {
    const h = harness();
    await h.service.check();
    h.clock.now += CHECK_INTERVAL_MS - 1;
    expect((await h.service.check())?.version).toBe("0.7.0");
    expect(h.asked).toHaveLength(1);
    h.clock.now += 1;
    await h.service.check();
    expect(h.asked).toHaveLength(2);
  });

  it("looks again at once when asked to by the user switching it on", async () => {
    const h = harness();
    await h.service.check();
    await h.service.check(true);
    expect(h.asked).toHaveLength(2);
  });

  it("shares one look between callers that ask together", async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.service.check(), h.service.check()]);
    expect(a).toEqual(b);
    expect(h.asked).toHaveLength(1);
  });

  it.each([
    ["a rate limit", { status: 403, body: { message: "API rate limit exceeded" } }],
    ["too many requests", { status: 429, body: {} }],
    ["a missing repository", { status: 404, body: { message: "Not Found" } }],
    ["a server error", { status: 500, body: null }],
    ["no connection or no permission", null],
    ["an answer of the wrong shape", { status: 200, body: { releases: [] } }],
    ["no extension release in the list", { status: 200, body: [{ tag_name: "v1.2", draft: false }] }],
  ])("stays silent after %s and does not try again before the day is out", async (_name, bad) => {
    const h = harness({ answer: bad });
    expect(await h.service.check()).toBeNull();
    expect(await h.service.check()).toBeNull();
    expect(h.asked).toHaveLength(1);
    expect(h.local.data.get(UPDATE_KEY)).toMatchObject({ checkedAt: T0, latest: null });
  });

  it("keeps the last good answer when a later look fails", async () => {
    const h = harness();
    await h.service.check();
    h.answer.value = { status: 403, body: {} };
    h.clock.now += CHECK_INTERVAL_MS;
    expect((await h.service.check())?.version).toBe("0.7.0");
    expect(h.asked).toHaveLength(2);
  });

  it("never rejects, even when storage or the network throws", async () => {
    const h = harness();
    h.deps.getResult = () => Promise.reject(new Error("boom"));
    const broken = createUpdateService(h.deps);
    expect(await broken.check()).toBeNull();
    const noStorage = createUpdateService({
      ...h.deps,
      local: { get: () => Promise.reject(new Error("full")), set: () => Promise.reject(new Error("full")) },
    });
    expect(await noStorage.check()).toBeNull();
    expect(await noStorage.later("0.7.0")).toBeNull();
    expect(await noStorage.skip("0.7.0")).toBeNull();
  });

  it("hides the notice for a few days after Later, then shows it again", async () => {
    const h = harness();
    await h.service.check();
    expect(await h.service.later("0.7.0")).toBeNull();
    h.clock.now += SNOOZE_MS - 1;
    expect(await h.service.check()).toBeNull();
    h.clock.now += 1;
    expect((await h.service.check())?.version).toBe("0.7.0");
  });

  it("brings the notice back at once for a release newer than the one snoozed", async () => {
    const h = harness();
    await h.service.check();
    await h.service.later("0.7.0");
    h.answer.value = { status: 200, body: [release("0.8.0"), release("0.7.0")] };
    expect((await h.service.check(true))?.version).toBe("0.8.0");
  });

  it("never offers a skipped version again, but offers a newer one", async () => {
    const h = harness();
    await h.service.check();
    expect(await h.service.skip("0.7.0")).toBeNull();
    h.clock.now += 100 * CHECK_INTERVAL_MS;
    expect(await h.service.check()).toBeNull();
    h.answer.value = { status: 200, body: [release("0.7.1")] };
    h.clock.now += CHECK_INTERVAL_MS;
    expect((await h.service.check())?.version).toBe("0.7.1");
  });

  it("repairs a damaged record instead of failing", async () => {
    const h = harness();
    await h.local.set(UPDATE_KEY, { checkedAt: "yesterday", latest: { evil: true }, skipped: 5 });
    expect((await h.service.check())?.version).toBe("0.7.0");
  });
});

describe("the update request through the real fetcher", () => {
  const withGrant = (granted: boolean) =>
    createFetchResult((origin) => Promise.resolve(granted && origin === `https://${OPTIONAL_LOOKUP_HOSTS.github}/*`));

  it("is refused before any network use while the host is not granted", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.reject(new Error("must not be called"));
    });
    try {
      const h = harness();
      h.deps.getResult = withGrant(false);
      expect(await createUpdateService(h.deps).check(true)).toBeNull();
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("sends no cookies and no referrer, and refuses redirects", async () => {
    const original = globalThis.fetch;
    const seen: (RequestInit | undefined)[] = [];
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      seen.push(init);
      return Promise.resolve(new Response(JSON.stringify([release("0.7.0")]), { status: 200 }));
    });
    try {
      const h = harness();
      h.deps.getResult = withGrant(true);
      expect((await createUpdateService(h.deps).check(true))?.version).toBe("0.7.0");
      expect(seen[0]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("the update messages", () => {
  it.each([
    { type: "update-check" },
    { type: "update-check", force: true },
    { type: "update-later", version: "0.7.0" },
    { type: "update-skip", version: "1.2" },
  ])("accepts %j", (request) => {
    expect(isWorkerRequest(request)).toBe(true);
  });

  it.each([
    { type: "update-check", force: "yes" },
    { type: "update-later" },
    { type: "update-later", version: "latest" },
    { type: "update-skip", version: 7 },
    { type: "update-skip", version: "1.0.0-beta" },
  ])("rejects %j", (request) => {
    expect(isWorkerRequest(request)).toBe(false);
  });

  it("checks the answer's shape, and only takes a link to GitHub", () => {
    expect(isOfferedUpdate(null)).toBe(true);
    expect(isOfferedUpdate({ version: "0.7.0", url: releaseUrl("0.7.0") })).toBe(true);
    expect(isOfferedUpdate({ version: "0.7.0", url: "https://evil.example/x" })).toBe(false);
    expect(isOfferedUpdate({ version: "x", url: releaseUrl("0.7.0") })).toBe(false);
    expect(isOfferedUpdate({ version: "0.7.0" })).toBe(false);
    expect(isOfferedUpdate("0.7.0")).toBe(false);
  });
});

describe("the router and the update notice", () => {
  it("answers the three update requests from the service, without touching any tab", async () => {
    const h = harness();
    const browser = fakeBrowser();
    const paste = new PasteService(browser.ports, { settings: memoryStore(), session: memoryStore() });
    const route = createRouter(
      browser.ports,
      FAST_CLIENT,
      paste,
      { exact: () => Promise.resolve(""), search: () => Promise.resolve("") },
      undefined,
      undefined,
      h.service,
    );
    expect(await route({ type: "update-check" })).toEqual({
      ok: true,
      data: { version: "0.7.0", url: releaseUrl("0.7.0") },
    });
    expect(await route({ type: "update-later", version: "0.7.0" })).toEqual({ ok: true, data: null });
    h.clock.now += SNOOZE_MS;
    expect(await route({ type: "update-skip", version: "0.7.0" })).toEqual({ ok: true, data: null });
    expect(browser.log).toEqual([]);
  });
});

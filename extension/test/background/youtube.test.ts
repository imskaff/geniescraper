import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATE,
  YoutubeGate,
  realYoutube,
  youtubePages,
  type Clock,
  type GateOptions,
} from "../../src/background/youtube";
import { createFetchText, type GetText } from "../../src/lookups/http";

const html = (name: string, data: unknown) => `<html><script>var ${name} = ${JSON.stringify(data)};</script></html>`;

/** A clock that moves only when something sleeps, so spacing and cool-downs are tested without waiting. */
function fakeClock(): Clock & { time: number; sleeps: number[]; advance(ms: number): void } {
  const clock = {
    time: 1_000_000,
    sleeps: [] as number[],
    now: () => clock.time,
    sleep: (ms: number) => {
      clock.sleeps.push(ms);
      clock.time += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      clock.time += ms;
    },
  };
  return clock;
}

const OPTIONS: GateOptions = { maxInFlight: 2, gapMs: 300, failuresToTrip: 3, cooldownMs: 60_000 };

describe("YoutubeGate", () => {
  it("has at most maxInFlight requests running, however many ask at once", async () => {
    let active = 0;
    let peak = 0;
    const gate = new YoutubeGate({ ...OPTIONS, gapMs: 0 }, fakeClock());
    await Promise.all(
      Array.from({ length: 20 }, () =>
        gate.run(async () => {
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active--;
          return "x";
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it("spaces the starts of requests at least gapMs apart", async () => {
    const clock = fakeClock();
    const gate = new YoutubeGate(OPTIONS, clock);
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 4 }, () =>
        gate.run(() => {
          starts.push(clock.now());
          return Promise.resolve("x");
        }),
      ),
    );
    expect(starts.slice(1).map((t, i) => t - (starts[i] ?? 0))).toEqual([300, 300, 300]);
  });

  it("stops asking after failuresToTrip failures in a row, then resumes after the cool-down", async () => {
    const clock = fakeClock();
    const gate = new YoutubeGate(OPTIONS, clock);
    let asked = 0;
    const fail = () => {
      asked++;
      return Promise.resolve(null);
    };
    for (let i = 0; i < 3; i++) await gate.run(fail);
    expect(gate.coolingDown).toBe(true);
    expect(await gate.run(() => Promise.resolve("never"))).toBeNull();
    expect(asked).toBe(3);
    clock.advance(OPTIONS.cooldownMs + 1);
    expect(gate.coolingDown).toBe(false);
    expect(await gate.run(() => Promise.resolve("again"))).toBe("again");
  });

  it("does not trip on failures that are not in a row", async () => {
    const gate = new YoutubeGate(OPTIONS, fakeClock());
    for (let i = 0; i < 10; i++) {
      await gate.run(() => Promise.resolve(null));
      await gate.run(() => Promise.resolve("ok"));
    }
    expect(gate.coolingDown).toBe(false);
  });

  it("is gentle by default: two at a time, spaced, and a minute of rest after three failures", () => {
    expect(DEFAULT_GATE).toEqual({ maxInFlight: 2, gapMs: 300, failuresToTrip: 3, cooldownMs: 60_000 });
  });
});

describe("youtubePages", () => {
  const gate = () => new YoutubeGate({ ...OPTIONS, gapMs: 0 }, fakeClock());

  it("asks for the results page and the watch page, encoding the query, and parses what comes back", async () => {
    const urls: string[] = [];
    const getText: GetText = (url) => {
      urls.push(url);
      return Promise.resolve(html(url.includes("/results") ? "ytInitialData" : "ytInitialPlayerResponse", { n: 1 }));
    };
    const pages = youtubePages(getText, gate());
    expect(await pages.search('"SOS" "SZA - Topic" & more')).toEqual({ n: 1 });
    expect(await pages.watch("abc_-123")).toEqual({ n: 1 });
    expect(urls).toEqual([
      "https://www.youtube.com/results?search_query=%22SOS%22+%22SZA+-+Topic%22+%26+more",
      "https://www.youtube.com/watch?v=abc_-123",
    ]);
  });

  it("gives null when the page cannot be fetched or holds no data", async () => {
    expect(await youtubePages(() => Promise.resolve(null), gate()).search("x")).toBeNull();
    expect(await youtubePages(() => Promise.resolve("<html></html>"), gate()).watch("x")).toBeNull();
  });

  it("does not count an ordinary page that holds no data as a failure: only a refusal means YouTube is limiting us", async () => {
    const g = gate();
    const pages = youtubePages(() => Promise.resolve("<html><body>a perfectly ordinary page</body></html>"), g);
    for (let i = 0; i < 10; i++) expect(await pages.watch("x")).toBeNull();
    expect(g.coolingDown).toBe(false);
  });

  it.each([
    [
      "Google's unusual-traffic page",
      "<html>Our systems have detected unusual traffic from your computer network</html>",
    ],
    ["a /sorry/ redirect page", '<html><a href="https://www.google.com/sorry/index?continue=x">here</a></html>'],
    ["the consent wall", '<html><form action="https://consent.youtube.com/save"></form></html>'],
  ])("counts %s as a failure, so a few of them rest the gate", async (_name, page) => {
    const g = gate();
    const pages = youtubePages(() => Promise.resolve(page), g);
    for (let i = 0; i < 3; i++) await pages.search("x");
    expect(g.coolingDown).toBe(true);
  });

  it("asks for nothing, and counts no failure, while the permission is not granted", async () => {
    let asked = 0;
    const getText: GetText = () => {
      asked++;
      return Promise.resolve(null);
    };
    const g = gate();
    const pages = youtubePages(getText, g, () => Promise.resolve(false));
    for (let i = 0; i < 10; i++) await pages.search("x");
    expect(asked).toBe(0);
    expect(g.coolingDown).toBe(false);
  });

  it("treats a failing permission check as not granted", async () => {
    const pages = youtubePages(
      () => Promise.resolve(html("ytInitialData", {})),
      gate(),
      () => Promise.reject(new Error("x")),
    );
    expect(await pages.search("x")).toBeNull();
  });
});

describe("realYoutube with the user's key", () => {
  const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
  const quota = { status: 403, body: { error: { code: 403, errors: [{ reason: "quotaExceeded" }] } } };
  const empty = { status: 200, body: { items: [] } };
  const base = {
    granted: () => Promise.resolve(true),
    apiGranted: () => Promise.resolve(true),
  };

  it("stops asking Google once its daily allowance is used up, and keeps saying so, until the allowance is back", async () => {
    let asked = 0;
    let now = Date.UTC(2026, 9, 28, 20, 0, 0); // 13:00 in Pacific time
    const service = realYoutube({
      ...base,
      getKey: () => Promise.resolve(KEY),
      getResult: () => {
        asked++;
        return Promise.resolve(quota);
      },
      getText: () => Promise.resolve(null),
      now: () => now,
    });
    const first = await service.find("SOS", "SZA");
    expect(first.keyProblem).toBe("quota");
    const askedAfterFirst = asked;
    expect(askedAfterFirst).toBeGreaterThan(0);

    // Every later song goes straight to the pages, and the answer still names the key's problem.
    const second = await service.find("Kill Bill", "SZA");
    expect(second.keyProblem).toBe("quota");
    expect(asked).toBe(askedAfterFirst);

    // The allowance resets at midnight Pacific time: after it, Google is asked again.
    now = Date.UTC(2026, 9, 29, 7, 30, 0); // 00:30 the next day in Pacific time
    await service.find("Snooze", "SZA");
    expect(asked).toBeGreaterThan(askedAfterFirst);
  });

  it("asks again at once when the user saves a different key", async () => {
    let asked = 0;
    let key = KEY;
    const service = realYoutube({
      ...base,
      getKey: () => Promise.resolve(key),
      getResult: () => {
        asked++;
        return Promise.resolve(quota);
      },
      getText: () => Promise.resolve(null),
    });
    await service.find("SOS", "SZA");
    const before = asked;
    key = "AIzaSyB9z8Y7x6W5v4U3t2S1r0Q9p8O7n6M5l4K";
    await service.find("Kill Bill", "SZA");
    expect(asked).toBeGreaterThan(before);
  });

  it("falls back to reading YouTube's pages when Google finds nothing, instead of calling that final", async () => {
    let pagesAsked = 0;
    const service = realYoutube({
      ...base,
      getKey: () => Promise.resolve(KEY),
      getResult: () => Promise.resolve(empty),
      getText: () => {
        pagesAsked++;
        return Promise.resolve(null);
      },
    });
    const answer = await service.find("SOS", "SZA");
    expect(answer.url).toBe("");
    expect(answer.keyProblem).toBe("");
    expect(pagesAsked).toBeGreaterThan(0);
  });
});

describe("realYoutube", () => {
  it("gives no link, and contacts nothing, while the permission is not granted", async () => {
    let called = 0;
    const getText = createFetchText(() => Promise.resolve(false));
    const counting: GetText = (url) => {
      called++;
      return getText(url);
    };
    expect(await realYoutube({ getText: counting, granted: () => Promise.resolve(false) }).find("SOS", "SZA")).toEqual({
      url: "",
      isMusicVideo: false,
      keyProblem: "",
    });
    expect(called).toBe(0);
  });
});

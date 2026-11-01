import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppleError } from "../../src/apple/errors";
import { detectAlbum, scrapeTrack, waitForCredits, waitForPage, type Timing } from "../../src/apple/driver";
import { handleRequest } from "../../src/apple/handler";
import { TRACK_ROW_SELECTOR } from "../../src/apple/page";
import { waitFor } from "../../src/apple/wait";
import { CASES, creditMap, loadFixture, loadGolden } from "./fixtures";

// Saved pages are already rendered, so every wait can be tiny.
const FAST: Timing = { readyMs: 300, creditsMs: 300, settleMs: 5, pollMs: 10 };

const ALBUMS = CASES.filter((c) => c.url.includes("/album/"));
const SONG_PAGE = /^https:\/\/music\.apple\.com\/[a-z]{2}\/song\/[^/]+\/\d+$/;

function html(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("detectAlbum on the saved album pages", () => {
  it.each(ALBUMS)("$id reports the album, its tracks and its copyright", async ({ id, url }) => {
    const golden = loadGolden(id);
    const info = await detectAlbum(loadFixture(id, "page"), url, FAST);

    expect(info.artist).toBe(golden.artist);
    expect([info.phonographicCopyright, info.copyrightNotice]).toEqual([
      golden.phonographic_copyright,
      golden.copyright_notice,
    ]);
    expect(info.trackTitles).toHaveLength(info.trackCount);
    expect(info.trackUrls).toHaveLength(info.trackCount);
  });

  it.each(ALBUMS)("$id reports the album's own release date", async ({ id, url }) => {
    const info = await detectAlbum(loadFixture(id, "page"), url, FAST);
    expect(info.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(ALBUMS)("$id lists real track titles, never placeholders", async ({ id, url, track_index }) => {
    const info = await detectAlbum(loadFixture(id, "page"), url, FAST);
    expect(info.trackTitles.filter((title) => /^Track \d+$/.test(title))).toEqual([]);
    expect(info.trackTitles[track_index - 1]).toBe(loadGolden(id).title);
  });

  it.each(ALBUMS)("$id links the chosen track to its own song page", async ({ id, url, track_index }) => {
    const info = await detectAlbum(loadFixture(id, "page"), url, FAST);
    const link = info.trackUrls[track_index - 1] ?? "";
    expect(link).toMatch(SONG_PAGE);
  });

  it.each(ALBUMS)("$id gives every track the title and the link of the same row", async ({ id, url }) => {
    // The panel sends trackUrls[i] with trackTitles[i], and the sent title wins over the page's own,
    // so a shifted list would silently mislabel a track.
    const doc = loadFixture(id, "page");
    const info = await detectAlbum(doc, url, FAST);
    const rows = [...doc.querySelectorAll(TRACK_ROW_SELECTOR)];
    expect(rows.length).toBeGreaterThanOrEqual(info.trackCount);

    info.trackUrls.forEach((link, index) => {
      const row = rows[index];
      expect(info.trackTitles[index], `row ${String(index + 1)} title`).toBe(
        row?.querySelector('[data-testid="track-title"]')?.textContent.trim(),
      );
      if (link) expect(row?.querySelector('a[href*="/song/"]')?.getAttribute("href")).toBe(link);
    });
  });

  it("marks a track without a song page as unavailable instead of dropping it, so indexes stay aligned", async () => {
    // Apple renders some tracks as plain rows: the Eilish album has 11 songs and 10 song links.
    const info = await detectAlbum(loadFixture("eilish-hmhas-t3", "page"), CASES[2]?.url ?? "", FAST);
    expect(info.trackUrls.filter((link) => link === "")).toHaveLength(1);
    expect(info.trackUrls.filter(Boolean).every((link) => SONG_PAGE.test(link))).toBe(true);
  });

  it("treats a song URL as its own only track page", async () => {
    const song = CASES.find((c) => c.url.includes("/song/"));
    if (!song) throw new Error("no song fixture");
    const info = await detectAlbum(loadFixture(song.id, "page"), song.url, FAST);
    expect(info.trackCount).toBe(1);
    expect(info.trackUrls).toEqual([song.url]);
  });
});

describe("scrapeTrack on the saved song pages", () => {
  // The credits fixtures are the song pages Apple shows after View Credits, which is exactly the page the
  // extension now opens directly.
  it.each(CASES)("$id credits, title and artist match the golden file", async ({ id }) => {
    const golden = loadGolden(id);
    const result = await scrapeTrack(
      loadFixture(id, "credits"),
      { url: "https://music.apple.com/us/song/x/1", trackTitle: "" },
      FAST,
    );

    expect(creditMap(result.credits)).toEqual(creditMap(golden.credits));
    expect(result.title).toBe(golden.title);
    expect(result.artist).toBe(golden.artist);
    expect(result.releaseDate).toBe(golden.release_date);
    expect(result.warnings).toEqual([]);
  });

  it("prefers the title the album's track list already gave", async () => {
    const result = await scrapeTrack(
      loadFixture("swift-ttpd-t1", "credits"),
      { url: "https://music.apple.com/us/song/x/1", trackTitle: "Known Title" },
      FAST,
    );
    expect(result.title).toBe("Known Title");
  });

  it("warns, and returns no credits, for a page without credit cards", async () => {
    const doc = html('<div class="song-header-page"><p>lyrics Songwriter</p><p>A, B</p></div>');
    const result = await scrapeTrack(doc, { url: "https://music.apple.com/us/song/x/1", trackTitle: "T" }, FAST);
    expect(result.credits).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("waitForPage", () => {
  it.each(["not-found-heading", "page-error-title"])("throws not-found for data-testid=%s", async (testid) => {
    const doc = html(`<h1 data-testid="${testid}">Page Not Found</h1>`);
    await expect(waitForPage(doc, FAST)).rejects.toMatchObject({ name: "AppleError", code: "not-found" });
    await expect(waitForPage(doc, FAST)).rejects.toBeInstanceOf(AppleError);
  });

  it("returns when the page renders after a delay", async () => {
    const doc = html("<body></body>");
    setTimeout(() => {
      doc.body.append(Object.assign(doc.createElement("div"), { className: "song-header-page" }));
    }, 40);
    await expect(waitForPage(doc, { ...FAST, readyMs: 1000 })).resolves.toBeUndefined();
  });

  it("throws a timeout when the page never renders, instead of letting an empty page be read", async () => {
    await expect(waitForPage(html("<body></body>"), { ...FAST, readyMs: 50 })).rejects.toMatchObject({
      name: "AppleError",
      code: "timeout",
    });
  });

  it("reports an album page that never hydrated as a timeout, not an empty album", async () => {
    const doc = html("<body><p>Loading…</p></body>");
    await expect(
      detectAlbum(doc, "https://music.apple.com/us/album/x/1", { ...FAST, readyMs: 50 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("waitForCredits", () => {
  function card(doc: Document, name: string): void {
    const el = doc.createElement("div");
    el.className = "artist-name";
    el.textContent = name;
    doc.body.append(el);
  }

  // The settle pause measures time with performance.now() on message events, not timers, so these tests drive a
  // clock of their own: the page changes at exact moments of it, whatever the machine's load.
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Let the pending message-channel hops and promise continuations run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function track(promise: Promise<void>): { finished: () => boolean } {
    let done = false;
    void promise.then(() => {
      done = true;
    });
    return { finished: () => done };
  }

  it("waits until the card count stops changing", async () => {
    const doc = html("<body></body>");
    card(doc, "A");
    const wait = waitForCredits(doc, { ...FAST, settleMs: 20 });
    const run = track(wait);
    await flush();

    now = 8;
    card(doc, "B");
    now = 20;
    await flush();
    // The first check, at 20, saw a second card appear: it must look again rather than finish.
    expect(run.finished()).toBe(false);

    now = 40;
    await wait;
    expect(doc.querySelectorAll(".artist-name")).toHaveLength(2);
  });

  it("waits while a card's text changes even though the number of cards does not", async () => {
    const doc = html("<body></body>");
    card(doc, "A");
    const roles = doc.createElement("div");
    roles.className = "artist-roles";
    doc.body.append(roles);
    const wait = waitForCredits(doc, { ...FAST, settleMs: 40 });
    const run = track(wait);
    await flush();

    // Two edits to the same card, the second after the first settle check: a count alone would already be done.
    now = 10;
    roles.textContent = "Songwriter";
    now = 40;
    await flush();
    expect(run.finished()).toBe(false);
    now = 55;
    roles.textContent = "Songwriter, Producer";
    now = 80;
    await flush();
    expect(run.finished()).toBe(false);

    now = 120;
    await wait;
    expect(roles.textContent).toBe("Songwriter, Producer");
  });

  it("is bounded when no card ever appears", async () => {
    const started = Date.now();
    await waitForCredits(html("<body></body>"), { ...FAST, creditsMs: 60 });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("waitFor", () => {
  it("resolves immediately when the probe already holds", async () => {
    await expect(waitFor(html(""), () => "ready", 100, 10)).resolves.toBe("ready");
  });

  it("returns null at the timeout", async () => {
    await expect(waitFor(html(""), () => null, 40, 10)).resolves.toBeNull();
  });

  it("reacts to a DOM change", async () => {
    const doc = html("<body></body>");
    setTimeout(() => {
      doc.body.append(doc.createElement("section"));
    }, 20);
    await expect(waitFor(doc, () => doc.querySelector("section"), 1000, 500)).resolves.not.toBeNull();
  });
});

describe("handleRequest", () => {
  const SONG = "https://music.apple.com/us/song/fortnight/1736268220";

  it("rejects malformed requests", async () => {
    for (const raw of [null, "x", {}, { type: "apple/scrape", url: SONG }, { type: "other", url: SONG }]) {
      const result = await handleRequest(raw, html(""), FAST);
      expect(result).toMatchObject({ ok: false, error: { code: "bad-request" } });
    }
  });

  it.each([
    "https://evil.example/us/song/x/1",
    "http://music.apple.com/us/song/x/1",
    "https://music.apple.com.evil.example/us/song/x/1",
    "https://music.apple.com/us/playlist/x/pl.1",
  ])("refuses to read %s", async (url) => {
    const result = await handleRequest({ type: "apple/detect", url }, html(""), FAST);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-url" } });
  });

  it("refuses to scrape an album link, which has no credits of its own", async () => {
    const url = "https://music.apple.com/us/album/the-tortured-poets-department/1736268215";
    const result = await handleRequest({ type: "apple/scrape", url, trackTitle: "" }, html(""), FAST);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-url" } });
  });

  it("returns a not-found failure as data", async () => {
    const doc = html('<h1 data-testid="not-found-heading">Page Not Found</h1>');
    const result = await handleRequest({ type: "apple/detect", url: SONG }, doc, FAST);
    expect(result).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("reports an unexpected failure as internal, not as a timeout", async () => {
    const broken = html('<div class="song-header-page"></div>');
    Object.defineProperty(broken, "title", {
      get() {
        throw new Error("parser crashed");
      },
    });
    const result = await handleRequest({ type: "apple/detect", url: SONG }, broken, FAST);
    expect(result).toEqual({ ok: false, error: { code: "internal", message: "parser crashed" } });
  });

  it("answers a scrape request with the credits of the page", async () => {
    const result = await handleRequest(
      { type: "apple/scrape", url: SONG, trackTitle: "" },
      loadFixture("swift-ttpd-t1", "credits"),
      FAST,
    );
    expect(result).toMatchObject({ ok: true, data: { title: "Fortnight (feat. Post Malone)" } });
  });
});

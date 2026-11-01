import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { detectAlbum, scrapeTrack } from "../../src/spotify/driver";
import { handleRequest } from "../../src/spotify/handler";
import { REAL_TIMING, type Timing } from "../../src/spotify/page";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(here, name), "utf-8").trim();
const nodesOf = (markup: string): Node[] => [...new DOMParser().parseFromString(markup, "text/html").body.childNodes];
const setBody = (markup: string): void => {
  document.body.replaceChildren(...nodesOf(markup));
};

const FAST: Timing = {
  ...REAL_TIMING,
  buttonMs: 300,
  menuMs: 300,
  dialogMs: 300,
  rowsMs: 600,
  settleMs: 100,
  stepMs: 10,
  retryPauseMs: 10,
};
const BARE = "button:not([aria-disabled]):not([aria-expanded])";
const TRACK = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";
const ALBUM = "https://open.spotify.com/album/1uyf3l2d4XYwiEqAb7t7fX";

const HEADER =
  '<div data-testid="entity-header"><span data-testid="entityTitle"><h1>Sample Song</h1></span>' +
  '<a data-testid="creator-link" href="/artist/SAMPLE">Artist One</a>' +
  '<a data-testid="creator-link" href="/artist/SAMPLE">Artist Two</a>' +
  '<span data-testid="release-date">2020</span></div>';
const COPYRIGHT = "<p>© 2020 Sample Label</p><p>℗ 2020 Sample Label, marketed by Another</p>";

interface PageOptions {
  dialog?: string;
  credits?: boolean;
  failFirstClick?: boolean;
  /** The dialog opens with only its first credit row and gets the rest a moment later (a late second render). */
  lateRows?: boolean;
  withButton?: boolean;
}

/** A track page whose options button opens the saved menu, whose credits entry opens the saved dialog. */
function trackPage({ dialog = "credits-many-roles.html", credits = true, failFirstClick = false, withButton = true, lateRows = false }: PageOptions = {}): void {
  setBody(
    `<main>${HEADER}${
      withButton ? '<div data-testid="action-bar-row"><button data-testid="more-button"></button></div>' : ""
    }${COPYRIGHT}</main>`,
  );
  const more = document.querySelector("button[data-testid='more-button']");
  let opened = 0;
  more?.addEventListener("click", () => {
    const open = document.querySelector("[role='menu']");
    if (open) {
      open.remove();
      return;
    }
    opened++;
    const holder = document.createElement("div");
    holder.append(...nodesOf(fixture("menu-track.html")));
    // Without a credits entry the menu still has "Open in Desktop app", which must never be clicked.
    if (!credits) holder.querySelector(BARE)?.remove();
    document.body.append(holder);
    holder.querySelector(BARE)?.addEventListener("click", () => {
      if (failFirstClick && opened === 1) return;
      document.body.append(...nodesOf(fixture(dialog)));
      if (lateRows) {
        const groups = [...document.querySelectorAll("dialog [role='group'][aria-labelledby]")];
        const later = groups.slice(2).map((group) => ({ group, parent: group.parentElement }));
        for (const { group } of later) group.remove();
        setTimeout(() => {
          for (const { group, parent } of later) parent?.append(group);
        }, 0);
      }
    });
  });
}

beforeEach(() => {
  setBody("");
  document.documentElement.lang = "";
});

describe("scrapeTrack on a saved track page", () => {
  it("returns the mapped credits, the header's title and artists, and says what Spotify cannot give", async () => {
    trackPage();
    const scrape = await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST);
    expect(scrape.title).toBe("Sample Song");
    expect(scrape.artist).toBe("Artist One, Artist Two");
    expect(scrape.credits.map((c) => c.role)).toContain("Songwriter");
    expect(scrape.credits.map((c) => c.role)).toContain("Producer");
    expect(scrape.releaseDate).toBe("");
    expect(scrape.coverArtUrl).toBe("");
    expect(scrape.warnings).toEqual([]);
    expect(scrape.notes?.at(-1)).toMatch(/ISRC/);
  });

  it("uses the title the album listed when it is given", async () => {
    trackPage();
    expect((await scrapeTrack(document, { url: TRACK, trackTitle: "Listed Title" }, FAST)).title).toBe("Listed Title");
  });

  it("lists roles it cannot map, and everything in a German dialog", async () => {
    trackPage({ dialog: "credits-de.html" });
    const scrape = await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST);
    expect(scrape.notes?.[0]).toMatch(/^Left out because Genius has no matching role: /);
  });

  it("says nothing about the language when Spotify answered in English as asked", async () => {
    document.documentElement.lang = "en";
    trackPage();
    const scrape = await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST);
    expect(scrape.notes?.join(" ")).not.toMatch(/English|language/);
  });

  it("falls back to the role table of the page's language, and names that language, when English did not come back", async () => {
    document.documentElement.lang = "de";
    trackPage({ dialog: "credits-de.html" });
    const scrape = await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST);
    const roles = scrape.credits.map((c) => c.role);
    expect(roles).toEqual(expect.arrayContaining(["Songwriter", "Producer", "Guitar", "Drums"]));
    expect(scrape.notes?.join(" ")).toMatch(/German and not in English/);
  });

  it("does not trust a page that says English but shows another language's dialog", async () => {
    document.documentElement.lang = "en";
    trackPage({ dialog: "credits-de.html" });
    const scrape = await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST);
    expect(scrape.notes?.join(" ")).toMatch(/did not show this page in English as asked/);
    // Only words that happen to be English are mapped then ("Recording Engineer", "Synthesizer").
    expect(scrape.credits.map((c) => c.role)).toEqual(expect.arrayContaining(["Recording Engineer", "Synthesizer"]));
    expect(scrape.credits.map((c) => c.role)).not.toContain("Producer");
  });

  it("leaves a Studio Personnel row out of the credits and lists it under About this read", async () => {
    document.documentElement.lang = "en";
    trackPage({ dialog: "credits-self-released.html" });
    const scrape = await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST);
    expect(scrape.credits.flatMap((c) => c.artists)).not.toContain("Sample Studio");
    expect(scrape.credits.map((c) => c.role)).toContain("Recording Engineer");
    expect(scrape.notes?.[0]).toBe("Left out because Genius has no matching role: Studio Personnel (Sample Studio).");
  });

  it("is ok with no credits for a track with only artists, and warns", async () => {
    trackPage({ dialog: "credits-artist-only.html" });
    const scrape = await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST);
    expect(scrape.credits).toEqual([]);
    expect(scrape.warnings).toEqual(["No credits were found on this track's page."]);
  });

  it("waits for a late second render instead of reading half a dialog", async () => {
    trackPage({ lateRows: true });
    const late = await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST);
    trackPage();
    const whole = await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST);
    expect(late.credits).toEqual(whole.credits);
  });

  it("retries once when the first click on the entry opened nothing", async () => {
    trackPage({ failFirstClick: true });
    expect((await scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST)).credits.length).toBeGreaterThan(0);
  });

  it("says the track is unavailable when the page has no options button", async () => {
    trackPage({ withButton: false });
    await expect(scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("says unavailable for a page that never gets a header", async () => {
    setBody("<main></main>");
    await expect(scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("says the credits would not open when the menu has no credits entry, and clicks nothing else", async () => {
    trackPage({ credits: false });
    let desktopClicked = false;
    document.addEventListener("click", (event) => {
      if ((event.target as Element).closest("[role='menuitem']")) desktopClicked = true;
    });
    await expect(scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST)).rejects.toMatchObject({
      code: "tab-failed",
      message: expect.stringContaining("no-item") as string,
    });
    expect(desktopClicked).toBe(false);
  });

  it("says blocked when a captcha is showing, without clicking anything", async () => {
    setBody("<main><h1>Please solve this captcha to continue</h1></main>");
    await expect(scrapeTrack(document, { url: TRACK, trackTitle: "" }, FAST)).rejects.toMatchObject({ code: "blocked" });
  });
});

describe("detectAlbum", () => {
  it("describes a track page as a one-track album, with its copyright lines and no cover", async () => {
    trackPage();
    const info = await detectAlbum(document, TRACK, FAST);
    expect(info).toMatchObject({
      url: TRACK,
      albumTitle: "Sample Song",
      artist: "Artist One, Artist Two",
      trackCount: 1,
      trackTitles: ["Sample Song"],
      trackUrls: [TRACK],
      coverArtUrl: "",
      releaseDate: "",
    });
    expect(info.phonographicCopyright).toMatch(/^℗ 2020/);
    expect(info.copyrightNotice).toMatch(/^© 2020/);
  });

  it("lists an album's tracks by id and title from the saved album page", async () => {
    setBody(fixture("album-page.html"));
    const info = await detectAlbum(document, ALBUM, FAST);
    expect(info.albumTitle).toBe("Sample Album");
    expect(info.trackCount).toBe(3);
    expect(info.trackTitles).toEqual(["Sample Track 1", "Sample Track 2", "Sample Track 3"]);
    expect(info.trackUrls.every((url) => /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}$/.test(url))).toBe(true);
    expect(info.note).toBeUndefined();
  });

  it("pads a windowed list to the printed count, with the missing tracks unavailable, and says so", async () => {
    setBody(fixture("album-page.html").replace("3 songs", "100 songs"));
    const info = await detectAlbum(document, ALBUM, FAST);
    expect(info.trackCount).toBe(100);
    expect(info.trackTitles).toHaveLength(100);
    expect(info.trackUrls.filter(Boolean)).toHaveLength(3);
    expect(info.trackTitles[3]).toBe("Track 4");
    expect(info.trackUrls[3]).toBe("");
    expect(info.note).toBe("Spotify's page lists 3 of 100 tracks. Open any other track on its own page to read it.");
  });

  it("reads the album's English release date when the page prints one, and none from a localised line", async () => {
    setBody(fixture("album-page.html"));
    expect((await detectAlbum(document, ALBUM, FAST)).releaseDate).toBe("2020-03-20");
    setBody(fixture("album-page.html").replace("March 20, 2020", "20 marca 2020"));
    expect((await detectAlbum(document, ALBUM, FAST)).releaseDate).toBe("");
  });

  it("fails when an album shows no tracks", async () => {
    setBody('<main><div data-testid="entity-header"><span data-testid="entityTitle">X</span></div></main>');
    await expect(detectAlbum(document, ALBUM, FAST)).rejects.toMatchObject({ code: "tab-failed" });
  });

  it("clicks nothing: a detect may run in the user's own tab", async () => {
    setBody(fixture("album-page.html"));
    let clicks = 0;
    document.addEventListener("click", () => clicks++);
    await detectAlbum(document, ALBUM, FAST);
    expect(clicks).toBe(0);
  });
});

describe("handleRequest", () => {
  it("answers its own requests as data", async () => {
    trackPage();
    const answer = await handleRequest({ type: "spotify/scrape", url: TRACK, trackTitle: "" }, document, FAST);
    expect(answer).toMatchObject({ ok: true, data: { title: "Sample Song" } });
  });

  it("returns a failure as data", async () => {
    setBody("<main></main>");
    expect(await handleRequest({ type: "spotify/scrape", url: TRACK, trackTitle: "" }, document, FAST)).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it("ignores Apple's requests and anything malformed or off-site", async () => {
    for (const raw of [
      { type: "apple/detect", url: "https://music.apple.com/us/album/x/1" },
      { type: "spotify/scrape", url: TRACK },
      null,
      "spotify/detect",
    ]) {
      expect(await handleRequest(raw, document, FAST), JSON.stringify(raw)).toMatchObject({
        ok: false,
        error: { code: "bad-request" },
      });
    }
    for (const url of ["https://evil.example/track/4cOdK2wGLETKBW3PvgPWqT", ALBUM]) {
      expect(await handleRequest({ type: "spotify/scrape", url, trackTitle: "" }, document, FAST)).toMatchObject({
        ok: false,
        error: { code: "invalid-url" },
      });
    }
  });
});

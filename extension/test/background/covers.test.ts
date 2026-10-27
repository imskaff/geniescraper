import { describe, expect, it } from "vitest";
import { realCovers, type CoverService } from "../../src/background/covers";
import { PasteService } from "../../src/background/paste";
import { createRouter } from "../../src/background/router";
import type { GetJson } from "../../src/lookups/itunes";
import type { AlbumInfo } from "../../src/shared/messages";
import { memoryStore } from "../ui/fakes";
import { ALBUM_INFO, ALBUM_URL, FAST_CLIENT, fakeBrowser } from "./fakePorts";

const GOOD = "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6b/x.rgb.jpg/100x100bb.jpg";
const GOOD_PNG = "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6b/x.rgb.jpg/1000x1000bb.png";

/** A router over a fake browser whose album page shows `pageCover`, with the given cover lookups. */
function setup(covers: CoverService, pageCover = "") {
  const album: AlbumInfo = { ...ALBUM_INFO, coverArtUrl: pageCover };
  const browser = fakeBrowser({ answer: () => Promise.resolve({ ok: true, data: album }) });
  const paste = new PasteService(browser.ports, { settings: memoryStore(), session: memoryStore() });
  return createRouter(browser.ports, FAST_CLIENT, paste, covers);
}

const cover = async (route: ReturnType<typeof setup>): Promise<string> => {
  const result = await route({ type: "detect", url: ALBUM_URL });
  if (!result.ok) throw new Error("detect failed");
  return (result.data as AlbumInfo).coverArtUrl;
};

describe("the album cover on detect", () => {
  it("is Apple's exact lookup when there is one, ahead of the page header", async () => {
    const searches: string[] = [];
    const route = setup(
      {
        exact: () => Promise.resolve("https://exact/1000x1000bb.png"),
        search: (t) => (searches.push(t), Promise.resolve("")),
      },
      "https://page/cover.png",
    );
    expect(await cover(route)).toBe("https://exact/1000x1000bb.png");
    expect(searches).toEqual([]);
  });

  it("falls back to the page header when the lookup finds nothing, without searching", async () => {
    const searches: string[] = [];
    const route = setup(
      { exact: () => Promise.resolve(""), search: (t) => (searches.push(t), Promise.resolve("x")) },
      "https://page/cover.png",
    );
    expect(await cover(route)).toBe("https://page/cover.png");
    expect(searches).toEqual([]);
  });

  it("searches by title and artist only when both the lookup and the page have nothing", async () => {
    const searches: string[] = [];
    const route = setup({
      exact: () => Promise.resolve(""),
      search: (title, artist) => (
        searches.push(`${artist} / ${title}`),
        Promise.resolve("https://searched/1000x1000bb.png")
      ),
    });
    expect(await cover(route)).toBe("https://searched/1000x1000bb.png");
    expect(searches).toEqual(["Taylor Swift / TTPD"]);
  });

  it("is empty when nothing has a cover, and the read still succeeds", async () => {
    expect(await cover(setup({ exact: () => Promise.resolve(""), search: () => Promise.resolve("") }))).toBe("");
  });

  it("survives a lookup that throws", async () => {
    const route = setup(
      { exact: () => Promise.reject(new Error("offline")), search: () => Promise.resolve("") },
      "https://page/c.png",
    );
    expect(await cover(route)).toBe("https://page/c.png");
  });

  it("starts the lookup before the page has been read, so it adds no waiting", async () => {
    const order: string[] = [];
    const browser = fakeBrowser({
      answer: () => {
        order.push("page-read");
        return Promise.resolve({ ok: true, data: ALBUM_INFO });
      },
    });
    const paste = new PasteService(browser.ports, { settings: memoryStore(), session: memoryStore() });
    const route = createRouter(browser.ports, FAST_CLIENT, paste, {
      exact: () => (order.push("lookup-started"), Promise.resolve("")),
      search: () => Promise.resolve(""),
    });
    await route({ type: "detect", url: ALBUM_URL });
    expect(order).toEqual(["lookup-started", "page-read"]);
  });

  it("does not look anything up when the page read fails", async () => {
    const browser = fakeBrowser({
      answer: () => Promise.resolve({ ok: false, error: { code: "not-found", message: "x" } }),
    });
    const paste = new PasteService(browser.ports, { settings: memoryStore(), session: memoryStore() });
    const searches: string[] = [];
    const route = createRouter(browser.ports, FAST_CLIENT, paste, {
      exact: () => Promise.resolve(GOOD_PNG),
      search: (t) => (searches.push(t), Promise.resolve("")),
    });
    expect(await route({ type: "detect", url: ALBUM_URL })).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(searches).toEqual([]);
  });
});

describe("realCovers", () => {
  it("looks up by catalog id and searches by title through the same fetcher", async () => {
    const seen: string[] = [];
    const getJson: GetJson = (url) => {
      seen.push(new URL(url).pathname);
      return Promise.resolve({ results: [{ artworkUrl100: GOOD, trackName: "SOS", artistName: "SZA" }] });
    };
    const covers = realCovers(getJson);
    expect(await covers.exact("https://music.apple.com/us/album/sos/1658650093")).toBe(GOOD_PNG);
    expect(await covers.search("SOS", "SZA")).toBe(GOOD_PNG);
    expect(seen).toEqual(["/lookup", "/search"]);
  });
});

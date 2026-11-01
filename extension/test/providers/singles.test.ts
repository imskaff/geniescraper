import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readApplePageLabel } from "../../src/apple/pageLabel";
import { musicTabEntries, type OpenTab } from "../../src/core/musicTabs";
import { appleTitleIsSingle, appleTitleParts } from "../../src/providers/tabTitles";
import { withPageTitles } from "../../src/ui/pageTitles";

// Saved header of https://music.apple.com/us/album/jestem-poj384ny-single/1765583437 (one song, "- Single").
const MATA = new DOMParser().parseFromString(
  readFileSync(join(import.meta.dirname, "..", "apple", "mata-single.header.html"), "utf-8"),
  "text/html",
);
const MATA_URL = "https://music.apple.com/us/album/jestem-poj384ny-single/1765583437";

const tab = (url: string, title: string, extra: Partial<OpenTab> = {}): OpenTab => ({
  tabId: 1,
  url,
  title,
  current: true,
  ...extra,
});
const entry = (t: OpenTab) => {
  const [e] = musicTabEntries([t]);
  return e && { name: e.name, kind: e.kind };
};

describe("Apple Music single (Mata, JESTEM POJ384NY)", () => {
  it("is listed as 'Artist - Title' and as a song, from the saved page's own tab title", () => {
    expect(entry(tab(MATA_URL, MATA.title))).toEqual({ name: "Mata - JESTEM POJ384NY", kind: "song" });
  });

  it("reads the header label without the '- Single' suffix and flags the single", () => {
    document.body.replaceChildren(...MATA.body.cloneNode(true).childNodes);
    expect(readApplePageLabel()).toMatchObject({ title: "JESTEM POJ384NY", artists: ["Mata"], single: true });
  });

  it("keeps multi-artist and feat. singles", () => {
    expect(entry(tab(MATA_URL, "‎Hit (feat. Zed) - Single - Album by Ann & Bo - Apple Music"))).toEqual({
      name: "Ann & Bo - Hit (feat. Zed)",
      kind: "song",
    });
  });

  it("keeps a German single's artist", () => {
    expect(appleTitleParts("Hit - Single - Album von Ann - Apple Music")).toEqual({ title: "Hit", artist: "Ann" });
  });
});

describe("what stays an album", () => {
  const ALBUM = "https://music.apple.com/us/album/x/1";
  it("an album and an EP", () => {
    expect(entry(tab(ALBUM, "Big - Album by Ann - Apple Music"))).toEqual({ name: "Ann - Big", kind: "album" });
    expect(entry(tab(ALBUM, "Mini - EP - Album by Ann - Apple Music"))).toEqual({ name: "Ann - Mini", kind: "album" });
  });

  it("an album whose title merely contains the word", () => {
    expect(appleTitleIsSingle("Single Ladies - Album by Ann - Apple Music")).toBe(false);
  });

  it("a ?i= link to one track of a real album, read from its header", async () => {
    const t = tab(`${ALBUM}?i=2`, "Track Two - Song by Ann", {});
    document.body.replaceChildren(
      ...new DOMParser().parseFromString(
        '<div data-testid="container-detail-header"><h1 data-testid="non-editable-product-title">Big</h1><a href="https://music.apple.com/us/artist/a/1">Ann</a></div>',
        "text/html",
      ).body.childNodes,
    );
    const [read] = await withPageTitles([t], (_id, reader) =>
      Promise.resolve(reader()).then((l) => ({ ...l, path: "/us/album/x/1" })),
    );
    expect(read && entry(read)).toEqual({ name: "Ann - Big", kind: "album" });
  });

  it("a ?i= link on a single's own page is that single, a song", async () => {
    document.body.replaceChildren(...MATA.body.cloneNode(true).childNodes);
    const [read] = await withPageTitles([tab(`${MATA_URL}?i=9`, "JESTEM POJ384NY - Song by Mata")], (_id, reader) =>
      Promise.resolve({ ...reader(), path: new URL(MATA_URL).pathname }),
    );
    expect(read && entry(read)).toEqual({ name: "Mata - JESTEM POJ384NY", kind: "song" });
  });
});

describe("Spotify single", () => {
  const ALBUM = "https://open.spotify.com/album/1uyf3l2d4XYwiEqAb7t7fX";
  const page = (type: string) =>
    `<div data-testid="entity-header"><span>${type}</span><span data-testid="entityTitle"><h1>Hit</h1></span><a data-testid="creator-link" href="/artist/A">Ann</a><a data-testid="creator-link" href="/artist/B">Bo</a></div>`;
  const listed = async (type: string) => {
    document.body.replaceChildren(...new DOMParser().parseFromString(page(type), "text/html").body.childNodes);
    const [read] = await withPageTitles([tab(ALBUM, "Playing - Other")], (_id, reader) =>
      Promise.resolve({ ...reader(), path: new URL(ALBUM).pathname }),
    );
    return read && entry(read);
  };

  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("is listed as 'Artist - Title' and as a song", async () => {
    expect(await listed("Single")).toEqual({ name: "Ann, Bo - Hit", kind: "song" });
  });

  it("an album and an EP stay albums", async () => {
    expect(await listed("Album")).toEqual({ name: "Ann, Bo - Hit", kind: "album" });
    expect(await listed("EP")).toEqual({ name: "Ann, Bo - Hit", kind: "album" });
  });
});

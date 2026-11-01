import { beforeEach, describe, expect, it } from "vitest";
import { musicTabEntries, type OpenTab } from "../../src/core/musicTabs";
import { labelText, readPageLabel } from "../../src/spotify/pageLabel";
import { needsLabel, withPageTitles } from "../../src/ui/pageTitles";

const ALBUM = "https://open.spotify.com/album/1uyf3l2d4XYwiEqAb7t7fX";
const TRACK = "https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT?si=1";

/** The album page for Heavy Is The Crown, while the player bar plays another song: the heading is the page's own. */
const PAGE =
  '<main><div data-testid="entity-header"><span data-testid="entityTitle"><h1>Heavy Is The Crown</h1></span>' +
  '<a data-testid="creator-link" href="/artist/A">Anderson .Paak</a><a data-testid="creator-link" href="/artist/B">Cordae</a></div></main>' +
  '<footer><div data-testid="now-playing-widget"><a data-testid="context-item-link" href="/track/x">Race My Mind</a><a href="/artist/D">Drake</a></div></footer>';

beforeEach(() => {
  document.body.replaceChildren(...new DOMParser().parseFromString(PAGE, "text/html").body.childNodes);
});

const tab = (url: string, title: string, pageTitle?: string): OpenTab => ({
  tabId: 1,
  url,
  title,
  current: true,
  ...(pageTitle === undefined ? {} : { pageTitle }),
});

describe("readPageLabel", () => {
  it("reads the page's own heading and artists, not the song in the player bar", () => {
    const label = readPageLabel();
    expect(label.title).toBe("Heavy Is The Crown");
    expect(label.artists).toEqual(["Anderson .Paak", "Cordae"]);
    expect(JSON.stringify(label)).not.toMatch(/Race My Mind|Drake/);
    expect(labelText(label)).toBe("Heavy Is The Crown by Anderson .Paak, Cordae");
  });

  it("gives nothing for a page with no heading", () => {
    document.body.replaceChildren();
    expect(labelText(readPageLabel())).toBe("");
  });
});

describe("naming a Spotify tab whose title follows the playing song", () => {
  /** What Spotify makes of the title while a song plays: no site name at the end. */
  const PLAYING = "Race My Mind • Drake";
  const name = (url: string, title: string, pageTitle?: string): string | undefined =>
    musicTabEntries([tab(url, title, pageTitle)])[0]?.name;

  it("prefers the page's own heading over any tab title", () => {
    expect(name(ALBUM, PLAYING, "Heavy Is The Crown by Anderson .Paak, Cordae")).toBe(
      "Heavy Is The Crown by Anderson .Paak, Cordae",
    );
    expect(name(ALBUM, "Other - Album by Someone | Spotify", "Heavy Is The Crown by Cordae")).toBe(
      "Heavy Is The Crown by Cordae",
    );
  });

  it("never shows a playing song's title when the page could not be read: a generic name instead", () => {
    expect(name(ALBUM, PLAYING)).toBe("Spotify album");
    expect(name(TRACK, PLAYING)).toBe("Spotify track");
    expect(name(TRACK, "")).toBe("Spotify track");
    expect(name(TRACK, "Race My Mind - song and lyrics by Drake")).toBe("Spotify track");
  });

  it.each([
    ["English track", TRACK, "Blinding Lights - song and lyrics by The Weeknd | Spotify", "Blinding Lights by The Weeknd"],
    ["Danish (English text) album", ALBUM, "Listen to After Hours - Album by The Weeknd | Spotify", "After Hours by The Weeknd"],
    ["German track", TRACK, "Blinding Lights – Musik und Lyrics von The Weeknd | Spotify", "Blinding Lights – Musik und Lyrics von The Weeknd"],
    ["German album", ALBUM, "Streame After Hours – Album von The Weeknd | Spotify", "Streame After Hours – Album von The Weeknd"],
    ["Japanese album", ALBUM, "ザ・ウィークエンドのアルバム - After Hoursを聴く | Spotify", "ザ・ウィークエンドのアルバム - After Hoursを聴く"],
  ])("uses a title that is provably the page's own when the page could not be read: %s", (_label, url, title, expected) => {
    expect(name(url, title)).toBe(expected);
  });

  it("keeps a generic name when the heading was read from another page, whatever the title says", () => {
    expect(name(ALBUM, "Blinding Lights - song and lyrics by The Weeknd | Spotify", "")).toBe("Spotify album");
  });

  it("still names an Apple Music tab from its title", () => {
    expect(name("https://music.apple.com/us/album/x/1", "Demo - Apple Music")).toBe("Demo");
  });
});

describe("withPageTitles", () => {
  it("reads the label of each Spotify tab and leaves other tabs alone", async () => {
    const read: string[] = [];
    const tabs = [tab(ALBUM, "Race My Mind"), { ...tab("https://music.apple.com/us/album/x/1", "X"), tabId: 2 }];
    const out = await withPageTitles(tabs, (id) => {
      read.push(String(id));
      return Promise.resolve({ path: "/album/1uyf3l2d4XYwiEqAb7t7fX", title: "Heavy Is The Crown", artists: ["Cordae"] });
    });
    expect(read).toEqual(["1"]);
    expect(out[0]?.pageTitle).toBe("Heavy Is The Crown by Cordae");
    expect(out[1]?.pageTitle).toBeUndefined();
  });

  it("drops a label read from another page than the address names (the player was moving)", async () => {
    const out = await withPageTitles([tab(ALBUM, "x")], () =>
      Promise.resolve({ path: "/track/4cOdK2wGLETKBW3PvgPWqT", title: "Race My Mind", artists: ["Drake"] }),
    );
    expect(out[0]?.pageTitle).toBe("");
    expect(musicTabEntries(out)[0]?.name).toBe("Spotify album");
  });

  it("falls back to a generic name when the tab cannot be read", async () => {
    const out = await withPageTitles([tab(TRACK, "Race My Mind")], () => Promise.reject(new Error("no access")));
    expect(musicTabEntries(out)[0]?.name).toBe("Spotify track");
    const none = await withPageTitles([tab(TRACK, "x")], () => Promise.resolve(null));
    expect(none[0]?.pageTitle).toBeUndefined();
  });

  it("matches a locale-prefixed address by its path", async () => {
    const out = await withPageTitles([tab(TRACK, "x")], () =>
      Promise.resolve({ path: "/intl-de/track/4cOdK2wGLETKBW3PvgPWqT", title: "Song", artists: ["A"] }),
    );
    expect(out[0]?.pageTitle).toBe("Song by A");
  });
});

describe("a page that has not rendered yet", () => {
  it("is read again later: no heading means no name yet", async () => {
    const out = await withPageTitles([tab(ALBUM, "x")], () => Promise.resolve({ path: "/album/1uyf3l2d4XYwiEqAb7t7fX", title: "", artists: [] }));
    expect(out[0]?.pageTitle).toBeUndefined();
    expect(needsLabel(out)).toBe(true);
  });

  it("stops being retried once the heading is read, and never retries an Apple Music tab", async () => {
    const named = await withPageTitles([tab(ALBUM, "x")], () => Promise.resolve({ path: "/album/1uyf3l2d4XYwiEqAb7t7fX", title: "T", artists: [] }));
    expect(needsLabel(named)).toBe(false);
    expect(needsLabel([tab("https://music.apple.com/us/album/x/1", "X")])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { musicTabEntries } from "../../src/core/musicTabs";
import { SPOTIFY_PROVIDER } from "../../src/providers/spotify";
import { recogniseUrl } from "../../src/providers/registry";
import { canonicalSpotifyUrl, parseSpotifyUrl, spotifyOpenUrl } from "../../src/spotify/url";

const ID = "4cOdK2wGLETKBW3PvgPWqT";
const ALBUM = "1uyf3l2d4XYwiEqAb7t7fX";

describe("parseSpotifyUrl", () => {
  it("recognises a track and an album", () => {
    expect(parseSpotifyUrl(`https://open.spotify.com/track/${ID}`)).toEqual({ kind: "song", id: ID });
    expect(parseSpotifyUrl(`https://open.spotify.com/album/${ALBUM}`)).toEqual({ kind: "album", id: ALBUM });
  });

  it("accepts locale-prefixed paths, tracking queries and a trailing slash", () => {
    for (const path of [`intl-de/track/${ID}`, `intl-pt/track/${ID}?si=abc123`, `intl-es-419/track/${ID}/`, `track/${ID}#x`]) {
      expect(parseSpotifyUrl(`https://open.spotify.com/${path}`), path).toEqual({ kind: "song", id: ID });
    }
  });

  it("refuses everything else", () => {
    const bad = [
      `http://open.spotify.com/track/${ID}`,
      `https://open.spotify.com.evil.example/track/${ID}`,
      `https://evil.example/https://open.spotify.com/track/${ID}`,
      `https://spotify.com/track/${ID}`,
      `https://open.spotify.com/artist/${ID}`,
      `https://open.spotify.com/playlist/${ID}`,
      `https://open.spotify.com/episode/${ID}`,
      `https://open.spotify.com/track/short`,
      `https://open.spotify.com/track/${ID}x`,
      `https://open.spotify.com/intl-/track/${ID}`,
      `https://open.spotify.com/intl-de/artist/${ID}`,
      `https://open.spotify.com/track/${ID.slice(0, 21)}!`,
      "",
    ];
    for (const url of bad) expect(parseSpotifyUrl(url), url).toBeNull();
  });
});

describe("canonicalSpotifyUrl", () => {
  it("drops the locale prefix and the query", () => {
    expect(canonicalSpotifyUrl(`https://open.spotify.com/intl-de/track/${ID}?si=zzz`)).toBe(
      `https://open.spotify.com/track/${ID}`,
    );
    expect(canonicalSpotifyUrl(`https://open.spotify.com/album/${ALBUM}`)).toBe(`https://open.spotify.com/album/${ALBUM}`);
    expect(canonicalSpotifyUrl("https://open.spotify.com/artist/x")).toBeNull();
  });
});

describe("spotifyOpenUrl", () => {
  const track = `https://open.spotify.com/track/${ID}?locale=en&geniescraper=read`;

  it("asks for English on a plain track and album address", () => {
    expect(spotifyOpenUrl(`https://open.spotify.com/track/${ID}`)).toBe(track);
    expect(spotifyOpenUrl(`https://open.spotify.com/album/${ALBUM}`)).toBe(`https://open.spotify.com/album/${ALBUM}?locale=en&geniescraper=read`);
  });

  it("replaces a tracking query, a fragment, a trailing slash and an existing locale", () => {
    for (const url of [
      `https://open.spotify.com/track/${ID}?si=abc123`,
      `https://open.spotify.com/track/${ID}/?si=abc&locale=de`,
      `https://open.spotify.com/track/${ID}#x`,
      `https://open.spotify.com/track/${ID}?locale=en&geniescraper=read`,
    ]) {
      expect(spotifyOpenUrl(url), url).toBe(track);
    }
  });

  it("drops a locale prefix instead of keeping the browser language's address", () => {
    expect(spotifyOpenUrl(`https://open.spotify.com/intl-de/track/${ID}?si=1`)).toBe(track);
    expect(spotifyOpenUrl(`https://open.spotify.com/intl-es-419/album/${ALBUM}`)).toBe(
      `https://open.spotify.com/album/${ALBUM}?locale=en&geniescraper=read`,
    );
  });

  it("is null for anything that is not a track or album page, so no tab is opened for it", () => {
    expect(spotifyOpenUrl(`https://open.spotify.com/artist/${ID}`)).toBeNull();
    expect(spotifyOpenUrl(`https://evil.example/?u=https://open.spotify.com/track/${ID}`)).toBeNull();
    expect(spotifyOpenUrl("")).toBeNull();
  });

  it("gives an address the parser reads as the same page", () => {
    expect(parseSpotifyUrl(track)).toEqual({ kind: "song", id: ID });
  });
});

describe("the Spotify provider", () => {
  it("is found by address and declares an optional host", () => {
    expect(recogniseUrl(`https://open.spotify.com/intl-fr/album/${ALBUM}`)?.provider).toBe(SPOTIFY_PROVIDER);
    expect(SPOTIFY_PROVIDER.permission).toBe("optional");
    expect(SPOTIFY_PROVIDER.origins).toEqual(["https://open.spotify.com/*"]);
  });

  it("opens the English address and keys a page by the plain one", () => {
    const url = `https://open.spotify.com/intl-de/track/${ID}?si=1`;
    expect(SPOTIFY_PROVIDER.openUrl(url)).toBe(`https://open.spotify.com/track/${ID}?locale=en&geniescraper=read`);
    expect(SPOTIFY_PROVIDER.pageKey(url)).toBe(SPOTIFY_PROVIDER.pageKey(`https://open.spotify.com/track/${ID}`));
  });

  it("names tabs from their titles as Artist - Title, and generically when it cannot", () => {
    const name = (title: string): string => SPOTIFY_PROVIDER.tabName(title, "", "song");
    expect(name("Blinding Lights - song and lyrics by The Weeknd | Spotify")).toBe("The Weeknd - Blinding Lights");
    expect(name("After Hours - Album by The Weeknd | Spotify")).toBe("The Weeknd - After Hours");
    expect(name("Blinding Lights – Musik und Lyrics von The Weeknd | Spotify")).toBe("The Weeknd - Blinding Lights");
    expect(name("Blinding Lights – Titel und Songtext von The Weeknd | Spotify")).toBe("Spotify track");
    expect(name("")).toBe("Spotify track");
    expect(SPOTIFY_PROVIDER.tabName(" | Spotify", "", "album")).toBe("Spotify album");
  });
});

describe("open Spotify tabs", () => {
  it("are listed with their source, the same page in two locales once, the page in view first", () => {
    const entries = musicTabEntries([
      { tabId: 1, url: `https://open.spotify.com/track/${ID}`, title: "Song - song and lyrics by Band | Spotify", current: false },
      { tabId: 2, url: `https://open.spotify.com/intl-de/track/${ID}?si=1`, title: "Song | Spotify", current: true },
      { tabId: 3, url: "https://open.spotify.com/artist/abc", title: "Band | Spotify", current: false },
      { tabId: 4, url: "https://music.apple.com/us/album/x/1", title: "X - Apple Music", current: false },
    ]);
    expect(entries.map((e) => [e.source, e.kind, e.current])).toEqual([
      ["Spotify", "song", true],
      ["Apple Music", "album", false],
    ]);
  });
});

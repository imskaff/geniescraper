import { describe, expect, it } from "vitest";
import { musicTabEntries, type OpenTab } from "../../src/core/musicTabs";

const tab = (url: string, title = "", current = false, tabId = 1): OpenTab => ({ tabId, url, title, current });

const ALBUM = "https://music.apple.com/us/album/hit-me-hard-and-soft/1739659134";
const SONG = "https://music.apple.com/us/song/chihiro/1739659140";

describe("the open Apple Music pages the panel offers", () => {
  it("keeps only album and song pages of Apple Music", () => {
    const entries = musicTabEntries([
      tab(ALBUM),
      tab(SONG),
      tab("https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb"),
      tab("https://music.apple.com/us/browse"),
      tab("https://music.apple.com/us/artist/billie-eilish/9272002"),
      tab("https://example.com/us/album/x/123"),
      tab("https://music.apple.com.evil.example/us/album/x/123"),
      tab("http://music.apple.com/us/album/x/123"),
      tab(""),
    ]);
    expect(entries.map((e) => e.url)).toEqual([ALBUM, SONG]);
  });

  it("shows a title as one plain line: no-break and thin spaces, tabs and control characters are cleaned", () => {
    const names = musicTabEntries([
      tab(ALBUM, "Some\u00a0Album\u2009Name - Apple Music"),
      tab(SONG, "Two\tcolumns\nand newline\u0007 - Apple Music"),
    ]).map((e) => e.name);
    expect(names).toEqual(["Some Album Name", "Two columns and newline"]);
  });

  it("says whether a page is an album or a song", () => {
    expect(musicTabEntries([tab(ALBUM), tab(SONG)]).map((e) => e.kind)).toEqual(["album", "song"]);
  });

  it("lists a page once, however many tabs show it", () => {
    const entries = musicTabEntries([tab(ALBUM, "A", false, 1), tab(ALBUM, "C", false, 3)]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.url).toBe(ALBUM);
  });

  it("lists an album address with a song picked as that song, once, with the song's own address", () => {
    const withSong = `${ALBUM}?i=1739659140`;
    const entries = musicTabEntries([
      tab(withSong, "A", false, 1),
      tab(ALBUM, "B", false, 2),
      tab(withSong, "C", false, 3),
    ]);
    expect(entries.map((e) => [e.kind, e.url])).toEqual([
      ["song", "https://music.apple.com/us/song/song/1739659140"],
      ["album", ALBUM],
    ]);
  });

  it("keeps pages of different storefronts apart", () => {
    const other = "https://music.apple.com/pl/album/hit-me-hard-and-soft/1739659134";
    expect(musicTabEntries([tab(ALBUM), tab(other)])).toHaveLength(2);
  });

  it.each([
    ["‎Hit Me Hard And Soft - Album by Billie Eilish - Apple Music", "Billie Eilish - Hit Me Hard And Soft"],
    ["LONELY AT THE TOP - Song with Lyrics by Joey Bada$$ - Apple Music", "Joey Bada$$ - LONELY AT THE TOP"],
    ["LUNCH – Titel mit Gesang von Billie Eilish – Apple Music", "Billie Eilish - LUNCH"],
    ["HIT ME HARD AND SOFT – Album von Billie Eilish – Apple Music", "Billie Eilish - HIT ME HARD AND SOFT"],
    ["LUNCH – Morceau avec paroles par Billie Eilish – Apple Music", "Billie Eilish - LUNCH"],
    ["HIT ME HARD AND SOFT – Album par Billie Eilish – Apple Music", "Billie Eilish - HIT ME HARD AND SOFT"],
    ["LUNCH - ビリー・アイリッシュの曲（歌詞付き）- Apple Music", "ビリー・アイリッシュ - LUNCH"],
    [
      "HIT ME HARD AND SOFT - ビリー・アイリッシュのアルバム - Apple Music",
      "ビリー・アイリッシュ - HIT ME HARD AND SOFT",
    ],
    // A wording not seen live: the title alone, never a half-translated marketing phrase.
    ["Hit Me Hard And Soft – album artysty Billie Eilish – Apple Music", "Hit Me Hard And Soft"],
    ["CHIHIRO - Song by Billie Eilish | Apple Music", "Billie Eilish - CHIHIRO"],
    ["Float (INDIGO) — Song by Insane Shinobi — Apple Music", "Insane Shinobi - Float (INDIGO)"],
    ["SOS by SZA on Apple Music", "SZA - SOS"],
    ["Stand by Me by Ben E. King on Apple Music", "Ben E. King - Stand by Me"],
    ["  ‏SOS  ", "SOS"],
  ])("names a page from its tab title as Artist - Title: %j", (title, name) => {
    expect(musicTabEntries([tab(ALBUM, title)])[0]?.name).toBe(name);
  });

  it("never leaves a source's marketing text in a name", () => {
    for (const title of [
      "LUNCH - Song with Lyrics by Billie Eilish - Apple Music",
      "LUNCH – Titel mit Gesang von Billie Eilish – Apple Music",
    ]) {
      expect(musicTabEntries([tab(ALBUM, title)])[0]?.name).not.toMatch(/with Lyrics|Gesang|Song by|Album/i);
    }
  });

  it("falls back to the address when the title says nothing", () => {
    for (const title of ["", "Apple Music", "‎ Apple Music "]) {
      expect(musicTabEntries([tab(ALBUM, title)])[0]?.name, JSON.stringify(title)).toBe("Hit Me Hard And Soft");
    }
    expect(musicTabEntries([tab(SONG, "")])[0]?.name).toBe("Chihiro");
  });

  it("never lets a long or odd title run on", () => {
    const entry = musicTabEntries([tab(ALBUM, `${"x".repeat(300)} - Apple Music`)])[0];
    expect(entry?.name.length).toBeLessThanOrEqual(120);
    expect(entry?.name.endsWith("…")).toBe(true);
  });

  it("puts the page the user is looking at first, and marks only that one", () => {
    const entries = musicTabEntries([tab(ALBUM, "", false, 1), tab(SONG, "", true, 2)]);
    expect(entries.map((e) => [e.url, e.current])).toEqual([
      [SONG, true],
      [ALBUM, false],
    ]);
  });

  it("keeps the browser's order for the rest, and marks none when the current tab is not an Apple Music page", () => {
    const third = "https://music.apple.com/us/album/sos/1650000000";
    const entries = musicTabEntries([tab(ALBUM, "", false, 1), tab(SONG, "", false, 2), tab(third, "", false, 3)]);
    expect(entries.map((e) => e.url)).toEqual([ALBUM, SONG, third]);
    expect(entries.some((e) => e.current)).toBe(false);
  });

  it("gives nothing for no tabs", () => {
    expect(musicTabEntries([])).toEqual([]);
  });
});

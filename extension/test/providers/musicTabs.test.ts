import { describe, expect, it } from "vitest";
import { musicTabEntries, type OpenTab } from "../../src/core/musicTabs";
import { APPLE_PROVIDER } from "../../src/providers/apple";
import { ALBUM_URL } from "../background/fakePorts";
import { FAKE_ALBUM, FAKE_PROVIDER, FAKE_SONG } from "./fakeProvider";

const BOTH = [APPLE_PROVIDER, FAKE_PROVIDER];

function tab(url: string, title: string, tabId: number, current = false): OpenTab {
  return { tabId, url, title, current };
}

describe("musicTabEntries with several providers", () => {
  it("lists pages of every provider, named by their own provider, the page in view first", () => {
    const entries = musicTabEntries(
      [
        tab(ALBUM_URL, "TTPD - Apple Music", 1),
        tab(FAKE_SONG, "Low Light | Tunes", 2, true),
        tab("https://tunes.example/search?q=x", "Search | Tunes", 3),
      ],
      BOTH,
    );
    expect(entries).toEqual([
      { url: FAKE_SONG, name: "Low Light", kind: "song", current: true },
      { url: ALBUM_URL, name: "TTPD", kind: "album", current: false },
    ]);
  });

  it("merges the same page open twice and falls back to the provider's own name", () => {
    const entries = musicTabEntries([tab(FAKE_ALBUM, "", 1), tab(`${FAKE_ALBUM}?x=1`, "", 2, true)], BOTH);
    expect(entries).toEqual([{ url: FAKE_ALBUM, name: "Tunes page", kind: "album", current: true }]);
  });

  it("leaves the second provider's pages out when it is not registered", () => {
    expect(musicTabEntries([tab(FAKE_SONG, "Low Light | Tunes", 1)])).toEqual([]);
  });
});

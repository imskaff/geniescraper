import { describe, expect, it } from "vitest";
import { createGeniusNavigator, type GeniusSearch } from "../../src/background/geniusNav";
import type { GeniusHit } from "../../src/core/geniusMatch";
import { PASTE_KEY, startPaste } from "../../src/core/paste";
import { memoryStore } from "../ui/fakes";
import { fakeBrowser, type FakeBehaviour } from "./fakePorts";

const TIMING = { loadMs: 300, askMs: 200, pollMs: 5 };
const FORTNIGHT: GeniusHit = {
  id: 10,
  title: "Fortnight",
  primary: ["Taylor Swift"],
  featured: ["Post Malone"],
  path: "/Taylor-swift-fortnight-lyrics",
};
const FORTNIGHT_URL = "https://genius.com/Taylor-swift-fortnight-lyrics";
const hit = (id: number, title = "Fortnight", artist = "Taylor Swift"): GeniusHit => ({
  id,
  title,
  primary: [artist],
  featured: [],
  path: `/song-${String(id)}-lyrics`,
});

type SearchResult = GeniusHit[] | null | "throws";

function setup(result: SearchResult, behaviour: FakeBehaviour = {}) {
  const browser = fakeBrowser(behaviour);
  const searches: string[] = [];
  const search: GeniusSearch = (title, artist) => {
    searches.push(`${artist}|${title}`);
    return result === "throws" ? Promise.reject(new Error("boom")) : Promise.resolve(result);
  };
  const session = memoryStore();
  const nav = createGeniusNavigator(browser.ports, { settings: memoryStore(), session }, search, TIMING);
  return { browser, nav, searches, session };
}

const asks = (log: string[]): string[] => log.filter((line) => line.startsWith("ask:"));

describe("opening a song on Genius", () => {
  it("opens the matching song in a new visible tab and asks its page to open the form", async () => {
    const { browser, nav, searches } = setup([hit(1, "Other"), FORTNIGHT]);
    const answer = await nav.open("Fortnight (feat. Post Malone)", "Taylor Swift");
    expect(answer.status).toBe("opened");
    expect(answer.song?.url).toBe(FORTNIGHT_URL);
    expect(searches).toEqual(["Taylor Swift|Fortnight (feat. Post Malone)"]);
    expect(browser.log).toEqual([`create:${FORTNIGHT_URL}:active=true`, "ask:1000:genius/open-edit"]);
  });

  it("brings an already open tab of that song to the front instead of opening another", async () => {
    const { browser, nav } = setup([FORTNIGHT], {
      geniusTabs: [
        { id: 3, active: false },
        { id: 4, active: false },
      ],
      geniusUrls: { 3: "https://genius.com/Some-other-song-lyrics", 4: `${FORTNIGHT_URL}?utm=x#about` },
    });
    const answer = await nav.open("Fortnight", "Taylor Swift");
    expect(answer.status).toBe("opened");
    expect(browser.log).toEqual(["focus:4", "ask:4:genius/open-edit"]);
  });

  it("never navigates an open Genius tab that shows another page", async () => {
    const { browser, nav } = setup([FORTNIGHT], {
      geniusTabs: [{ id: 3, active: true }],
      geniusUrls: { 3: "https://genius.com/Some-other-song-lyrics" },
    });
    await nav.open("Fortnight", "Taylor Swift");
    expect(browser.log.some((line) => line.includes(":3"))).toBe(false);
    expect(browser.log[0]).toBe(`create:${FORTNIGHT_URL}:active=true`);
  });

  it("opens nothing for a hit whose path is not a plain song page", async () => {
    const { browser, nav } = setup([{ ...FORTNIGHT, path: "https://evil.example/x" }]);
    expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("none");
    expect(browser.log).toEqual([]);
  });

  it("stops with none when no song matches exactly, opening nothing", async () => {
    const { browser, nav } = setup([hit(1, "Fortnight (Remix)"), hit(2, "Fortnight", "Someone Else")]);
    expect(await nav.open("Fortnight", "Taylor Swift")).toEqual({ status: "none" });
    expect(browser.log).toEqual([]);
  });

  it("stops with several candidates and opens none of them", async () => {
    const { browser, nav } = setup([hit(1), hit(2)]);
    const answer = await nav.open("Fortnight", "Taylor Swift");
    expect(answer.status).toBe("several");
    expect(answer.songs?.map((song) => song.url)).toEqual([
      "https://genius.com/song-1-lyrics",
      "https://genius.com/song-2-lyrics",
    ]);
    expect(browser.log).toEqual([]);
  });

  it.each<SearchResult>([null, "throws"])(
    "says failed when Genius cannot be searched (%s), opening nothing",
    async (result) => {
      const { browser, nav } = setup(result);
      expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("failed");
      expect(browser.log).toEqual([]);
    },
  );

  it("says sign-in when the page has no Edit Metadata button", async () => {
    const { nav } = setup([FORTNIGHT], { geniusAnswer: () => ({ ok: true, data: { state: "no-button" } }) });
    const answer = await nav.open("Fortnight", "Taylor Swift");
    expect(answer.status).toBe("sign-in");
    expect(answer.song?.url).toBe(FORTNIGHT_URL);
  });

  it("says no-form when the form did not open", async () => {
    const { nav } = setup([FORTNIGHT], { geniusAnswer: () => ({ ok: true, data: { state: "no-form" } }) });
    expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("no-form");
  });

  it("counts a form that was already open as opened", async () => {
    const { nav } = setup([FORTNIGHT], { geniusAnswer: () => ({ ok: true, data: { state: "already-open" } }) });
    expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("opened");
  });

  it("keeps asking a page whose content script has not loaded yet", async () => {
    const { browser, nav } = setup([FORTNIGHT], { deafAsks: 3 });
    expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("opened");
    expect(asks(browser.log)).toHaveLength(4);
  });

  it("gives up on a page that never answers", async () => {
    const { nav } = setup([FORTNIGHT], { deafAsks: 100000 });
    expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("failed");
  });

  it("gives up on an answer it does not understand", async () => {
    const { nav } = setup([FORTNIGHT], { geniusAnswer: () => ({ ok: true, data: { state: "surprise" } }) });
    expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("failed");
  });

  it("says failed when the new tab never loads", async () => {
    const { nav } = setup([FORTNIGHT], { neverLoads: true });
    expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("failed");
  });

  it("says failed when the tab cannot be created", async () => {
    const { nav } = setup([FORTNIGHT], { createFails: true });
    expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("failed");
  });

  it("does nothing while a paste is running", async () => {
    const { browser, nav, session, searches } = setup([FORTNIGHT]);
    await session.set(PASTE_KEY, startPaste("Song", [["written_by", "A"]]));
    expect(await nav.open("Fortnight", "Taylor Swift")).toEqual({ status: "busy" });
    expect(searches).toEqual([]);
    expect(browser.log).toEqual([]);
  });

  it("works from the finished screen of a paste, when the next song is wanted", async () => {
    const { nav, session } = setup([FORTNIGHT]);
    await session.set(PASTE_KEY, { ...startPaste("Song", [["written_by", "A"]]), position: 1 });
    expect((await nav.open("Fortnight", "Taylor Swift")).status).toBe("opened");
  });
});

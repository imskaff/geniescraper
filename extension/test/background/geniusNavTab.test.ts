import { describe, expect, it } from "vitest";
import { createGeniusNavigator, type GeniusSearch } from "../../src/background/geniusNav";
import { memoryStore } from "../ui/fakes";
import { fakeBrowser, type FakeBehaviour } from "./fakePorts";

const TIMING = { loadMs: 300, askMs: 200, pollMs: 5 };
const PAGE = "https://genius.com/Taylor-swift-fortnight-lyrics";

function setup(behaviour: FakeBehaviour) {
  const browser = fakeBrowser(behaviour);
  const searches: string[] = [];
  const search: GeniusSearch = (title, artist) => {
    searches.push(`${artist}|${title}`);
    return Promise.resolve([]);
  };
  const nav = createGeniusNavigator(browser.ports, { settings: memoryStore(), session: memoryStore() }, search, TIMING);
  return { browser, nav, searches };
}

describe("opening the form on the page the read started from", () => {
  it("presses Edit Metadata on that tab, with no search and no new tab", async () => {
    const { browser, nav, searches } = setup({
      geniusTabs: [{ id: 5, active: true }],
      geniusUrls: { 5: `${PAGE}?x=1` },
    });
    const answer = await nav.open("Fortnight", "Taylor Swift", 5);
    expect(answer).toEqual({ status: "opened", song: { title: "Fortnight", artists: ["Taylor Swift"], url: PAGE } });
    expect(searches).toEqual([]);
    expect(browser.log).toEqual(["ask:5:genius/open-edit"]);
  });

  it("reports a signed-out page the way the search path does", async () => {
    const { nav } = setup({
      geniusTabs: [{ id: 5, active: true }],
      geniusUrls: { 5: PAGE },
      geniusAnswer: () => ({ ok: true, data: { state: "no-button" } }),
    });
    expect(await nav.open("Fortnight", "Taylor Swift", 5)).toMatchObject({ status: "sign-in" });
  });

  it("falls back to the search when the tab is gone or no longer shows a song page", async () => {
    const gone = setup({});
    await gone.nav.open("Fortnight", "Taylor Swift", 5);
    expect(gone.searches).toEqual(["Taylor Swift|Fortnight"]);
    const moved = setup({ geniusTabs: [{ id: 5, active: true }], geniusUrls: { 5: "https://genius.com/" } });
    await moved.nav.open("Fortnight", "Taylor Swift", 5);
    expect(moved.searches).toEqual(["Taylor Swift|Fortnight"]);
  });
});

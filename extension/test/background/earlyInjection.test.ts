import { describe, expect, it } from "vitest";
import { scrapeTrack } from "../../src/background/providerClient";
import { FAST_CLIENT, PAGE_SCRAPE, SONG_URL, fakeBrowser } from "./fakePorts";

/** A browser whose new tab shows `address` for the first `polls` polls while still loading, then completes. */
function slowLoadingBrowser(address: string, polls: number) {
  const browser = fakeBrowser();
  let count = 0;
  browser.ports.getTab = (tabId) => {
    if (!browser.openTabs.has(tabId)) return Promise.resolve(null);
    count++;
    return Promise.resolve(count > polls ? { status: "complete", url: SONG_URL } : { status: "loading", url: address });
  };
  return { browser, polls: () => count };
}

describe("reading a background tab", () => {
  it("injects as soon as the page has committed, without waiting for the load to finish", async () => {
    const { browser, polls } = slowLoadingBrowser(SONG_URL, 1000);
    const result = await scrapeTrack(browser.ports, SONG_URL, "Fortnight", FAST_CLIENT);

    expect(result).toEqual({ ok: true, data: PAGE_SCRAPE });
    expect(polls()).toBe(1);
    expect(browser.log).toEqual([
      `create:${SONG_URL}:active=false`,
      "inject:1000",
      "send:1000:apple/scrape",
      "remove:1000",
    ]);
  });

  it("keeps waiting while the tab shows nothing of the site yet", async () => {
    const { browser, polls } = slowLoadingBrowser("about:blank", 3);
    const result = await scrapeTrack(browser.ports, SONG_URL, "Fortnight", FAST_CLIENT);

    expect(result.ok).toBe(true);
    expect(polls()).toBe(4);
  });

  it("does not take another site's address for the page", async () => {
    const { browser, polls } = slowLoadingBrowser("https://music.apple.com.evil.example/us/song/x/1", 2);
    await scrapeTrack(browser.ports, SONG_URL, "Fortnight", FAST_CLIENT);
    expect(polls()).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import { detectAlbum, scrapeTrack } from "../../src/background/providerClient";
import { PROVIDERS } from "../../src/providers/registry";
import type { CreditsProvider } from "../../src/providers/types";
import { ALBUM_URL, FAST_CLIENT, fakeBrowser } from "../background/fakePorts";
import { FAKE_PROVIDER, FAKE_SONG } from "./fakeProvider";

// The client reads the shipped registry, so a second source plugs in the way a real one will: by being listed
// there. The registry is restored after each test.
function withFakeProvider(run: () => Promise<void>): () => Promise<void> {
  const registry = PROVIDERS as CreditsProvider[];
  return async () => {
    registry.push(FAKE_PROVIDER);
    try {
      await run();
    } finally {
      registry.splice(registry.indexOf(FAKE_PROVIDER), 1);
    }
  };
}

describe("providerClient with a second provider", () => {
  it(
    "injects that provider's own script, opens a visible tab when it cannot run hidden, and closes it",
    withFakeProvider(async () => {
      const browser = fakeBrowser();
      const injected: (string | undefined)[] = [];
      const inject = browser.ports.injectContentScript.bind(browser.ports);
      browser.ports.injectContentScript = (tabId, file) => {
        injected.push(file);
        return inject(tabId, file);
      };
      const result = await scrapeTrack(browser.ports, FAKE_SONG, "Low Light", FAST_CLIENT);

      expect(result.ok).toBe(true);
      expect(injected).toEqual(["fake/content.js"]);
      expect(browser.log.filter((entry) => entry !== "access")[0]).toBe(`create:${FAKE_SONG}:active=true`);
      expect(browser.openTabs.size).toBe(0);
    }),
  );

  it(
    "words failures with the provider's label and applies its timing override",
    withFakeProvider(async () => {
      // The override (77 ms) is shorter than the 5 s given here, so the timeout proves it was applied.
      const browser = fakeBrowser({ answer: () => new Promise<never>(() => undefined) });
      const slow = await scrapeTrack(browser.ports, FAKE_SONG, "Low Light", { ...FAST_CLIENT, requestMs: 5000 });
      expect(slow).toEqual({ ok: false, error: { code: "timeout", message: FAKE_PROVIDER.messages.slowResponse } });

      const notSong = await scrapeTrack(fakeBrowser().ports, "https://tunes.example/album/x/1", "x", FAST_CLIENT);
      expect(notSong).toEqual({ ok: false, error: { code: "invalid-url", message: "Not a Tunes track link." } });

      const wrongTab = fakeBrowser({ userTabs: { 5: { status: "complete", url: "https://tunes.example/album/y/2" } } });
      const detect = await detectAlbum(wrongTab.ports, "https://tunes.example/album/x/1", 5, FAST_CLIENT);
      expect(detect).toEqual({
        ok: false,
        error: { code: "invalid-url", message: FAKE_PROVIDER.messages.tabNotShowing },
      });
    }),
  );

  it(
    "refuses an address no provider owns, before a tab exists, in general words",
    withFakeProvider(async () => {
      const browser = fakeBrowser();
      const result = await detectAlbum(browser.ports, "https://other.example/album/x/1", undefined, FAST_CLIENT);
      expect(result).toEqual({
        ok: false,
        error: { code: "invalid-url", message: "Not a supported album or song link." },
      });
      expect(browser.log).toEqual([]);
    }),
  );

  it(
    "still reads Apple Music exactly as before when the second provider is registered",
    withFakeProvider(async () => {
      const browser = fakeBrowser();
      const result = await detectAlbum(browser.ports, ALBUM_URL, undefined, FAST_CLIENT);
      expect(result.ok).toBe(true);
      expect(browser.log[0]).toBe(`create:${ALBUM_URL}:active=false`);
    }),
  );
});

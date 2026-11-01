// Reading credits must never start, resume or switch playback, nor change the user's queue or library.
import { beforeEach, describe, expect, it } from "vitest";
import { detectAlbum, scrapeTrack } from "../../src/background/providerClient";
import { findCreditsItem } from "../../src/spotify/page";
import { blockPlayback, isReaderTab } from "../../src/spotify/guard";
import { spotifyOpenUrl } from "../../src/spotify/url";
import { fakeBrowser } from "../background/fakePorts";
import { FAST_CLIENT } from "../background/fakePorts";

const entry = (label: string, attrs = ""): string =>
  `<li role="presentation"><button role="menuitem" ${attrs}><span dir="auto">${label}</span></button></li>`;
const setBody = (markup: string): void => {
  document.body.replaceChildren(...new DOMParser().parseFromString(markup, "text/html").body.childNodes);
};
const menu = (...items: string[]): void => {
  setBody(`<ul role="menu">${items.join("")}</ul>`);
};
const clicked = (): string | null => {
  const found = findCreditsItem(document);
  return found ? found.textContent : null;
};

describe("the credits entry is the only thing ever clicked", () => {
  beforeEach(() => {
    setBody("");
  });

  it("finds View credits in the signed-out menu", () => {
    menu(
      entry("Add to playlist", 'aria-expanded="false"'),
      entry("Save to your Liked Songs", 'aria-disabled="false"'),
      entry("View credits"),
      entry("Share", 'aria-expanded="false"'),
      entry("Open in Desktop app"),
    );
    expect(clicked()).toBe("View credits");
  });

  // Made-up markup: no signed-in menu was available. It has the entries a signed-in menu is expected to add.
  it("finds View credits in a signed-in style menu with queue and taste-profile entries", () => {
    menu(
      entry("Add to playlist", 'aria-expanded="false"'),
      entry("Save to your Liked Songs"),
      entry("Add to queue"),
      entry("Exclude from your taste profile"),
      entry("Go to song radio"),
      entry("View credits"),
      entry("Share", 'aria-expanded="false"'),
      entry("Open in Desktop app"),
    );
    expect(clicked()).toBe("View credits");
  });

  it.each(["Add to queue", "Play", "Save to your Liked Songs", "Remove from your Liked Songs", "Go to song radio"])(
    "clicks nothing when the entry before Share is %s",
    (label) => {
      menu(entry("Add to playlist", 'aria-expanded="false"'), entry(label), entry("Share", 'aria-expanded="false"'));
      expect(clicked()).toBeNull();
    },
  );

  it("clicks nothing when no entry is expandable", () => {
    menu(entry("View credits"), entry("Add to queue"));
    expect(clicked()).toBeNull();
  });
});

describe("the playback guard", () => {
  it("makes play() fail, pauses a media element that starts anyway, and refuses a key system", async () => {
    blockPlayback(window);
    const video = document.createElement("video");
    await expect(video.play()).rejects.toMatchObject({ name: "NotAllowedError" });
    const paused: string[] = [];
    video.pause = () => paused.push("pause");
    document.body.append(video);
    video.dispatchEvent(new Event("play"));
    expect(paused).toEqual(["pause"]);
    expect(video.muted).toBe(true);
    if (typeof navigator.requestMediaKeySystemAccess === "function") {
      await expect(navigator.requestMediaKeySystemAccess("com.widevine.alpha", [])).rejects.toMatchObject({
        name: "NotSupportedError",
      });
    }
  });

  it("acts only on the addresses the worker opens", () => {
    const opened = new URL(spotifyOpenUrl("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT") ?? "");
    expect(isReaderTab(opened.search)).toBe(true);
    expect(isReaderTab("")).toBe(false);
    expect(isReaderTab("?locale=en")).toBe(false);
  });
});

describe("reader tabs get the guard before the page loads", () => {
  const TRACK = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";
  const ALBUM = "https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj";

  it("arms it before a tab is created for a track read", async () => {
    const browser = fakeBrowser();
    await scrapeTrack(browser.ports, TRACK, "x", FAST_CLIENT);
    const guard = browser.log.indexOf("guard:spotify/guard.js");
    const create = browser.log.findIndex((entry) => entry.startsWith("create:"));
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(create);
  });

  it("arms it for an album read that opens its own tab, but not for the user's own tab", async () => {
    const own = fakeBrowser();
    await detectAlbum(own.ports, ALBUM, undefined, FAST_CLIENT);
    expect(own.log).toContain("guard:spotify/guard.js");

    const users = fakeBrowser({ userTabs: { 7: { status: "complete", url: ALBUM } } });
    await detectAlbum(users.ports, ALBUM, 7, FAST_CLIENT);
    expect(users.log.some((entry) => entry.startsWith("guard:"))).toBe(false);
  });

  it("opens no tab when the guard cannot be armed", async () => {
    const browser = fakeBrowser();
    browser.ports.armReaderGuard = () => Promise.reject(new Error("no scripting"));
    const result = await scrapeTrack(browser.ports, TRACK, "x", FAST_CLIENT);
    expect(result.ok).toBe(false);
    expect(browser.log.some((entry) => entry.startsWith("create:"))).toBe(false);
  });
});

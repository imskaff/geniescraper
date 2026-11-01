import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenTab } from "../../src/core/musicTabs";
import type { AlbumInfo, PageScrape } from "../../src/shared/messages";
import { PanelController, describeError } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, fakeEnv } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};

const TRACK = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";
const OTHER = "https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b";
const SPOTIFY_ALBUM = "https://open.spotify.com/album/1uyf3l2d4XYwiEqAb7t7fX";

const SPOTIFY_INFO: AlbumInfo = {
  url: SPOTIFY_ALBUM,
  albumTitle: "Sample Album",
  artist: "Band",
  trackCount: 4,
  trackTitles: ["One", "Two", "Track 3", "Track 4"],
  trackUrls: [TRACK, OTHER, "", ""],
  phonographicCopyright: "℗ 2020 Label",
  copyrightNotice: "© 2020 Label",
  coverArtUrl: "",
  releaseDate: "",
  note: "Spotify's page lists 2 of 4 tracks. Open any other track on its own page to read it.",
};

const SINGLE_INFO: AlbumInfo = {
  url: SPOTIFY_ALBUM,
  albumTitle: "One",
  artist: "Band",
  trackCount: 1,
  trackTitles: ["One"],
  trackUrls: [TRACK],
  phonographicCopyright: "℗ 2020 Label",
  copyrightNotice: "© 2020 Label",
  coverArtUrl: "",
  releaseDate: "",
};

const SPOTIFY_SCRAPE: PageScrape = {
  title: "One",
  artist: "Band",
  credits: [{ role: "Songwriter", artists: ["Writer A"] }],
  coverArtUrl: "",
  releaseDate: "",
  warnings: [],
  notes: [
    "Left out because Genius has no matching role: Director (Person 1).",
    "Spotify's page does not show the ISRC.",
  ],
};

async function mount(options: Parameters<typeof fakeEnv>[0] = {}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv(options);
  const panel = await PanelController.create(env);
  new PanelView(root, panel);
  await flush();
  return { root, env, panel };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("picking a Spotify page", () => {
  it("reads it at once, with no permission step", async () => {
    const { root, env, panel } = await mount({
      api: { detect: () => Promise.resolve({ ok: true, data: SINGLE_INFO }) },
    });
    await panel.detect(TRACK);
    expect(env.api.calls[0]).toBe(`detect:${TRACK}:undefined`);
    await flush();
    expect(root.querySelector('[data-key="source-access"]')).toBeNull();
  });

  it("lists the detector without any note about allowing access", async () => {
    const { root } = await mount();
    const text = $(root, '[data-key="open-pages"]').textContent;
    expect(text).not.toContain("allowed access");
    expect(text).not.toContain("Chrome asks");
  });
});

describe("open Spotify tabs", () => {
  it("are listed with their source next to Apple Music pages", async () => {
    const openTabs: OpenTab[] = [
      {
        tabId: 1,
        url: TRACK,
        title: "Race My Mind - song and lyrics by Drake | Spotify",
        pageTitle: "One by Band",
        current: true,
      },
      { tabId: 2, url: ALBUM.url, title: "Demo Album - Apple Music", current: false },
    ];
    const { root } = await mount({ openTabs });
    const section = $(root, '[data-key="open-pages"]');
    expect(section.querySelector("h3")?.textContent).toBe("2 music pages detected");
    expect([...section.querySelectorAll(".tag")].map((tag) => tag.textContent)).toEqual([
      "Spotify · Song · this page",
      "Apple Music · Album",
    ]);
    expect(section.textContent).toContain("One by Band");
    expect(section.textContent).not.toContain("Race My Mind");
  });
});

describe("a Spotify album", () => {
  it("shows the page's own count, marks tracks it did not list, and says why", async () => {
    const { root, panel } = await mount({ api: { detect: () => Promise.resolve({ ok: true, data: SPOTIFY_INFO }) } });
    await panel.detect(SPOTIFY_ALBUM);
    await flush();
    expect(root.textContent).toContain(SPOTIFY_INFO.note);
    const boxes = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((box) => box.disabled)).toEqual([false, false, true, true]);
    expect(root.textContent).toContain("No Spotify page");
    expect(root.textContent).not.toContain("No Apple Music page");
  });

  it("keeps the scrape's notes with the song and shows them under the credits", async () => {
    const { root, env, panel } = await mount({
      api: {
        detect: () =>
          Promise.resolve({
            ok: true,
            data: SINGLE_INFO,
          }),
        scrapeTrack: () => Promise.resolve({ ok: true, data: SPOTIFY_SCRAPE }),
      },
    });
    await panel.detect(SPOTIFY_ALBUM);
    await flush();
    expect(env.api.calls.some((call) => call.startsWith("scrape"))).toBe(true);
    const song = panel.state.session.results[0]?.song;
    expect(song?.notes).toEqual(SPOTIFY_SCRAPE.notes);
    expect(song?.phonographicCopyright).toBe("℗ 2020 Label");
    expect(song?.releaseDate).toBe("");
    const notes = $(root, '[data-key="source-notes"]');
    expect(notes.querySelectorAll("li")).toHaveLength(2);
    expect(notes.textContent).toContain("Director (Person 1)");
    expect(notes.textContent).toContain("ISRC");
  });

  it("shows no notes block for an Apple Music song", async () => {
    const { root, panel } = await mount();
    await panel.detect(ALBUM.url);
    await panel.setAllSelected(true);
    await panel.getCredits();
    await flush();
    expect(root.querySelector('[data-key="source-notes"]')).toBeNull();
  });
});

describe("describeError for Spotify", () => {
  it("uses the worker's own wording for statuses it worded, and the site's name for the rest", () => {
    expect(describeError({ code: "blocked", message: "Spotify is asking for a captcha." }, "Spotify")).toBe(
      "Spotify is asking for a captcha.",
    );
    expect(describeError({ code: "unavailable", message: "No playable page." }, "Spotify")).toBe("No playable page.");
    expect(describeError({ code: "not-found", message: "" }, "Spotify")).toBe(
      "Spotify could not find that page. Check the link and try again.",
    );
    expect(describeError({ code: "timeout", message: "" })).toBe("Apple Music took too long to respond. Try again.");
  });
});

describe("open Spotify tabs", () => {
  const tab: OpenTab = {
    tabId: 1,
    url: SPOTIFY_ALBUM,
    title: "Race My Mind • Drake",
    pageTitle: "Heavy Is The Crown by Cordae",
    current: true,
  };

  it("are listed at once with the real name, with no permission asked", async () => {
    const { panel } = await mount({ openTabs: [tab] });
    expect(panel.state.appleTabs.map((entry) => entry.name)).toEqual(["Heavy Is The Crown by Cordae"]);
  });

  it("reads a page's name again a moment later when it had no heading yet, then stops", async () => {
    vi.useFakeTimers();
    try {
      const unnamed: OpenTab = { tabId: 1, url: SPOTIFY_ALBUM, title: "Race My Mind • Drake", current: true };
      const env = fakeEnv({ openTabs: [unnamed] });
      const panel = await PanelController.create(env);
      expect(panel.state.appleTabs.map((entry) => entry.name)).toEqual(["Spotify album"]);
      env.openTabs[0] = { ...unnamed, pageTitle: "Heavy Is The Crown by Cordae" };
      await vi.advanceTimersByTimeAsync(1100);
      expect(panel.state.appleTabs.map((entry) => entry.name)).toEqual(["Heavy Is The Crown by Cordae"]);
      const reads = env.openTabs.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(env.openTabs.length).toBe(reads);
    } finally {
      vi.useRealTimers();
    }
  });
});

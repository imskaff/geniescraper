import { afterEach, describe, expect, it } from "vitest";
import type { OpenTab } from "../../src/core/musicTabs";
import type { AlbumInfo, PageScrape } from "../../src/shared/messages";
import { PanelController, MESSAGES, describeError } from "../../src/ui/controller";
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

describe("picking a Spotify page before the user has allowed Spotify", () => {
  it("explains first and asks the worker nothing", async () => {
    const { root, env, panel } = await mount({ sources: { spotify: false } });
    await panel.detect(TRACK);
    expect(panel.state.sourceAsk).toEqual({ url: TRACK, providerId: "spotify" });
    expect(env.api.calls).toEqual([]);
    expect(env.sources.log).toEqual([]);
    await flush();
    const card = $(root, '[data-key="source-access"]');
    expect(card.textContent).toContain("Allow Géniescraper to read Spotify pages?");
    expect(card.textContent).toContain("nothing it reads is sent anywhere");
    expect(card.textContent).toContain("open.spotify.com");
  });

  it("asks Chrome only from the Allow click, then reads the page the user picked", async () => {
    const { root, env } = await mount({
      sources: { spotify: false },
      api: {
        detect: () =>
          Promise.resolve({
            ok: true,
            data: SINGLE_INFO,
          }),
      },
    });
    $(root, "#link").setAttribute("value", TRACK);
    (root.querySelector("#link") as HTMLInputElement).value = TRACK;
    $(root, "form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(env.sources.log).toEqual([]);

    $(root, '[data-key="access-allow"]').click();
    await flush();
    expect(env.sources.log).toEqual(["request:spotify"]);
    expect(env.api.calls[0]).toBe(`detect:${TRACK}:undefined`);
    expect(root.querySelector('[data-key="source-access"]')).toBeNull();
  });

  it("says why nothing was read when Chrome's prompt is refused, and keeps no page open", async () => {
    const { root, env, panel } = await mount({ sources: { spotify: false, allow: false } });
    await panel.detect(TRACK);
    await flush();
    $(root, '[data-key="access-allow"]').click();
    await flush();
    expect(env.api.calls).toEqual([]);
    expect(panel.state.sourceAsk).toBeNull();
    expect(panel.state.error).toBe(MESSAGES.noAccess);
  });

  it("drops the explanation on Not now", async () => {
    const { root, panel } = await mount({ sources: { spotify: false } });
    await panel.detect(TRACK);
    await flush();
    $(root, '[data-key="access-decline"]').click();
    await flush();
    expect(panel.state.sourceAsk).toBeNull();
    expect(root.querySelector('[data-key="source-access"]')).toBeNull();
  });

  it("never asks about Apple Music, which needs no permission", async () => {
    const { env, panel } = await mount({ sources: { spotify: false } });
    await panel.detect(ALBUM.url);
    expect(panel.state.sourceAsk).toBeNull();
    expect(env.api.calls[0]).toContain("detect:");
  });

  it("tells the user, in the detector, that Spotify pages appear once access is allowed", async () => {
    const denied = await mount({ sources: { spotify: false } });
    expect($(denied.root, '[data-key="open-pages"]').textContent).toContain(
      "Spotify pages show up here once you have allowed access",
    );
    const allowed = await mount();
    expect($(allowed.root, '[data-key="open-pages"]').textContent).not.toContain("once you have allowed access");
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
    expect(describeError({ code: "no-access", message: "Allow it first." }, "Spotify")).toBe("Allow it first.");
    expect(describeError({ code: "not-found", message: "" }, "Spotify")).toBe(
      "Spotify could not find that page. Check the link and try again.",
    );
    expect(describeError({ code: "timeout", message: "" })).toBe("Apple Music took too long to respond. Try again.");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import type { FoundMatch, Result, ServiceMatch, SongMatchesAnswer } from "../../src/shared/messages";
import { PanelController } from "../../src/ui/controller";
import { geniusAlbumPage, geniusPage } from "../../src/ui/geniusSong";
import { PanelView } from "../../src/ui/view";
import { ALBUM, deferred, fakeEnv } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};
const has = (root: ParentNode, selector: string): boolean => root.querySelector(selector) !== null;

const ALBUM_TAB = { tabId: 5, url: "https://genius.com/albums/Olivia-rodrigo/Sour" };
const APPLE_URL = "https://music.apple.com/us/album/1560734944";
const SPOTIFY_URL = "https://open.spotify.com/album/6s84u2TUpR3wdUv4NgKA2j";
const SPOTIFY_URL_2 = "https://open.spotify.com/album/7bYichzvtYHdjF8HF69dyA";

const apple: FoundMatch = {
  status: "found",
  url: APPLE_URL,
  name: "Olivia Rodrigo - SOUR",
  release: "2021 · 11 tracks",
  source: "search",
};
const spotify: FoundMatch = {
  status: "found",
  url: SPOTIFY_URL,
  name: "Olivia Rodrigo - SOUR",
  release: "2021",
  source: "search",
};
const ready = (a: ServiceMatch = apple, s: ServiceMatch = spotify): Result<SongMatchesAnswer> => ({
  ok: true,
  data: {
    status: "ready",
    kind: "album",
    path: "/albums/Olivia-rodrigo/Sour",
    title: "SOUR",
    artists: ["Olivia Rodrigo"],
    apple: a,
    spotify: s,
  },
});

type Options = Parameters<typeof fakeEnv>[0];

async function open(options: Options = {}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv({ tab: ALBUM_TAB, settings: { onboarded: true, findPagesOnGenius: true }, ...options });
  const panel = await PanelController.create(env);
  new PanelView(root, panel);
  await flush();
  return { root, env, panel };
}

const asks = (calls: string[]): string[] => calls.filter((call) => call.startsWith("song-matches:"));

afterEach(() => {
  document.body.replaceChildren();
});

describe("which Genius addresses are albums", () => {
  it("accepts /albums/<artist>/<album> and nothing else", () => {
    expect(geniusAlbumPage("https://genius.com/albums/Olivia-rodrigo/Sour?x=1#y")).toBe(
      "https://genius.com/albums/Olivia-rodrigo/Sour",
    );
    expect(geniusAlbumPage("https://genius.com/albums/Beyonc%C3%A9/Cowboy-carter")).toBe(
      "https://genius.com/albums/Beyonc%C3%A9/Cowboy-carter",
    );
    for (const url of [
      "https://genius.com/albums/Olivia-rodrigo",
      "https://genius.com/albums/Olivia-rodrigo/Sour/extra",
      "https://genius.com/albums/",
      "https://genius.com/artists/Olivia-rodrigo",
      "https://genius.com/Olivia-rodrigo-good-4-u-lyrics",
      "https://genius.com.evil.example/albums/A/B",
      "https://example.com/albums/A/B",
      "http://genius.com/albums/A/B",
      "not a url",
    ]) {
      expect(geniusAlbumPage(url)).toBeNull();
    }
  });

  it("tells a song page from an album page and any other page", () => {
    expect(geniusPage("https://genius.com/Olivia-rodrigo-good-4-u-lyrics")?.kind).toBe("song");
    expect(geniusPage("https://genius.com/albums/Olivia-rodrigo/Sour")?.kind).toBe("album");
    expect(geniusPage("https://genius.com/artists/Olivia-rodrigo")).toBeNull();
    expect(geniusPage("https://genius.com/")).toBeNull();
  });
});

describe("the card on a Genius album page", () => {
  it("lists the album's Apple Music and Spotify pages in the card's album words", async () => {
    const { root, env } = await open({ api: { songMatches: () => Promise.resolve(ready()) } });
    expect(asks(env.api.calls)).toEqual(["song-matches:5"]);
    const card = $(root, '[data-key="song-matches"]');
    expect(card.querySelector("h3")?.textContent).toBe("This album on Apple Music and Spotify");
    expect(card.getAttribute("aria-label")).toBe("This album on Apple Music and Spotify");
    const rows = [...card.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows[0]).toContain("Olivia Rodrigo - SOUR");
    expect(rows[0]).toContain("Apple Music · 2021 · 11 tracks · found by search");
    expect(rows[1]).toContain("Spotify · 2021 · found by search");
    expect(card.textContent).not.toContain("song");
  });

  it("says it is searching while the worker works, in album words", async () => {
    const answer = deferred<Result<SongMatchesAnswer>>();
    const { root } = await open({ api: { songMatches: () => answer.promise } });
    expect($(root, '[data-key="song-matches"] h3').textContent).toBe(
      "Looking for this album on Apple Music and Spotify…",
    );
    expect($(root, '[data-key="song-matches"]').textContent).toContain("Searching both for this album.");
    answer.resolve(ready());
    await flush();
    expect($(root, '[data-key="song-matches"] h3').textContent).toBe("This album on Apple Music and Spotify");
  });

  it("says plainly when there is no exact match, without claiming Genius looked", async () => {
    const { root } = await open({
      api: { songMatches: () => Promise.resolve(ready({ status: "none" }, { status: "none" })) },
    });
    const card = $(root, '[data-key="song-matches"]');
    expect($(root, '[data-key="match-apple"]').textContent).toContain("No exact match found");
    expect($(root, '[data-key="match-spotify"]').textContent).toContain("No exact match found");
    expect(card.textContent).toContain("A search found no exact match. Paste a link below.");
    expect(card.textContent).not.toContain("Genius and a search");
  });

  it("shows a service that could not be asked, with its reason, and a Try again", async () => {
    const { root } = await open({
      api: {
        songMatches: () =>
          Promise.resolve(
            ready(apple, { status: "failed", message: "Spotify: Spotify asked for a captcha. (blocked)" }),
          ),
      },
    });
    expect($(root, '[data-key="match-spotify"]').textContent).toContain("Could not look this up");
    expect($(root, '[data-key="match-spotify"]').textContent).toContain("captcha");
    expect(has(root, 'button[data-key="match-apple"]')).toBe(true);
    expect(has(root, '[data-key="song-matches-find"]')).toBe(true);
  });

  it("gives each of several albums its own Get credits button, and lists a single Apple one as before", async () => {
    const second: FoundMatch = { ...spotify, url: SPOTIFY_URL_2 };
    const { root } = await open({
      api: { songMatches: () => Promise.resolve(ready(apple, { status: "several", matches: [spotify, second] })) },
    });
    expect(has(root, 'button[data-key="match-apple"]')).toBe(true);
    expect(has(root, 'button[data-key="match-spotify-1"]')).toBe(true);
    expect(has(root, 'button[data-key="match-spotify-2"]')).toBe(true);
    expect($(root, '[data-key="song-matches"] h3').textContent).toBe("This album on Apple Music and Spotify");
    expect($(root, '[data-key="song-matches"]').textContent).toContain("Pick one to get its credits.");
  });

  it("counts a service with several albums as found for the card's hint", async () => {
    const { root } = await open({
      api: {
        songMatches: () =>
          Promise.resolve(
            ready({ status: "none" }, { status: "several", matches: [spotify, { ...spotify, url: SPOTIFY_URL_2 }] }),
          ),
      },
    });
    expect($(root, '[data-key="song-matches"]').textContent).toContain("Pick one to get its credits.");
  });

  it("asks once per album page, and again for another album page", async () => {
    const { env, panel } = await open({ api: { songMatches: () => Promise.resolve(ready()) } });
    await panel.refreshPage();
    await panel.refreshPage();
    await flush();
    expect(asks(env.api.calls)).toHaveLength(1);
    env.setTab({ tabId: 5, url: "https://genius.com/albums/Kendrick-lamar/Gnx" });
    await panel.refreshPage();
    await flush();
    expect(asks(env.api.calls)).toHaveLength(2);
  });

  it("shows nothing on an /albums/ page the worker says is not an album (a translation)", async () => {
    const { root, env } = await open({
      api: { songMatches: () => Promise.resolve({ ok: true, data: { status: "not-song" } }) },
    });
    expect(asks(env.api.calls)).toHaveLength(1);
    expect(has(root, '[data-key="song-matches"]')).toBe(false);
  });

  it("shows nothing on an artist page and asks nothing", async () => {
    const { root, env } = await open({ tab: { tabId: 5, url: "https://genius.com/artists/Olivia-rodrigo" } });
    expect(asks(env.api.calls)).toEqual([]);
    expect(has(root, '[data-key="song-matches"]')).toBe(false);
  });
});

describe("Get credits from the album card", () => {
  it("runs the normal album read, and keeps the read from pasting into the album page", async () => {
    const { root, env, panel } = await open({
      api: { songMatches: () => Promise.resolve(ready()), detect: () => Promise.resolve({ ok: true, data: ALBUM }) },
    });
    $(root, 'button[data-key="match-apple"]').click();
    await flush();
    expect(env.api.calls).toContain(`detect:${APPLE_URL}:undefined`);
    // An album page has no edit form: each track is opened on Genius as usual, never "in place" on this page.
    expect(panel.state.geniusSource).toBeNull();
    expect(panel.state.session.screen).toBe("tracks");
  });

  it("reads a Spotify album the same way", async () => {
    const { root, env } = await open({
      api: { songMatches: () => Promise.resolve(ready()), detect: () => Promise.resolve({ ok: true, data: ALBUM }) },
    });
    $(root, 'button[data-key="match-spotify"]').click();
    await flush();
    expect(env.api.calls).toContain(`detect:${SPOTIFY_URL}:undefined`);
  });

  it("opens each track on Genius by a search, as for any album", async () => {
    const { root, env, panel } = await open({
      api: { songMatches: () => Promise.resolve(ready()), detect: () => Promise.resolve({ ok: true, data: ALBUM }) },
      settings: { onboarded: true, openOnGenius: true, findPagesOnGenius: true },
    });
    await panel.getCreditsFromGenius(APPLE_URL);
    await panel.setAllSelected(true);
    await panel.getCredits();
    await panel.showTrack(0);
    await flush();
    const button = [...root.querySelectorAll("button")].find((b) => b.textContent === "Open on Genius");
    expect(button).toBeDefined();
    button?.click();
    await flush();
    expect(env.api.calls).toContain("genius-open:Demo Artist|One");
  });
});

describe("with the automatic look-up off (the default), on an album page", () => {
  const manual = { onboarded: true };

  it("shows a button in album words and looks nothing up, opening no tab, until it is pressed", async () => {
    const { root, env } = await open({ settings: manual, api: { songMatches: () => Promise.resolve(ready()) } });
    expect(asks(env.api.calls)).toEqual([]);
    const card = $(root, '[data-key="song-matches"]');
    expect(card.textContent).toBe("Findthis album on Apple Music and Spotify");
    expect(card.querySelectorAll("p")).toHaveLength(0);
    const button = $(root, '[data-key="song-matches-find"]');
    expect(button.getAttribute("aria-label")).toBe(
      "Find this album on Apple Music and Spotify. Nothing is looked up until you press this button.",
    );
    expect(button.getAttribute("title")).toContain("Nothing is looked up");
    expect(has(root, 'button[data-key="match-apple"]')).toBe(false);
    button.click();
    await flush();
    expect(asks(env.api.calls)).toEqual(["song-matches:5"]);
    expect(has(root, 'button[data-key="match-apple"]')).toBe(true);
  });

  it("stays quiet through tab events", async () => {
    const { env, panel } = await open({ settings: manual });
    await panel.refreshPage();
    await panel.refreshPage();
    expect(asks(env.api.calls)).toEqual([]);
  });

  it("starts the look-up for the album page on screen when the setting is turned on", async () => {
    const { env, panel } = await open({ settings: manual, api: { songMatches: () => Promise.resolve(ready()) } });
    await panel.setSetting("findPagesOnGenius", true);
    await flush();
    expect(asks(env.api.calls)).toEqual(["song-matches:5"]);
  });

  it("keeps the song wording on a song page", async () => {
    const { root } = await open({
      settings: manual,
      tab: { tabId: 5, url: "https://genius.com/Taylor-swift-fortnight-lyrics" },
    });
    expect($(root, '[data-key="song-matches"]').textContent).toBe("Findthis song on Apple Music and Spotify");
  });
});

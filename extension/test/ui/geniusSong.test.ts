import { afterEach, describe, expect, it } from "vitest";
import type { Result, ServiceMatch, SongMatchesAnswer } from "../../src/shared/messages";
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, SINGLE, deferred, fakeEnv } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};
const has = (root: ParentNode, selector: string): boolean => root.querySelector(selector) !== null;

const GENIUS_TAB = { tabId: 5, url: "https://genius.com/Taylor-swift-fortnight-lyrics" };
const APPLE_URL = "https://music.apple.com/us/song/1736268216";
const SPOTIFY_URL = "https://open.spotify.com/track/1jX3nPWUbEQVGxMBb7NPXp";

const apple: ServiceMatch = {
  status: "found",
  url: APPLE_URL,
  name: "Taylor Swift - Fortnight (feat. Post Malone)",
  release: "THE TORTURED POETS DEPARTMENT",
  source: "genius",
};
const spotify: ServiceMatch = {
  status: "found",
  url: SPOTIFY_URL,
  name: "Taylor Swift, Post Malone - Fortnight (feat. Post Malone)",
  release: "THE TORTURED POETS DEPARTMENT",
  source: "search",
};
const ready = (a: ServiceMatch = apple, s: ServiceMatch = spotify): Result<SongMatchesAnswer> => ({
  ok: true,
  data: {
    status: "ready",
    path: "/Taylor-swift-fortnight-lyrics",
    title: "Fortnight",
    artists: ["Taylor Swift", "Post Malone"],
    apple: a,
    spotify: s,
  },
});

type Options = Parameters<typeof fakeEnv>[0];

async function open(options: Options = {}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv({ tab: GENIUS_TAB, ...options });
  const panel = await PanelController.create(env);
  new PanelView(root, panel);
  await flush();
  return { root, env, panel };
}

const asks = (calls: string[]): string[] => calls.filter((call) => call.startsWith("song-matches:"));

afterEach(() => {
  document.body.replaceChildren();
});

describe("the card on a Genius song page", () => {
  it("lists the song's Apple Music and Spotify pages, each with where it came from", async () => {
    const { root, env } = await open({ api: { songMatches: () => Promise.resolve(ready()) } });
    expect(asks(env.api.calls)).toEqual(["song-matches:5"]);
    const card = $(root, '[data-key="song-matches"]');
    expect(card.querySelector("h3")?.textContent).toBe("This song on Apple Music and Spotify");
    const rows = [...card.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows[0]).toContain("Taylor Swift - Fortnight (feat. Post Malone)");
    expect(rows[0]).toContain("Apple Music · THE TORTURED POETS DEPARTMENT · from Genius");
    expect(rows[1]).toContain("Spotify · THE TORTURED POETS DEPARTMENT · found by search");
    expect(card.textContent).toContain("Get credits");
  });

  it("says it is looking while the worker works", async () => {
    const answer = deferred<Result<SongMatchesAnswer>>();
    const { root } = await open({ api: { songMatches: () => answer.promise } });
    expect($(root, '[data-key="song-matches"] h3').textContent).toContain("Looking for this song");
    expect(has(root, '[data-key="match-apple"]')).toBe(false);
    answer.resolve(ready());
    await flush();
    expect($(root, '[data-key="song-matches"] h3').textContent).toBe("This song on Apple Music and Spotify");
  });

  it("says plainly when a service has no exact match, and when it could not be asked", async () => {
    const { root } = await open({
      api: {
        songMatches: () =>
          Promise.resolve(ready({ status: "none" }, { status: "failed", message: "Spotify could not be asked." })),
      },
    });
    expect($(root, '[data-key="match-apple"]').textContent).toContain("No exact match found");
    expect($(root, '[data-key="match-spotify"]').textContent).toContain("Could not look this up");
    // The Get credits buttons are for found pages only.
    expect(has(root, 'button[data-key="match-apple"]')).toBe(false);
    expect(has(root, '[data-key="song-matches-retry"]')).toBe(true);
  });

  it("shows a failed look-up with Try again, which asks again once and shows the answer", async () => {
    let attempt = 0;
    const { root, env } = await open({
      api: {
        songMatches: () =>
          Promise.resolve(
            attempt++ === 0
              ? { ok: false, error: { code: "timeout", message: "The Genius page did not finish loading." } }
              : ready(),
          ),
      },
    });
    expect($(root, '[data-key="song-matches"]').textContent).toContain("Could not look this up");
    expect($(root, '[data-key="song-matches"]').textContent).toContain("did not finish loading");
    $(root, '[data-key="song-matches-retry"]').click();
    await flush();
    expect(asks(env.api.calls)).toHaveLength(2);
    expect(has(root, 'button[data-key="match-apple"]')).toBe(true);
  });

  it("shows nothing on a Genius page that is not a song, and nothing on a music page", async () => {
    const notSong = await open({
      api: { songMatches: () => Promise.resolve({ ok: true, data: { status: "not-song" } }) },
    });
    expect(has(notSong.root, '[data-key="song-matches"]')).toBe(false);
    const album = await open({
      tab: { tabId: 5, url: "https://genius.com/albums/Taylor-swift/The-tortured-poets-department" },
    });
    expect(asks(album.env.api.calls)).toEqual([]);
    expect(has(album.root, '[data-key="song-matches"]')).toBe(false);
    const music = await open({ tab: { tabId: 6, url: "https://music.apple.com/us/album/demo/100" } });
    expect(asks(music.env.api.calls)).toEqual([]);
  });

  it("asks once per song page, however many tab events follow, and not again on coming back", async () => {
    const { env, panel } = await open({ api: { songMatches: () => Promise.resolve(ready()) } });
    await panel.refreshPage();
    await panel.refreshPage();
    await flush();
    expect(asks(env.api.calls)).toHaveLength(1);
    env.setTab({ tabId: 6, url: "https://example.com/" });
    await panel.refreshPage();
    await flush();
    expect(panel.state.geniusSong).toBeNull();
    env.setTab(GENIUS_TAB);
    await panel.refreshPage();
    await flush();
    expect(panel.state.geniusSong?.phase).toBe("ready");
    expect(asks(env.api.calls)).toHaveLength(1);
  });

  it("asks again for another song page", async () => {
    const { env, panel } = await open({ api: { songMatches: () => Promise.resolve(ready()) } });
    env.setTab({ tabId: 5, url: "https://genius.com/Olivia-rodrigo-good-4-u-lyrics" });
    await panel.refreshPage();
    await flush();
    expect(asks(env.api.calls)).toHaveLength(2);
  });

  it("does not draw an answer for a page the user has left", async () => {
    const answer = deferred<Result<SongMatchesAnswer>>();
    const { env, panel } = await open({ api: { songMatches: () => answer.promise } });
    env.setTab({ tabId: 6, url: "https://example.com/" });
    await panel.refreshPage();
    answer.resolve(ready());
    await flush();
    expect(panel.state.geniusSong).toBeNull();
  });
});

describe("Get credits from the card", () => {
  it("runs the normal read for that page and goes straight on for a single song", async () => {
    const { root, env, panel } = await open({
      api: { songMatches: () => Promise.resolve(ready()), detect: () => Promise.resolve({ ok: true, data: SINGLE }) },
    });
    $(root, 'button[data-key="match-apple"]').click();
    await flush();
    expect(env.api.calls).toContain(`detect:${APPLE_URL}:undefined`);
    expect(panel.state.session.screen).toBe("review");
    expect(panel.state.geniusSource).toEqual({ tabId: 5 });
  });

  it("keeps the paste on that Genius page: Open on Genius opens its form in place, with no search", async () => {
    const { root, env, panel } = await open({
      api: { songMatches: () => Promise.resolve(ready()), detect: () => Promise.resolve({ ok: true, data: ALBUM }) },
      settings: { onboarded: true, openOnGenius: true },
    });
    await panel.detect(SPOTIFY_URL, { tabId: 5 });
    await panel.setAllSelected(true);
    await panel.getCredits();
    await panel.showTrack(0);
    await flush();
    const button = [...root.querySelectorAll("button")].find((b) => b.textContent === "Open the edit form");
    expect(button?.getAttribute("aria-label")).toBe("Open the edit form on this Genius page");
    button?.click();
    await flush();
    expect(env.api.calls).toContain("genius-open:Demo Artist|One@5");
  });

  it("goes back to searching Genius for a read that did not start on a Genius page", async () => {
    const { root, env, panel } = await open({
      tab: null,
      api: { detect: () => Promise.resolve({ ok: true, data: ALBUM }) },
    });
    await panel.detect(ALBUM.url);
    await panel.setAllSelected(true);
    await panel.getCredits();
    await panel.showTrack(0);
    await flush();
    const button = [...root.querySelectorAll("button")].find((b) => b.textContent === "Open on Genius");
    button?.click();
    await flush();
    expect(env.api.calls).toContain("genius-open:Demo Artist|One");
  });

  it("forgets the Genius page when the user starts over", async () => {
    const { panel } = await open({
      api: { songMatches: () => Promise.resolve(ready()), detect: () => Promise.resolve({ ok: true, data: SINGLE }) },
    });
    await panel.getCreditsFromGenius(APPLE_URL);
    await panel.newAlbum();
    expect(panel.state.geniusSource).toBeNull();
  });
});

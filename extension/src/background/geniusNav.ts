// "Open on Genius": find the Genius song that is exactly this track and open its Edit Metadata form.
// It only ever opens a page and presses Edit Metadata. It never navigates a tab that is already open on another
// page (that tab may hold a form with unsaved work), never runs while a paste is active, and stops with an answer
// the user can read for no match, several matches, a signed-out Genius or a form that did not open.
import { geniusSongUrl, matchSong, type GeniusHit, type GeniusSong } from "../core/geniusMatch";
import { PASTE_KEY, normalisePaste } from "../core/paste";
import { isOpenEditState, isResult, type GeniusOpenAnswer, type GeniusSongLink } from "../shared/messages";
import type { Stores } from "../shared/storage";
import type { BrowserPorts } from "./ports";

export interface GeniusNavTiming {
  /** How long a new Genius tab may take to load. */
  loadMs: number;
  /** How long to keep asking a page that has not loaded its content script yet. */
  askMs: number;
  pollMs: number;
}

export const REAL_GENIUS_NAV_TIMING: GeniusNavTiming = { loadMs: 30_000, askMs: 20_000, pollMs: 250 };

/** Searches Genius for a track; null when Genius could not be asked. */
export type GeniusSearch = (title: string, artist: string) => Promise<GeniusHit[] | null>;

export interface GeniusNavigator {
  open(title: string, artist: string): Promise<GeniusOpenAnswer>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const link = (song: GeniusSong): GeniusSongLink => ({ title: song.title, artists: song.artists, url: song.url });

/** A tab's address without its query or fragment, for comparing it with a song page. */
function pageOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const { origin, pathname } = new URL(url);
  return geniusSongUrl(pathname) === null ? null : `${origin}${pathname}`;
}

export function createGeniusNavigator(
  ports: BrowserPorts,
  stores: Stores,
  search: GeniusSearch,
  timing: GeniusNavTiming = REAL_GENIUS_NAV_TIMING,
): GeniusNavigator {
  async function waitLoaded(tabId: number): Promise<boolean> {
    const deadline = Date.now() + timing.loadMs;
    while (Date.now() < deadline) {
      const tab = await ports.getTab(tabId);
      if (tab === null) return false;
      if (tab.status === "complete") return true;
      await sleep(timing.pollMs);
    }
    return false;
  }

  /** Ask the page to open its form, for as long as its content script is not there yet. */
  async function askToOpen(tabId: number): Promise<"opened" | "sign-in" | "no-form" | "failed"> {
    const deadline = Date.now() + timing.askMs;
    for (;;) {
      const reply = await ports.askGenius(tabId, { type: "genius/open-edit" });
      if (isResult(reply)) {
        const state = reply.ok && typeof reply.data === "object" && reply.data !== null ? reply.data : null;
        const value = state === null ? undefined : (state as Record<string, unknown>)["state"];
        if (!isOpenEditState(value)) return "failed";
        if (value === "no-button") return "sign-in";
        return value === "no-form" ? "no-form" : "opened";
      }
      if (Date.now() >= deadline) return "failed";
      await sleep(timing.pollMs);
    }
  }

  return {
    async open(title, artist) {
      const paste = normalisePaste(await stores.session.get(PASTE_KEY).catch(() => undefined));
      // A finished track is not a run in progress: the next song's page may be opened from the finished screen.
      if (paste.active && paste.position < paste.queue.length) return { status: "busy" };

      const hits = await search(title, artist).catch(() => null);
      if (hits === null) return { status: "failed" };
      const match = matchSong(title, artist, hits);
      if (match.kind === "none") return { status: "none" };
      if (match.kind === "several") return { status: "several", songs: match.songs.map(link) };

      const song = match.song;
      const tabs = await ports.geniusTabs().catch(() => []);
      const existing = tabs.find((tab) => pageOf(tab.url) === song.url);
      let tabId: number;
      try {
        if (existing) {
          tabId = existing.id;
          await ports.focusTab(tabId);
        } else {
          // A visible tab of its own: an open Genius tab is never navigated, and the user is meant to see this one.
          tabId = await ports.createTab(song.url, true);
          if (!(await waitLoaded(tabId))) return { status: "failed", song: link(song) };
        }
      } catch {
        return { status: "failed", song: link(song) };
      }
      return { status: await askToOpen(tabId), song: link(song) };
    },
  };
}

// The panel's list of a Genius song's pages on Apple Music and Spotify. When the user is on a Genius song page, the
// worker is asked (once per song page) which pages those are; the answer is kept for the session, so coming back to
// the page, or a flurry of tab events, asks nothing more. A failed look-up is not retried by itself: the card offers
// "Try again". Nothing is read from the pages listed: the user presses Get credits for that.
import { GENIUS_ORIGIN, geniusSongUrl } from "../core/geniusMatch";
import type { ActiveTab } from "./panelState";
import type { PanelHost } from "./panelHost";
import type { GeniusSongState } from "./panelState";

/** The song page a tab shows (without query or fragment), or null when it cannot be one: only a quick address check. */
export function geniusSongPage(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const { origin, pathname } = new URL(url);
  // Every song page is "/Artist-title-lyrics"; the page itself is what decides, but this keeps the worker from being
  // asked about the home page, an artist page or an album on every tab change.
  if (origin !== GENIUS_ORIGIN || !pathname.endsWith("-lyrics") || geniusSongUrl(pathname) === null) return null;
  return `${origin}${pathname}`;
}

export class GeniusSongMatches {
  /** Answers kept for the session, by song page: a song is looked up once. */
  private readonly known = new Map<string, GeniusSongState>();
  /** The song page last answered "not a song": not asked about again while the user stays on it. */
  private notSong: string | null = null;
  /** Bumped by every new question, so an answer for a page the user has left is not drawn. */
  private attempt = 0;

  constructor(private readonly host: PanelHost) {}

  /** Look at the page the user is on: a Genius song page gets its card, any other page none. */
  async refresh(tab: ActiveTab | null): Promise<void> {
    const key = tab ? geniusSongPage(tab.url) : null;
    if (key !== this.notSong) this.notSong = null;
    if (!tab || key === null) {
      if (this.host.state.geniusSong !== null) {
        this.attempt++;
        this.host.update({ geniusSong: null });
      }
      return;
    }
    // A page that said "not a song" is left alone until the user goes to another address; a tab event (a Spotify tab
    // changing its title) must not make the card flash and vanish again and again.
    if (key === this.notSong) return;
    const shown = this.host.state.geniusSong;
    if (shown?.key === key && shown.phase !== "failed") {
      // The same page (another tab event, or the page in another tab): keep the answer, follow the tab.
      if (shown.tabId !== tab.tabId) this.host.update({ geniusSong: { ...shown, tabId: tab.tabId } });
      return;
    }
    if (shown?.key === key) return; // a failed look-up waits for the user's "Try again"
    const kept = this.known.get(key);
    if (kept) {
      this.host.update({ geniusSong: { ...kept, tabId: tab.tabId } });
      return;
    }
    await this.ask(key, tab.tabId);
  }

  /** Ask again for the page on screen after a failed look-up. */
  async retry(): Promise<void> {
    const shown = this.host.state.geniusSong;
    if (!shown || shown.phase === "loading") return;
    this.known.delete(shown.key);
    await this.ask(shown.key, shown.tabId);
  }

  private async ask(key: string, tabId: number): Promise<void> {
    const mine = ++this.attempt;
    this.host.update({
      geniusSong: { key, tabId, phase: "loading", title: "", artists: [], apple: null, spotify: null, message: "" },
    });
    const answer = await this.host.env.api.songMatches(tabId);
    if (mine !== this.attempt) return; // the user moved to another page meanwhile
    if (!answer.ok) {
      this.host.update({
        geniusSong: {
          key,
          tabId,
          phase: "failed",
          title: "",
          artists: [],
          apple: null,
          spotify: null,
          message: answer.error.message,
        },
      });
      return;
    }
    if (answer.data.status === "not-song") {
      // Remembered only while the user stays on this address: another visit (or a reload) looks again.
      this.notSong = key;
      this.host.update({ geniusSong: null });
      return;
    }
    const { title, artists, apple, spotify } = answer.data;
    const ready: GeniusSongState = { key, tabId, phase: "ready", title, artists, apple, spotify, message: "" };
    // A half that failed is asked again by "Try again", so only a complete answer is kept.
    if (apple.status !== "failed" && spotify.status !== "failed") this.known.set(key, ready);
    this.host.update({ geniusSong: ready });
  }
}

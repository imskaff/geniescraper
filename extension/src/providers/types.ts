// The seam between the extension and the music sites it reads credits from. Everything outside src/providers/
// and a provider's own in-page folder talks to this interface and never names a site. See docs/provider-interface.md.
import type { ClientTiming } from "../background/providerClient";

/** Stable id of a source; also the prefix of its content-script requests (`apple/detect`). */
export type SourceId = string;

/** What a recognised page is: one track ("song", whatever the site calls it) or a whole album. */
export type PageKind = "album" | "song";

export interface MusicUrl {
  kind: PageKind;
  /** Storefront or market in the address, "" when the site has none. */
  region: string;
}

/** The wording of failures that name the site; the codes they travel with are shared. */
export interface ProviderMessages {
  notAlbumOrSong: string;
  notSong: string;
  tabNotShowing: string;
  slowResponse: string;
}

export interface CreditsProvider {
  readonly id: SourceId;
  /** Shown in the UI and in errors: "Apple Music". */
  readonly label: string;
  /** Match patterns of the hosts the provider reads; the tab query and the manifest check use them. */
  readonly origins: readonly string[];
  /** Whether the manifest lists the origins as required or optional host permissions. */
  readonly permission: "required" | "optional";
  /** Content script bundle that answers this provider's requests, relative to dist. */
  readonly contentScript: string;
  /** Whether a minimized background window can run the in-page reader. */
  readonly worksHidden: boolean;
  /**
   * Set for a site that is read politely: at least this many milliseconds between the starts of two page loads, and no
   * reading at all for a while after the site asked for a captcha. Absent for a site that tolerates parallel reads.
   */
  readonly readGapMs?: number;
  /** For a polite site: how many pages may load at once while it behaves (1 when absent). One failure drops it to 1. */
  readonly readConcurrency?: number;
  /**
   * True when the browser tab's title is not the page's own (Spotify rewrites it to the song that is playing). The
   * open-pages list then names such a tab only from `OpenTab.pageTitle`, which the panel reads from the page itself,
   * and never from the tab title.
   */
  readonly liveTitle?: boolean;
  /**
   * For a `liveTitle` provider: whether a tab title is certainly the page's own and not a rewritten one. Used only when
   * the page's heading could not be read. Spotify's own titles end with "| Spotify"; a playing song's does not.
   */
  isOwnTitle?(title: string): boolean;
  /** Overrides of the shared waits, for a site that needs longer. */
  readonly timing?: Partial<ClientTiming>;
  readonly messages: ProviderMessages;
  /** Strict address check; null for anything that is not an album or song page of this site. */
  parseUrl(url: string): MusicUrl | null;
  /** What names the page in an address: two addresses with the same key are one page (the open-pages list merges them). */
  pageKey(url: string): string;
  /** The address to open in a background tab for a recognised `url`: a provider may drop a locale prefix or tracking. */
  openUrl(url: string): string;
  /** Name for the open-pages list; `title` has its invisible marks and extra spaces removed already. */
  tabName(title: string, url: string, kind: PageKind): string;
  /** Genius role name for a raw role label as this site shows it. */
  normaliseRole(raw: string): string;
}

// The worker's cover lookups behind an interface, so the router can be tested without the network.
import { fetchJson } from "../lookups/http";
import { lookupCover, searchCover, type GetJson } from "../lookups/itunes";

export interface CoverService {
  /** Artwork of exactly this Apple Music album or song, by catalog id; "" when none. */
  exact(appleMusicUrl: string): Promise<string>;
  /** Cover of this track found by a title search; "" when nothing is the same track. */
  search(title: string, artist: string): Promise<string>;
}

export function realCovers(getJson: GetJson = fetchJson): CoverService {
  return {
    exact: (url) => lookupCover(getJson, url),
    search: (title, artist) => searchCover(getJson, title, artist),
  };
}

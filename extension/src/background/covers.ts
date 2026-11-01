// The worker's cover lookups behind an interface, so the router can be tested without the network.
import { deezerCover } from "../lookups/deezer";
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
    // Apple's own catalog first, being the same catalog as Apple Music, then Deezer, as in the desktop app. Deezer
    // answers "" at once, without a request, unless the user has granted its permission.
    async search(title, artist) {
      return (await searchCover(getJson, title, artist)) || (await deezerCover(getJson, title, artist));
    },
  };
}

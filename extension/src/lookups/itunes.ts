// Exact cover art from Apple's own catalog, ported from scraper.deezer (the iTunes parts) and scraper.pipeline.
// Everything here is best-effort: a failed lookup gives "" and never breaks a read. The only host contacted is
// itunes.apple.com, and an artwork URL is accepted only when it points at Apple's image CDN over https.
import { coreTitleWords, words } from "../core/text";

/** Fetch a URL as JSON; resolves null on any failure (network, status, not JSON). Never throws. */
export type GetJson = (url: string) => Promise<unknown>;

const CATALOG_URL = /music\.apple\.com\/([a-z]{2})\/(?:album|song)\/(?:[^/?#]+\/)?(\d+)/;
const TRACK_PARAM = /[?&]i=(\d+)/;
const LOOKUP_URL = "https://itunes.apple.com/lookup";
const SEARCH_URL = "https://itunes.apple.com/search";

/**
 * (storefront, catalog id) of an Apple Music album or song URL, or null.
 * An album URL carrying `?i=<track id>` resolves to that track, so the artwork is that track's edition.
 */
export function catalogRef(url: string): [storefront: string, id: string] | null {
  const match = CATALOG_URL.exec(url);
  const storefront = match?.[1];
  const id = match?.[2];
  if (!storefront || !id) return null;
  return [storefront, TRACK_PARAM.exec(url)?.[1] ?? id];
}

/** Rewrite an iTunes artwork URL to its 1000x1000 PNG variant. */
export function itunesPng(artworkUrl: string): string {
  return artworkUrl.replace(/\d+x\d+bb\.\w+$/, "1000x1000bb.png");
}

/** True for an https URL on Apple's image CDN; anything else in a response is not artwork we will use. */
export function isAppleArtwork(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { protocol, hostname } = new URL(url);
  return protocol === "https:" && (hostname === "mzstatic.com" || hostname.endsWith(".mzstatic.com"));
}

/**
 * True when a search hit is this track by this artist, ignoring feat. parts and accents.
 * A title search returns other songs by the artist too ("Kill Bill" for "SOS"), whose artwork is another release.
 */
export function sameTrack(resultTitle: string, resultArtist: string, title: string, artist: string): boolean {
  const core = coreTitleWords(title);
  const resultCore = coreTitleWords(resultTitle);
  if (core.length !== resultCore.length || !core.every((word, i) => word === resultCore[i])) return false;
  const wanted = words(artist).filter((word) => word.length >= 3);
  const found = new Set(words(resultArtist));
  return wanted.length === 0 || wanted.some((word) => found.has(word));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function results(data: unknown): Record<string, unknown>[] {
  const list = isRecord(data) ? data["results"] : undefined;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

/** The first 1000x1000 PNG artwork URL in an iTunes response that names a usable `artworkUrl100`, or "". */
function firstArtwork(entries: Record<string, unknown>[]): string {
  for (const entry of entries) {
    const art = entry["artworkUrl100"];
    if (typeof art !== "string" || !art) continue;
    const png = itunesPng(art);
    if (isAppleArtwork(png)) return png;
  }
  return "";
}

/** Artwork of the exact album or song in an Apple Music URL, looked up by catalog id; "" when none. */
export async function lookupCover(getJson: GetJson, appleMusicUrl: string): Promise<string> {
  const ref = catalogRef(appleMusicUrl);
  if (!ref) return "";
  const url = new URL(LOOKUP_URL);
  url.searchParams.set("id", ref[1]);
  url.searchParams.set("country", ref[0]);
  return firstArtwork(results(await getJson(url.href)));
}

/** Cover of this track found by a title search in the same catalog; "" when no hit is the same track. */
export async function searchCover(getJson: GetJson, title: string, artist: string): Promise<string> {
  if (!title || !artist) return "";
  const url = new URL(SEARCH_URL);
  url.searchParams.set("term", `${artist} ${title}`);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "10");
  const hits = results(await getJson(url.href)).filter((hit) => {
    const hitTitle = hit["trackName"];
    const hitArtist = hit["artistName"];
    return (
      typeof hitTitle === "string" && typeof hitArtist === "string" && sameTrack(hitTitle, hitArtist, title, artist)
    );
  });
  return firstArtwork(hits);
}

/**
 * Best-effort 1000x1000 PNG cover for an album or track, or "" when no source has one.
 * The lookup by catalog id returns the artwork of exactly the release the user opened; only without it does the
 * title search run, since a search can return another edition of the same song.
 */
export async function fetchCover(
  getJson: GetJson,
  appleMusicUrl: string,
  title: string,
  artist: string,
): Promise<string> {
  return (await lookupCover(getJson, appleMusicUrl)) || (await searchCover(getJson, title, artist));
}

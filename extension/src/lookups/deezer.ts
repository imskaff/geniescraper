// Cover art from Deezer's search, ported from scraper.deezer.fetch_cover_url. It is the fallback behind Apple's own
// catalog, reached only when the user has granted the optional api.deezer.com permission. Best-effort: "" on any
// problem. A cover link is accepted only over https from Deezer's image CDN.
import { sameTrack, type GetJson } from "./itunes";

const SEARCH_URL = "https://api.deezer.com/search";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** True for an https URL on Deezer's image CDN (dzcdn.net); anything else in a response is not artwork we will use. */
export function isDeezerArtwork(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { protocol, hostname } = new URL(url);
  return protocol === "https:" && (hostname === "dzcdn.net" || hostname.endsWith(".dzcdn.net"));
}

/** Deezer's CDN serves PNG when the file extension is changed. */
export function deezerPng(coverUrl: string): string {
  return coverUrl.replace(/\.\w+$/, ".png");
}

/** Cover of this track found on Deezer, as a PNG link; "" when no hit is the same track or none has a usable cover. */
export async function deezerCover(getJson: GetJson, title: string, artist: string): Promise<string> {
  if (!title || !artist) return "";
  const url = new URL(SEARCH_URL);
  // Deezer's field syntax returns nothing for combined fields, so search plainly and check each hit.
  url.searchParams.set("q", `${artist} ${title}`);
  url.searchParams.set("limit", "10");
  const data = await getJson(url.href);
  const hits = isRecord(data) && Array.isArray(data["data"]) ? data["data"].filter(isRecord) : [];
  for (const hit of hits) {
    const hitTitle = hit["title"];
    const hitArtist = isRecord(hit["artist"]) ? hit["artist"]["name"] : undefined;
    if (typeof hitTitle !== "string" || typeof hitArtist !== "string") continue;
    if (!sameTrack(hitTitle, hitArtist, title, artist)) continue;
    const cover = isRecord(hit["album"]) ? hit["album"]["cover_xl"] : undefined;
    if (typeof cover !== "string" || !cover) continue;
    const png = deezerPng(cover);
    if (isDeezerArtwork(png)) return png;
  }
  return "";
}

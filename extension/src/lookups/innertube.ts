// YouTube's own JSON endpoints, the ones its website asks for search and for a video's details. They answer in the
// shape of the page data the lookup already scores (videoRenderer, ownerBadges, videoDetails), at a third of the
// size of the HTML page, and unlike the HTML page they were not refused after a few requests in testing.
// Unofficial: the endpoint and the client version it expects can change, so the caller falls back to the HTML
// pages when this gives nothing.
import type { PostJson } from "./http";
import type { YoutubePages } from "./youtube";

const BASE = "https://www.youtube.com/youtubei/v1";

/** The web client's identity. A version that is too old is eventually refused, which the fallback covers. */
const CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20250101.00.00", hl: "en", gl: "US" } } as const;

export function innertubePages(post: PostJson): YoutubePages {
  return {
    search: (query) => post(`${BASE}/search?prettyPrint=false`, { context: CONTEXT, query }),
    watch: (videoId) => post(`${BASE}/player?prettyPrint=false`, { context: CONTEXT, videoId }),
  };
}

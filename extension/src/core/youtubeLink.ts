// A YouTube link the user pasted, reduced to the one form the paste queue uses. Anything that is not a link to a
// single YouTube video gives null, so the queue can never receive another site's address or a markup-looking string.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS: ReadonlySet<string> = new Set(["www.youtube.com", "youtube.com", "m.youtube.com", "music.youtube.com"]);

/** The canonical https link of the video in `raw`, or null when it is not a link to one YouTube video. */
export function parseYoutubeLink(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 300) return null;
  // A link pasted without its scheme ("youtu.be/abc...") still counts.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  if (!URL.canParse(candidate)) return null;
  const url = new URL(candidate);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") id = parts[1] ?? null;
  }
  return id !== null && VIDEO_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** Where to look for a song on YouTube: a results page the user reads and chooses from, nothing is fetched. */
export function youtubeSearchUrl(title: string, artist: string): string {
  const query = `${artist} ${title} official music video`.replace(/\s+/g, " ").trim();
  return `https://www.youtube.com/results?${new URLSearchParams({ search_query: query }).toString()}`;
}

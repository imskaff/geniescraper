// The worker's YouTube lookup behind an interface, so the router can be tested without the network.
import { fetchText, type GetText } from "../lookups/http";
import { extractVar, findYoutube, type YoutubeLink, type YoutubePages } from "../lookups/youtube";
import { Limiter } from "./serial";

export interface YoutubeService {
  /** The link for this song, or an empty link when none is found or YouTube may not be contacted. */
  find(title: string, artist: string): Promise<YoutubeLink>;
}

export const NO_YOUTUBE: YoutubeService = { find: () => Promise.resolve({ url: "", isMusicVideo: false }) };

/** Requests to YouTube in flight at once, across every track being read: the desktop app's three, not three per track. */
export const MAX_YOUTUBE_REQUESTS = 3;

/** The pages of YouTube, read as text and parsed, every request going through one shared limit. */
export function youtubePages(getText: GetText, limit: Limiter): YoutubePages {
  const page = (url: string, name: string): Promise<unknown> =>
    limit.run(async () => {
      const html = await getText(url);
      return html === null ? null : extractVar(html, name);
    });
  return {
    search: (query) =>
      page(
        `https://www.youtube.com/results?${new URLSearchParams({ search_query: query }).toString()}`,
        "ytInitialData",
      ),
    watch: (id) =>
      page(`https://www.youtube.com/watch?${new URLSearchParams({ v: id }).toString()}`, "ytInitialPlayerResponse"),
  };
}

export function realYoutube(getText: GetText = fetchText): YoutubeService {
  const pages = youtubePages(getText, new Limiter(MAX_YOUTUBE_REQUESTS));
  return { find: (title, artist) => findYoutube(pages, title, artist) };
}

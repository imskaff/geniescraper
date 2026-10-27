// Find a song's YouTube link, ported from scraper.youtube. The scoring and the order of the phases are the desktop
// app's, so the two pick the same video; the page access is behind `YoutubePages`, so everything here runs offline
// against saved pages. Best-effort: every failure gives no link and never breaks a read.
import { coreTitleWords, words } from "../core/text";

/** What the lookup needs from YouTube: the parsed data of a results page and of a watch page, or null. */
export interface YoutubePages {
  /** `ytInitialData` of the search-results page for a query. */
  search(query: string): Promise<unknown>;
  /** `ytInitialPlayerResponse` of a video's watch page. */
  watch(videoId: string): Promise<unknown>;
}

export interface YoutubeLink {
  url: string;
  isMusicVideo: boolean;
}

const NONE: YoutubeLink = { url: "", isMusicVideo: false };

const MV_KEYWORDS = ["official music video", "official video", "music video", "official visual"];
const SKIP_KEYWORDS = [
  "lyrics",
  "lyric",
  "audio only",
  "cover by",
  "reaction",
  "reacts",
  "remix",
  "parody",
  "live",
  "performance",
  "interview",
  "behind the scenes",
  "dance practice",
  "choreography",
  "teaser",
  "trailer",
];
const AUDIO_INDICATORS = ["official audio", "(audio)", "audio only", "audio stream"];

const MV_CREW_KEYWORDS = [
  "directed by",
  "director:",
  "director,",
  "d.p.",
  "dp:",
  "dop:",
  "cinematography by",
  "cinematographer",
  "shot by",
  "filmed by",
  "edited by",
  "editor:",
  "color by",
  "colorist",
  "visual director",
  "creative director",
  "production company",
];
const MV_DESC_INDICATORS = [
  "music video",
  "official video",
  "official music video",
  "official visual",
  "visual video",
  "watch the video",
  "stream & watch",
  "listen & watch",
];

// ── helpers ───────────────────────────────────────────────────────────────────

/** Python's \W: anything that is not a letter, digit or underscore, in any script. */
const NON_WORD = /[^\p{L}\p{N}_]+/u;

/** True if a significant word (3+ chars) of the song title is in the video title, or its collapsed form is. */
export function sigPresent(videoTitle: string, songTitle: string): boolean {
  const t = videoTitle.toLowerCase();
  const sig = songTitle
    .toLowerCase()
    .split(NON_WORD)
    .filter((w) => w.length >= 3);
  if (sig.length > 0) return sig.some((w) => t.includes(w));
  // "FE!N" collapses to "fen", checked against the collapsed video title.
  const collapse = (text: string): string => text.replace(/[^a-z0-9]/g, "");
  const ct = collapse(songTitle.toLowerCase());
  return ct !== "" && collapse(t).includes(ct);
}

/** Words a plain upload may add around "Artist - Song" without making it a different video. */
const PLAIN_TITLE_FILLER = new Set([
  "official",
  "audio",
  "video",
  "music",
  "visualizer",
  "visualiser",
  "explicit",
  "clean",
  "hd",
  "hq",
  "4k",
  "feat",
  "ft",
  "featuring",
  "with",
  "x",
  "and",
  "vevo",
  "topic",
]);

/** True when the video title is just this song, as a plain upload titles it; any extra word rejects it. */
export function titleMatchesSong(videoTitle: string, songTitle: string, artist: string): boolean {
  const core = coreTitleWords(songTitle);
  if (core.length === 0) return false;
  const title = words(videoTitle);
  const allowed = new Set([...words(songTitle), ...words(artist), ...PLAIN_TITLE_FILLER]);
  const present = new Set(title);
  return core.every((w) => present.has(w)) && title.every((w) => allowed.has(w));
}

const COLLAB_SEP = /\s*[&,]\s*|\s+(?:ft\.?|feat\.?|and|x)\s+/i;

export function isArtistChannel(channel: string, artist: string): boolean {
  const ch = channel.toLowerCase();
  const isVevo = ch.includes("vevo");
  const chNospace = ch.replaceAll(" ", "");

  const oneMatches = (a: string): boolean => {
    const aNospace = a.replaceAll(" ", "");
    const vevoOk = isVevo && aNospace.length >= 3 && chNospace.includes(aNospace);
    // 6+ chars for "channel inside artist", so short generic names do not false-match.
    return ch.includes(a) || (ch.length >= 6 && a.includes(ch)) || vevoOk;
  };

  const ar = artist.toLowerCase();
  if (oneMatches(ar)) return true;
  // For a collaboration ("Drake & Central Cee") a channel owned by any one of them qualifies.
  return ar.split(COLLAB_SEP).some((part) => {
    const trimmed = part.trim();
    return trimmed.length >= 3 && oneMatches(trimmed);
  });
}

/** True if the full artist credit, or one collaborator (3+ chars), appears as whole words in the text. */
export function namesArtist(text: string, artist: string): boolean {
  const haystack = ` ${words(text).join(" ")} `;
  return [artist, ...artist.split(COLLAB_SEP)]
    .filter((n) => n.trim() !== "")
    .map((n) => words(n).join(" "))
    .some((name) => name.length >= 3 && haystack.includes(` ${name} `));
}

/** True for the auto-generated "Artist - Topic" upload; the "Provided to YouTube by" text counts only on a trusted channel. */
function isTopicUpload(channel: string, snippet: string, artist: string, trustedChannel: boolean): boolean {
  if (channel.toLowerCase().includes("- topic")) return true;
  return trustedChannel && snippet.toLowerCase().startsWith("provided to youtube by") && namesArtist(snippet, artist);
}

// ── per-phase scorers ─────────────────────────────────────────────────────────

/**
 * Phase 1, the canonical song upload: 2 for a Topic upload, 1 for the artist's own channel with a plain title,
 * -1 to skip. `officialArtist` is YouTube's Official Artist Channel badge, which identifies the artist's channel
 * when its name differs from the credit, provided the video title names the artist.
 */
export function scoreAudio(
  videoTitle: string,
  channel: string,
  artist: string,
  songTitle: string,
  officialArtist = false,
  snippet = "",
): number {
  const t = videoTitle.toLowerCase();
  if (SKIP_KEYWORDS.some((kw) => t.includes(kw))) return -1;
  // Explicit music videos belong to phase 2.
  if (MV_KEYWORDS.some((kw) => t.includes(kw))) return -1;
  if (!sigPresent(videoTitle, songTitle)) return -1;

  const artistCh = isArtistChannel(channel, artist);
  if (isTopicUpload(channel, snippet, artist, artistCh || officialArtist)) {
    return titleMatchesSong(videoTitle, songTitle, artist) ? 2 : -1;
  }
  if (artistCh || (officialArtist && namesArtist(videoTitle, artist))) {
    return titleMatchesSong(videoTitle, songTitle, artist) ? 1 : -1;
  }
  return -1;
}

/**
 * Phase 2, the official music video: 3 for the artist's (or VEVO) channel with an MV signal in the title, 2 for a
 * verified label channel (provisional, needs crew credits), 1 for the artist's channel with a plain title
 * (provisional, needs the description), -1 to skip.
 */
export function scoreMv(
  videoTitle: string,
  channel: string,
  artist: string,
  songTitle: string,
  verified = false,
): number {
  const t = videoTitle.toLowerCase();
  if (SKIP_KEYWORDS.some((kw) => t.includes(kw))) return -1;
  if (!sigPresent(videoTitle, songTitle)) return -1;

  const artistCh = isArtistChannel(channel, artist);
  const isVevo = channel.toLowerCase().includes("vevo");
  const hasMvKw = MV_KEYWORDS.some((kw) => t.includes(kw)) || /\bm\/?v\b/.test(t);

  // The artist's own channel is required: "VEVO" alone is not enough, reupload channels use it too.
  if (!artistCh) {
    // Some official videos live on a verified label channel; only a crew credit in the description makes it count.
    return verified && hasMvKw && namesArtist(videoTitle, artist) ? 2 : -1;
  }
  const isOfficial = t.includes("official") && !AUDIO_INDICATORS.some((kw) => t.includes(kw));
  if (hasMvKw || isVevo || isOfficial) return 3;
  // Plain title on the artist's channel: provisional, and only the song itself qualifies.
  return titleMatchesSong(videoTitle, songTitle, artist) ? 1 : -1;
}

// ── page parsing ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text of the JSON value (an object) that starts at `start`, found by matching braces outside strings; or "". */
function jsonObjectAt(text: string, start: number): string {
  if (text[start] !== "{") return "";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return "";
}

/** The JSON object assigned to `var <name> = ` in a page's HTML, or null. */
export function extractVar(html: string, name: string): unknown {
  const match = new RegExp(`var ${name}\\s*=\\s*`).exec(html);
  if (!match) return null;
  const json = jsonObjectAt(html, match.index + match[0].length);
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/** A YouTube video id. Anything else in a page is not used to build a link, however it got there. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

interface Video {
  id: string;
  title: string;
  channel: string;
  /** The Official Artist Channel badge. */
  officialArtist: boolean;
  /** A plain verified checkmark (labels, media companies). */
  verified: boolean;
  /** The description excerpt shown under the result. */
  snippet: string;
}

function firstRun(node: unknown): string {
  const runs = isRecord(node) ? node["runs"] : undefined;
  const first: unknown = Array.isArray(runs) ? runs[0] : undefined;
  const text = isRecord(first) ? first["text"] : undefined;
  return typeof text === "string" ? text : "";
}

/** The videos of a search-results page, in result order. */
export function listVideos(data: unknown): Video[] {
  const sections = [data]
    .flatMap((d) => (isRecord(d) ? [d["contents"]] : []))
    .flatMap((c) => (isRecord(c) ? [c["twoColumnSearchResultsRenderer"]] : []))
    .flatMap((c) => (isRecord(c) ? [c["primaryContents"]] : []))
    .flatMap((c) => (isRecord(c) ? [c["sectionListRenderer"]] : []))
    .flatMap((c) => (isRecord(c) ? [c["contents"]] : []))
    .flatMap((c) => (Array.isArray(c) ? (c as unknown[]) : []));
  const videos: Video[] = [];
  for (const section of sections) {
    const items =
      isRecord(section) && isRecord(section["itemSectionRenderer"]) ? section["itemSectionRenderer"]["contents"] : [];
    for (const item of Array.isArray(items) ? (items as unknown[]) : []) {
      const vr = isRecord(item) ? item["videoRenderer"] : undefined;
      if (!isRecord(vr) || typeof vr["videoId"] !== "string" || !VIDEO_ID.test(vr["videoId"])) continue;
      const badges = Array.isArray(vr["ownerBadges"]) ? (vr["ownerBadges"] as unknown[]) : [];
      const styles = new Set(
        badges.map((b) => {
          const renderer = isRecord(b) ? b["metadataBadgeRenderer"] : undefined;
          const style = isRecord(renderer) ? renderer["style"] : undefined;
          return typeof style === "string" ? style : "";
        }),
      );
      const metadata = Array.isArray(vr["detailedMetadataSnippets"])
        ? (vr["detailedMetadataSnippets"] as unknown[])
        : [];
      const snippetNode = isRecord(metadata[0]) ? metadata[0]["snippetText"] : undefined;
      const snippetRuns =
        isRecord(snippetNode) && Array.isArray(snippetNode["runs"]) ? (snippetNode["runs"] as unknown[]) : [];
      videos.push({
        id: vr["videoId"],
        title: firstRun(vr["title"]),
        channel: firstRun(vr["ownerText"]),
        officialArtist: styles.has("BADGE_STYLE_TYPE_VERIFIED_ARTIST"),
        verified: styles.has("BADGE_STYLE_TYPE_VERIFIED"),
        snippet: snippetRuns.map((r) => (isRecord(r) && typeof r["text"] === "string" ? r["text"] : "")).join(""),
      });
    }
  }
  return videos;
}

/** The video's description from a player response, or "". */
export function descriptionOf(player: unknown): string {
  const details = isRecord(player) ? player["videoDetails"] : undefined;
  const text = isRecord(details) ? details["shortDescription"] : undefined;
  return typeof text === "string" ? text : "";
}

// ── the lookup ────────────────────────────────────────────────────────────────

/** Phase 1 search queries, most targeted first. */
export const audioQueries = (title: string, artist: string): string[] => [
  `"${title}" "${artist} - Topic"`,
  `"${artist}" "${title}"`,
  `${artist} ${title}`,
];

/** Phase 2 search queries, most targeted first. */
export const mvQueries = (title: string, artist: string): string[] => [
  `"${artist}" "${title}" official music video`,
  `${artist} ${title} official music video`,
];

type Candidate = [score: number, rank: number, url: string];

const watchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;
const videoId = (url: string): string => url.split("=").pop() ?? "";

async function top10(pages: YoutubePages, query: string): Promise<Video[]> {
  return listVideos(await pages.search(query)).slice(0, 10);
}

/** Phase 1: the canonical audio, from a Topic channel or the artist's own channel. */
async function audioPhase(pages: YoutubePages, title: string, artist: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const query of audioQueries(title, artist)) {
    for (const [rank, video] of (await top10(pages, query)).entries()) {
      if (seen.has(video.id)) continue;
      seen.add(video.id);
      const score = scoreAudio(video.title, video.channel, artist, title, video.officialArtist, video.snippet);
      if (score > 0) candidates.push([score, rank, watchUrl(video.id)]);
    }
    // A Topic upload is definitive: skip the remaining queries.
    if (candidates.some(([s]) => s >= 2)) break;
  }
  return candidates;
}

/** Phase 2: the music video, as (confirmed, provisional, label-channel) candidates. */
async function mvPhase(
  pages: YoutubePages,
  title: string,
  artist: string,
): Promise<[Candidate[], Candidate[], Candidate[]]> {
  const confirmed: Candidate[] = [];
  const provisional: Candidate[] = [];
  const label: Candidate[] = [];
  // Its own seen-set, so phase 1's rejects (MV-keyword videos) can still be scored here.
  const seen = new Set<string>();
  for (const query of mvQueries(title, artist)) {
    for (const [rank, video] of (await top10(pages, query)).entries()) {
      if (seen.has(video.id)) continue;
      seen.add(video.id);
      const score = scoreMv(video.title, video.channel, artist, title, video.verified);
      const entry: Candidate = [score, rank, watchUrl(video.id)];
      if (score === 3) confirmed.push(entry);
      else if (score === 2) label.push(entry);
      else if (score === 1) provisional.push(entry);
    }
    if (confirmed.length > 0) break;
  }
  return [confirmed, provisional, label];
}

/** Crew keywords (+2) outweigh generic music-video words (+1); 0 when neither appears. */
export function descriptionBonus(description: string): number {
  if (MV_CREW_KEYWORDS.some((kw) => description.includes(kw))) return 2;
  if (MV_DESC_INDICATORS.some((kw) => description.includes(kw))) return 1;
  return 0;
}

const byScoreThenRank = (a: Candidate, b: Candidate): number => b[0] - a[0] || a[1] - b[1];

/**
 * The link for a song: the official music video when phase 2 finds one, otherwise the canonical audio, otherwise
 * nothing. Phase 1 and 2 run together, then the descriptions that need confirming are read together.
 */
export async function findYoutube(pages: YoutubePages, title: string, artist: string): Promise<YoutubeLink> {
  if (!title || !artist) return NONE;
  try {
    const [audio, [mv, provisional, label]] = await Promise.all([
      audioPhase(pages, title, artist),
      mvPhase(pages, title, artist),
    ]);

    // Every description the checks below may read, each fetched once.
    const mvIds = new Set(mv.map(([, , u]) => videoId(u)));
    const wanted = [
      ...mv.slice(0, 3).map(([, , u]) => videoId(u)),
      ...provisional
        .slice(0, 3)
        .map(([, , u]) => videoId(u))
        .filter((id) => !mvIds.has(id)),
      ...label.slice(0, 2).map(([, , u]) => videoId(u)),
      ...audio
        .slice(0, 5)
        .filter(([s, , u]) => s === 1 && !mvIds.has(videoId(u)))
        .map(([, , u]) => videoId(u)),
    ];
    const unique = [...new Set(wanted)];
    const texts = await Promise.all(unique.map(async (id) => descriptionOf(await pages.watch(id)).toLowerCase()));
    const descriptions = new Map(unique.map((id, i) => [id, texts[i] ?? ""]));
    const described = (url: string): string => descriptions.get(videoId(url)) ?? "";

    // The top 3 MV candidates get a bonus when the description confirms a real music video.
    for (const [i, [score, rank, url]] of mv.slice(0, 3).entries())
      mv[i] = [score + descriptionBonus(described(url)), rank, url];

    // Artist-channel videos with plain titles count only when the description confirms a music video.
    for (const [score, rank, url] of provisional.slice(0, 3)) {
      if (mvIds.has(videoId(url))) continue;
      const bonus = descriptionBonus(described(url));
      if (bonus) mv.push([score + bonus, rank, url]);
    }

    // Verified label-channel videos need a crew credit; they stay at 2 so a confirmed artist-channel video wins.
    for (const [score, rank, url] of label.slice(0, 2)) {
      if (MV_CREW_KEYWORDS.some((kw) => described(url).includes(kw))) mv.push([score, rank, url]);
    }

    // An artist-channel audio hit may be absent from phase 2's results: check its description and reclassify.
    const nowMv = new Set(mv.map(([, , u]) => videoId(u)));
    for (const [score, rank, url] of audio.slice(0, 5)) {
      if (score !== 1 || nowMv.has(videoId(url)) || !descriptions.has(videoId(url))) continue;
      const bonus = descriptionBonus(described(url));
      if (bonus) mv.push([score + bonus, rank, url]);
    }

    const bestMv = [...mv].sort(byScoreThenRank)[0];
    if (bestMv) return { url: bestMv[2], isMusicVideo: true };
    const bestAudio = [...audio].sort(byScoreThenRank)[0];
    if (bestAudio) return { url: bestAudio[2], isMusicVideo: false };
    return NONE;
  } catch {
    return NONE;
  }
}

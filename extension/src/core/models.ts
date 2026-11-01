// Port of scraper.models: credits, the merge rules and the paste queue in Genius form order.
import { extractLabels } from "./copyright";
import { deriveLabelInfo, type LabelInfo } from "./labels";
import { MONTHS, formatReleaseDate, splitReleaseDate } from "./releaseDate";

export interface Credit {
  role: string;
  artists: string[];
}

/** What the song's YouTube link is, in Genius's order of preference. */
export type VideoKind = "music-video" | "lyric-video" | "official-audio" | "auto-generated";

export const VIDEO_KINDS: readonly VideoKind[] = ["music-video", "lyric-video", "official-audio", "auto-generated"];

export interface SongCredits {
  title: string;
  artist: string;
  appleMusicUrl: string;
  credits: Credit[];
  phonographicCopyright: string;
  copyrightNotice: string;
  coverArtUrl: string;
  youtubeUrl: string;
  youtubeIsMv: boolean;
  /** When Apple Music released the song, ISO "YYYY-MM-DD"; "" when unknown. */
  releaseDate: string;
  /** Which kind of video the link is; absent for a link saved before this was recorded, or one the user gave. */
  youtubeKind?: VideoKind;
  /** True when the user pasted this link themselves, instead of the look-up finding it. */
  youtubeByUser?: boolean;
  /** Remarks about how this was read: what its source cannot give, and roles left out. Shown beside the credits. */
  notes?: string[];
}

/** Year, month (1-12) and day of the song's release date; null when it is unknown. */
export function releaseYear(song: Pick<SongCredits, "releaseDate">): number | null {
  return splitReleaseDate(song.releaseDate)?.[0] ?? null;
}

export function releaseMonth(song: Pick<SongCredits, "releaseDate">): number | null {
  return splitReleaseDate(song.releaseDate)?.[1] ?? null;
}

export function releaseDay(song: Pick<SongCredits, "releaseDate">): number | null {
  return splitReleaseDate(song.releaseDate)?.[2] ?? null;
}

/** The date as shown to the user, "May 17, 2024" ("" when unknown). */
export function releaseDateText(song: Pick<SongCredits, "releaseDate">): string {
  return formatReleaseDate(song.releaseDate);
}

export type QueueKind =
  | "written_by"
  | "produced_by"
  | "role"
  | "artist"
  | "copyright_role"
  | "phonographic_copyright"
  | "copyright_notice"
  | "youtube_url"
  | "cover_art"
  | "release_month"
  | "release_day"
  | "release_year";

export type QueueItem = readonly [kind: QueueKind, value: string];

export interface QueueOptions {
  includeCore?: boolean;
  includeAdditional?: boolean;
  includeCopyright?: boolean;
  includeYoutube?: boolean;
  includeCoverArt?: boolean;
  includeReleaseDate?: boolean;
}

// Roles that map to Genius's Written By field (labelled "Writer" in the edit form).
const WRITTEN_BY_ROLES: ReadonlySet<string> = new Set(["songwriter", "lyricist", "lyrics", "co-writer", "writer"]);
const PRODUCED_BY_ROLES: ReadonlySet<string> = new Set(["producer", "co-producer"]);

/**
 * Merge credits that share a role (case-insensitively) into one entry.
 * The first occurrence fixes position and casing; artists are de-duplicated in order.
 */
export function mergedCredits(credits: readonly Credit[]): Credit[] {
  const merged = new Map<string, Credit>();
  for (const credit of credits) {
    const key = credit.role.toLowerCase().trim();
    let entry = merged.get(key);
    if (!entry) {
      entry = { role: credit.role, artists: [] };
      merged.set(key, entry);
    }
    for (const artist of credit.artists) {
      if (!entry.artists.includes(artist)) entry.artists.push(artist);
    }
  }
  return [...merged.values()].filter((credit) => credit.artists.length > 0);
}

// Membership uses the role as merged (lowercased, not trimmed), exactly as the Python reference does.
function isWrittenBy(credit: Credit): boolean {
  return WRITTEN_BY_ROLES.has(credit.role.toLowerCase());
}

function isProducedBy(credit: Credit): boolean {
  return PRODUCED_BY_ROLES.has(credit.role.toLowerCase());
}

export function additionalCredits(song: Pick<SongCredits, "credits">): Credit[] {
  return mergedCredits(song.credits).filter((credit) => !isWrittenBy(credit) && !isProducedBy(credit));
}

export function writtenBy(song: Pick<SongCredits, "credits">): string[] {
  return mergedCredits(song.credits)
    .filter(isWrittenBy)
    .flatMap((credit) => credit.artists);
}

export function producedBy(song: Pick<SongCredits, "credits">): string[] {
  return mergedCredits(song.credits)
    .filter(isProducedBy)
    .flatMap((credit) => credit.artists);
}

/** Label and Distributor derived from the ℗ line; a role the credits already carry is never repeated. */
export function labelInfo(song: Pick<SongCredits, "phonographicCopyright" | "credits">): LabelInfo {
  const info = deriveLabelInfo(song.phonographicCopyright, extractLabels(song.phonographicCopyright));
  const have = new Set(song.credits.map((credit) => credit.role.toLowerCase().trim()));
  return {
    ...info,
    label: have.has("label") ? "" : info.label,
    distributor: have.has("distributor") ? "" : info.distributor,
  };
}

/**
 * The paste queue, in the order of the Genius metadata form:
 * Writer, Producer, then each additional role followed by its artists,
 * then Label and Distributor (role and artist pairs derived from the ℗ line), the ℗ and © labels, the YouTube link, the cover art URL and the release date (month, day, year).
 */
export function typedQueue(song: SongCredits, options: QueueOptions = {}): QueueItem[] {
  const { includeCore = true, includeAdditional = true, includeCopyright = true } = options;
  const { includeYoutube = true, includeCoverArt = true, includeReleaseDate = true } = options;

  const queue: QueueItem[] = [];
  if (includeCore) {
    for (const artist of writtenBy(song)) queue.push(["written_by", artist]);
    for (const artist of producedBy(song)) queue.push(["produced_by", artist]);
  }
  if (includeAdditional) {
    for (const credit of additionalCredits(song)) {
      queue.push(["role", credit.role]);
      for (const artist of credit.artists) queue.push(["artist", artist]);
    }
  }
  if (includeCopyright) {
    const info = labelInfo(song);
    for (const [role, name] of [
      ["Label", info.label],
      ["Distributor", info.distributor],
    ] as const) {
      if (name) queue.push(["role", role], ["artist", name]);
    }
    const phonographic = song.phonographicCopyright ? extractLabels(song.phonographicCopyright) : [];
    const copyright = song.copyrightNotice ? extractLabels(song.copyrightNotice) : phonographic;
    if (phonographic.length > 0) {
      queue.push(["copyright_role", "Phonographic Copyright"]);
      for (const label of phonographic) queue.push(["phonographic_copyright", label]);
    }
    if (copyright.length > 0) {
      queue.push(["copyright_role", "Copyright"]);
      for (const label of copyright) queue.push(["copyright_notice", label]);
    }
  }
  if (includeYoutube && song.youtubeUrl) queue.push(["youtube_url", song.youtubeUrl]);
  if (includeCoverArt && song.coverArtUrl) queue.push(["cover_art", song.coverArtUrl]);
  const date = includeReleaseDate ? splitReleaseDate(song.releaseDate) : null;
  if (date) {
    // Genius's Release Date is three dropdowns: month by name, day without a leading zero, year.
    const [year, month, day] = date;
    queue.push(
      ["release_month", MONTHS[month - 1] ?? ""],
      ["release_day", String(day)],
      ["release_year", String(year)],
    );
  }
  return queue;
}

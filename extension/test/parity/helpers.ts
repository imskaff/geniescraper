import type { QueueItem, QueueKind, SongCredits } from "../../src/core/models";
import vectors from "../vectors.json";

export type SongName = keyof typeof vectors.songs;

/** A sample song of the Python vectors (snake_case model dump) as the TypeScript model. */
export function songFromVector(name: SongName): SongCredits {
  const raw = vectors.songs[name];
  return {
    title: raw.title,
    artist: raw.artist,
    appleMusicUrl: raw.apple_music_url,
    credits: raw.credits.map((credit) => ({ role: credit.role, artists: [...credit.artists] })),
    phonographicCopyright: raw.phonographic_copyright,
    copyrightNotice: raw.copyright_notice,
    coverArtUrl: raw.cover_art_url,
    youtubeUrl: raw.youtube_url,
    youtubeIsMv: raw.youtube_kind === "music-video",
  };
}

/** A queue as the JSON vectors hold it (arrays of strings) as typed queue items. */
export function queueFromVector(raw: string[][]): QueueItem[] {
  return raw.map(([kind = "", value = ""]) => [kind as QueueKind, value]);
}

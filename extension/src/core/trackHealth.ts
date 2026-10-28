// How a track in the credits list is doing, at a glance: everything found, something the user should look at, or failed.
import type { SongCredits } from "./models";

export type HealthLevel = "waiting" | "working" | "ok" | "attention" | "error" | "none";

export interface Health {
  level: HealthLevel;
  /** Plain words for the list item and for a screen reader; never colour alone. */
  label: string;
  /** What was expected but not found, for an "attention" track. */
  missing: string[];
}

export interface HealthInput {
  status: "pending" | "loading" | "done" | "error" | "unavailable";
  song: SongCredits | null;
  /** Which of the optional steps are switched on; a step that is off is never "missing". */
  wants: { copyright: boolean; coverArt: boolean; youtube: boolean };
  /** True while the YouTube look-up for this track is running or waiting its turn. */
  youtubeSearching: boolean;
}

/** Nothing here is judged by what the track has not been asked for: only what was asked and is absent counts. */
export function trackHealth({ status, song, wants, youtubeSearching }: HealthInput): Health {
  switch (status) {
    case "pending":
      return { level: "waiting", label: "Waiting", missing: [] };
    case "loading":
      return { level: "working", label: "Reading", missing: [] };
    case "error":
      return { level: "error", label: "Failed", missing: [] };
    case "unavailable":
      return { level: "none", label: "No page", missing: [] };
    case "done":
      break;
  }
  if (!song) return { level: "error", label: "Failed", missing: [] };
  const missing: string[] = [];
  if (song.credits.length === 0) missing.push("credits");
  if (wants.copyright && !song.phonographicCopyright && !song.copyrightNotice) missing.push("copyright");
  if (wants.coverArt && !song.coverArtUrl) missing.push("cover art");
  const awaitingLink = wants.youtube && !song.youtubeUrl;
  if (awaitingLink && !youtubeSearching) missing.push("YouTube link");
  if (missing.length === 0 && awaitingLink) return { level: "working", label: "Finding YouTube link", missing };
  if (missing.length === 0) return { level: "ok", label: "All found", missing };
  return { level: "attention", label: `Needs a look: ${missing.join(", ")}`, missing };
}

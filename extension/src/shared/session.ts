// The working session: which album is open, which tracks were picked, and what was read for each.
// It is stored so the panel can close and reopen (the side panel is destroyed whenever it is closed)
// without losing the credits the user is in the middle of pasting.
import type { Credit, SongCredits } from "../core/models";
import { isAlbumInfo, type AlbumInfo } from "./messages";

export const SESSION_KEY = "session";

export type TrackStatus = "pending" | "loading" | "done" | "error" | "unavailable";
export type Screen = "link" | "tracks" | "review";

export interface TrackResult {
  /** Zero-based position in the album's track list. */
  index: number;
  title: string;
  /** The track's song page; "" for an unavailable track. */
  url: string;
  status: TrackStatus;
  song: SongCredits | null;
  error: string;
}

export interface Session {
  screen: Screen;
  album: AlbumInfo | null;
  /** Zero-based indexes of the tracks the user picked. */
  selected: number[];
  results: TrackResult[];
  /** Index of the track whose credits are open on the review screen; null until the user opens one. */
  current: number | null;
}

export const EMPTY_SESSION: Readonly<Session> = {
  screen: "link",
  album: null,
  selected: [],
  results: [],
  current: null,
};

const STATUSES: ReadonlySet<string> = new Set(["pending", "loading", "done", "error", "unavailable"]);
const SCREENS: ReadonlySet<string> = new Set(["link", "tracks", "review"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCredit(value: unknown): value is Credit {
  return isRecord(value) && typeof value["role"] === "string" && isStringArray(value["artists"]);
}

export function isSongCredits(value: unknown): value is SongCredits {
  return (
    isRecord(value) &&
    typeof value["title"] === "string" &&
    typeof value["artist"] === "string" &&
    typeof value["appleMusicUrl"] === "string" &&
    Array.isArray(value["credits"]) &&
    value["credits"].every(isCredit) &&
    typeof value["phonographicCopyright"] === "string" &&
    typeof value["copyrightNotice"] === "string" &&
    typeof value["coverArtUrl"] === "string" &&
    typeof value["youtubeUrl"] === "string" &&
    typeof value["youtubeIsMv"] === "boolean"
  );
}

function toTrackResult(value: unknown): TrackResult | null {
  if (!isRecord(value)) return null;
  const { index, title, url, status, song, error } = value;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
  if (typeof title !== "string" || typeof url !== "string" || typeof error !== "string") return null;
  if (typeof status !== "string" || !STATUSES.has(status)) return null;
  if (song !== null && !isSongCredits(song)) return null;
  // A track that was loading when the panel closed was interrupted: it has to be asked for again.
  const restored = status === "loading" ? "pending" : (status as TrackStatus);
  if (restored === "done" && song === null) return null;
  return { index, title, url, status: restored, song, error };
}

/** A session from storage, or an empty one when what is stored is missing, stale or malformed. */
export function normaliseSession(raw: unknown): Session {
  if (!isRecord(raw) || !isAlbumInfo(raw["album"])) return { ...EMPTY_SESSION };
  const album = raw["album"];
  const results = (Array.isArray(raw["results"]) ? raw["results"] : []).map(toTrackResult);
  if (results.some((result) => result === null)) return { ...EMPTY_SESSION };

  const tracks = results as TrackResult[];
  const inRange = (index: unknown): index is number =>
    typeof index === "number" && Number.isInteger(index) && index >= 0 && index < album.trackTitles.length;
  const selected = (Array.isArray(raw["selected"]) ? raw["selected"] : []).filter(inRange);
  const screenName =
    typeof raw["screen"] === "string" && SCREENS.has(raw["screen"]) ? (raw["screen"] as Screen) : "tracks";
  // The review screen needs something to review.
  const screen = screenName === "review" && tracks.length === 0 ? "tracks" : screenName;
  const current = inRange(raw["current"]) ? raw["current"] : null;
  return { screen, album, selected: [...new Set(selected)], results: tracks, current };
}

/**
 * The track whose credits are on screen: the one the user opened, or the only one there is. With several tracks
 * none is open until the user picks one, so Start pasting is in reach without scrolling past a long credits list.
 */
export function shownTrack(session: Pick<Session, "results" | "current">): TrackResult | null {
  if (session.current !== null) return session.results.find((r) => r.index === session.current) ?? null;
  return session.results.length === 1 ? (session.results[0] ?? null) : null;
}

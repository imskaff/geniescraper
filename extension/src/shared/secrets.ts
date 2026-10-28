// The one secret the extension keeps: the user's own YouTube Data API key. It lives in this browser's local storage
// only (never the synced area, so it does not travel to the user's other devices), is sent only to Google's API
// host in a request header, and is never logged or shown back in full.
import type { KeyValueStore } from "./storage";

export const YOUTUBE_KEY = "youtubeApiKey";

/** Google API keys are "AIza" followed by 35 URL-safe characters. */
const KEY_SHAPE = /^AIza[0-9A-Za-z_-]{35}$/;

export const looksLikeApiKey = (text: string): boolean => KEY_SHAPE.test(text);

/** Tidy what a user pasted: spaces and line breaks around it, or quotes copied with it, are dropped. */
export const cleanKey = (text: string): string =>
  text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

export async function loadYoutubeKey(store: KeyValueStore): Promise<string> {
  try {
    const value = await store.get(YOUTUBE_KEY);
    return typeof value === "string" && looksLikeApiKey(value) ? value : "";
  } catch {
    return "";
  }
}

export async function saveYoutubeKey(store: KeyValueStore, key: string): Promise<void> {
  await store.set(YOUTUBE_KEY, key);
}

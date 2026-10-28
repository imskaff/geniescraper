// Only Apple Music album and song pages are ever opened or read. The check is strict because the extension
// opens tabs for URLs that arrive in messages: anything else is refused before a tab exists.

export interface AppleMusicUrl {
  kind: "album" | "song";
  storefront: string;
}

const APPLE_MUSIC_URL = /^https:\/\/music\.apple\.com\/([a-z]{2})\/(album|song)\/(?:[^/?#]+\/)?\d+(?:[/?#]|$)/;

/** Kind and storefront of an Apple Music album or song URL, or null for anything else. */
export function parseAppleMusicUrl(url: string): AppleMusicUrl | null {
  const match = APPLE_MUSIC_URL.exec(url);
  const storefront = match?.[1];
  const kind = match?.[2];
  if (!storefront || (kind !== "album" && kind !== "song")) return null;
  return { kind, storefront };
}

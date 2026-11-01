// The providers the extension ships, in the order they are asked about an address.
import { APPLE_PROVIDER } from "./apple";
import { SPOTIFY_PROVIDER } from "./spotify";
import type { CreditsProvider, MusicUrl } from "./types";

export const PROVIDERS: readonly CreditsProvider[] = [APPLE_PROVIDER, SPOTIFY_PROVIDER];

export interface RecognisedUrl {
  provider: CreditsProvider;
  url: MusicUrl;
}

/** The provider that owns `url` and what it points to, or null when no provider recognises it. */
export function recogniseUrl(url: string, providers: readonly CreditsProvider[] = PROVIDERS): RecognisedUrl | null {
  for (const provider of providers) {
    const parsed = provider.parseUrl(url);
    if (parsed) return { provider, url: parsed };
  }
  return null;
}

/** Wording for an address no provider recognises: a provider's own when it is the only one, else a general one. */
export function unsupportedLinkMessage(
  kind: "album-or-song" | "song",
  providers: readonly CreditsProvider[] = PROVIDERS,
): string {
  const only = providers.length === 1 ? providers[0] : undefined;
  if (only) return kind === "song" ? only.messages.notSong : only.messages.notAlbumOrSong;
  return kind === "song" ? "Not a supported song link." : "Not a supported album or song link.";
}

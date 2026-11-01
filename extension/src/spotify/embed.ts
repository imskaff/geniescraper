// The full release date of a track, from Spotify's public embed page (open.spotify.com/embed/track/<id>), which the
// signed-out player embeds in an iframe. It carries `releaseDate.isoString` in its __NEXT_DATA__ JSON, in every
// language, where the track page itself shows only the year. Same host, no cookie, no token; see
// docs/spotify-release-date.md for the measurements.

const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})T/;

/**
 * "YYYY-MM-DD" from the embed page's markup, or "" when it has no date. Spotify stores a release known only by its
 * year as 1 January, and the embed does not say which, so a 1 January date is dropped rather than shown as a day
 * that is probably invented (a real 1 January release is lost with them).
 */
export function releaseDateFromEmbed(markup: string): string {
  const json = NEXT_DATA.exec(markup)?.[1];
  if (!json) return "";
  let iso: unknown;
  try {
    iso = (
      JSON.parse(json) as {
        props?: { pageProps?: { state?: { data?: { entity?: { releaseDate?: { isoString?: unknown } } } } } };
      }
    ).props?.pageProps?.state?.data?.entity?.releaseDate?.isoString;
  } catch {
    return "";
  }
  const match = typeof iso === "string" ? ISO_DAY.exec(iso) : null;
  if (!match || (match[2] === "01" && match[3] === "01")) return "";
  return `${match[1] ?? ""}-${match[2] ?? ""}-${match[3] ?? ""}`;
}

/** Best-effort: any failure (network, status, markup change) gives "" and never breaks the credits read. */
export async function fetchEmbedReleaseDate(trackId: string): Promise<string> {
  if (!trackId) return "";
  try {
    const response = await fetch(`/embed/track/${trackId}`, { credentials: "omit" });
    return response.ok ? releaseDateFromEmbed(await response.text()) : "";
  } catch {
    return "";
  }
}

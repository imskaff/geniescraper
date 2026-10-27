// Ports of the cover URL helpers in scraper.apple_music.

/** Rewrite an Apple Music artwork URL to its 1000x1000 PNG variant. */
export function normaliseCoverUrl(url: string): string {
  const base = url.split("?")[0] ?? "";
  // Replace the trailing /{w}x{h}[flags][-quality].{ext}, e.g. /600x600bb.jpg, /1200x630wp-60.jpg, /296x296.webp.
  return base.replace(/\/\d+x\d+[a-z]*(?:-\d+)?\.[a-z]+$/i, "/1000x1000bb.png");
}

/**
 * Pick the album artwork among header image URLs, as a 1000x1000 PNG ("" if none).
 * Album artwork lives under /image/thumb/Music; motion-artwork stills (Video) and editorial
 * images (Features) are never the cover, so no cover beats a wrong one.
 */
export function pickCoverUrl(urls: readonly string[]): string {
  const music = urls.find((url) => url.includes("/image/thumb/Music"));
  return music ? normaliseCoverUrl(music) : "";
}

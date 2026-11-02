# Finding a song's Apple Music and Spotify pages by search (fallback study)

Question: on a Genius song page, how well can an exact-match search find the song's Apple Music and Spotify pages from the Genius title and artist, using only hosts the extension already has?
Policy under test: exact title and exact artist, otherwise "not found"; never a guess.

This is research only.
No production code was changed; the matcher in section 4 is meant to be ported to `extension/src/core/` and unit tested, with `docs/match-search-fallback.sample.json` as a ready-made fixture.

## 1. Result in one table

Sample: 55 songs (section 2), measured 2026-11-02, US storefront, signed out.
"Found" means the matcher in section 4 accepted a result and that result is the right song (reviewed by hand, see section 6).
"Wrong" means an accepted result that is another song or another recording.

| Source | Found | Not found | Wrong | Typical cost |
|--------|-------|-----------|-------|--------------|
| iTunes Search API, `term=<title> <artist>`, `entity=song`, `limit=25` | 51 | 4 | 0 | 1 GET, median 0.5 s, no tab |
| iTunes Search API, `term=<title>`, `limit=50` | 50 | 5 | 0 | 1 GET, median 0.7 s |
| Apple Music search page `music.apple.com/us/search?term=...` in a hidden tab | 54 | 1 | 0 | 1 hidden tab, about 2.0 to 3.0 s |
| Spotify `open.spotify.com/search/<query>/tracks?locale=en` in a hidden tab | 53 | 2 | 0 | 1 hidden tab, about 2.0 to 3.0 s |

Eight negative controls (right title with another artist, swapped roles, an invented title) produced no accepted result on any source, except one case that is correct by design on Spotify (section 6.3).

Recommendation in short:

- Apple: ask the iTunes API first (cheap, 51 of 55).
  Only when it finds nothing, read the Apple Music search page in a hidden tab (finds the rest, 54 of 55 overall).
- Spotify: one hidden tab on `/search/<query>/tracks?locale=en`.
  There is no cheaper credential-free route on `open.spotify.com`.
- Both: show "not found" when the matcher accepts nothing, and never fall back to the top result.
- Prerequisite for both: the Genius page must give primary and featured artists as separate names (section 5); that is not verified yet.

No new host is needed (section 7).

## 2. The sample

55 songs, each as the Genius page would give it: the title, the primary artists as separate names, and the featured artists.
It holds the 7 songs of `bench/cases.json` and `tests/golden/` and variety:

- non-English titles and scripts: Japanese, Korean with an added Hangul bracket, French, German, Spanish and Italian titles with diacritics;
- featured artists in the title or artist (`Ft.`), several primary artists with `&`, an artist with a comma ("Tyler, The Creator"), a dollar sign ("A$AP Rocky"), a diaeresis ("JAY-Z" against "JAŸ-Z");
- remix, `Radio Edit`, `Remastered`, `Taylor's Version`, `(Deluxe)`-style neighbours;
- punctuation: curly apostrophes, `+`, `:`, `/`, `!`, a `.` in "Mr." and "J. Cole";
- very short or common titles: "Home", "Stay" (two different songs), "Yesterday", "Mamma Mia", "lovely";
- songs whose Genius title differs from the store title (Hangul bracket, `Ft.` against `feat.`, `Radio Edit`, `Remastered`).

Caveat: the Genius title and artist fields were typed to mimic what Genius shows; they were not read from live Genius pages.
Real Genius strings can differ, and the study depends on the page giving featured artists separately (section 5).

The fixture `docs/match-search-fallback.sample.json` holds the sample and, per source, the reviewed pick or `null`.
It holds no personal data.

## 3. How the searches were run

One request at a time, 3.5 s apart for iTunes (about 17 a minute) and 8 s apart for the hidden tabs; no parallel requests, no retries, no loops.
In all, about 140 iTunes requests, 65 Spotify page loads and 67 Apple Music page loads; no block, captcha or error page appeared in any page load.
The hidden-tab reads used a throwaway extension with `scripting` and the host permission for the one site, the same design as `extension/scripts/live-spotify-probe.mjs`: an unfocused background tab in its own window, one page at a time, the window removed afterwards.

### 3.1 iTunes Search API (`itunes.apple.com/search`)

- `media=music&entity=song&country=us&limit=25&term=<title> <primary artist>` with the featured part removed from the title.
- Returns `trackName`, `artistName`, `collectionName`, `trackViewUrl` (an album URL with `?i=<track id>`), which is exactly the form the extension opens.
- `artistName` holds the primary artists joined with `&`.
- Featured artists are in the title ("Fortnight (feat. Post Malone)").
- Title-only (`term=<title>`, `limit=50`) found one song fewer ("Wake Me Up (Radio Edit)" fell outside the 50) and never found one more.
  Raising the limit to 200, `attribute=songTerm`, folding diacritics in the term, and `country=gb` did not recover the four misses.
- The four misses are gaps of the index, not of the matcher: "DÁKITI", "Tití Me Preguntó", "EARFQUAKE" and "The Less I Know the Better" all exist on Apple Music (the search page finds three of them), but the API returns other songs of the artist and covers instead.
  So a miss from this API is not proof that the song is absent.
  A lookup of an album found by name did not help either (the album search returned other releases).

### 3.2 Apple Music search page

- `https://music.apple.com/us/search?term=<title> <artist>` in a hidden tab; the page is client rendered.
- Rows: `[data-testid="track-lockup-title"]` holds the song link (`.../album/<slug>/<id>?i=<track id>`); the artist links (`a[href*="/artist/"]`) sit in the same row.
  The first four rows are the "Top Results" duplicates of the "Songs" section; 13 rows per page in all, so duplicates must be dropped by link.
- The row shows no album name, but the link slug names it ("swag-live-from-coachella-weekend-i"), which is enough for the release check in section 4.
- Rows appear about 1.6 to 2.2 s after the script starts; an invented title shows an empty page (0 rows) and the reader must stop on a bounded wait.
  One such lookup (the invented title) took 66 s in my probe; I did not isolate whether the tab load or the row wait stalled, so the extension needs a hard cap on both.

### 3.3 Spotify

- `https://open.spotify.com/search/<url-encoded "title artist">/tracks?locale=en` in a hidden tab.
- `?locale=en` worked: `<html lang="en">` on all 55 sample loads, so titles and labels are English.
- Rows: `[data-testid="tracklist-row"]`, with the title in `a[href*="/track/"]` (the track id is in the link), every artist as its own `a[href*="/artist/"]` and the album as `a[href*="/album/"]`.
  20 rows on every page.
- Without `/tracks` (`/search/<query>`) the page shows 4 "top songs" only and no album; `/tracks` is the better page.
- Spotify always fills the list with fuzzy results, even for an invented title (19 rows), so "no rows" never means "not found"; the matcher alone decides.
- Credential-free alternatives on `open.spotify.com` do not search: `oembed?url=` and `/embed/track/<id>` only resolve a track whose id is already known (a search URL gives HTTP 400), and a plain fetch of `/search/...` returns a 188 KB shell with no track links (the list is rendered by script).
  They are useful for checking a known id, not for finding one.

## 4. The matching rule (port this)

### 4.1 Normalisation

`fold(text)`:

1. Unicode NFKD, then remove all combining marks (`\p{M}`): "Ça" gives "ca", "JAŸ-Z" gives "jay-z", "Måneskin" gives "maneskin".
2. Lower case.
3. Delete apostrophes and quote marks (`’ ‘ ' ` ´`), so "Don't" and "Dont" agree and "Taylor’s" equals "Taylor's".
4. Replace `&` with the word `and`.
5. Replace every run of characters that are not a letter or number (`\p{L}`, `\p{N}`) with one space; trim.
   Non-Latin letters stay, so "夜に駆ける" compares as it is.
   A `+` or `$` becomes a space ("A$AP" gives "a ap" on both sides, which is consistent).

`normTitle(title, artistNames)`, applied to both the Genius title and the result title:

1. Delete featured parts: a bracket that starts with `feat.`, `ft.`, `featuring` (round or square), and a trailing ` - feat. ...`.
2. Delete a bracket `(with A, B)` only when every name in it is one of the song's artists (Spotify writes "STAY (with Justin Bieber)").
   "Stay (With Me)" keeps its bracket because "Me" is not an artist.
3. Delete edition words that do not change the recording: `(Remastered)`, `(Remastered 2011)`, `- 2013 Remaster`, `- Remastered 2009`, `(Digital Remaster)`, `Radio Edit`, `Single Version`, `Album Version`, `(Deluxe)`, `(Deluxe Edition)`, `(Explicit)`.
   Anything else stays part of the title: `Remix`, `Live`, `Acoustic`, `Instrumental`, `Sped Up`, `Version` words not listed, `Taylor's Version`.
   Spotify writes `Despacito - Remix` and Apple `Despacito (feat. Justin Bieber) [Remix]`.
   After steps 1 to 3 and `fold`, all three give `despacito remix`.
4. Delete a bracket that holds only non-Latin letters and no ASCII letter or digit: "Gangnam Style (강남스타일)" gives "Gangnam Style".
   A bracket with digits or Latin letters ("(4:44)", "(Blue)") is kept.
5. `fold` the rest.

Artists:

- Genius side: `primary` (the artists in the header) and `featured` (the "Featuring" credit) as separate names, never as one string; "Tyler, The Creator" is one name.
- Spotify returns the artists as separate links with no primary or featured distinction: accept only when the set of folded result artists equals the set of folded `primary` plus `featured`.
- Apple returns one joined string ("Elton John & Dua Lipa") and keeps featured artists in the title: accept only when removing each wanted primary name from the folded string leaves nothing except the separators `and`, `x`, `with`, and the featured names in the result title equal the set of folded `featured`.

### 4.2 Acceptance rule

A result is accepted when all of these hold:

1. `normTitle(result.title)` equals `normTitle(genius.title)` (whole-string equality, never "contains").
2. The artist rule of its service holds (equality of sets, never "a subset" or "the first artist").
3. The release is not a different edition by name: every flag word in the album name (Spotify, iTunes) or in the album slug of the link (Apple) must also be a word of the Genius title.
   The flag words are `live`, `acoustic`, `remix(es)`, `instrumental`, `karaoke`, `sped up`, `slowed`, `reverb`, `tribute`, `cover`, `lullaby`, `8 bit`, `piano version`, `mixed`.
   So Genius "Cold Heart (PNAU Remix)" accepts a remix release but still refuses a live one.
4. Among accepted results, take the first in the service's own order.
   If there is none, the answer is "not found".

Rules 2 and 3 were added after the first runs showed real wrong matches (section 6.2); rule 4's order was always right in this sample.

### 4.3 TypeScript sketch

```ts
interface GeniusSong { title: string; primary: string[]; featured: string[] }
interface Hit { title: string; artists: string[]; album?: string; href: string } // Apple: artists = [joined] or link names

const fold = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[’‘'`´]/g, "").replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const FEAT = /[([]\s*(?:feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]|\s[-–]\s*(?:feat\.?|ft\.?|featuring)\s.*$/gi;
const WITH = /[([]\s*with\s+([^)\]]*)[)\]]/i;
const NON_LATIN_BRACKET = /[(\[](?=[^)\]]*\p{L})(?![^)\]]*[A-Za-z0-9])[^)\]]*[)\]]/gu;
const REM = String.raw`(?:\d{4}\s+)?(?:digital\s+)?remaster(?:ed)?(?:\s+\d{4})?`;
const EDITION = new RegExp(
  String.raw`[(\[]\s*(?:${REM}|radio edit|single version|album version|deluxe(?: edition)?|explicit)\s*[)\]]` +
    String.raw`|\s[-–]\s*(?:${REM}|radio edit|single version|album version)\s*$`, "gi");
const FLAG_WORDS =
  /\b(live|acoustic|remix(?:es)?|instrumental|karaoke|sped up|slowed|reverb|tribute|cover|lullaby|8 bit|piano version|mixed)\b/gi;
const flagWords = (text: string) => new Set((text.match(FLAG_WORDS) ?? []).map((w) => w.toLowerCase()));

function normTitle(title: string, artists: string[]): string {
  let t = title.replace(FEAT, " ");
  const w = WITH.exec(t);
  if (w && w[1].split(/\s*(?:,|&|\band\b)\s*/).every((n) => artists.map(fold).includes(fold(n)))) t = t.replace(WITH, " ");
  return fold(t.replace(EDITION, " ").replace(NON_LATIN_BRACKET, " "));
}

const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a.map(fold)), y = new Set(b.map(fold));
  return x.size === y.size && [...x].every((n) => y.has(n));
};

function sameArtistsJoined(joined: string, names: string[]): boolean {
  let rest = ` ${fold(joined)} `;
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    const f = ` ${fold(n)} `;
    if (!rest.includes(f)) return false;
    rest = rest.replace(f, " ");
  }
  return rest.trim().split(/\s+/).filter(Boolean).every((w) => w === "and" || w === "x" || w === "with");
}

function featuredInTitle(title: string): string[] {
  return [...title.matchAll(/[(\[]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]*)[)\]]/gi)]
    .flatMap((m) => m[1].split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean));
}

/** Release name: Spotify/iTunes album, or the Apple link slug ("swag-live-from-coachella" gives words). */
const releaseOf = (h: Hit) => h.album ?? decodeURIComponent(/\/album\/([^/]+)\//.exec(h.href)?.[1] ?? "").replace(/-/g, " ");

export function accepts(service: "spotify" | "apple", g: GeniusSong, h: Hit): boolean {
  const all = [...g.primary, ...g.featured];
  if (normTitle(h.title, all) !== normTitle(g.title, all)) return false;
  const artistsOk =
    service === "spotify"
      ? sameSet(h.artists, all)
      : sameArtistsJoined(h.artists.join(" and "), g.primary) && sameSet(featuredInTitle(h.title), g.featured);
  if (!artistsOk) return false;
  const allowed = flagWords(g.title);
  return [...flagWords(releaseOf(h))].every((w) => allowed.has(w));
}

export const pick = (service: "spotify" | "apple", g: GeniusSong, hits: Hit[]) =>
  hits.find((h) => accepts(service, g, h)) ?? null;
```

Unit-test the port with the `cases` array of the fixture (31 rows from the live runs and by hand, each with the expected `accept`), including these: `normTitle("Stay (With Me)", ["Rihanna"])` is `stay with me`; `normTitle("STAY (with Justin Bieber)", ["The Kid LAROI", "Justin Bieber"])` is `stay`; `normTitle("Hotel California - 2013 Remaster", [])` is `hotel california`; `normTitle("Gangnam Style (강남스타일)", [])` is `gangnam style`; "Home (Live)" by the same artist is rejected against Genius "Home".

## 5. What the matcher needs from the Genius page (a prerequisite, not yet checked)

The rule compares sets of artist names, so it needs the song's primary artists and featured artists as separate names, plus the title as shown.
This study did not read a live Genius song page (no Genius traffic was sent), and the sample was typed to that assumption.

What the repository offers today:

- `extension/src/genius/*` only drives the edit form; nothing reads the song page's own title or artists.
- `extension/src/core/geniusMatch.ts` reads `genius.com/api/search/song` results, which carry `primary_artists[].name` and `featured_artists[].name` as separate lists.
  So that shape exists on a host already allowed (it is used in the reverse direction, Apple to Genius).
- No saved Genius song page is in `tests/fixtures/` (only the edit form and release-date pages), so the page's own markup could not be checked offline.
- The sibling study on Genius pages should say whether the song page exposes the same two lists (for example in its embedded page data or its header links).

If only a joined string such as the `og:title` "Artist - Title Lyrics" is available, the comma and `&` cases ("Tyler, The Creator", "Earth, Wind & Fire") cannot be split safely.
Then the Spotify set test is unreliable.
The safe choices are to read the two lists from the search API for the same song (one extra Genius request) or to show "not found".
Until that is settled, treat the figures here as measured with correct inputs.

Spotify cannot tell primary from featured, so an artist who is primary on Genius but featured on Spotify (or the reverse) still matches.
That is harmless because it is the same recording.

## 6. Findings

### 6.1 Misses (all three are the "not found" the policy asks for)

| Song | Source | Why |
|------|--------|-----|
| "Dákiti", Bad Bunny and Jhay Cortez | Spotify, Apple search, iTunes | Spotify and Apple list the artist as "JHAYCO", Genius says "Jhay Cortez": the exact-artist rule refuses, correctly by policy and wrong in effect. Apple also has only "(Mixed)" variants besides "DÁKITI" by Bad Bunny and JHAYCO. |
| "Cold Heart (PNAU Remix)", Elton John and Dua Lipa | Spotify | Spotify adds PNAU as a third artist; the sample's Genius artists had two. |
| "Tití Me Preguntó", "EARFQUAKE", "The Less I Know the Better" | iTunes API only | Index gaps (section 3.1); the Apple search page finds all three. |

### 6.2 Dangerous exact-looking matches the first rule would have accepted

A first version (same title, every Genius artist among the result's artists, extras allowed) was run on the same data.
It would have accepted all of these; the recommended rule rejects them:

- "SNOOZE" by Justin Bieber and SZA for Genius "Snooze" by SZA (a different recording with an extra artist).
- "Hotline Bling" by Drake and Trap Capoo, "Nuvole Bianche" by Ludovico Einaudi and Alessia Tondo, "Ça plane pour moi" by The Lost Fingers and Plastic Bertrand (a cover): extra artists, rejected by set equality.
- "Anti-Hero (feat. Bleachers)" and "Levitating (feat. DaBaby)" for the plain versions on Apple: rejected by comparing the featured names in the title with the Genius featured credit.
- Identical track title on a different release: "Fortnight (feat. Post Malone)" on the album "Fortnight (Acoustic Version)" and on a "BLOND:ISH Remix" single, "STAY" on "SWAG LIVE FROM COACHELLA", "Ça plane pour moi" and "Nuvole Bianche" on live albums, "I'm Good (Blue)" on "Remixes #2": rejected by rule 3.
  About seven accepted rows in the sample were of this kind; none was the first accepted row, so the order alone would not have been enough to rely on.

With the recommended rule, no accepted result in the 55 songs was another song or a flagged release (0 wrong).

### 6.3 Residual risks

- Same title and artist, different recording, no sign in the title or album name (a live version labelled with the studio title, a re-recording kept under one title).
  Not seen in this sample, cannot be excluded.
- The pick is the first accepted result, which can be the album, the single, a deluxe or a remaster; their credits can differ.
  Picks differed between sources, for example SZA "SOS" came from two different albums.
  This is a product question (which release to show), not a matching one.
- Spotify cannot tell roles: a negative control "Fortnight" by Post Malone ft. Taylor Swift matched Taylor Swift's song because the artist set is the same.
  Harmless (same recording) and by design.
- Only the US storefront was measured.
  Other storefronts (`country=`, `/gb/search`) were not tested; titles of non-English songs may be localised there.
  Spotify `?locale=en` fixes the language of the page, not the market.

## 7. Cost, limits, permissions

| | iTunes API | Apple search page | Spotify search page |
|---|---|---|---|
| Requests per lookup | 1 GET | 1 hidden tab, 1 page load | 1 hidden tab, 1 page load |
| Latency | median 0.5 s (0.3 to 1.8 s) | rows after 1.6 to 2.4 s; about 3.0 s with the probe's settle time | rows after 1.4 to 1.7 s; about 3.0 s with the probe's settle time |
| Rate limit seen | none at 17 a minute (about 20 a minute is the commonly cited limit) | none | none |
| New host | none (`itunes.apple.com`, required) | none (`music.apple.com`, required) | none (`open.spotify.com`, required) |
| Extra permission | none | the content-script injection the Apple reader already uses | the same as the existing Spotify hidden-tab reader |

No new host, no optional host and no new permission is needed, so `PRIVACY.md` and the store listing are unaffected.
The one new outgoing detail is that the song title and artist from the Genius page go into a search query to the three hosts above; that is the same data class as today's Genius search and cover lookups, but the privacy text should say it when the feature ships.

A full "Get credits" press costs one iTunes GET plus, only when that fails, one Apple tab, and one Spotify tab: at most two tabs, one after the other, then the normal credit reads.

## 8. Recommendation

- Apple Music: iTunes Search API first, Apple Music search page second, matcher of section 4 on both.
  Expect about 93 percent from the API alone and about 98 percent with the fallback.
  Take the URL as `trackViewUrl` without `uo=4`.
- Spotify: hidden tab on `/search/<query>/tracks?locale=en`, matcher of section 4, take the first accepted row and build `https://open.spotify.com/track/<id>?locale=en` from its link.
  About 96 percent.
- Show "not found" with the searched title and artist when nothing is accepted, so the user can paste the link by hand; never open the top result.
- Prefer the page's own links when the sibling study finds them on Genius pages; the search is the fallback only.
- Bound every wait (tab load and row wait), reuse the single-tab-at-a-time and close-in-`finally` rules of the existing readers, and run the lookups only after the user presses Get credits.

## 9. Reproducing

The probe scripts were not committed (research only).
The data came from `itunes.apple.com/search?media=music&entity=song&country=us&limit=25&term=...`, and from a throwaway Chromium extension that opened one background tab per search URL and read the rows described in section 3, 8 s apart.
Re-run it sparingly and one request at a time; the sample file lists every query input.

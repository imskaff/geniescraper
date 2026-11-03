# Genius album pages: what they say about Apple Music and Spotify

Status: implemented on top of the song feature (see `docs/genius-song-links.md` and `docs/match-search-fallback.md`).
Measured 3 November 2026, from real public Genius pages, read like a single user: no login, one page every 14 seconds, 21 requests in total.

## Question

When the user is on a Genius **album** page (`https://genius.com/albums/<artist>/<album>`), can the extension find the album's Apple Music and Spotify pages, so that the panel lists them with the same Get credits button the song card has?

## Short answer

- **No id of any kind.**
  None of 19 album pages carries an Apple Music or a Spotify id, not on the album and not on its songs.
  The song page's `appleMusicId` and `spotifyUuid` fields have no album counterpart.
  Both services are therefore found by an exact search, never from Genius's own ids.
- What an album page does carry is enough to search for the album and to check what was found: its title, its album artists, the release date, Genius's own type of release and the full tracklist.
- Two services, two sources: iTunes's search API for Apple Music (`entity=album`, no new host) and the albums tab of Spotify's search page for Spotify (one background tab, like the song search).
- Rule: a result is taken only when title (with its edition words), artists and release year agree, and, where the service says it, the number of tracks.
  Several exact results are all listed (at most three); no exact result is "none".

## Method

1. Sample: 19 album pages that exist, plus 2 guessed slugs that returned 404 (a wrong slug is a plain 404 with `currentPage = "islands"` and `pageType = "generic"`).
   Pages were fetched with an ordinary desktop browser User-Agent and no cookies.
2. For each page the embedded state (`window.__PRELOADED_STATE__`) was decoded as a string literal and parsed as JSON, and every key containing `apple` or `spotify` with a non-null value was listed.
3. Page kinds covered: mainstream albums, an EP (typed "album" by Genius), a single, a compilation, a soundtrack by Various Artists, an album with a non-ASCII title, an album with a non-ASCII artist, a Japanese artist, a name with a comma, four deluxe or edition pages, a re-recording ("Taylor's Version") and a translation of an album by one of Genius's translation accounts.
4. The panel behavior was then checked live, see "Live check" below.

## What an album page exposes

| Source | Where | Content | Notes |
|--------|-------|---------|-------|
| Embedded state | inline script defining `window.__PRELOADED_STATE__` | `currentPage` is `"islands"`; the album is `islands.album` | Not `entities.albums`: that is empty on an album page |
| Album | `islands.album` | `name`, `url`, `primaryArtists[].name`, `releaseDate` (`2021-05-21`), `albumType`, `translationOf` | No Apple or Spotify field |
| Tracklist | `islands.albumAppearances[]` | one entry per track, with `trackNumber` and `song.title` | Complete: 11 for SOUR, 31 for the Anthology edition |
| Page type | `islands.pageType` | `"album"` | `"generic"` on a 404 |
| Meta tags | `og:title`, `og:image`, `canonical` | title and artist as one text, cover | No `og:type`, no ids |
| Visible DOM | anchors | none | A description may link an Apple Music album page (SOUR's links a German storefront page), which is prose, not data |

`albumType` values seen: `album` (13 pages), `compilation`, `soundtrack`, `single`.
Genius does not mark an EP: "dont smile at me" is an EP on Apple Music and `album` on Genius.

## The 19 pages

| # | Path | Kind | Year | Tracks | Apple id | Spotify id |
|---|------|------|------|--------|----------|------------|
| 1 | `/albums/Olivia-rodrigo/Sour` | mainstream | 2021 | 11 | no | no |
| 2 | `/albums/Kendrick-lamar/Gnx` | mainstream | 2024 | 12 | no | no |
| 3 | `/albums/Taylor-swift/The-tortured-poets-department` | mainstream | 2024 | 16 | no | no |
| 4 | `/albums/Taylor-swift/The-tortured-poets-department-the-anthology` | edition | 2024 | 31 | no | no |
| 5 | `/albums/Billie-eilish/Dont-smile-at-me` | EP | 2017 | 9 | no | no |
| 6 | `/albums/Sabrina-carpenter/Espresso` | single (`single`) | 2024 | 2 | no | no |
| 7 | `/albums/Michael-jackson/The-essential-michael-jackson` | compilation | 2005 | 38 | no | no |
| 8 | `/albums/Various-artists/Guardians-of-the-galaxy-awesome-mix-vol-1-original-motion-picture-soundtrack` | various artists (`soundtrack`) | 2014 | 12 | no | no |
| 9 | `/albums/Bad-bunny/Nadie-sabe-lo-que-va-a-pasar-manana` | non-ASCII title (ñ) | 2023 | 23 | no | no |
| 10 | `/albums/Ed-sheeran/Divide-deluxe-edition` | deluxe, name "÷ (Divide) [Deluxe Edition]" | 2017 | 16 | no | no |
| 11 | `/albums/Taylor-swift/1989-taylors-version-deluxe` | deluxe and re-recording, curly apostrophe | 2023 | 23 | no | no |
| 12 | `/albums/Kendrick-lamar/Good-kid-m-a-a-d-city-deluxe-version` | deluxe | 2012 | 18 | no | no |
| 13 | `/albums/Rosalia/Motomami` | non-ASCII artist (ROSALÍA) | 2022 | 16 | no | no |
| 14 | `/albums/Yoasobi/The-book` | Japanese artist | 2021 | 9 | no | no |
| 15 | `/albums/Tyler-the-creator/Flower-boy` | comma in the artist's name | 2017 | 14 | no | no |
| 16 | `/albums/Charli-xcx/Brat` | mainstream (a "Brat - Single" exists too) | 2024 | 15 | no | no |
| 17 | `/albums/Beyonce/Cowboy-carter` | mainstream, long | 2024 | 27 | no | no |
| 18 | `/albums/Daft-punk/Random-access-memories` | catalogue | 2013 | 14 | no | no |
| 19 | `/albums/Genius-traducciones-al-espanol/Olivia-rodrigo-sour-traduccion-al-espanol` | translation of an album | 2021 | 11 | no | no |

Totals: **0 of 19** carry an Apple Music id, **0 of 19** carry a Spotify id.
Two guessed slugs (`/albums/Kendrick-lamar/Not-like-us`, an Arabic translation) were 404: a slug can not be derived from a title.
Genius redirects some slugs to the canonical one (the Guardians page was asked as `...-vol-1` and answered under `...-original-motion-picture-soundtrack`), so the page state's own path, not the requested one, is what the address must be compared with.

## Identifying an album page

- URL: `/albums/<artist>/<album>`, exactly two segments.
  This is only a quick check so the worker is not asked about every Genius page.
- The page decides: `currentPage === "islands"`, `islands.pageType === "album"`, and `islands.album.url` has the address now showing.
  The state describes the page as first served, so after a navigation inside the page it would describe the first album; the reader compares the album's path with the current one and returns nothing on a mismatch.
- A translation of an album (`translationOf` is not null, the artist is a translation account) is not the album and is left out: the card does not appear.
- Artist pages (`currentPage = "profilePage"`) and song pages (`songPage`) are not albums.
  The song reader in turn reads nothing from an album page.

## What the fallback search needs

| Service | Query | Fields read from a result | Used to check |
|---------|-------|---------------------------|---------------|
| Apple Music | iTunes search, `entity=album`, `country=us`, `term` = title and album artists | `collectionId`, `collectionName`, `artistName`, `releaseDate`, `trackCount`, `collectionExplicitness` | title, artists, year, track count, explicit or censored twin |
| Spotify | `open.spotify.com/search/<title and artists>/albums`, one background tab | per card: album link (id), title, every artist, release year | title, artists, year (no track count on a card) |

For an album by "Various Artists" the artist is left out of the query (both services index a compilation by its title).
The listed address is built by the worker from the id, never taken from the text of a result.

### The match rule

1. Title: folded (no case, accents or apostrophes; "&" is "and"; other symbols one space).
   `- Single`, `- EP`, `(Explicit)` and `(Standard Edition)` are dropped, and "Deluxe Edition" is read as "Deluxe" and "Remastered" as "Remaster".
   Every other word stays, so a "(Deluxe)", "(Live)" or "(Taylor's Version)" must be on both sides or neither.
2. Artists: the same set of names (Spotify), or Apple's one joined string made of exactly these names and nothing but "and", "x" or "with".
3. Year: equal, or one year apart (release dates differ between regions); an unknown year does not reject.
4. A result named `X - Single` or `X - EP` is a claim about the kind of release: it is the album `X` only when Genius also calls it a single (for `- Single`), or when both tracklists have the same number of tracks.
5. Of the accepted results the censored twin of an explicit one is dropped, and when some have the tracklist's length and others do not, only the former are kept.
6. Results that look the same in every way a list can show (same title, artists, year and size) are one entry, the first.
7. One result is listed; two or three are all listed ("several"); more than three are cut to three; none is "none".

### Known losses, on purpose

- Names the two services spell differently are "none": Genius calls the Ed Sheeran deluxe "÷ (Divide) [Deluxe Edition]" and Apple Music "÷ (Deluxe)".
  The extension never treats a different set of words as the same album.
- An album whose only match is on the service under another year (a reissue two or more years later), another artist credit or a different edition is "none".
- Spotify lists some albums twice under one name and year (measured live: SOUR, GNX and Espresso each came back as two cards with different ids).
  Nothing on a card tells them apart, so they are one entry, the first, rather than two identical lines.

## What the extension reads, with no new permission

- `genius.com`, `itunes.apple.com` and `open.spotify.com` are the hosts the song feature already uses.
  No new host, permission or stored value; `PRIVACY.md`, `store/listing.md` and the settings label name the album case.
- The page's own data is read by the content script that already runs on `genius.com`, as text; nothing is run.
- Nothing is looked up until the user presses Find, unless the existing setting for automatic look-up (off by default) is on; the setting's label now says "song and album pages".
- Nothing is read from the pages listed until the user presses Get credits, which runs the ordinary album read.
  An album page has no edit form, so a read that started on a Genius album page does not paste "in place"; each track is opened on Genius by a search as usual.

## Live check

`node scripts/live-matches.mjs --chrome <chrome.exe> --albums` (add `--manual` for the button-first mode) opens 14 real Genius album pages one at a time, 15 seconds apart, in a minimized window, presses Find, and compares what the panel lists with the album's expected name.
Run on 3 November 2026 with the shipped build, 13 album pages (one more, a translation, must show no card):

| | Apple Music | Spotify |
|---|---|---|
| found | 9 | 11 |
| correctly matched | 9 | 11 |
| none | 4 | 2 |
| wrong | **0** | **0** |
| could not ask | 0 | 0 |

Misses (all "none", never a guess): Apple for "nadie sabe lo que va a pasar mañana" (the US iTunes search lists only an unrelated single of that name), for the Ed Sheeran deluxe (Apple names it "÷ (Deluxe)"), for MOTOMAMI and Flower Boy (the iTunes search returned no exact match; the cause was not investigated); Spotify for the Guardians soundtrack and the Ed Sheeran deluxe (named differently).
A translation page and an artist page showed no card.

A first run of the same cases found one wrong match: Spotify's "MOTOMAMI +" (an expanded edition) was taken for "MOTOMAMI" because folding dropped the plus sign.
A plus sign is now a word, a title made only of symbols ("÷", "×") is no longer folded to nothing, and both have regression tests.
Not checked live: a signed-in Genius page, Edge, Safari, and pressing Get credits on an album found this way (the album read is the existing, unchanged one).

## Known gaps

- Apple Music has no second source for albums: unlike songs, there is no fallback to Apple Music's own search page, so an album that the iTunes search does not list is "none".
- Genius lists no id for an album, so a wrong release of the right album can not be caught by an id; only title, artists, year and size guard it.

# Spotify release date: where it can be read

Researched 2026-11-01 (signed out, English and German browser language, `?locale=en`), quiet single-user reads: 13 tracks twice (plain and `?locale=de`, 1.5 s apart) and 3 albums on the embed page, plus the track and album pages of one track in a real browser pane.
Tracks: old to new, singles and album tracks (Never Gonna Give You Up 1987, Smells Like Teen Spirit 1991, Imagine 1971, Hotel California 1976, Billie Jean, Mr. Brightside, Rolling in the Deep, Bohemian Rhapsody, Shape of You, Dance Monkey, Blinding Lights, Levitating, As It Was).
Albums: The Dark Side of the Moon, After Hours, Abbey Road (Remastered 2009).

## Result

**The track's embed page gives the full date, with no new permission.**
`GET https://open.spotify.com/embed/track/<id>` returns HTML whose `__NEXT_DATA__` JSON holds `props.pageProps.state.data.entity.releaseDate.isoString`, for example `2020-03-20T00:00:00Z`.
It is implemented in `extension/src/spotify/embed.ts` and used by `scrapeTrack`.

## Per source

| Source | Gives | Stability | Cost | Verdict |
|---|---|---|---|---|
| `/embed/track/<id>` | Full date (`isoString`) for 13 of 13 tracks, identical with `?locale=de`. Also title, artists, duration, cover, preview. No ISRC, label, copyright or credits. | One page, public (it exists to be iframed); JSON path is undocumented and may move. | One plain GET per track to `open.spotify.com` (already a required host); same-origin from the content script; no cookie or token sent. | **Used.** |
| `/embed/album/<id>` | `releaseDate` is `null` (3 of 3). Track list only. | n/a | n/a | No use. |
| `/oembed?url=` | iframe snippet, title, thumbnail. | n/a | n/a | No date. |
| Track page (hydrated) | `[data-testid="release-date"]`: the year only (21 of 21 earlier, again here). No `ld+json` (0), 3 meta tags (`viewport`, `og:site_name`, `fb:app_id`), no ISRC anywhere in the page. | Stable, but year only. | none | Year only. |
| Album page | A line like "March 20, 2020" for day-precise releases (used for album reads); a year-only album shows only "2004". Localised, so only the English form is parsed. | Medium. | An album visit. | Already used for album reads. |
| Server HTML for non-browser clients | `music:release_date` and 200+ meta tags, but only for a plain `node`/`curl` user agent; a browser or the extension's `fetch` gets the app shell. | Needs a spoofed user agent. | Policy problem. | Not used. |
| Credits dialog | Writers, producers, roles, source. No date, no ISRC. | n/a | n/a | No date. |
| Pathfinder API (the page's own GraphQL) | Probably ISRC and label. | Token-gated, undocumented. | Needs a replayed bearer token. | Not tried, not to be used. |

## Caveat: year-only releases

Spotify stores a release known only by its year as 1 January.
The embed cannot tell that from a real 1 January release: Mr. Brightside shows `2004-01-01` there while its track page and its album (Hot Fuss) page both show just "2004".
The reader therefore returns an empty date for any 1 January and the panel leaves the field empty, instead of filling a day that is probably invented.
A real 1 January release is lost with them; filling the year only is not offered by the Genius form's day-month-year dropdowns.

## ISRC, label, copyright lines

Not found in any public, token-free surface: not in the embed JSON, the page, or the dialog.
The ℗/© lines are read from the album or track page already (`readCopyright`).
ISRC would need the token-gated API, which this project does not use.

## What was not done

Signed-in accounts were not tried; tracks that are removed or unavailable in a region were not tried (the reader then gives an empty date and the credits read is unaffected).

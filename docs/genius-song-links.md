# Genius song pages: what they say about Apple Music and Spotify

Status: research only, no production code.
Measured 2 November 2026, from real public Genius pages, read like a single user: no login, one page every 12 to 15 seconds, about 50 requests in total.

## Question

When the user is on a Genius **song** page, can the extension find the song's Apple Music and Spotify pages from what Genius itself exposes, so that the panel can list them with a Get credits button?

## Short answer

- Apple Music: **every** song page (46 of 46) carries an Apple Music track id, and 44 of 46 were confirmed to be the same song.
- Spotify: **19 of 46** pages carry a Spotify track id, and all 19 were confirmed to be the same song.
  The split is by age: 17 of 18 songs released up to 2018 have one, only 2 of 28 released from 2019 on.
- Neither is a link on the page.
  Both are fields in the page's embedded state (`__PRELOADED_STATE__`), and the visible page has no `music.apple.com` or `open.spotify.com` anchor.
- Recommendation: use Genius's own ids as the primary source, and add a search fallback for Spotify only (see the end).

## Method

1. Sample: 46 song pages.
   The 7 bench songs (`bench/cases.json`, `tests/golden`), plus variety: Spanish, French, Japanese and Korean songs, features, a remix, releases from 1970 to October 2025 (the newest checked was "The Fate of Ophelia", 3 October 2025), singles and album tracks.
   Pages were fetched with an ordinary desktop browser User-Agent and no cookies.
   Slugs were guessed from the Genius convention (`/Artist-title-lyrics`); 4 guesses were 404 and are not in the table (a wrong slug is a plain 404, so a slug can not be derived reliably from a title).
2. For each page the embedded state was parsed and the song entity read (`entities.songs[songPage.song]`).
3. Apple ids were checked with the iTunes Lookup API (`itunes.apple.com/lookup?id=<id>`, storefronts us, de, fr, jp, ca, au, br), and where that returned nothing, by opening `music.apple.com/us/song/<id>` and reading the page title.
4. Spotify ids were checked with Spotify's public oEmbed endpoint (`open.spotify.com/oembed?url=https://open.spotify.com/track/<id>`), which returns the track title.
5. "Same song" means the title returned by Apple or Spotify equals the Genius title, allowing only version tags such as "Remastered 2011" or "Radio Edit" (listed below).
6. The claims about the content script were checked in a live tab of the built-in browser on one song page ("good 4 u").

## What a song page exposes

| Source | Where | Apple Music | Spotify | Notes |
|--------|-------|-------------|---------|-------|
| Embedded state, song entity | inline script defining `window.__PRELOADED_STATE__`, entity `entities.songs[songPage.song]` | `appleMusicId` (string, 46 of 46), `appleMusicPlayerUrl` (a genius.com embed URL, not an Apple link) | `spotifyUuid` (a Spotify track id, 19 of 46) | The reliable fields |
| Embedded state, `media[]` | same entity | never | `{provider: "spotify", type: "audio", url: "https://open.spotify.com/track/<id>"}` on 18 of the 19 | "Nights" has `spotifyUuid` but an empty `media`; read `spotifyUuid` first |
| Embedded state, other media | same entity | no | no | `youtube` in `media` 45 of 46 (`youtubeUrl` 46 of 46), `soundcloud` 40 of 46 |
| JSON-LD | `<script type="application/ld+json">`, one `MusicRecording` | no | no | Name, artist, date, image, album only |
| Meta tags | `og:type=music.song`, `canonical`, `twitter:app:url:iphone=genius://songs/<id>` | no | no | The Genius id is in `genius://songs/<id>` |
| Visible DOM | anchors | none | none | Only unrelated links inside lyric annotations (a Houdini annotation links an Apple album page) |

The Genius site's public API (`genius.com/api/songs/<id>`) was not measured; the page already has the data.

## Link formats

- **Apple Music:** `appleMusicId` is an Apple catalogue **track** id (the `?i=` value of an album track URL).
  The usable URL is `https://music.apple.com/us/song/<id>`; it redirects to the slugged form (`/us/song/let-it-be/401151904`) for 44 of 46 ids.
  The iTunes `trackViewUrl` of the same id has the album form (`/us/album/not-like-us/1744776162?i=1744776167`), which is the form the extension's Apple reader is built for.
  `/song/` pages carry no copyright data (a known limit of the Apple reader), so Get credits from a `/song/` URL would read fewer fields than from the album form.
  The album id is not on the Genius page, but one `itunes.apple.com/lookup?id=<id>` returns it (`collectionId`); it returned nothing for 7 of 46 ids.
- **Spotify:** `https://open.spotify.com/track/<22 characters>`.
  No locale prefix (`intl-xx`), no redirect or tracking wrapper, always a track (never album or artist).
- Neither id passes through a Genius redirect.

## Does it point to the same song?

- Apple: 39 ids confirmed by iTunes Lookup (title and artist equal), 5 more by the Apple page title (Let It Be, Smells Like Teen Spirit, Royals, Papaoutai, HUMBLE.), **2 unconfirmed**: "Bohemian Rhapsody" (932648449) and "Houdini" (1746338874) return 404 on `/us/song/` and `/gb/song/` and nothing from iTunes.
  Neither points to a wrong song; the ids look retired (Houdini was re-released, and its Genius annotation links the earlier album id).
- Spotify: 19 of 19 confirmed.
  Variant titles, all the same recording: "Let It Be - Remastered 2009", "Bohemian Rhapsody - Remastered 2011", "Dreams - 2004 Remaster", "Get Lucky (Radio Edit) [feat. ...]".
- **The id can be a different release of the same song than the one the user opened on Apple Music.**
  Against the bench cases: "Not Like Us" (Genius album 1744776162, bench single 1781353928), "SOS" (1657869377, bench 1658650093) and "SOUR" (1560735414, bench 1560734944) point to other album ids; "Hit Me Hard and Soft", "The Tortured Poets Department" and "Con Altura" are the same album.
  So Genius's Apple id is not an identity key against an open Apple tab; identity must come from title and artist.
- Singles and remixes have their own Genius page and their own Apple id ("Not Like Us", "Old Town Road (Remix)"), so the version is chosen by Genius.

## Freshness

- All 13 songs from 2024 and 2025 already had an Apple id, including "The Fate of Ophelia" (3 October 2025), "Manchild" and "Abracadabra".
- A Spotify id is added by hand, so it appears late or never: 2 of 28 songs from 2019 on have one, none of the 13 from 2024 or 2025.
- This sample cannot say how long a brand-new Genius page (hours old) takes to get an Apple id; the newest page here was weeks old.

## Identifying a song page

- URL: `https://genius.com/<Artist>-<Title>-lyrics`.
  Not enough alone: translation pages and some others share the pattern.
- Reliable signals, all present on the 46 pages: `<meta property="og:type" content="music.song">`, `<link rel="canonical">`, `currentPage === "songPage"` and `songPage.pageType === "song"` in the state, `twitter:app:url:iphone = genius://songs/<id>`.
- Other page types seen: an artist page (`/artists/...`) has `currentPage = "profilePage"`; an album page (`/albums/...`) has `currentPage = "islands"` and no `songPage`.
  A wrong slug returns 404 with `currentPage = "islands"`.
- The edit page: the Edit Metadata form is a modal on the song page (see `docs/genius-navigation.md`), so there is no `/songs/<id>/edit` page to detect; the song page is the page.
- A signed-in page was not read.
  The signed-out state already lists `edit_spotify_uuid` among the permissions Genius knows, and the fields above are in the page data regardless of sign-in.

## What the extension can read with no new permission

- `genius.com` is already a required host and `src/genius/content.ts` already runs on `https://genius.com/*`.
- In a real tab, `window.__PRELOADED_STATE__` is an object in the page's own world, which a content script (isolated world) does not see.
  The inline script that defines it **is** in the DOM: `document.scripts` held it (about 220 KB of text) including `appleMusicId` and the `open.spotify.com/track/` URL.
  A content script can read it from `textContent` without injecting anything into the page.
  The text is a JavaScript string literal (`JSON.parse('...')` with `\"` and `\u` escapes) and must be decoded as a string literal and then parsed; never `eval` it.
- The service worker could instead fetch the song page HTML.
  A plain HTTP client received all song pages (200) here, but the Genius home page returned 403 and the Genius search API returns 403 to a plain client (see `docs/genius-navigation.md`), so reading the page the user already has open is safer than refetching it.
- Reading the open page costs no request, needs no new permission, host or stored value, and so changes neither `PRIVACY.md` nor `store/listing.md`.

## Per-song table

The "Apple check" and "Spotify check" columns show what Apple or Spotify returned for the id (title / album).
"none" means the page carries no Spotify id.

| # | Genius path | Year | Lang | Apple id | Apple check | Spotify id | Spotify check | Other media |
|---|---|---|---|---|---|---|---|---|
| 1 | `/Kendrick-lamar-not-like-us-lyrics` | 2024 | en | 1744776167 | iTunes: Not Like Us / Not Like Us - Single | none |  | soundcloud, youtube |
| 2 | `/Sza-sos-lyrics` | 2022 | en | 1657869385 | iTunes: SOS / SOS | none |  | soundcloud, youtube |
| 3 | `/Olivia-rodrigo-good-4-u-lyrics` | 2021 | en | 1560735551 | iTunes: good 4 u / SOUR | 6PERP62TejQjgHu81OHxgM | oEmbed: good 4 u | soundcloud, youtube |
| 4 | `/Billie-eilish-chihiro-lyrics` | 2024 | en | 1739659141 | iTunes: CHIHIRO / HIT ME HARD AND SOFT | none |  | soundcloud, youtube |
| 5 | `/Taylor-swift-fortnight-lyrics` | 2024 | en | 1736268216 | iTunes: Fortnight (feat. Post Malone) / THE TORTURED POETS DEPARTMENT | none |  | soundcloud, youtube |
| 6 | `/Rosalia-and-j-balvin-con-altura-lyrics` | 2019 | es | 1457085979 | iTunes: Con Altura (feat. El Guincho) / Con Altura (feat. El Guincho) - Single | none |  | soundcloud, youtube |
| 7 | `/Bad-bunny-monaco-lyrics` | 2023 | es | 1710982872 | iTunes: MONACO / nadie sabe lo que va a pasar mañana | none |  | soundcloud, youtube |
| 8 | `/Rosalia-saoko-lyrics` | 2022 | es | 1607918359 | iTunes: SAOKO / MOTOMAMI | none |  | soundcloud, youtube |
| 9 | `/Bts-dynamite-lyrics` | 2020 | en | 1597024424 | iTunes: Dynamite / Dynamite (DayTime Version) - EP | none |  | youtube |
| 10 | `/Ed-sheeran-shape-of-you-lyrics` | 2017 | en | 1193701392 | iTunes: Shape of You / ÷ (Deluxe) | 0FE9t6xYkqWXU2ahLh6D8X | oEmbed: Shape of You | youtube, soundcloud |
| 11 | `/The-beatles-let-it-be-lyrics` | 1970 | en | 401151904 | song page title matches | 7iN1s7xHE4ifF5povM6A48 | oEmbed: Let It Be - Remastered 2009 | youtube |
| 12 | `/Queen-bohemian-rhapsody-lyrics` | 1975 | en | 932648449 | unresolved | 7tFiyTwD0nx5a1eklYtX2J | oEmbed: Bohemian Rhapsody - Remastered 2011 | youtube, soundcloud |
| 13 | `/Nirvana-smells-like-teen-spirit-lyrics` | 1991 | en | 485495704 | song page title matches | 5ghIJDpPoe3CfHMGu71E6T | oEmbed: Smells Like Teen Spirit | youtube, soundcloud |
| 14 | `/Michael-jackson-billie-jean-lyrics` | 1982 | en | 159293848 | iTunes: Billie Jean (Single Version) / The Essential Michael Jackson | 5ChkMS8OtdzJeqyybCc9R5 | oEmbed: Billie Jean | youtube, soundcloud |
| 15 | `/Daft-punk-get-lucky-lyrics` | 2013 | en | 617154366 | iTunes: Get Lucky / Random Access Memories | 2Foc5Q5nqNiosCNqttzHof | oEmbed: Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers] | youtube, soundcloud |
| 16 | `/Dua-lipa-houdini-lyrics` | 2023 | en | 1746338874 | unresolved | none |  | soundcloud, youtube |
| 17 | `/Charli-xcx-360-lyrics` | 2024 | en | 1739079976 | iTunes: 360 / BRAT | none |  | soundcloud, youtube |
| 18 | `/Sabrina-carpenter-espresso-lyrics` | 2024 | en | 1740212434 | iTunes: Espresso / Espresso - Single | none |  | soundcloud, youtube |
| 19 | `/Chappell-roan-good-luck-babe-lyrics` | 2024 | en | 1737497080 | iTunes: Good Luck, Babe! / Good Luck, Babe! - Single | none |  | soundcloud, youtube |
| 20 | `/Tyler-the-creator-see-you-again-lyrics` | 2017 | en | 1254572572 | iTunes: See You Again (feat. Kali Uchis) / Flower Boy | none |  | soundcloud, youtube |
| 21 | `/Kanye-west-runaway-lyrics` | 2010 | en | 1440742918 | iTunes: Runaway (feat. Pusha T) / My Beautiful Dark Twisted Fantasy | 3DK6m7It6Pw857FcQftMds | oEmbed: Runaway | youtube, soundcloud |
| 22 | `/Drake-gods-plan-lyrics` | 2018 | en | 1418213269 | iTunes: God's Plan / Scorpion | 2XW4DbS6NddZxRPm5rMCeY | oEmbed: God's Plan | youtube, soundcloud |
| 23 | `/Beyonce-texas-hold-em-lyrics` | 2024 | en | 1730408498 | iTunes: TEXAS HOLD 'EM / TEXAS HOLD 'EM - Single | none |  | soundcloud, youtube |
| 24 | `/Rihanna-diamonds-lyrics` | 2012 | en | 1444321282 | iTunes: Diamonds / Diamonds - Single | 6O20JhBJPePEkBdrB5sqRx | oEmbed: Diamonds | youtube, soundcloud |
| 25 | `/Lorde-royals-lyrics` | 2013 | en | 703590283 | song page title matches | 4zztp85oS36ijgAWwyhX8p | oEmbed: Royals | youtube, soundcloud |
| 26 | `/Lil-nas-x-old-town-road-remix-lyrics` | 2019 | en | 1468166326 | iTunes: Old Town Road (feat. Billy Ray Cyrus) [Remix] / 7 | 6u7jPi22kF8CTQ3rb9DHE7 | oEmbed: Old Town Road (feat. Billy Ray Cyrus) - Remix | youtube, soundcloud |
| 27 | `/Doja-cat-say-so-lyrics` | 2019 | en | 1486263180 | iTunes: Say So / Hot Pink | none |  | soundcloud, youtube |
| 28 | `/Stromae-papaoutai-lyrics` | 2013 | fr | 686571344 | song page title matches | 1QFw2xxyQtgKjlrMCEqsNj | oEmbed: Papaoutai | youtube, soundcloud |
| 29 | `/Yoasobi-yoru-ni-kakeru-lyrics` | 2019 | ja | 1542182776 | iTunes: Yoru ni kakeru / THE BOOK | none |  | soundcloud, youtube |
| 30 | `/Kendrick-lamar-humble-lyrics` | 2017 | en | 1223592498 | song page title matches | 3GnLo84IkdSWCPYt6tnLll | oEmbed: HUMBLE. | youtube, soundcloud |
| 31 | `/Radiohead-creep-lyrics` | 1992 | en | 1097862231 | iTunes: Creep / Pablo Honey | 6b2oQwSGFkzsMtQruIWm2p | oEmbed: Creep | youtube, soundcloud |
| 32 | `/Fleetwood-mac-dreams-lyrics` | 1977 | en | 594061856 | iTunes: Dreams / Rumours | 0ofHAoxe9vBkTCp2UQIavz | oEmbed: Dreams - 2004 Remaster | youtube |
| 33 | `/Pink-floyd-comfortably-numb-lyrics` | 1979 | en | 1065976170 | iTunes: Comfortably Numb / The Wall | 5HNCy40Ni5BZJFw1TKzRsC | oEmbed: Comfortably Numb | soundcloud, youtube |
| 34 | `/Taylor-swift-cruel-summer-lyrics` | 2019 | en | 1677234270 | iTunes: Cruel Summer / The More Lover Chapter - EP | none |  | soundcloud, youtube |
| 35 | `/Travis-scott-sicko-mode-lyrics` | 2018 | en | 1421242781 | iTunes: SICKO MODE / ASTROWORLD | 2xLMifQCjDGFmkHkpNLD9h | oEmbed: SICKO MODE | soundcloud, youtube |
| 36 | `/Bad-bunny-and-chencho-corleone-me-porto-bonito-lyrics` | 2022 | es | 1622045634 | iTunes: Me Porto Bonito / Un Verano Sin Ti | none |  | youtube |
| 37 | `/Wizkid-essence-lyrics` | 2020 | en | 1531532767 | iTunes: Essence (feat. Tems) / Made In Lagos | none |  | youtube |
| 38 | `/Burna-boy-last-last-lyrics` | 2022 | en | 1623677811 | iTunes: Last Last / Love, Damini | none |  | soundcloud, youtube |
| 39 | `/Gracie-abrams-thats-so-true-lyrics` | 2024 | en | 1773474483 | iTunes: That’s So True / The Secret of Us (Deluxe) | none |  | soundcloud, youtube |
| 40 | `/Taylor-swift-the-fate-of-ophelia-lyrics` | 2025 | en | 1842897454 | iTunes: The Fate of Ophelia / The Life of a Showgirl | none |  | soundcloud, youtube |
| 41 | `/Sabrina-carpenter-manchild-lyrics` | 2025 | en | 1818103445 | iTunes: Manchild / Manchild - Single | none |  | soundcloud, youtube |
| 42 | `/Rose-and-bruno-mars-apt-lyrics` | 2024 | ko | 1773452221 | iTunes: APT. / APT. - Single | none |  | soundcloud, youtube |
| 43 | `/Lady-gaga-abracadabra-lyrics` | 2025 | en | 1793869710 | iTunes: Abracadabra / Abracadabra - Single | none |  | soundcloud, youtube |
| 44 | `/Kendrick-lamar-and-sza-luther-lyrics` | 2024 | en | 1781270323 | iTunes: luther / GNX | none |  | soundcloud, youtube |
| 45 | `/Olivia-rodrigo-vampire-lyrics` | 2023 | en | 1694386830 | iTunes: vampire / GUTS | none |  | soundcloud, youtube |
| 46 | `/Frank-ocean-nights-lyrics` | 2016 | en | 1146195720 | iTunes: Nights / Blonde | 4Jle0Cjj88YkM7jbAjiFjf | oEmbed: Nights |  |

Four slug guesses were 404 and are not in the table (Shakira and Bizarrap Vol. 53 in two spellings, Bad Bunny "Debi Tirar Mas Fotos", and a "Not Like Us single" slug).
The Genius home page returned 403 and was not used.

## Coverage

| | Count | Share |
|---|---|---|
| Songs sampled | 46 | |
| Apple Music id on the page | 46 | 100% |
| Apple id confirmed as the same song | 44 | 96% |
| Apple id unconfirmed (retired id) | 2 | 4% |
| Spotify track id on the page | 19 | 41% |
| Spotify id confirmed as the same song | 19 | 100% of those |
| Spotify id, songs released up to 2018 | 17 of 18 | 94% |
| Spotify id, songs released 2019 or later | 2 of 28 | 7% |
| YouTube link | 46 | 100% |
| SoundCloud link | 40 | 87% |

The sample is biased towards well-known songs, which Genius covers best; pages of small artists likely have fewer links, so 41% is an upper estimate for Spotify.
Every song here is on Apple Music; a song that is not would have no id, and that case was not sampled.

## Risks

- **Markup and field changes.** `appleMusicId`, `spotifyUuid` and the state name are internal fields of Genius's web app, not a public contract.
  Keep the reader in one file next to `src/genius/selectors.ts`, validate each field (digits only for Apple, 22 base62 characters for Spotify), and fail to "no link found".
- **Wrong release.** The Apple id can be another release than the user's tab (3 of 7 bench songs), and credits can differ slightly between a single and an album.
  Show the album title the page resolves to.
- **Retired ids.** 2 of 46 Apple ids do not resolve.
  Get credits on one must end with the existing "not found" message, not a guess.
- **Wrong Spotify ids.** None seen in 19, but editors enter them by hand; confirm with the Spotify reader before trusting one.
- **Untrusted data.** Build the URL from the id only (`music.apple.com/us/song/<digits>`, `open.spotify.com/track/<22 characters>`); never follow a URL taken from the page.
- **Storefront.** The Genius id carries no storefront; `us` worked for 44 of 46, other storefronts were not needed.

## Recommendation

1. **Primary source: Genius's own ids.**
   On a song page, read `appleMusicId` and `spotifyUuid` from the inline state script, validate them, and list the two pages, each with a Get credits button.
   Apple is available on every page checked, so no search is needed for it.
2. **Apple: a lookup, not a search.**
   If the id does not resolve (about 4% here), say "No Apple Music page found" and do nothing else.
   Prefer the album form of the URL (one iTunes lookup by id gives `collectionId`) so the Apple reader gets the copyright fields.
3. **Spotify: a fallback is needed.**
   About 6 of 10 songs have no Spotify id on Genius, and about 9 of 10 songs released from 2019 on have none.
   For those, run the existing Spotify provider's search by title and artist, with the strict exact-match rules of `docs/genius-navigation.md` applied in reverse, or show "Not linked on Genius" with a Search button; nothing runs automatically.
4. Identify a song page by `og:type = music.song` plus `currentPage = "songPage"`, not by the URL alone.
5. Scope: songs only.
   Album pages (`currentPage = "islands"`) are later and need their own study.

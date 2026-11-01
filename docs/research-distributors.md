# Research: can a song's distributor be found reliably?

Status: research, then built as described under "Implemented" at the end; the rest of this note is the original study.
Measured on 2026-10-30.

## Verdict

**Partial go, behind a narrow rule.**

- The distributor is **not** published by any free source we can reach without a login.
  Apple Music, the iTunes API, Deezer, MusicBrainz and Discogs return the label or the ℗ owner, not the distributor.
  Spotify's "Source" credit is not reachable without a login.
- For **major-label releases** the distributor is the label's parent group (Sony Music Entertainment, Universal Music Group, Warner Music Group).
  It can be derived from the ℗ line we already scrape with a small label-to-group table.
  This matched Genius's own human-entered "Distributor" credit in 6 of 6 major-label cases.
- For **self-released and aggregator releases** (DistroKid, TuneCore, CD Baby, Ditto, and so on) no source tested names the distributor with usable reliability.
  The one automatic signal (YouTube "Provided to YouTube by", plus the ISRC prefix as a lead) is too sparse or too unverified to ship.
- Recommendation: ship only the label-to-group rule, as an **opt-in, review-before-paste** additional role "Distributor".
  Never guess for anything else; leave the field empty.
  Do not build an aggregator detector yet.

## Method

- 34 tracks, serialized, one request at a time with a pause after each (1.3 to 3 s depending on host).
  No logins, no credentials, no API keys.
- Mix chosen before looking at results: 12 major-label, 8 indie-label, 14 "self-released" guesses.
  Several of the 14 turned out to be label-backed (Dax on Columbia, Lil Dicky on BMG, Jinsang on Vinyl Digital, Boy Pablo on 777), so the class column is the expected class, not a verified one.
- The case set is bigger than `bench/cases.json` (7 cases); SZA, Olivia Rodrigo, Billie Eilish, Taylor Swift, Kendrick Lamar and ROSALIA come from it, the rest are new.
- 6 tracks could not be found on the US iTunes/Apple Music storefront (Bon Iver, Hopsin, Adam Calhoun, Ryan Upchurch, Lil Dicky, Rex Orange County), so no ℗ line exists for them.
  This matters for the feature: no Apple page means no ℗ line and no rule input.
- The probe script is a throwaway (Python, standard library only) and is not committed.

### Ground truth, and its limits

There is no authoritative public database of distributors.
The least bad cross-check is Genius's own **"Distributor" credit**, entered by editors on the song page (it is a real role there; see below).
Where the page exists and has it, that is the truth for this project, because it is what we would be pasting.

- Genius "Distributor" present: 7 of 34 tracks (SZA, Olivia Rodrigo, Kendrick Lamar, The Weeknd, Adele, Dax, Chance the Rapper).
- One more case verified by two independent public signals: Jinsang, "Provided to YouTube by Label Engine" on the correct Topic video, with Discogs showing the ℗ owner Vinyl Digital GmbH and "Licensed To: jinsang".
- That makes a **truth set of 8**.
  It is small and skewed to major labels, because editors fill the credit mostly for major releases.
  Read all accuracy figures below as indications, not as statistics.

## Distributor is not label

| | Label (the ℗ owner or licensee) | Distributor |
|---|---|---|
| Example, SZA "SOS" | Top Dawg Entertainment and RCA Records | Sony Music Entertainment |
| Example, Adele "Easy On Me" | Melted Stone and Columbia Records | Sony Music Entertainment |
| Example, Chance the Rapper | Chance the Rapper LLC (self) | Ditto Music |
| Example, Dax "Dear Alcohol" | Records Label LLC and Columbia Records | Sony Music Entertainment and Ten2 |
| Where Apple shows it | In the ℗ and © lines | Nowhere |

- Genius shows both as separate credits on the song page: "Label", "Phonographic Copyright ℗", "Copyright ©", "Distributor", "Publisher" (all seen on the live page for SZA "SOS").
- Apple's ℗ line mixes the two ideas: "marketed by Republic Records, a division of UMG Recordings" names a label and a group, but it says nothing explicit about distribution.
- Genius credits the **corporate group** as distributor for major releases (Sony Music Entertainment, Universal Music Group), not the imprint.
  That is why the derivation rule works.

## Results per source

Coverage = the source returned anything usable for the track.
"Names a distributor" = the returned string is a distributor in Genius's sense, checked against the truth set (n = 8).

| Source | Hosts | Coverage (of 34) | Names a distributor (of 8 truth) | Notes |
|---|---|---|---|---|
| Apple ℗ line (via iTunes lookup, same string as the page) | `itunes.apple.com`, `music.apple.com` | 28 | 0 literally; **6 of 8 after a label-to-group map** | The page fetched with plain HTTP also carries the ℗ line (checked for SOS). The iTunes `search` result has no copyright field; `lookup` by collection id does. |
| Deezer album `label` | `api.deezer.com` | 32 | 0 | Mostly the ℗ owner again. Wrong or odd in 3 of 34: Olivia Rodrigo "Olivia Rodrigo PS", Beach House "Bella Union" (Apple says Sub Pop), Kupla "Lofi Girl" (Apple says Lofi Records). Also gives the ISRC. |
| MusicBrainz (ISRC lookup, releases with labels and label relations) | `musicbrainz.org` | 26 had labels | 0 | The "distributed by" relation was empty in all 26. Label lists are noisy: The Weeknd returned 31 labels across regional releases, many tracks return "[no label]". |
| Discogs (search, plus release detail for 22 non-major) | `api.discogs.com` | 32 found a release | 0 | No "Distributed By" company in any of the 22 detail records. "Licensed To" appeared on 3 (Jinsang, Idealism, Rex Orange County: AWAL Recordings). Physical-release oriented; top hit was a wrong album at least once (Kendrick: "Unc Records"). |
| Genius song page, "Distributor" credit | `genius.com` | 28 pages found, **7 have a Distributor** | 7 (it is the truth) | Human-entered, mostly on major releases. Using it as a source would be circular: the user is on the edit page to fill exactly this. |
| YouTube auto-generated Topic video, "Provided to YouTube by X" | `www.youtube.com` | Topic video found for 6 of 20 searched; **right artist for 1 of 6** | 1 of 1 where the artist was right | 4 of 6 hits were a different artist's Topic video (Mitski gave "Tunearo", Idealism gave "CDBaby", Hopsin gave "Xelon Entertainment", Beach House gave "The Orchard Enterprises"). Shipping this would produce confident wrong answers. For major releases the string is the label ("RCA Records Label"), not the group. |
| Spotify public track page, embed and oEmbed | `open.spotify.com` | 0 of 3 probes | not applicable | No label, copyright or "Source" in the HTML or embed. The credits dialog with "Source" is served to the logged-in app only. Excluded: it needs a login. |

### Not tested

- **ISRC registrant prefix** as a distributor fingerprint.
  Deezer returns ISRCs, and aggregator prefixes look consistent in this sample (both Tom MacDonald and Bryson Gray start `TCAF`, which is consistent with TuneCore; Chance the Rapper's `GBMA2` is consistent with Ditto Music).
  I found no free, authoritative registrant list to check this against, so it stays an unverified lead.
  It is the only idea with a path to covering self-released releases; verifying it needs a registrant table from IFPI/RIAA or a labelled corpus, not more scraping.
- Spotify's authenticated credits, Apple Music's authenticated API (`recordLabel`), Beatport, Bandcamp, Soundcharts, and paid metadata APIs.
- Genius's add-credit dropdown.
  The "Distributor" role is visible on song pages, but I did not log in to confirm that the edit form's role picker accepts the exact name "Distributor" (same method as the note at the top of `extension/src/core/geniusRoles.ts`: measure on the live form).
  The owner should check this once before any code is written.

### Per-track results

Apple ℗ line has the year stripped; "-" means the source returned nothing; the Genius column shows "no page" when the guessed URL was not found.

| # | Track | Class | Apple ℗ line | Deezer label | Genius Distributor | YouTube "Provided to" |
|---|---|---|---|---|---|---|
| 1 | SZA - SOS | major | Top Dawg Entertainment, under exclusive license… | Top Dawg Entertainment/RCA Reco… | Sony Music Entertainment | - |
| 2 | Olivia Rodrigo - good 4 u | major | Olivia Rodrigo, under exclusive license to Geff… | Olivia Rodrigo PS | Universal Music Group | - |
| 3 | Billie Eilish - BIRDS OF A FEATHER | major | Darkroom/Interscope Records | Darkroom/Interscope Records | - | - |
| 4 | Taylor Swift - Fortnight | major | Taylor Swift | Taylor Swift | - | - |
| 5 | Kendrick Lamar - Not Like Us | major | Kendrick Lamar, under exclusive license to Inte… | Kendrick Lamar, under exclusive… | Universal Music Group | - |
| 6 | ROSALÍA - Con Altura | major | Columbia Records, a Division of Sony Music Ente… | Columbia | - | - |
| 7 | Dua Lipa - Levitating | major | Dua Lipa Limited under exclusive license to War… | Warner Records | - | - |
| 8 | The Weeknd - Blinding Lights | major | The Weeknd XO, Inc., marketed by Republic Recor… | Republic Records | Universal Music Group | - |
| 9 | BTS - Dynamite | major | BIGHIT MUSIC | BIGHIT MUSIC | - | - |
| 10 | Adele - Easy On Me | major | Melted Stone under exclusive license to Columbi… | Columbia | Sony Music Entertainment | - |
| 11 | Sabrina Carpenter - Espresso | major | Island Records, a division of UMG Recordings, I… | Island Records | - | - |
| 12 | Drake - Hotline Bling | major | Young Money Entertainment/Cash Money Records | Cash Money Records/Young Money … | - | - |
| 13 | Phoebe Bridgers - Motion Sickness | indie | Dead Oceans | Dead Oceans | - | no Topic video |
| 14 | Bon Iver - Holocene | indie | not found | Jagjaguwar | - | no Topic video |
| 15 | Arctic Monkeys - Do I Wanna Know? | indie | Domino Recording Co Ltd | Domino Recording Co | - | no Topic video |
| 16 | Big Thief - Simulation Swarm | indie | Big Thief under exclusive license to 4AD Ltd | 4AD | - | no Topic video |
| 17 | Fontaines D.C. - Starburster | indie | 32 County Love Train Ltd under exclusive licens… | XL Recordings | no page | no Topic video |
| 18 | Japanese Breakfast - Be Sweet | indie | Dead Oceans | Dead Oceans | - | no Topic video |
| 19 | Beach House - Space Song | indie | Sub Pop Records | Bella Union | - | The Orchard Enterprises (wrong artist) |
| 20 | Mitski - Washing Machine Heart | indie | Dead Oceans | Dead Oceans | - | Tunearo (wrong artist) |
| 21 | Tom MacDonald - Dear Slim | self | Tom MacDonald | Tom MacDonald | - | no Topic video |
| 22 | Hopsin - Ill Mind of Hopsin 5 | self | not found | Undercover Prodigy | - | Xelon Entertainment (wrong artist) |
| 23 | Jinsang - Affection | self | Vinyl Digital GmbH | VinDig | - | Label Engine |
| 24 | Dax - Dear Alcohol | self | Records Label, LLC / Columbia | Records/Columbia | Sony Music Entertainment & Te… | no Topic video |
| 25 | Mr. Kitty - After Dark | self | Negative Gain Productions | Negative Gain Productions | no page | none (wrong artist) |
| 26 | Adam Calhoun - Hate Me | self | not found | - | no page | no Topic video |
| 27 | Ryan Upchurch - Hold On | self | not found | - | no page | no Topic video |
| 28 | Bryson Gray - Let's Go Brandon | self | Xposure Music | Xposure Music | no page | no Topic video |
| 29 | Boy Pablo - Everytime | self | 777 MUSIC | 777 Music | - | no Topic video |
| 30 | Chance the Rapper - All Day Long | self | Chance the Rapper LLC | Chance The Rapper | Ditto Music | no Topic video |
| 31 | Kupla - Slumber | self | Lofi Records | Lofi Girl | no page | no Topic video |
| 32 | Idealism - Controlla | self | Cookie Dough Records | Cookie Dough Records | - | CDBaby (wrong artist) |
| 33 | Lil Dicky - Freaky Friday | self | not found | Commission/BMG | - | no Topic video |
| 34 | Rex Orange County - Loving Is Easy | self | not found | Rex Orange County | - | no Topic video |

## Mapping to Genius's role name

- The Genius role is **"Distributor"**, an additional credit whose value is an entity (an artist/company search result), same shape as "Label".
- Neither `scraper/roles.py` nor `extension/src/core/geniusRoles.ts` mentions it, because Apple has no distributor role to translate.
  No `ROLE_MAP` entry or `geniusRole()` change is needed; the queue carries the Genius name directly.
- Value on Genius for major releases is the group name as Genius spells it: "Sony Music Entertainment", "Universal Music Group".
  The Genius entity search must resolve that string to an existing entity, as it does for labels today.
  Warner Music Group's exact spelling on Genius was not in the sample and needs a one-time check.

## Legal, terms and rate-limit risk

| Host | Risk | Note |
|---|---|---|
| `music.apple.com`, `*.mzstatic.com` | Already used by the app. | No new traffic. The ℗ line is already scraped. |
| `itunes.apple.com` | Low. | Public Search/Lookup API, no key. Apple documents roughly 20 calls per minute per IP; the probe stayed well below. Already used for covers. |
| `api.deezer.com` | Low. | Public API without a key, quota of about 50 requests per 5 seconds. Already used for covers. Terms restrict storing or redistributing catalogue data; a transient lookup is fine. |
| `musicbrainz.org` | Low, but rate-bound. | Hard limit of 1 request per second, descriptive User-Agent required. Data is CC0 but the service is run by a non-profit, so keep it out of the default path. Gains nothing here anyway. |
| `api.discogs.com` | Medium. | Unauthenticated search worked in this test but Discogs documents authentication and a 25 requests per minute limit for unauthenticated clients. Data use is restricted by their API terms. Gains nothing here anyway. |
| `genius.com` | Medium. | Reading a song page as ground truth is fine for research. Using it as a runtime source is circular and scraping it at scale is against their terms. Not recommended. |
| `www.youtube.com` | Medium. | Already used. The "Provided to YouTube by" lookup adds a second request per song and Google blocks scripted fetches intermittently (see the YouTube note in the project memory). Unreliable, see above. |
| `open.spotify.com` | High if pursued. | The credits data needs a logged-in session or an undocumented token flow. Out of bounds under the no-login rule and against Spotify's terms. |

Quota figures in the table are from the vendors' documentation as I recall it and were not re-verified.

Hosts contacted during this research, request counts:

- `itunes.apple.com`: 60
- `api.deezer.com`: 64
- `musicbrainz.org`: 57
- `api.discogs.com`: 53
- `genius.com`: 33 song pages plus 1 earlier manual page
- `www.youtube.com`: 28
- `open.spotify.com`: 4 (one guessed-ID page, then one page, one embed and one oEmbed)
- `music.apple.com`: 1 (one album page, to confirm the ℗ line is in the plain HTML)

Several counts are above "a few dozen" because each track needs two or three calls on most hosts (search, then lookup or detail).
Everything ran serialized.

Distributor names are facts about a recording, not creative content, and the recommended rule needs no new network traffic at all.
No logins were used and no credentials were entered anywhere.

## Recommendation

1. **Go (partial): derive the group distributor from the ℗ line.**
   - Input: the labels already parsed by `_extract_labels` / `extractLabels` from the ℗ line, plus the "division of / marketed by" text.
   - A fixed table maps label families to a group: Sony (RCA, Columbia, Epic, Arista, Legacy, "Sony Music"), Universal (Geffen, Interscope, Republic, Island, Def Jam, Capitol, Virgin, Polydor, "UMG Recordings"), Warner (Warner Records, Atlantic, Elektra, Parlophone, Reprise).
   - Output: one string, or empty when no label matches.
   - Measured: 6 of 6 correct on the major-label cases in the truth set, with Dax missing the extra "Ten2".
     It does not generalise to indies or aggregators: Chance the Rapper (Ditto) and Jinsang (Label Engine) yield nothing, which is the right outcome.
2. **No-go for aggregator discovery from the tested sources.**
   Revisit only if the ISRC-prefix idea is verified against a labelled corpus of 100 or more tracks.
3. **Make it opt-in and reviewable.**
   Off by default, an editable value on the credits screen (as with the YouTube link), and never pasted when empty.
   A wrong distributor on Genius is worse than a missing one.
4. **Keep it out of the benchmark's accuracy figures until a golden set exists** (see test plan).

### Why not simply copy the label

Because Genius credits the group, not the imprint, pasting "RCA Records" as Distributor would be wrong 6 of 6 times.
It is the same reason the Label credit and the Distributor credit are separate rows.

## Implementation outline

All names below match the current code; nothing here has been built.

### Desktop (`scraper/`)

- `scraper/distributor.py` (new, pure, no I/O): `derive_distributor(phonographic_copyright: str) -> str`.
  - Reuses `_extract_labels` (move it to a shared helper only if a second module needs it) and a module constant `LABEL_GROUPS: dict[str, str]` (lowercase label key to canonical Genius name), in the style of `ROLE_MAP`.
  - Unknown label returns `""`; two different groups in one line return `""` (ambiguous, leave it to the user).
- `scraper/models.py`:
  - `SongCredits.distributor: str = ""` with a validator that turns non-strings into `""` (same pattern as `release_date`); older saved songs still load.
  - `typed_queue(..., include_distributor: bool = False)`; when true and `distributor` is set, append `("role", "Distributor")` then `("artist", self.distributor)` in the additional-credits block, after Written By, Produced By and the other additional roles and before the copyright rows.
  - No new queue kind: `role` and `artist` already cover it, so `_TYPE_COLORS`, `_FIELD_LABELS` and Auto-Tab need no new entries.
- `scraper/pipeline.py`: set `distributor` from the scraped ℗ line after the scrape; no extra network call.
- `utils/config.py`: a typed `Settings` flag (for example `include_distributor: bool = False`), a line in `Settings.save()`, and a README configuration row, per the project rules.
- The desktop manual hotkey mode is frozen (AGENTS.md), so only the shared model and queue change; no GUI work is part of this.

### Extension (`extension/src/`)

- `core/distributor.ts` (new): a port of `derive_distributor` with the same label table; a unit test fixture shared with the Python table so the two cannot drift.
- `core/models.ts`:
  - `SongCredits.distributor: string` (default `""`).
  - `QueueOptions.includeDistributor?: boolean`; `typedQueue()` emits the same `["role", "Distributor"]`, `["artist", name]` pair in the same position as the Python version.
  - Keep `QueueKind` unchanged.
- `core/geniusRoles.ts`: no change (the name is already Genius's).
- Paste steps (`core/paste.ts`, `background/paste.ts`, `core/flow.ts`): the pair rides on the existing additional-credit steps (role dropdown, then entity search), so no new step type is required; add one test that the pair is pasted in order and that an empty value is skipped.
- UI: an editable "Distributor" field with the derived value preselected on the credits screen and a toggle in settings, off by default.

### Tests (offline, no network)

- Unit: `derive_distributor` for each major group and imprint, a division-of line, a marketed-by line, an unknown label, a self line ("Chance the Rapper LLC") and two conflicting groups.
- Queue: `typed_queue()` order with and without the flag, and with an empty value.
- Golden: add `distributor` to the reviewed golden files only after a manual check of each value (SZA: Sony Music Entertainment; Rodrigo and Kendrick: Universal Music Group), never from scraper output.
- Python and TypeScript table parity test.

### Order of work (small slices)

1. Owner confirms on the live Genius form that "Distributor" is accepted and how "Warner Music Group" is spelled.
2. Pure function plus table plus unit tests (Python), then the TypeScript port.
3. Model field and queue pair behind the flag, in both languages.
4. Settings flag, credits-screen field, README.
5. Optional later: ISRC-prefix research as a separate task.

## Implemented

The owner asked for it to be built, so it ships without an opt-in flag, in a slightly different shape than the outline above.

- `scraper/labels.py` holds the reviewed table `LABEL_GROUPS` (name phrase to Genius label and group) and `derive_label_info`; `tools/export_labels.py` writes it to `extension/data/labels.json` and `extension/src/core/labels.ts` is the port, held to it by vectors.
- Evidence for the acceptance song (Trade Places, Jack Harlow): the album page and the iTunes lookup both give only the line "℗ 2026 Atlantic Recording Corporation"; neither has a label or distributor field. The table gives Label "Atlantic Records" and Distributor "Warner Music Group".
- The values are derived when the queue is built, not stored. They are queued as `role`/`artist` pairs ("Label", "Distributor"; both exist on Genius's standardized role list) after the other additional credits and before the copyright rows, and follow the copyright toggle. A role the credits already carry is not repeated.
- Only clear evidence fills a value: exactly one known label, one known group, or a stated "distributed by". Several different labels or groups leave it empty.
- A `/song/` page has no footer (the saved song page has no ℗/© line, and the iTunes record of the song has no `copyright`). Chosen source: iTunes lookup of the song id gives `collectionId`, a second lookup of that album gives `copyright` (`℗ 2026 Atlantic Recording Corporation`). Reasons: no extra Apple tab or page load, the host is already used for covers, and the same two requests work in Python (`deezer.fetch_itunes_copyright`) and the extension (`lookupCopyright`, applied by the router after `detect`). iTunes gives one line, so only ℗ (or ©) is filled; the page footer's separate © line is not available this way.
- Spotify reads use the same table on the ℗ line the page shows; the review screen marks the source as Spotify's.
- Still unchecked on the live Genius form: how the Distributor entity search resolves "Warner Music Group", and the exact order of Label/Distributor against other roles (Genius's role rows are free-order).

# Research: reading credits from other music services

Date of research: 30 October 2026.
Question: small artists are often missing from Apple Music, so can the extension (and later the desktop app) read credits from Spotify and other services, and how would the code have to change?

Short answer: **Spotify is a go**, through the credits dialog of its public web player.
**Deezer is a conditional go** (writers only, as a fallback).
**SoundCloud is a conditional go** for a narrow case (one writer string, label and ℗ line, when the uploader filled them in).
**Bandcamp is no-go** for structured credits (free text only), though its release date and cover are easy.
**Tidal is no-go** for now (credits need an authenticated API).

Everything below marked "verified" was observed on 30 October 2026 with a handful of requests.
Everything marked "not tested" comes from prior knowledge and must be confirmed by a spike before relying on it.

## 1. How the research was done

Rules followed: low volume, one request at a time with a pause of a few seconds, no logins, no credentials, no cookies set beyond rejecting the consent banner.
The anonymous access token that Spotify's embed page ships in its JSON was seen but **not used** for any request.

Hosts contacted (all read-only GETs unless noted):

| Host | Requests | Why |
|---|---|---|
| `open.spotify.com` | about 8 page loads (curl and the built-in browser), 1 oEmbed, 1 embed page | track pages, credits dialog, search page for small-artist tracks |
| `spclient.wg.spotify.com` | 1 unauthenticated GET | confirm the internal credits endpoint needs a token (answer: 401) |
| `api.spotify.com` | 1 unauthenticated GET | confirm the official Web API needs a token (answer: 401) |
| `i.scdn.co` | 1 image download | check the largest cover size (1500x1500 JPEG) |
| `itunes.apple.com` | 3 searches | check whether the small-artist tracks exist on Apple Music |
| `api.deezer.com` | 2 | track and search JSON |
| `www.deezer.com` | 1 | public track page |
| `tidal.com` | 2 (one redirect) | public track page |
| `soundcloud.com` | 1 | public track page |
| `bandcamp.com` | 4 (home, two tag pages, discover in the browser) | find a real small-artist release |
| `daniellanois.bandcamp.com` | 1 (404, a guessed URL) | none, a wasted request |
| `cindylee.bandcamp.com` | 1 | album page markup |

Tracks tested:

| Track | On Apple Music? | Used for |
|---|---|---|
| Rick Astley, "Never Gonna Give You Up" (`4cOdK2wGLETKBW3PvgPWqT`) | yes | rich credits baseline on Spotify |
| Chris Ash, "Life Simulator" (`0hTuPmBX6BM64SjXHPwdTb`) | no (iTunes search: 0 results) | small artist, full credits dialog |
| Pozer, "Kitchen Stove" (`7diD1MucbcRUVjS6AA9ehm`) | not found under that artist (a different "Kitchen Stove" came back) | metadata only |
| TOX!C, "kitchen" (`1Faes1yX4ZkI2i8sglVZ9n`) | no (0 results) | metadata only |
| Daft Punk, "Harder, Better, Faster, Stronger" (Deezer `3135556`) | yes | Deezer API and page |
| Forss, "Flickermood" (SoundCloud) | n/a | SoundCloud hydration JSON |
| Cindy Lee, "Diamond Jubilee" (Bandcamp album) | n/a | Bandcamp markup |

The iTunes search is only indicative: it confirms these two small-artist tracks are absent from the iTunes catalog, which is the same catalog as Apple Music.

## 2. Spotify (go)

### What exists and where it comes from

| Field | Source | Needs login? | Verified |
|---|---|---|---|
| Title, artist | `<meta property="og:title">` and `og:description` ("Artist · Album · Song · Year") in the server-rendered HTML | no | yes |
| Release date (full) | `<meta name="music:release_date" content="1987-11-12">` | no | yes |
| Cover | `og:image` (640x640 JPEG). Replacing the size code `ab67616d0000b273` with `ab67616d000082c1` returns the original, **1500x1500 JPEG** | no | yes |
| Album and track number | `music:album`, `music:album:track` meta tags | no | yes |
| Songwriters, producers, performers, engineers, studio personnel, publisher ("Sources") | the track's **Show credits** dialog in the web player (see below) | **no**, it opened signed out | yes |
| © and ℗ lines | plain text on the track page ("© 2023 955465 Records DK", "℗ 2023 955465 Records DK") | no | yes |
| Credits as JSON | internal `spclient.wg.spotify.com/track-credits-view/...` | yes, bearer token (401 without) | yes (401) |
| Credits via the official Web API | does not exist (the public `/v1/tracks` has no writers) | needs an app token | 401 seen; the "no writers" part is not tested |

Credits dialog content, signed out, for "Life Simulator" (a track not on Apple Music):

```
Performer:      Chris Ash (main artist)
Composition and lyrics: Christopher Joseph Johnson (lyricist), Bubba Stephens (lyricist)
Production and engineering: Chris Ash (recording engineer), The Basement @ CRC (studio personnel)
Sources:        955465 Records DK
```

For the Rick Astley track it lists composers, producers, a mixer and instrumentalists (guitar, keyboards, backing vocals), which is as rich as Apple's.
So Spotify covers exactly the small-artist gap: Apple has nothing for these tracks, Spotify has the writers the owner needs.

### How the page is built (markup stability)

- The dialog is a React overlay.
  Section headings are `<span>` elements, each row is a `role="group"` with `aria-labelledby="listrow-title-<name>"`, the name in `<span dir="auto">`, the role in `<p id="listrow-subtitle-<name>">`.
- There are **no `data-testid` attributes** inside it and class names are hashed (`e-101040-text`, random strings), so only ARIA roles and structure can be relied on.
  Section order and the `listrow-subtitle-` id prefix are the most stable anchors.
- The menu item that opens it ("Show credits") is found by text, not by id.
- The server-rendered meta tags (title, date, cover) are the most stable part; they exist for link previews and SEO.
  They only appeared for a **plain request without a browser User-Agent string**; with a Chrome UA the same URL returned the bare app shell without tags.
  Inside a real browser tab the page is the normal web player, so the extension reads the rendered DOM and does not depend on the meta tags being served to it, but the `<head>` still carries them after hydration (not tested; the dialog and `og` data are anyway visible in the DOM).

### Open problems (each needs a spike before committing)

1. **Language.**
   The dialog is localized to the browser or account language: the test browser showed Polish ("Kompozytor", "Autor Tekstu", "Realizator", "Wokale Wspierające").
   The extension's `ROLE_MAP` is English.
   Forcing English by URL did not work (`/intl-en/...` was redirected to the unprefixed URL and stayed Polish).
   Options: (a) a translated role table per supported UI language, built from the dialogs of a few reference tracks; (b) switch the player's language through its own language picker (`data-testid="language-option-en"`), which probably sets a cookie, not tested; (c) read the role from the stable section structure only (Composition and lyrics = Songwriter, Production and engineering = Producer) and keep unknown instrument roles as written.
   Recommendation: (c) as the baseline (section headings are also localized, but there are only about five of them and the order is fixed), plus (a) for the user's own language.
2. **Opening the dialog needs a click.**
   A synthetic `element.click()` from page script opened the options menu but did not open the dialog; a real pointer click did.
   A content script can only send synthetic events (`isTrusted: false`), so it may fail the same way.
   The spike must test dispatching the full pointer event sequence (`pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`) from a content script.
   The fallbacks are poor: the `chrome.debugger` API (a scary permission warning, not acceptable for the store listing) or asking the user to open the dialog themselves.
3. **Hidden tabs.**
   The Apple flow reads from a hidden background tab (see `docs/extension-plan.md` and the comment in `extension/src/apple/driver.ts`).
   Whether the Spotify dialog can be opened in a hidden tab is not tested; background tabs throttle timers and may defer React hydration.
4. **Consent banner.**
   A cookie banner overlays the player on first visit and covers the page; the user already dealt with it in their own browser, so a signed-in or already-consented profile is unaffected.
   The extension must never click it.
5. **Per-track cost.**
   One dialog per track, reached only by loading that track's page (about 4 seconds in the test), so an album read is N page loads, the same shape as Apple's song-page flow.
   Album pages list their tracks as `/track/<id>` links, so album detection is feasible (the search page showed such links; an album page was not examined).

### Can the extension read it from a page the user already has open?

Yes for everything except the dialog, which needs the page to be open and one interaction.
Reading the open tab (like `core/appleTabs.ts` does for Apple) works with `host_permissions` for `https://open.spotify.com/*`.
No login is required for any of the fields above, but a signed-in user sees the same credits, so the user's own open tab is equally good.

### Terms of service and rate-limit risk

- Spotify's Developer Terms forbid scraping and using content to train models, and its User Guidelines forbid automated access beyond the apps.
  The extension would only read pages the user opened in their own browser, one track at a time, at human speed, which is the least risky shape available; it is still not "permitted" by the letter of the terms.
- The internal credits API and the anonymous token embedded in the embed page are **out of scope**: using a token not issued to us, against an undocumented endpoint, is the clearly prohibited kind of access and also breaks without notice.
- Rate limiting was not hit at the volume tested (a dozen requests).
  Serialize reads, one track every few seconds, and stop on any 429 or captcha.

### Stability rating

Meta tags: stable.
Credits dialog DOM: medium (hashed classes, no test ids, localized text); expect to fix selectors a few times a year.
Internal API: unstable and out of bounds.

## 3. Deezer (conditional go, fallback only)

| Field | Source | Needs login? | Verified |
|---|---|---|---|
| Title, release date, ISRC, main/featured artists with roles ("Main") | public JSON `https://api.deezer.com/track/<id>` | no | yes |
| Writers | the public track page HTML carries a line `Writer: A, B, C` (server-rendered), not in the JSON API | no | yes (one track) |
| Composer, lyricist, producer split, engineers, label, ℗ | not seen in the public JSON or the page text | likely yes (the logged-in app) | not tested |
| Cover | `md5_image` in JSON, 1000x1000 via the CDN (already used by `extension/src/lookups/deezer.ts`) | no | existing code |

- The write-up is one flat `Writer:` line with no roles, so everything lands under Songwriter.
  Producers and the rest stay unavailable without a login.
- Deezer is **already a host the extension asks for** (optional permission `https://api.deezer.com/*`), so the only new thing is `https://www.deezer.com/*` for the page.
- The `/search` call for "Chris Ash - Life Simulator" returned 0 results: Deezer's catalog is also missing some small artists, so it is not a cure for the Apple gap on its own.
- Stability: the JSON API is documented and stable; the `Writer:` line is HTML that can change.
- Terms: the public API is intended for public use; there is a documented rate limit (about 50 requests per 5 seconds per IP, not tested), far above what we do.
- Verdict: worth adding after Spotify as a "writers only" fallback, because it covers tracks whose Spotify credits are empty.

## 4. SoundCloud (conditional go, narrow)

| Field | Source | Needs login? | Verified |
|---|---|---|---|
| Title, artist, genre, label name, release date, artwork | `window.__sc_hydration` JSON in the track page HTML (`label_name`, `release_date`, `artwork_url`) | no | yes |
| Writer, publisher, ISRC | `publisher_metadata` in the same JSON: `writer_composer`, `publisher`, `isrc`, `artist` | no | yes (one track, filled in) |
| ℗ line | `p_line` and `c_line` keys were **absent** on the tested track | no | not found |
| Producers, other roles | none; there is no structured role list | n/a | yes |

- `writer_composer` is one free string set by the uploader, often empty on small-artist uploads, so it helps only where the uploader filled it in.
- (Not tested, from prior knowledge.) The official API needs a registered app and has been closed to new registrations; the `api-v2` calls the website makes need a `client_id` scraped from its JavaScript, which is not acceptable.
- Reading `__sc_hydration` from the user's own open tab is fine, with `https://soundcloud.com/*`.
- Terms: scraping is prohibited by the terms; reading the user's open tab at human speed is low risk, bulk access is not.
- Stability: the hydration blob has been stable for years but is an implementation detail.
- Verdict: a cheap later slice (about a day) for the "uploader filled in the writer" case; low value otherwise.

## 5. Bandcamp (no-go for credits)

| Field | Source | Verified |
|---|---|---|
| Album and track title, artist, release date | `application/ld+json` and `data-tralbum` JSON in the page | yes |
| Cover | `https://f4.bcbits.com/img/a<art_id>_10.jpg` (original upload) | yes (id present, image not fetched) |
| Credits | one free-text block (`creditText` / `current.credits`), for example "written and recorded by X in Toronto" | yes |
| Writer or producer roles | none | yes |
| ℗ | none; `copyrightNotice` is a licence ("All Rights Reserved") | yes |

Credits are prose with no structure, so nothing can be reliably mapped to Genius roles.
A future slice could offer the text to the user for manual copying, but that is not credit reading.
Terms and stability are fine (the JSON is deliberate and stable); the value is just low.

## 6. Tidal (no-go for now)

- The public track page (`tidal.com/track/<id>`, after one redirect) returned about 9 KB of HTML with title, `og:image` (640x640) and a generic description, and **no credits** (verified).
- The web player's credits come from `api.tidal.com` with a bearer token; Tidal's official API (`openapi.tidal.com`) needs a registered client and is under strict developer terms (not tested).
- Reading the player's DOM (as for Spotify) is the only no-token route; it requires a Tidal login to play and probably to see credits, and was not tested because no accounts may be used.
- Verdict: revisit only if a user with a Tidal login can verify what the signed-in player shows.
  The cover (640 px) and title are not worth a provider by themselves.

## 7. Feasibility table

| | Spotify | Deezer | SoundCloud | Bandcamp | Tidal |
|---|---|---|---|---|---|
| Songwriters | yes, by section | yes, flat line | one string, if filled | no (free text) | not seen |
| Producers | yes | no | no | no | not seen |
| Other roles (engineers, instruments) | yes | no | no | no | not seen |
| Label / ℗ / © | yes, text on the page | no | label only | no | no |
| Release date | yes, full date in meta | yes, full date in JSON | yes, ISO in JSON | yes | not seen |
| Cover | 640 px meta, 1500 px by URL swap (JPEG) | 1000 px | 500 px artwork URL, larger by suffix | original | 640 px |
| Source of data | rendered DOM (dialog) plus meta tags | public JSON plus page line | embedded JSON | embedded JSON and text | needs token |
| Readable from the user's open tab | yes, needs one UI interaction | yes | yes | yes | not tested |
| Works signed out | yes | yes | yes | yes | not applicable |
| Localization risk | **high** (roles and headings translated) | low | none | none | n/a |
| Markup stability | medium | medium (HTML line), high (JSON) | medium | high | n/a |
| ToS risk for reading the user's own tab | medium | low | medium | low | high |
| Covers the Apple gap (small artists) | **yes** | partly | partly | no | unknown |
| Verdict | **GO** | go after Spotify (fallback) | later, narrow | no-go | no-go |

## 8. Proposed provider interface

### 8.1 What is Apple-specific today

| Place | Apple-specific part |
|---|---|
| `extension/src/apple/url.ts` | `parseAppleMusicUrl`: host, storefront, album or song kind |
| `extension/src/apple/driver.ts`, `page.ts`, `credits.ts`, `wait.ts`, `title.ts` | selectors and the credit-card parser; `waitFor`, `sleep` are generic but live there and are imported by `genius/*` |
| `extension/src/apple/handler.ts`, `content.ts` | request validation by Apple URL; one content script per host |
| `extension/src/shared/messages.ts` | `ContentRequest` is `apple/detect` and `apple/scrape`; `AlbumInfo` and `PageScrape` are generic in shape |
| `extension/src/background/appleClient.ts` | opens a hidden tab for a validated URL, injects `apple/content.js` (`ports.ts` `CONTENT_SCRIPT_FILE`), error strings say "Apple Music" |
| `extension/src/background/router.ts` | calls `detectAlbum` and `scrapeTrack` from `appleClient` directly |
| `extension/src/background/covers.ts`, `lookups/itunes.ts` | `exact(appleMusicUrl)` looks the cover up by Apple catalog id |
| `extension/src/core/appleTabs.ts`, `shared/bridge.ts`, `ui/controller.ts` | open-tab discovery by `parseAppleMusicUrl`; UI text names Apple Music |
| `extension/src/core/models.ts`, `shared/session.ts` | `SongCredits.appleMusicUrl`, validated and persisted by name |
| `extension/src/core/roles.ts`, `data/roles.json` | generated from `scraper/roles.py`; English Apple role labels |
| `extension/manifest.json`, `scripts/build.mjs` | `host_permissions`, one content script bundle entry `apple/content` |
| `scraper/apple_music.py`, `scraper/pipeline.py` | Playwright scrape; `pipeline.fetch_track` calls `apple_music` directly; `SongCredits` has no source field; `utils/config.py` settings |
| `scraper/roles.py` | `ROLE_MAP`, the source of `roles.json` |

Already source-neutral and untouched: `core/models.ts` queue logic (`typedQueue`), `genius/*`, `core/paste.ts`, `lookups/youtube*.ts`, `core/copyright.ts`, `core/releaseDate.ts`.

### 8.2 Interface (extension, TypeScript)

New folder `extension/src/providers/` with one module per service and a registry.

```ts
export type ProviderId = "apple" | "spotify" | "deezer" | "soundcloud";

/** A recognised music page: which service, album or track, and its id. */
export interface MusicUrl {
  provider: ProviderId;
  kind: "album" | "track";
  id: string;
  /** Storefront for Apple, empty elsewhere. */
  region: string;
}

export interface CreditsProvider {
  readonly id: ProviderId;
  /** Shown in the UI and errors: "Apple Music", "Spotify". */
  readonly label: string;
  /** Exact origins; drives the manifest check and the tab query. */
  readonly origins: readonly string[];
  /** Strict URL check; null for anything else. The worker refuses to open a tab otherwise. */
  parseUrl(url: string): MusicUrl | null;
  /** Content script bundle that answers this provider's requests, relative to dist. */
  readonly contentScript: string;
  /** Name for the tab list from a tab title and its address. */
  tabName(title: string, url: string): string;
  /** Whether a hidden background tab can run this provider's driver (Apple: yes, Spotify: to be measured). */
  readonly worksHidden: boolean;
  /** Map a raw role label as the page showed it to a Genius role; the page's UI language is passed along. */
  normaliseRole(raw: string, locale: string): string;
  /** Source of the exact cover when the page has none (Apple: iTunes lookup by id; Spotify: size swap, no network). */
  coverFor?(url: MusicUrl, page: PageScrape | AlbumInfo): string;
}

/** The in-page half, bundled into the provider's content script and tested against saved pages. */
export interface PageDriver {
  detect(doc: Document, url: string, timing: Timing): Promise<AlbumInfo>;
  scrape(doc: Document, request: ScrapeRequest, timing: Timing): Promise<PageScrape>;
}
```

Changes this implies, in order of risk:

1. **Messages.**
   `ContentRequest` becomes `{ type: "provider/detect" | "provider/scrape", provider: ProviderId, url, trackTitle? }`.
   `isContentRequest` validates `provider` against the registry.
   `apple/*` message names stay accepted until the content script and worker ship together (they always do, so they can be switched at once).
   `AlbumInfo` and `PageScrape` stay as they are (they are already neutral); add optional `locale` to `PageScrape` so roles can be mapped in the worker.
2. **Worker.**
   Rename `appleClient.ts` to `providerClient.ts`; take the provider from `parseUrl`, inject `provider.contentScript`, and use `provider.label` in error strings.
   `ports.ts` takes the file as an argument instead of the constant.
   Timing: `REAL_CLIENT_TIMING` stays shared; Spotify may need a longer ready wait.
3. **Models.**
   `SongCredits.appleMusicUrl` becomes `sourceUrl` plus `source: ProviderId`.
   `isSongCredits` in `shared/session.ts` must accept a stored session with only `appleMusicUrl` (old data) and map it to `source: "apple"`, so a user's saved session does not become invalid after an update.
   `typedQueue` is unchanged.
4. **Roles.**
   Keep `data/roles.json` as the canonical English Genius role map.
   Add per-provider alias tables (`providers/spotify/roles.ts`: spotify label to the lowercase key `normaliseRole` already understands, per locale) instead of editing `scraper/roles.py`.
   `normaliseRole(raw)` stays unchanged for Apple.
   Spotify's sections (composition and lyrics, production and engineering) give a fallback role when a label is unknown or untranslated.
5. **Open-tab discovery.**
   `appleTabEntries(tabs)` becomes `musicTabEntries(tabs)` using the registry's `parseUrl` and `tabName`; `AppleTabEntry` gains `provider`.
   `shared/bridge.ts` and `ui/controller.ts` replace `parseAppleMusicUrl` with the registry lookup; `core/appleTabs.ts` keeps Apple's title-suffix stripping inside the Apple provider.
   The desktop bridge payload gains `provider` (old desktop builds ignore unknown fields; check `shared/bridge.ts` validation first).
6. **Manifest.**
   Add each new origin to `host_permissions` (or, better, `optional_host_permissions` plus a runtime request, see section 10), and add a `scripting` registration per provider (injection is already on demand via `chrome.scripting.executeScript`, so no static content script is needed).
   `scripts/build.mjs` gets one more entry per provider (`spotify/content`), and `validate-dist.mjs` must check that every provider's `contentScript` exists in `dist`.
7. **UI.**
   Copy that says "Apple Music" (panel strings in `_locales/en/messages.json`, `ui/view.ts`) takes the provider's label.
   The track picker, copyright, cover and release-date rows stay.
   For services with no ℗/© (Deezer, SoundCloud) the existing "missing field" handling applies.
8. **Cover.**
   `CoverService.exact(appleMusicUrl)` becomes `exact(url: MusicUrl)` and is only used for Apple; Spotify returns the size-swapped meta image directly with no network.
   Note Genius takes a PNG: Apple's cover is delivered as a 1000x1000 PNG, Spotify's as a 1500x1500 JPEG.
   The existing `core/cover.ts` normalisation must be checked for the extension (JPEG is accepted by Genius upload, not tested).

### 8.3 Python (`scraper/`)

The desktop app's manual hotkey mode is frozen, and the desktop will be built around the extension link, so Python gets **no Spotify scraper in the first slices**.
What changes there:

- Add a `source` field to `SongCredits` (default `"apple"`) so credits that arrive from the extension through the companion link can carry their provider.
- Keep `scraper/apple_music.py` as is; `scraper/pipeline.py` stays Apple-only until the desktop reads credits itself.
- If the desktop later reads Spotify on its own, add `scraper/spotify.py` with the same `detect` and `scrape` shape and route in `pipeline.py` by URL host; Playwright can do real clicks, so the dialog is reachable there, but the language and consent banner problems are the same.
- `ROLE_MAP` remains the single canonical English map; per-provider alias tables are separate Python modules, exported to the extension by `tools/export_roles.py` like today.
- Golden and fixture rules from `CLAUDE.local.md` apply: Spotify fixtures are saved dialog HTML, kept script-stripped, reviewed by hand.

## 9. Sliced implementation plan

Each slice leaves the extension working and releasable.

0. **Spike (1 day, no shipped code).**
   In a test profile, from a content script, answer: does a dispatched pointer-event sequence open Spotify's menu and credits dialog? Does it work in a hidden tab? Does the dialog render in English when the browser language is English, and what are the English role labels for ten reference tracks? Output: a short note and saved dialog HTML fixtures.
   A **no** on the first question stops the plan before any refactor.
1. **Provider seam, Apple only.**
   Introduce `providers/` with the Apple provider, switch messages, worker, tab discovery, `source` on `SongCredits` (with the old-session migration) and UI copy to the registry.
   Zero user-visible change; all existing tests must pass unchanged apart from renames.
2. **Spotify read-only metadata.**
   URL detection, `detect` for tracks and albums from the page DOM and meta (title, artist, date, cover, ℗/©, track list).
   Behind a setting; the credits list is empty with a warning.
3. **Spotify credits.**
   Open the dialog, parse sections and rows, section-based role fallback, English role aliases; fixtures from slice 0; unit and offline tests on the saved dialogs; a live smoke script like `scripts/live-smoke.mjs`.
4. **Localization.**
   Role tables for the languages of the first users (Polish is already confirmed as needed by the owner's own browser).
5. **Source picker in the panel.**
   The "open pages" list shows Apple and Spotify tabs together; a link pasted by the user is routed by the registry.
6. **Deezer writers fallback** (optional permission for `www.deezer.com`).
7. **SoundCloud writer, label and release date** (optional).
8. **Desktop link:** carry `source` through the companion link and show the provider in the desktop status view.

Estimates are deliberately omitted; slice 0 decides everything after it.

## 10. Host permissions that need the owner's approval

Nothing was added to the manifest in this change.
Proposed, in order of need:

| Host | For | Kind | Notes |
|---|---|---|---|
| `https://open.spotify.com/*` | Spotify pages and the credits dialog | **required** (same as `music.apple.com`) or optional with a prompt on first use | optional keeps the store listing's permission warning smaller; Apple's is already required |
| `https://www.deezer.com/*` | Deezer track page `Writer:` line | optional | `api.deezer.com` is already optional |
| `https://soundcloud.com/*` | SoundCloud hydration JSON | optional | |
| `https://i.scdn.co/*` | Spotify cover download for the Genius cover step | optional, only if the extension itself fetches it | not needed if the URL is only handed to Genius |

Not requested and not recommended: `spclient.wg.spotify.com`, `api.spotify.com`, `api.tidal.com`, `api-v2.soundcloud.com`, `*.bandcamp.com` (internal or token-gated endpoints, or a wildcard for little value).
Also needs the owner's call: the Chrome Web Store privacy and permission justification text (`extension/PRIVACY.md`, `store/listing.md`) must name every new site, and `README` and the FAQ must say which services are read.

## 11. Risks and open questions for the owner

- **Terms of service.**
  Reading a page the user has open is the same stance as for Apple Music, but Spotify's terms are stricter than most about automated access.
  The mitigation is the same shape as today (the user's own tab, serial, human pace, no tokens, no internal APIs); the owner should accept that explicitly.
- **Hidden tab.**
  If the dialog cannot open in a hidden tab, Spotify reads need a visible tab that flashes during a read, which conflicts with the "no surprise popups" preference.
- **Genius's own policy** on data from Spotify (credits copied from a streaming service) is not assessed here.
- **Cover format:** JPEG 1500 px versus the 1000 px PNG Genius expects from Apple; check what the Genius form accepts.
- **Accuracy:** Spotify credits come from distributors and labels and are sometimes wrong or partial; the Genius form is for facts, so the panel should show the source next to each song.

# Provider interface

How the extension reads credits from more than one music site.
Apple Music is the first provider; Spotify is the planned second (see `docs/research-services.md`, sections 8 and 10).
This document says where each piece lives.
Introducing it is a pure refactor: no user-visible change, and the message contracts between the panel and the worker stay compatible.

## Module map

| Piece                                                               | Module                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Interface types (`CreditsProvider`, `MusicUrl`, `SourceId`)         | `extension/src/providers/types.ts`                                            |
| Registry and routing by URL                                         | `extension/src/providers/registry.ts`                                         |
| Apple Music provider (URL rules, tab names, messages, role mapping) | `extension/src/providers/apple.ts`                                            |
| Apple's in-page reader (unchanged)                                  | `extension/src/apple/*`                                                       |
| Worker side: open or reuse a tab, inject, ask, time out             | `extension/src/background/providerClient.ts` (was `appleClient.ts`)           |
| Open-tab discovery for the panel and the desktop link               | `extension/src/core/musicTabs.ts` (was `appleTabs.ts`)                        |
| Apple's role alias table                                            | `extension/data/roles.json` through `extension/src/core/roles.ts` (unchanged) |

## 1. Recognising a page

`provider.parseUrl(url)` returns `{ kind, region }` or `null`.
`kind` is `"album"` or `"song"`; "song" means a page of exactly one track, whatever the site calls it.
The check is strict (exact host, https, path shape), because the worker opens tabs for URLs that arrive in messages: anything a provider does not recognise is refused before a tab exists.
Normalising is the provider's job, through two methods: `pageKey(url)` says which part of an address names the page (for Apple the origin and path, so a track picked after the address does not make a second page; for Spotify the plain `/track/<id>` address, so `/intl-de/track/<id>?si=...` is the same page), and `openUrl(url)` gives the address to open in a background tab (Apple's unchanged, Spotify's without the locale prefix and query).

`providerForUrl(url)` in the registry asks each provider in order and returns the first match with its parsed URL.
Nothing outside `providers/` and the provider's own folder names a site.

## 2. The credits reader

Each provider has an in-page reader, bundled as its own content script (`provider.contentScript`, a path inside `dist`, for Apple `apple/content.js`).
It answers two questions, as today: detect (album or song summary, the shared `AlbumInfo`) and scrape (credits of one track, the shared `PageScrape` with `Credit[]`).
Both models stay as they are; they are already source-neutral.

The worker asks through `providerClient.ts`:

- **Which provider:** from `providerForUrl(url)`.
  No match gives `invalid-url` with the provider's own wording, or a generic wording when several providers are registered.
- **Injection:** `ports.injectContentScript(tabId, provider.contentScript)`.
  Injection is on demand through `chrome.scripting.executeScript`, so no static content script is declared in the manifest.
- **Early injection:** in a tab the worker opened, the script is injected (`injectImmediately`) as soon as the tab shows an address on the provider's site or has finished loading, whichever is first.
  The reader waits for the page's content by itself, so the rest of the load (scripts, fonts, images) is not waited for.
  Short waits inside a reader use `pause` (`apple/wait.ts`), which hops on a message channel, because timers in hidden tabs are throttled and stretch a 150 ms pause to a second or more.
- **Hidden or visible tab:** detect on a tab the user already has open reads it in place (never navigated or closed, and only if it shows the same URL).
  Otherwise, and for every scrape, a minimized background window is opened and closed in `finally`.
  `provider.worksHidden` says whether a hidden tab can run the driver; a provider that needs a visible tab sets it to `false` and the client opens the tab active.
  Apple is `true`.
- **Timeouts:** `ClientTiming` stays shared (`tabLoadMs`, `requestMs`, `pollMs`).
  A provider may raise them with `provider.timing` (a partial override); Apple does not.
- **Errors:** every failure comes back as data (`Result`), with the existing codes (`invalid-url`, `timeout`, `tab-failed`, ...).
  The strings that name the site come from `provider.messages`.
- **Message names:** `apple/detect`, `apple/scrape`, `spotify/detect` and `spotify/scrape` are the content requests; each content script answers only its own prefix.
  A further provider adds `<id>/detect` and `<id>/scrape` to `ContentRequest` and validates its own prefix in its handler.
- **Access:** a provider whose host is optional is checked with `ports.hasAccess(origins)` before any tab is opened; without it the client answers `no-access` and opens nothing.
- **Polite reading:** `provider.readGapMs` (Spotify: 150) and `provider.readConcurrency` (Spotify: 3) make the router read that provider in order, at most that many pages at once and no two starts closer than the gap, whatever the panel asks for. A `blocked`, `tab-failed`, `timeout` or `internal` answer drops it to one page at a time for the rest of the worker's life, and a `blocked` answer also stops reading it for 15 minutes. Reading the user's own tab opens nothing and skips the queue. The panel queues every picked track at once, so the rest of an album is read in the background in album order while the user reviews and pastes the first.
- **Error codes:** besides the shared ones, `unavailable` (the site has no page for the track), `blocked` (captcha or rate limit) and `no-access` (host not allowed yet) carry wording made for the user.
  The panel never sees these messages, so the panel-to-worker contract (`detect`, `scrape` with a URL) needs no `source` field: the worker derives the source from the URL.

## 3. Role mapping

Every provider has `normaliseRole(raw)`, which maps a raw role label from that site into a Genius role name.

- Apple's stays the data-driven `data/roles.json` (generated from `scraper/roles.py` by `tools/export_roles.py`) behind `core/roles.ts`, and is parity-tested against Python.
- A new provider ships its own alias table inside `providers/<id>/` (label as the site shows it, lowercase, to a Genius role) and never edits Apple's table or the Python map.
  Apple's unknown labels are kept as written.
  Spotify exposes `spotifyRole(raw, language)`, which returns `null` for an unknown label (English table first, then the table of the page's `<html lang>` in `src/spotify/roleTables.ts`, then Genius's own names, all by a normalised key): the credits mapping leaves such a role out and lists it (with who holds it) in the track's notes, so a role in another language is never typed into Genius by mistake.
  Every value in Spotify's table must be a role name Genius lists (a test checks it against the names Apple's table produces).

## 4. Open-tab discovery

`musicTabEntries(tabs, providers = PROVIDERS)` replaces `appleTabEntries`.
For each open tab it finds the provider by URL, keeps album and song pages only, labels the entry with the provider's name (`source`), names the tab with `provider.tabName(title, url, kind)` (the title arrives with invisible marks and extra spaces removed; the name is capped at 120 characters), merges the same page open twice, and puts the page in view first.
The panel queries each provider's origins on its own (one that fails cannot hide another), so only hosts the extension has permission for are listed; an optional host that was never allowed lists nothing, because Chrome hides a tab's address from an extension that may not read that site.
`toBridgePages` (desktop link) uses the same function but only with the Apple provider, and the worker queries only Apple's origins for it: the desktop app cannot read Spotify, so it is never told of Spotify pages.
The desktop link payload (`url`, `title`, `kind`, `current`) is unchanged; `source` is extra in the panel's entries only.
The panel's state field is still called `appleTabs`; renaming it is left to a follow-up so this change stays out of `ui/`.

## 5. Host permissions and content script

A provider declares:

- `origins`: exact origins, such as `https://music.apple.com/*`.
- `permission`: `"required"` (in `host_permissions`, Apple's case) or `"optional"` (in `optional_host_permissions`, requested at runtime on first use).
- `contentScript`: the bundle path; `scripts/build.mjs` has one entry per provider (`apple/content`).

The manifest stays hand-written and reviewed by the owner; a unit test checks that every provider's origins appear in the manifest under the declared kind and that every `contentScript` is a build entry.
Adding Spotify means one provider module, one build entry, and one manifest line, after the owner approves the permission.

## 6. What stays Apple-only for now

- **Cover art by Apple catalog id:** `lookups/itunes.ts` and `background/covers.ts` (`exact(appleMusicUrl)`) take an Apple URL.
- **`SongCredits.appleMusicUrl`** and the persisted session field name (renaming needs a stored-session migration, planned with the Spotify slice).
- **UI copy** naming Apple Music (`ui/link.ts`, `ui/view.ts`, locale strings).
- **Python desktop app:** `scraper/`, `scraper/roles.py` and the manual hotkey mode are frozen; the desktop gets no provider interface.
  `roles.json` parity with Python covers Apple only.

## 7. What a Spotify provider adds

`providers/spotify.ts` (URL rules for `open.spotify.com`, tab names, messages, `worksHidden` as the spike decides), `spotify/*` (the in-page reader and its saved-page tests), `providers/spotify/roles.ts` (alias table), one build entry, a registry line, the manifest permission, and the cover and session-field changes listed in section 6.

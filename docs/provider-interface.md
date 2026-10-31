# Provider interface

How the extension reads credits from more than one music site.
Apple Music is the first provider; Spotify is the planned second (see `docs/research-services.md`, sections 8 and 10).
This document says where each piece lives.
Introducing it is a pure refactor: no user-visible change, and the message contracts between the panel and the worker stay compatible.

## Module map

| Piece | Module |
|---|---|
| Interface types (`CreditsProvider`, `MusicUrl`, `SourceId`) | `extension/src/providers/types.ts` |
| Registry and routing by URL | `extension/src/providers/registry.ts` |
| Apple Music provider (URL rules, tab names, messages, role mapping) | `extension/src/providers/apple.ts` |
| Apple's in-page reader (unchanged) | `extension/src/apple/*` |
| Worker side: open or reuse a tab, inject, ask, time out | `extension/src/background/providerClient.ts` (was `appleClient.ts`) |
| Open-tab discovery for the panel and the desktop link | `extension/src/core/musicTabs.ts` (was `appleTabs.ts`) |
| Apple's role alias table | `extension/data/roles.json` through `extension/src/core/roles.ts` (unchanged) |

## 1. Recognising a page

`provider.parseUrl(url)` returns `{ kind, region }` or `null`.
`kind` is `"album"` or `"song"`; "song" means a page of exactly one track, whatever the site calls it.
The check is strict (exact host, https, path shape), because the worker opens tabs for URLs that arrive in messages: anything a provider does not recognise is refused before a tab exists.
Normalising is the provider's job: it decides which part of an address names the page (for Apple the path, so a track picked after the address does not make a second page).

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
- **Hidden or visible tab:** detect on a tab the user already has open reads it in place (never navigated or closed, and only if it shows the same URL).
  Otherwise, and for every scrape, a minimized background window is opened and closed in `finally`.
  `provider.worksHidden` says whether a hidden tab can run the driver; a provider that needs a visible tab sets it to `false` and the client opens the tab active.
  Apple is `true`.
- **Timeouts:** `ClientTiming` stays shared (`tabLoadMs`, `requestMs`, `pollMs`).
  A provider may raise them with `provider.timing` (a partial override); Apple does not.
- **Errors:** every failure comes back as data (`Result`), with the existing codes (`invalid-url`, `timeout`, `tab-failed`, ...).
  The strings that name the site come from `provider.messages`.
- **Message names:** the content request keeps `apple/detect` and `apple/scrape`.
  A provider's requests are named `<id>/detect` and `<id>/scrape`, and its content script validates its own prefix.
  The panel never sees these messages, so the panel-to-worker contract (`detect`, `scrape` with a URL) needs no `source` field: the worker derives the source from the URL.

## 3. Role mapping

Every provider has `normaliseRole(raw)`, which maps a raw role label from that site into a Genius role name.

- Apple's stays the data-driven `data/roles.json` (generated from `scraper/roles.py` by `tools/export_roles.py`) behind `core/roles.ts`, and is parity-tested against Python.
- A new provider ships its own alias table inside `providers/<id>/` (label as the site shows it, lowercase, to a Genius role) and never edits Apple's table or the Python map.
  Unknown labels are kept as written, as Apple's are.
  Where the site groups roles in sections, the provider may fall back to the section.

## 4. Open-tab discovery

`musicTabEntries(tabs, providers = PROVIDERS)` replaces `appleTabEntries`.
For each open tab it finds the provider by URL, keeps album and song pages only, names the tab with `provider.tabName(title, url, kind)`, merges the same page open twice, and puts the page in view first.
The worker's tab query uses the union of `provider.origins` (as match patterns), so only hosts the extension already has permission for are listed.
`toBridgePages` (desktop link) and the panel use the same list.
The entry shape (`url`, `name`, `kind`, `current`) is unchanged, so the desktop link payload is unchanged; a `provider` field can be added when the desktop needs it.
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

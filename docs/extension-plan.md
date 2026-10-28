# Géniescraper browser extension: requirements, architecture and plan

Status: draft for review.
Branch: `feat/chrome-extension`.
Reference implementation: the Python app at v0.5 (`scraper/`, `assistant/flow.py`).

## 1. Goal

Bring the Géniescraper workflow into the browser the user already has open.
The user opens an Apple Music album or song, the extension reads its credits, and on the Genius song edit form it fills each field with one user key press.
No Python, Playwright, or separate window is needed.

Decisions already confirmed with the project owner:

- **Standalone**: all TypeScript, no backend, no native messaging.
  It must be installable from the Chrome Web Store as a normal extension.
- **Genius side fills fields directly**, one field per user key press, and never clicks Save.
- **Toolchain approved**: TypeScript, esbuild, Vitest, happy-dom, ESLint, `@types/chrome`, pinned by `package-lock.json` and installed with `npm ci`.
  No UI framework.

## 2. Requirements

### 2.1 Functional

| ID | Requirement |
|----|-------------|
| F1 | Detect an Apple Music album or song page and offer to read it. |
| F2 | For an album, list the tracks and let the user choose which to process. |
| F3 | Read songwriters, producers, all other roles, the ℗ and © lines, with the same normalisation as `scraper/apple_music.py` and `scraper/roles.py`. |
| F4 | Build the paste queue exactly as `SongCredits.typed_queue()` does, including the toggles for core, additional, copyright, YouTube and cover art. |
| F5 | Find the exact 1000x1000 PNG cover (iTunes lookup by catalog id, then iTunes and Deezer title search). |
| F6 | Find the official YouTube video or official audio with the same scoring as `scraper/youtube.py`. |
| F7 | On the Genius edit form, show the current step and fill the matching field when the user presses the Next key (default F8); Back (default F7) and Skip also work. |
| F8 | Settings: hotkeys, auto-confirm, autocomplete wait, scrape toggles, persisted with `chrome.storage.sync`. |
| F9 | Never click Save or submit on Genius; the user reviews and saves. |

### 2.2 Non-functional

| Area | Requirement |
|------|-------------|
| Security | No remote code, no `eval`, default MV3 CSP, scraped text inserted with `textContent` or `value` only, never `innerHTML`. |
| Privacy | No analytics, no telemetry, no account, no data leaves the browser except the lookups to the hosts listed below. |
| Permissions | Narrowest host permissions; optional ones requested at runtime. |
| Performance | Tracks processed one at a time; credits for the next track prefetched while the user pastes; every wait has a bounded timeout. |
| Reliability | Selectors prefer `aria-label`, `data-testid` and roles; text-walk fallback as in Python; clear error states instead of silent failure. |
| Accessibility | ARIA live region for the current instruction, full keyboard navigation, visible focus, WCAG AA contrast, respects `prefers-reduced-motion`. |
| Testability | Pure logic separated from DOM and `chrome.*`; parsers run against the existing saved HTML fixtures. |
| Portability | Standard WebExtension APIs only, so Edge works unchanged and Safari via its converter (see section 6). |

### 2.3 Compliance (Chrome Web Store)

- Single purpose: "Copy Apple Music credits into the Genius song edit form."
- Permissions justified one by one in the listing (section 5.3).
- No remotely hosted code; all logic ships in the package.
- Privacy policy hosted in the repo, with a "no user data collected" disclosure.
- Limited Use: the only data handled is public page text the user is viewing and the user's own settings.
- Listing assets: 16, 48 and 128 px icons, screenshots, `_locales/en`.
- The extension does not impersonate Apple or Genius and uses no Apple or Genius logos.

## 3. Technical constraints and risks

| Constraint | Consequence |
|------------|-------------|
| `chrome.commands` does not accept a bare F8 (a modifier is required). | Hotkeys are a `keydown` listener in the Genius content script, where the user's focus already is. Optional `chrome.commands` can add Alt-based shortcuts later. |
| MV3 service workers are ephemeral. | All state lives in `chrome.storage.session` or `.local`; no in-memory queue is trusted across events. |
| `chrome.sidePanel` is Chrome and Edge only; Safari lacks it. | The UI is a single page that renders either as a side panel or a popup. Verify Safari support before relying on the side panel. |
| Apple Music credits sit behind MORE then View Credits, and that menu cannot be opened in a hidden tab (measured, section 11). | Per track, open the track's own song page (linked from the album row) in an inactive background tab, read the credit cards, close the tab in `finally`. One tab at a time, mirroring `_prefetch_semaphore`. Tracks with no song link are shown as unavailable. |
| Apple's internal API and embedded token are undocumented. | Not used. Only the rendered DOM the user could see is read. |
| Genius edit-form DOM is unknown to us and changes. | Captured as a script-stripped fixture (blocked on a signed-in session, see section 8). Selectors are isolated in one module. |
| Genius Terms of Service and the project rule of 100% guideline compliance. | One field per user key press, no Save, no bulk automation. Keep the posture identical to the desktop app. |
| YouTube has no API key here; the Python app parses search HTML. | Port the same scoring to TypeScript. Host is optional and requested only when the feature is on. Failures return an empty result, never break a scrape. |
| CORS in extension contexts. | Fetches run in the service worker with `host_permissions`, which bypasses page CORS. |

## 4. Architecture

```
extension/
  manifest.json
  src/
    core/               pure TypeScript, no DOM, no chrome.*
      models.ts         Credit, SongCredits, typedQueue()
      copyright.ts      extractLabels(), splitCopyright()
      roles.ts          normaliseRole(); data from generated roles.json
      flow.ts           autotabSteps(), instructionText()
      cover.ts          normaliseCoverUrl(), catalogRef(), coverFromLookup()
      youtube.ts        scoring, ported from scraper/youtube.py
      text.ts           words(), coreTitleWords()
    apple/              DOM adapters, take a Document
      credits.ts        creditsFromCards(), creditsFromText()
      page.ts           title/artist, tracklist, copyright, header artwork
      navigate.ts       MORE then View Credits driver (runs in the page)
    genius/
      selectors.ts      the only place that knows Genius markup
      fill.ts           set a field value and fire the events Genius expects
      content.ts        content script: keydown listener, step overlay
    background/
      worker.ts         message router, track prefetch queue, lookups
      lookups.ts        iTunes, Deezer, YouTube fetches
    ui/
      panel.html, panel.ts, panel.css   side panel / popup
      options.html, options.ts          settings
    shared/
      messages.ts       typed message contracts
      settings.ts       typed defaults and storage access
  _locales/en/messages.json
  data/roles.json       generated from scraper/roles.py
  test/                 Vitest
  scripts/              build and fixture helpers
```

Principles:

- Everything in `core/` is pure and unit tested; DOM adapters take a `Document` so happy-dom can run them on saved HTML.
- `chrome.*` is touched only in `background/`, `genius/content.ts`, `ui/` and `shared/settings.ts`, behind small interfaces that tests fake.
- Typed messages between contexts; every message handler validates its input at the boundary.

### 4.1 Data flow

1. The panel asks the active tab (Apple Music) for album info through a content script, or the worker reads it with `chrome.scripting`.
2. The user picks tracks.
3. The worker processes one track at a time: background tab on the track's song page, parse, close tab; in parallel it runs the cover and YouTube lookups.
4. The result is stored in `chrome.storage.session` as a `SongCredits` plus its `typedQueue()`.
5. The Genius content script reads the queue, shows the step overlay, and on the Next key fills the field for the current step.

### 4.2 Parity with the Python app

The Python code is the reference.
The TypeScript port must not drift, so parity is enforced by tests, not by discipline.

- **Fixtures and golden files**: Vitest runs the TypeScript parsers against the existing `tests/fixtures/*.html` and compares with `tests/golden/*.json`.
  These files are read, never modified, and never regenerated from extension output.
- **Roles**: `tools/export_roles.py` writes `extension/data/roles.json` from `ROLE_MAP`; a Python test fails if the committed file is stale.
- **Test vectors**: `tools/export_vectors.py` writes `extension/test/vectors.json` from the Python functions (`typed_queue`, `_extract_labels`, `split_copyright`, `autotab_steps`, `instruction_text`, `normalise_cover_url`, YouTube scoring); a Python test fails if stale, and Vitest consumes it.
- **Known gaps** pinned as `xfail(strict=True)` in Python are mirrored as `it.fails` in Vitest.

## 5. Security and store compliance

### 5.1 Manifest

- `manifest_version: 3`, no `content_security_policy` override (default is strict).
- Content scripts declared statically for `https://music.apple.com/*` (read only) and `https://genius.com/*` (fill).
- `web_accessible_resources`: none.
- No `externally_connectable`, no `<all_urls>`, no `tabs` permission unless a concrete need is shown.

### 5.2 Permissions

| Permission | Why | Type |
|------------|-----|------|
| host `https://music.apple.com/*` | Read credits the user is viewing | required |
| host `https://genius.com/*` | Fill the edit form | required |
| host `https://itunes.apple.com/*` | Exact cover lookup | required |
| host `https://api.deezer.com/*` | Cover fallback | optional |
| host `https://www.youtube.com/*` | Official video lookup | optional |
| host `https://www.googleapis.com/*` | Official YouTube service with the user's own key | optional |
| `storage` | Settings and the current queue | required |
| `scripting` | Drive the MORE then View Credits path | required |
| `sidePanel` | Main UI in Chrome and Edge | required |

### 5.3 Rules enforced in code review and lint

- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` (ESLint `no-restricted-syntax` and `no-restricted-properties`).
- Scraped text is data: it never selects a URL, a path or a command.
- Every fetch URL is built from a fixed host plus encoded parameters; every response is parsed defensively and typed.
- Hosts match the existing allow-list in `CLAUDE.local.md` plus `genius.com`, which the owner approved for this extension only.
- Dependencies pinned by lockfile, installed with `npm ci`, audited in CI.

## 6. Cross-browser notes

- Chrome and Edge: same package.
- Safari: converted with `xcrun safari-web-extension-converter` on macOS; requires a macOS build step and an Apple developer account, so it is a separate later slice.
- Code stays on the `chrome.*` namespace with MV3 promises, which Safari and Edge accept.

## 7. Testing strategy

| Layer | Tooling | What it proves |
|-------|---------|----------------|
| Unit | Vitest | `core/` logic and Python parity vectors |
| Fixture | Vitest + happy-dom | Apple parsers against saved HTML and golden JSON; Genius fill against the captured form fixture |
| Contract | Vitest | Message types, settings defaults, manifest invariants (no forbidden permissions, no remote URLs) |
| Lint and types | ESLint, `tsc --noEmit` | Style, forbidden APIs, type safety |
| End to end | Python Playwright loading the unpacked extension (existing dev dependency) | Real panel, real page, opt-in like the live tests |
| Live | opt-in | Real Apple Music and YouTube, run on a schedule |

CI adds an `extension` job on `ubuntu-latest` with SHA-pinned actions, `npm ci`, lint, typecheck, Vitest, build, and a manifest check.
Python CI also runs the staleness tests for `roles.json` and `vectors.json`.

## 8. Implementation plan: vertical slices

Each slice ends working, tested and committable.

| # | Slice | Acceptance check |
|---|-------|------------------|
| 0 | This plan | Reviewed by the owner (done) |
| 1 | Scaffold: `extension/` skeleton, manifest, build, lint, Vitest, CI job, roles export, vectors export (done) | `npm run check` green; Python staleness tests green |
| 2 | Port `typedQueue`, copyright helpers, flow logic (done) | All Python vectors pass in Vitest |
| 3 | Apple Music credits parser (done) | Every fixture in `tests/fixtures` matches `tests/golden` |
| 4 | Album and track detection, background-tab credits reader (done; reads song pages, see section 11) | Unit tests with fake `chrome.*` ports; real hidden-tab run matches golden |
| 5 | Side panel UI: link, track picker, credits and paste queue, settings; accessibility pass (done) | Unit tests with fake worker and storage; `npm run live:panel` drives the real panel, worker and live Apple Music |
| 6 | Genius fill, one field per press (done) | Fake-select tests on the saved form; engine and whole extension run live on Genius (`npm run live:genius`) |
| 7 | iTunes cover lookup (done) | Replays `tests/fixtures/lookups/covers` against the golden artwork; live lookup checked in `npm run live:panel` |
| 8 | Deezer and YouTube lookups with optional permissions (done, with the optional YouTube key; sections 17 to 21) | Replays `tests/fixtures/lookups/youtube` and matches `tests/golden/youtube.json` |
| 9 | Store readiness: icons, locales, privacy policy, listing text, permission justifications, packaging script (done, section 22) | Zip validated; manifest contract tests green |
| 10 | Edge check, Safari converter notes (done, section 23) | Documented result |

## 9. Open items

- **Genius edit-form DOM**: captured on 2026-10-27 as `tests/fixtures/genius-edit-form.html` (see section 10).
- **Auto-Tab**: Genius fields can be targeted directly by label, so the tab counts in `autotab_steps` are probably unnecessary; confirm during slice 6.

## 10. Findings from the captured Genius edit form

- The form is `form[aria-label="Edit Song Metadata Form"]` inside a `role="dialog"` modal (`#edit-metadata-body`).
- Class names are hashed styled-components names and `react-select-N-input` ids change on every open, so neither is used as a selector.
- Written By is labelled **Writer**, and Produced By is labelled **Producer**.
  Both are multi-value react-select comboboxes.
  They are found by the text of their `Field-shared__FieldLabel` span, with the label text kept in `genius/selectors.ts`.
- Stable anchors: `input[name="youtube_url"]`, `input[name="custom_song_art_image_url"]`, `[data-testid="custom-performances-expander"]`, `#custom_performances-N-label` (role) and `#custom_performances-N-artists` (artists), and the `focus-id` attribute on the artists input.
- Additional credits: the "Add additional credits" button appends a row holding an **Additional role** combobox and an **Artists in this role** combobox.
- Setting a combobox needs real typing events (React controlled input), then confirming the suggestion with Enter, which matches the Auto-Confirm setting.
- Save and Cancel are `button[aria-label="Save"]` and `button[aria-label="Cancel"]`; the extension never touches them.
- Genius shows a cookie consent dialog that can intercept clicks; the extension must not interact with it.
- The fixture omits the Tags, Albums and Song Relationships sections, which the extension never touches.
- **Hidden-tab side effects (slice 5)**: every scrape shows a tab briefly in the tab strip and adds a history entry for the song page; check whether a minimized window avoids the flash before relying on it.
- **Real worker end to end**: done. `npm run live:panel` drives the real panel page through the real worker, `chromePorts()` and the router with real key events; `npm run live:sidepanel` opens a genuine side panel next to a visible album tab.
- **Live coverage**: one track of one album has run live; the other six cases are covered by saved pages only.
- **Safari**: confirm which APIs (`sidePanel`, `scripting`, session storage) are available before committing to the shared UI page.
- **Genius ToS review**: confirm the per-press fill stays within the guidelines before the store listing.
- **Versioning**: extension version follows the app version (`0.5.x`) until the first store release.

## 11. Findings from the Apple Music background-tab work (slice 4)

All measured on real Chromium with the unpacked extension, driven over raw CDP so no automation tool applies focus emulation.
Playwright forces pages to report `visibilityState: "visible"` and focus, so it cannot show hidden-tab behaviour.

- The MORE button only opens its menu after a hover: `mouseover`, a pause of a few hundred milliseconds, then a click.
  A click alone, or `mousemove` then click without the pause, does nothing.
  That matches the hover fallback in `scraper/apple_music.py`.
- In a visible tab the hover-then-click driver opened View Credits and matched the golden file.
- In a hidden tab (`visibilityState: "hidden"`) the album page hydrates normally (rows, MORE buttons and footer are all there) but the menu never opens: 0 of 5 runs.
- View Credits only navigates, in place, to the track's song page.
  A song page renders its credit cards within 2 seconds even in a hidden tab, with no clicks.
- Each album row holds one `MORE` button and, for available tracks, one `a[href*="/song/"]` link.
  Some rows have none: the Eilish album has 11 songs and 10 links, and TTPD has 17 songs and 16 links.
- Decision: the extension reads each track's song page directly, which removes the synthetic-event path and its nth-MORE indexing.
  Song pages carry no ℗/© footer, so the album's copyright is read once, from the album page, at detection time.
- Result: 5 of 5 hidden-tab runs matched `tests/golden/eilish-hmhas-t3.json` (credits, title, artist, copyright); a scrape took about 0.75 s.
  A bad song link returns `not-found` after about 3 s.
- This differs from the Python app, which clicks through MORE; benchmark and golden-compare it there before porting the idea back.
- `chrome.tabs.sendMessage` waits for the answer, so the worker keeps itself alive with a periodic API call while a request runs.

## 12. Slice 5 decisions: the side panel

- The UI is a Chrome side panel (`side_panel.default_path`, opened by the toolbar button). The popup fallback for Safari stays an open item.
- State lives in a controller that takes the worker, storage and the active tab as injected ports, so the whole flow runs in tests; the view only renders it and uses `textContent` and attributes, never markup.
- The working session (album, picked tracks, credits, screen) is kept in `chrome.storage.session`, so closing the panel loses nothing; a track that was mid-read when the panel closed is read again on reopening.
- Only the five scrape toggles are settings in this slice, because they are the only ones with an effect yet; hotkeys, auto-confirm, autocomplete wait and auto-tab arrive with the Genius fill in slice 6.
- Single-track pages skip the track picker; tracks Apple gives no page are listed, disabled and labelled.
- Accessibility: one `h1`, a focused `h2` on every screen change, labelled controls, never-rebuilt status and alert regions, focus kept across re-renders, `aria-invalid` on a rejected link, `prefers-color-scheme` and `prefers-reduced-motion` handled.
  A test holds every color pair in `panel.css` to WCAG AA (4.5:1 text, 3:1 control edges), in both schemes, instead of an axe dependency, which has not been approved.
  That test found a real problem: the yellow selected-track edge failed on the light scheme, so it uses the darker link color.
- The live run at 400 px wide found a horizontal scrollbar caused by the unbreakable cover art URL in the paste queue; items now wrap.
- Reading an album or song page needs no extra step from the user: when the active tab already shows the pasted link it is read in place, otherwise a hidden tab is used and closed again.
- `chrome.sidePanel.open` needs a user gesture that a service worker cannot be given, even over CDP with `userGesture: true`.
  The live check opens a helper window with an extension page and makes the call from there with the gesture, which Chrome accepts.
- With the album open in a visible tab, the panel prefills its link, follows the user to another tab and back, reads that tab in place (peak tab count equals the number of tabs the user had open) and leaves the user's tabs untouched.
- The keyboard-only pass found no focus problems: Tab from the heading reaches the link box, Enter reads the album, Tab visits Select all, Select none and the tracks (skipping the disabled one), Space toggles with focus kept, and Enter on the button starts reading.
  It reads a whole 10-track album live, one hidden tab at a time.
- Looking at the light scheme found that checked boxes were yellow on white; they now use the darker link color.
  The focus ring is clearly visible around the yellow primary button in a screenshot.
- "New link" now clears the previous link instead of leaving it in the box.
- Still open: a visible tab flash and history entry per scrape, the popup fallback for Safari, a CDP side panel width narrower than 320 px (not measured), and the YouTube link setting, which has no data to act on until the lookup arrives (slice 8b, now done).

## 13. Slice 6 decisions: the Genius fill

Measured on the live Genius edit form (signed in, nothing saved):

- Fields are found by their label text, because class names are hashed and react-select ids change on every open.
  Written By is labelled **Writer**, Produced By **Producer**; additional credits are the rows `custom_performances-N-label` and `-artists`.
- Synthetic events drive them: a value set through the prototype's setter plus an `input` event shows suggestions within about 400 ms; ArrowDown moves `aria-activedescendant`; Enter chooses the focused option.
  The input itself carries `role="combobox"`, so the container is its parent's closest combobox.
- Every selection, including a credit row's single role, is a `multiValue` chip, so "is this field filled" is one rule.
- **A fuzzy first suggestion is real.** For a made-up name the first suggestion was "99 Neighbors", and for "Billie Eilish" the second was a different entity, "Billie Eilish, FINNEAS, Tim Anderson, Aron Forbes".
  The Python app's auto-confirm would pick those.
  Decision (the owner chose it): choose only an exact match, ignoring case, accents and symbols; otherwise leave the typed text and the open suggestions for the user and say so.
  `Create "..."` is never chosen.
- Genius's copyright roles are named "Phonographic Copyright ℗" and "Copyright ©", so matching ignores symbols.
- Three Apple roles have no Genius role at all ("Vocal Recording Engineer", "Programming", "Editing Engineer"); those steps are left for the user, who can Skip them.
  Waiting for suggestions that never come costs about 4 seconds.
- Fields are targeted directly, so the desktop app's Auto-Tab tab counts are not needed; the plain URL inputs get a value and input/change events and never a key press.
- Rows: a role goes into the last row if its role is still empty, otherwise "Add additional credits" is clicked; artists and copyright labels go into the last row.
- The panel's wording is its own: the desktop app's instruction text tells the user to click fields and calls Writer "Written By".
  `assistant/flow.py` stays ported for parity but is not shown.

Architecture:

- The worker is the only writer of the paste state (`chrome.storage.session`, trusted contexts only, so the Apple Music content script and web pages never see credits).
  Panel buttons are requests from an extension page; the Genius content script may only ask `paste-begin`, `paste-report`, `paste-back` and `paste-status`, and only from a frame on `https://genius.com`.
- A press: the page asks the worker for the step, fills it, and reports the outcome; the worker then moves the position.
  A press while a fill is running is ignored, a report for a stale step is ignored, and a fill that never reports is abandoned after 20 seconds.
- The content script is declared statically for `https://genius.com/*` and is idle until the worker says a session is running; only then are the hotkeys handled, and only then is the key suppressed.
- Hotkeys default to F8 (fill next) and F7 (back), as in the desktop app, and can be changed to F2, F4, F7, F8 or F9.
  Chrome uses F7 for caret browsing; the page handler suppresses the key while pasting, but that interaction has not been seen in a real browser.
- The extension never presses Save or Cancel and never submits the form; tests spy on both.

A bug found in review, fixed with tests first:

- When a role step was skipped (for example "Programming", which Genius lacks), the next artist step went into that empty row, and the next role then reused the row, so the artist ended up under the wrong role.
  Now an artist step refuses a row whose role has no chip, and skipping a role also skips the artists that belong to it, up to the next role.
  The live Genius script compares (role, artist) pairs against the credits, so this class of mistake is checked, not just names.

Verification state:

- Run for real on the live form with the real engine (signed-in pane, main world): Writer, Producer, additional roles, artists, both copyright roles with their labels, and the two URL fields all filled; a made-up name and the role "Programming" were correctly left for the user; nothing was saved and the form was discarded by reloading.
- The panel's paste screen and the new settings were run live (keyboard order, no overflow at 400 and 320 px, dark and light screenshots reviewed); opening them needs no Genius sign-in.
- Run for real through the whole extension (`npm run live:genius`, signed-in scratch profile, real panel, worker, content script in its isolated world and real F8/F7 key events) on the CHIHIRO queue of 47 steps: 38 steps filled and 5 were left for the user (the roles Programming, Editing Engineer and Vocal Recording Engineer, which Genius lacks, and the label Darkroom/Interscope Records, which Genius has no exact entry for) and skipped from the panel; every role and artist pair on the form was a pair from the credits, no artist sat in a row without a role, the writers and the producer matched, and nothing that could be a save was sent.
- Still unobserved: whether Chrome's F7 caret-browsing prompt is really suppressed by the page handler (CDP key events bypass browser shortcuts).
- Known rough edges: a skipped step leaves its typed text in the Genius field, and waiting for suggestions that never come (a role Genius lacks) takes about 4 seconds.
- The scratch Chromium profile used for the Genius sign-in holds that session's cookies and lives in the session's scratch folder; delete it when no more live checks are needed.

## 14. Slice 7 decisions: the exact cover

- The cover is looked up by Apple catalog id on `itunes.apple.com` (a required host), in the worker, in parallel with reading the album page, as in the desktop app.
  The lookup wins over the page header, which shows only motion artwork for some albums (SOUR); a title search in the same catalog is the last resort, because it can return another edition.
  A track's cover is its album's cover, as in the desktop app; the song page's header is only a fallback.
- Every ported helper is checked against Python: `catalogRef`, the 1000x1000 PNG rewrite, `sameTrack` and `coreTitleWords` run the vectors, and all 7 golden cases run against the saved iTunes responses (one request when the lookup answers, one search when there is no catalog id).
- Responses are untrusted: an artwork URL is used only if it is https on `mzstatic.com`, so a hostile or broken response cannot put another host into the paste queue or the panel.
- `src/lookups/http.ts` is the only place that fetches third-party data: https only, an explicit host allow-list (`itunes.apple.com` for now), no cookies, no referrer, a 10 second timeout, and null on every failure.
- Live: the golden track's cover through the real worker matches the golden artwork, and SOUR (no usable page header cover) gets its cover from the lookup.
- Deezer (optional host) arrived in slice 8a; YouTube followed in 8b (section 18).

## 15. Changes after the first hands-on review

From the owner's first try of the extension:

- **Main menu.** "New link" is now "Back to main menu", in its own blue (`--nav`, checked for contrast in both schemes) so it is not mistaken for the quiet outline buttons.
  It is in the header, on the track list and on the credits, and works even while credits are still being read (the late answer is dropped).
  It is not offered over Settings or the paste screen, where leaving would end work in progress.
- **Nothing is picked for the user.** An album opens with no track ticked and **Select all** highlighted yellow like Get credits.
  A single track still goes straight on.
  Select all and Select none never disable themselves: a disabled button drops keyboard focus, which the first version did (and Select none already did).
- **Start pasting in the header.** It sits next to Settings and the header is sticky, so the way on and the way back are never a scroll away; it is hidden until a track's credits are in, disabled while reading, and its accessible name includes the track.
  It has a soft yellow halo that is always on plus a slow pulse that is dropped under reduced motion: this machine reports reduced motion (Windows animations off), where a pulse alone would have been invisible.
- **Genius role names.** Apple's "Programming" is "Programmer" on Genius.
  Checked on the live form against every role in the golden credits: Genius has Programmer, Drum Programmer, Additional Production and Vocal Engineer, and nothing for Editing Engineer.
  `geniusRole` maps "Programming" and "<X> Programming" to "... Programmer", "Additional Producer" to "Additional Production" and "Vocal Recording Engineer" to "Vocal Engineer"; the queue shows, and the extension types, the Genius name.
  Later the desktop app was fixed the same way for the Programming family: `scraper/roles.py` now maps "Programming" and "<X> Programming" to "Programmer" and "<X> Programmer" (the role values in four golden files were updated by hand to match, and the exports regenerated).
  The extension still maps "Additional Producer" and "Vocal Recording Engineer" itself; the desktop app does not.
- **Collapsible queues.** The paste queue on the credits and the step list on the paste screen are native `details` elements, closed by default, with their length in the heading; each keeps its open state across redraws and keeps keyboard focus.
- Not changed: the credits-screen queue still labels the first steps "Written By" while the paste screen says "Writer" (Genius's name).

### Second round of hands-on feedback

- **One song has no track list.** Back to tracks is only offered for an album with more than one track.
- **Ways out under the paste queue.** Back to main menu moved from the header into the bottom row of the track list and the credits (next to Back to tracks), and is no longer in the header.
- **Steps open while pasting.** The paste screen's step list is open by default and keeps the user's choice across redraws.
- **Current step filled yellow.** The step to do now uses the primary yellow with dark ink (`--accent`, `--accent-ink`), not only an outline.
- **Stop pasting** uses the Back to main menu style.
- **Finished screen.** When the last step is done a success screen replaces the paste screen, as in the desktop app: a check mark, "All credits entered", the song, "Check the Genius page, then press Save there.", and the ways on: Paste next track (when a later track has credits), Back to the credits, Back to the track list (albums only), Back to main menu.
  Leaving it ends the paste session quietly.
  Focus moves to its heading and the message is announced.

### Third round of hands-on feedback

- **Back to credits.** The paste screen's way out is labelled "Back to credits" (it was "Stop pasting").
- **Broken done steps.** Finished steps were rendered as tall centred boxes because the finished screen's `.done` styles also matched the step rows (`li.done`).
  The finished screen now uses `.finished`, and a test fails if a bare `.done` rule comes back.
- **Steps done list.** A finished step moves into a "Steps done (n)" list, closed by default and above "Steps left (n)", which stays open.
  Going back moves the step out again, and the done list disappears when empty.
  "All steps" became "Steps left" because it no longer holds the done ones.

## 16. Reading tracks in parallel

Reading an album used to be strictly one hidden tab at a time (a `Serial` queue in the worker, one request at a time from the panel), like the desktop app's single prefetch.
There is now a setting, **Tracks read at the same time** (Settings, "Reading credits"): 1 (default), 2, 3, 5 or All at once.
The panel runs that many readers over the pending tracks; the worker runs track reads through a `Limiter` capped at 24 hidden tabs whatever the panel asks, and still detects albums one at a time.
Results are matched by track index, so order does not change; a failed read does not stop the others; Stop drops every late answer.

Measured live on the 11-track album (10 readable tracks), `node scripts/live-parallel.mjs --reps 3`, one run per mode in turn:

| Mode | Median | Peak tabs | Failures | Credits equal to one-by-one |
|------|--------|-----------|----------|-----------------------------|
| 1 at a time | 10.0 s | 1 | 0 | yes |
| 3 at a time | 4.0 s | 3 | 0 | yes |
| all at once | 2.0 s | 10 | 0 | yes |

The default is 3 at a time (chosen by the owner after these numbers); one by one is the gentlest and stays available in Settings.

## 17. Slice 8a: optional hosts and the Deezer cover fallback

- **Optional hosts.** `api.deezer.com` and `www.youtube.com` are `optional_host_permissions`; `itunes.apple.com` stays required.
  Settings has a "Look-ups on other sites" box per optional host.
  The Chrome permission is the setting: the box shows what `chrome.permissions.contains` says, is re-read when the panel opens, and follows `permissions.onAdded` and `onRemoved`, so taking the permission back in chrome://extensions unticks it live.
  Nothing is stored twice, so the box can never disagree with what the worker may do.
- **Gesture rule.** `chrome.permissions.request` is the first call in the change handler, before any wait; a test fails if anything is awaited first.
  A refusal puts the box back and says so.
  Unticking calls `permissions.remove`.
- **Fetcher.** `createFetchJson` checks the grant at every request for an optional host (a revoked permission stops the next lookup), and refuses redirects (`redirect: "error"`), so a response cannot come from a host that was not checked.
- **Deezer.** `lookups/deezer.ts` ports `fetch_cover_url`: it matches with the same `sameTrack` and accepts a cover only over https from `*.dzcdn.net`, with the extension swapped to `.png`.
  Order as in `scraper/pipeline.py`: Apple's exact lookup, then the iTunes title search, then Deezer (the two searches run together; Deezer answers "" without a request unless granted).
  No parity vector: the Python function is network-bound and its only pure parts (`sameTrack`, the `.png` rewrite) are already covered by the existing vectors and the new unit tests.
- **Verified.** Unit tests for all of the above; the Deezer lookup was run against the live API (CHIHIRO, SOS and FE!N each gave a 1000x1000 PNG on cdn-images.dzcdn.net that answered 200 image/png, a made-up song gave nothing).
  Chrome's permission prompt cannot be driven over CDP, so the prompt-and-grant step is **not** verified end to end here and needs one manual click.

## 18. Slice 8b: the YouTube link

- **Port.** `lookups/youtube.ts` ports `scraper/youtube.py`: the scorers, the three-phase search (canonical audio, music video, description checks), the candidate promotion rules and the final preference (music video, then audio, then nothing).
  Page access is behind `YoutubePages`, so the whole lookup runs offline: a test replays all 15 cases of `tests/golden/youtube.json` against the saved pages in `tests/fixtures/lookups/youtube/` and every one returns an accepted video with the right music-video flag.
  Python's `\W` is Unicode-aware, so the port splits on `[^\p{L}\p{N}_]` (an ASCII `\W` would cut "DÁKITI" in two).
  The saved pages and golden files are read-only; nothing in them changed.
- **Not ported: the request headers.** `fetch` cannot reliably set `User-Agent` or `Accept-Language` from an extension, so the requests go out as Chrome's own, with no cookies and no referrer.
- **One control.** The Chrome permission for `www.youtube.com` is the lookup's switch ("Find a YouTube link for each track" in Settings, off by default, with the same prompt, revoke and live-sync behaviour as Deezer).
  The existing "YouTube link" box under "What to paste" still decides whether the link is queued; a link is pasted only when both are on.
- **Traffic.** One worker-wide `YoutubeGate` shared by every track being read, so three tracks read at once cannot multiply the load: 2 requests in flight, 300 ms between starts, and after 3 failures in a row YouTube is left alone for 60 seconds.
  Nothing is asked, and no failure counted, while the permission is off.
  The search starts together with the page read, as in the desktop app: the panel now sends the album's artist with each read.
  Divergence on purpose: the desktop app repeats the search with the song page's title and artist when the first found nothing, even if they are the same; the extension repeats it only when they differ, so a song with no video does not cost double the traffic.
- **Verified.** Offline: the 15 golden cases, the scorers, the parsers and malformed pages, the limit, the router wiring.
  Live: the same lookup code (real `fetch`, permission stubbed as granted) found the accepted video with the right music-video flag for 5 of 5 golden cases (SZA SOS, good 4 u, CHIHIRO, Not Like Us, Pink + White) in about 2 seconds each, and the results page held `ytInitialData` (no consent page from this network).
  **Not verified:** Chrome's permission prompt and the lookup running inside the real extension with the permission granted, because the prompt cannot be driven over CDP; and an EU network, where a request without cookies can be sent to a consent page - a redirect is refused, so that gives no link rather than a wrong one.
- **Risk to record.** YouTube has no public API for this: the lookup reads the HTML of its search and watch pages.
  That is against YouTube's Terms of Service for automated access, can break whenever the page markup changes, and is the part most likely to draw a Chrome Web Store review question (remote host access, scraping a third party).
  Mitigations: it is off by default, needs the user's explicit grant, goes through one shared gate (below), never sends cookies, and is easy to remove (one module, one setting).
  If the store review objects, shipping without it still leaves a complete extension.

### Finding: Google throttles this approach

Live, from the real extension worker (Chrome's own network stack), sequential search requests 400 ms apart worked for about 7 requests and then every further request was redirected to `google.com/sorry` (Google's automated-traffic interstitial), for at least the following minutes.
The same happened from Node.
A whole-album run with the permission granted gave links for 2 of 10 tracks, then 0 of 10 on a second run; the credits, cover and timing were unaffected (6.5 s for three at a time with YouTube on, against 4.0 s before it existed; 10.0 s one at a time, the same as before).
The earlier 5 of 5 golden cases from Node were run on a fresh address, before any block.
Because redirects are refused, a block gives no link rather than a wrong one, and the gate stops the extension hammering a blocked service.
What this means: the lookup works for a few tracks at a time and then stops for a while, so on an album most tracks will have no YouTube link and the user adds it by hand.
The desktop app uses the same pages with the same scoring and may be affected the same way from the same address.
Not tried: slower pacing was no better in one run (one request at a time, 700 ms apart), and the cause of the threshold is not known.
If this matters, the options are a much lower request budget per track (for example the audio phase only, no watch pages), looking up only the track being pasted rather than the whole album, or dropping the YouTube lookup.
Stop in the panel drops late answers there, but requests already in flight in the worker finish.

## 19. Returning to the main menu after the last step

Like the desktop app, the finished screen returns to the main menu after 10 seconds, with the seconds shown on the "Back to main menu" button.
The countdown holds while the pointer is over the panel or one of its buttons has keyboard focus (the heading, where focus lands, does not hold it), so someone using the panel is never moved on; it carries on after they leave.
It stops when the user chooses a way out, goes back a step, or starts the next track, and begins again from ten at the next finish.
Because an automatic change of screen is a timing problem for some users (WCAG 2.2.1), Settings has "Go back to the main menu 10 seconds after the last step", on by default as in the desktop app; turning it off cancels a running countdown.
The countdown is not announced each second; the screen's own message is.
Not verified live: the redirect itself after ten real seconds (unit tests drive it with fake timers; the live check confirms the countdown label).

## 20. The YouTube look-up moves to one track at a time

The album read no longer asks YouTube anything.
A track's link is looked up when the user is about to paste it (Start pasting, or Paste next track), and once for the track in front of the user as soon as its credits are in, so Start pasting does not wait.
The answer is kept on the track and shown in the credits list; a track is asked about once (again only after a failure or a throttle), and nothing is asked while the permission or the "YouTube link" setting is off.
If YouTube is limiting requests the panel says so; if no link is found it says that.

The lookup also asks for far less than the desktop app's: the music-video phase runs first, the audio phase only when no confirmed video was found, and at most 2 + 2 + 1 + 2 descriptions are read.
Over the golden set that is 2 to 6 requests per song (average under 4), against up to 18; the 15 golden cases still pick an accepted video with the right flag.

Finding: a cookieless client is blocked by Google ("sorry" redirect) after roughly 5 to 7 requests on one reused connection, whatever the spacing; the same requests on fresh connections were not blocked.
From the real extension, looking up tracks 4 seconds apart still got links for only the first two tracks of an album before the block, because a block lasts minutes and every request on that connection after it fails.
That is Google's automated-traffic protection.
This project does not try to get around it (for example by spreading requests over other hostnames or forcing new connections), so the lookup stays best-effort: the first tracks of a session usually get a link, later ones may not until the block lifts, and the panel says when YouTube is limiting requests.
If links on whole albums matter more than staying inside that protection, the options are the user pasting the link by hand, a YouTube Data API key (an official quota, but a credential the user must create), or dropping the lookup.

### Check against the desktop app (same machine, after the testing above)

The desktop lookup (`scraper.youtube.fetch_youtube_url`, run for six tracks of the same album in a row) found links for 2 of the 6 and answered the others in about 2 seconds each, the same quick empty answers the extension got while blocked.
So from the development machine, after hundreds of test requests, the desktop app is limited in the same way: the limit looks like a state of this address and its connections, not something the extension's fetch causes by itself.
The earlier measurements (sections 18 and 20) are therefore pessimistic: they were taken after heavy testing from one address.
Not yet measured: the one-track lookup on a clean address with a normal user's pace, which is the owner's to try (reload the extension, tick the YouTube box, paste an album track by track).

## 21. An optional YouTube Data API key

Why: the page-reading lookup is limited by Google (sections 18 and 20), and the owner's album got no links.
A user who enters their own free key gets links from Google's official service, which does not have that limit.

- **New host.** `www.googleapis.com` joins the optional hosts (a "Save and check key" click asks Chrome for it, inside the click, like the other two).
- **Where the key lives.** `chrome.storage.local`: this browser only, never the synced area.
  The panel's state holds only whether a key is saved, never the key; it is sent only to Google's API host, in the `X-Goog-Api-Key` header (never in a URL), and is never logged.
  The key box is a password field with a "Show the key" box.
- **How it picks a video.** `lookups/youtubeApi.ts` rewrites the API's search and video answers into the shape the page-reading scorer already reads, so both ways choose by the same golden-tested rules.
  What the API does not give is absent: the verified-channel badges (so the Official Artist and label-channel shortcuts do not fire) and the Topic "Provided to YouTube" text is only the short snippet.
- **Order.** With a key and the permission, Google's service is asked first and is authoritative: no result there means no result, and YouTube's pages are not read.
  If the key cannot be used (wrong, daily allowance used up, the YouTube Data API not switched on) the page-reading lookup runs as before, and the panel says why in plain words.
- **Quota.** A search costs 100 units of the free 10,000 a day, so about 25 to 50 songs a day depending on how many searches each song needs.
  Two requests at a time at most.
- **Help for a first-time user.** Settings has "Better YouTube links (optional)": a plain-language explanation, a collapsed "How do I get a key? Step by step" with five numbered steps, each with a button that opens the exact Google page in a new tab (create a project, enable the service, create the key), and a link to Google's own guide.
  The extension does not read those pages, so no extra permission is needed.
  It cannot copy the key for the user: the key is shown on Google's site, which the extension cannot read.
  Step 3 spells out the key restriction list (choose Restrict key, tick only YouTube Data API v3 at the bottom of the list, or Don't restrict key), because Google offers dozens of services there and a first-time user would otherwise be stuck.
  Instead "Paste from clipboard" fills the box after the user presses Google's copy icon (Ctrl+V works too), "Save and check key" tries it with the cheapest call (1 unit) and says what Google answered, and a right key that cannot be used yet is kept with an explanation.
  A mistyped key is caught before any request, with what a key looks like.
- **Verified.** Offline: problem classification, entity decoding, the rewriting, the choice of videos through the API (Topic upload, official video, an apostrophe in a title), the header-not-URL rule, the permission gate, the service's order and fallbacks, the concurrency limit, the stored key, the messages, the panel flow (including that the permission is requested before anything is awaited) and the Settings help; live: the Settings screen renders the steps and links in both themes.
  **Not verified:** a real Google key (none is available here), so the exact answers of Google's API are as its documentation describes and the first real try is the check; and Chrome's permission prompt.

### Whole albums with a key

Without a key a track's link is looked up only for the track in front of the user and for each track as it is pasted (Google limits page reading), so after reading an album only those tracks show a link; the owner saw 2 of 10.
With a saved key and Google's permission, every track is looked up as its credits arrive (Google's service has no such burst limit; the worker still asks it two requests at a time), so the whole album gets its links.
That spends the free daily allowance on tracks that may never be pasted: roughly 25 to 50 songs a day.
A problem with the key found while reading (wrong key, allowance used up, service not enabled) stays in the status line after the "Got credits" summary.

### No more silent gaps, and a fixed memo

Each track's credits now say what became of its YouTube look-up: "Looking for it…", "No link found for this track.", that YouTube is limiting requests, or what is wrong with the key, so a missing link always has a visible reason.
Also fixed: the record of which tracks had been asked about was keyed by track number and survived a change of album, so a second album's tracks could be skipped as already asked; it is now cleared when a new album is read or the user returns to the main menu.

## 22. Slice 9: store readiness

- **Package.** `npm run package` builds, checks the build, and writes `release/geniescraper-extension-<version>.zip` (ignored by git).
  The zip comes from a small deterministic writer in `scripts/lib/zip.mjs` (sorted names, fixed timestamps, so the same sources give the same bytes), so there is no new dependency.
  The real package was extracted with PowerShell's `Expand-Archive` and matched `dist/` byte for byte.
- **Check before zipping.** `scripts/lib/validate-dist.mjs` fails the package for: a manifest that is not version 3 or has a version that is not Chrome's kind or differs from `package.json`; a missing locale message or a description over 132 characters; a missing, non-PNG or wrongly sized icon; anything the manifest points at that is not in the package; source maps, TypeScript, test files, notes or `node_modules`; empty scripts; `eval`, `new Function`, `innerHTML` assignments, `insertAdjacentHTML` or `document.write` in the shipped code; remote or inline scripts in HTML; and more than 10 MB.
  The checker itself is tested with a good package and every one of these faults.
- **Documents.** `extension/PRIVACY.md` (what is handled, what leaves the browser and to whom, what the extension does not do) and `extension/store/listing.md` (name, description, category, single purpose, a justification for every permission, remote-code and data-usage answers).
  Tests keep them honest: every permission and host in the manifest must have a justification row and no row may be extra, optional hosts must be marked optional, the short description must equal the manifest's and fit the limit, and the policy must mention every host the extension can contact.
- **CI.** The extension job runs `npm run package` after the build.
- **Still by hand.** Screenshots (1280x800), the 440x280 promotional tile, hosting the privacy policy at a public URL, and the developer account and upload.
  I did not submit anything.

## 23. Slice 10: Edge and Safari

### Edge: checked, works unchanged

The same unpacked build was loaded in Microsoft Edge 156 (`msedge.exe`, passed to the live scripts with `--chrome`).
- `npm run live:panel` (the real panel and worker against live Apple Music: album read through hidden tabs, credits, exact cover, paste screen, finished screen, settings, restore after reopening) passed every check.
- `npm run live:sidepanel` (the real side panel opened for the window, prefill from the active tab, tab switching, album read in place with no extra tab, the user's tabs untouched) passed every check.
- Not run in Edge: `npm run live:genius`, which needs a signed-in Genius profile; the Genius content script uses only standard DOM APIs and no browser-specific ones.
No code change was needed for Edge.

### Safari: not tested (needs a Mac); what to expect

Safari is a separate later job: it needs macOS, Xcode and, to distribute, an Apple developer account, none of which is available here.
Nothing below was run.

How to convert, on a Mac:

```
npm run build
xcrun safari-web-extension-converter dist --project-location ../safari --app-name "Geniescraper" --bundle-identifier <your.reverse.domain.geniescraper>
```

Open the generated Xcode project, run it, then in Safari enable the extension (Settings, Extensions) and, for an unsigned build, Develop, Allow Unsigned Extensions.
Safari asks the user to allow each website, so Apple Music and Genius must be set to Allow.

What the converter will not fix, from the APIs the extension uses:

| Area | Issue | Needed |
|------|-------|--------|
| Side panel | Safari has no `chrome.sidePanel` and ignores the `side_panel` key | The worker already skips the call when the API is absent (done in this slice). The UI needs a toolbar popup (`action.default_popup` pointing at `ui/panel.html`) for Safari; a popup closes when it loses focus, so the session kept in `storage.session` carries the work, and the hotkey flow on Genius does not need the panel open. |
| Optional hosts | `permissions.request` for Deezer, YouTube and Google's service behaves per Safari's own website-permission model | Test the Settings boxes; the prompt may be a Safari one rather than Chrome's |
| Service worker | MV3 service workers and Safari's background lifetime differ from Chrome's; the keep-alive ping may not apply | Test a whole album read and a paste |
| Hidden tabs | Safari may throttle or refuse to load background tabs the way Chrome does not | Test the credits read; fall back to reading the user's own tab |
| Clipboard | "Paste from clipboard" needs a user gesture and may be refused | Typing with Ctrl+V already works |
| Manifest keys | `minimum_chrome_version` and `side_panel` are ignored with warnings | None |

Everything else used (`storage`, `scripting.executeScript`, `tabs`, `runtime` messaging, content scripts) is supported by current Safari.

## 24. The first-time set-up

A walk through the choices that matter, shown the first time the panel opens.
It is a whole screen with five steps and it cannot be skipped: there is no skip button and no way to run it again later (the owner's decision; everything it sets is in Settings).
It adds no settings of its own except `onboarded`, set when the last step's "Start using Géniescraper" is pressed.

1. **Welcome.** The logo fades in with a soft glow and a blur that sharpens, then the title, the lead and the points rise into place one after another, and the button comes last; it plays once, with the first draw, and a redraw or coming back to it shows the finished state.
   It only says where each part starts from (`backwards` fill), so with reduced motion, or after it has played, everything simply shows; the machine this was built on reports reduced motion, so the live check turns that off to watch it play.
   The logo is the packaged icon, loaded from the extension itself.
2. **What should it paste?** The five toggles, each with a sentence; the recommended ones are already ticked.
   The cover option is called "PNG cover art link" here and in Settings, because the link is to a 1000 by 1000 PNG.
3. **Speed and comfort.** Tracks read at once (recommended 3, measured in section 16), auto-confirm, auto-return, and the two Genius keys with a note that laptops often need Fn for F-keys.
4. **Better covers and links (optional).** The Deezer and YouTube look-up boxes and the YouTube key help, reused from Settings.
   Each asks Chrome for its permission inside its own click, because a prompt needs a user gesture; the set-up never turns a look-up on by itself.
5. **You're all set.** A plain-words summary of what was chosen and three lines on how to use it, with the real key names.

Who sees it: `onboarded` is read from the synced settings.
Someone who already has saved settings from before this existed counts as having seen it, so an update does not greet existing users; only an empty store shows it, and the flag syncs, so a second browser on the same account does not repeat it.
Until it is finished it shows again each time the panel opens, from the welcome.
The Settings button and Start pasting are hidden while it shows.
Accessibility: focus moves to each step's heading, every control has a label and a description, headings stay in order, the logo is decoration, and it is checked at 320 px.

Verified: unit tests for every step, the summary, that nothing offers a skip or a second run, the intro's one-time play, the animation rules in the CSS, persistence and the migration rule, and an accessibility sweep of all five steps; the live panel check drives it in real Chrome (the intro mid-play, fully visible after it, focus, no horizontal scroll at 400 and 320 px, light and dark screenshots).
Not verified: Chrome's real permission prompts from inside the set-up, and the real side panel on a first install (the live check opens the panel page as a tab).

### The key box: clearer results

The message under the key box is a success (green, with a tick) only when the key is saved and working, and an error (red, with a cross) otherwise: a mistyped key, an empty box, a declined Chrome prompt, a key Google rejects, a key kept but not usable yet (allowance used up, service not enabled), or an unreachable Google.
The tick and cross are decoration; the words carry the meaning, and the message is still announced politely.
"Save and check key" is disabled while the box holds the key that is already saved and working, since pressing it would change nothing; it enables again when the text changes, after the key is removed, or after a check that did not succeed.
Because a button that disables itself drops keyboard focus, focus moves to the key box when that happens.
The green and red are checked for contrast in both themes.

## 25. Changes before release

- **Start pasting moved down.** It is now the first button in the row at the bottom of the credits, with Back to tracks and Back to main menu, and no longer in the header (which keeps only Settings).
  It keeps the glow, is shown for a single song too, and is named for its track for screen readers.
- **Return to the main menu after 30 seconds, and only after the last track.**
  The countdown (which still holds while the panel is in use and can be turned off in Settings) starts only when the track just finished is the last one of the list that has anything to paste; after any other track the finished screen stays until the user chooses, so nobody is moved away from the next track.
  If it is not known which track was pasted (a restored panel that cannot tell), no countdown starts.
- **Programming roles in the desktop app.** See section 15: `scraper/roles.py` now types Programmer.

### Reading without tabs in the tab strip

A background read now opens its page in a minimized window of its own (`chrome.windows.create` with `state: "minimized"`, `focused: false`), which closes with its only tab, so nothing joins the user's tab strip.
If the browser will not make a window, a background tab does the same job as before.
Measured live (`npm run live:panel`, 10 tracks read three at a time): the tab count of the user's window stayed at 2 for the whole read and the credits matched the golden file, where before the strip showed up to 2 extra tabs.
Up to four windows exist at once (the user's and three minimized readers); they do not take focus.
Not observed: how the operating system shows a minimized window (on Windows a taskbar button may appear briefly), and the history entry for each song page, which is unchanged.
`live:sidepanel` now marks the first-time set-up as done first, since a fresh profile starts with it.

### Code review fixes

A review of the branch found and fixed:
- The 30-second return keys off the tracks left to paste, not their order, so pasting a later track first no longer wipes unpasted tracks.
- The countdown no longer forgets that the pointer was already over the panel when it started.
- A lookup's key problem travels with its own answer instead of a shared variable that concurrent lookups overwrote.
- A minimized reader window with no usable tab id is closed before falling back to a tab.
- Start pasting waits at most 8 seconds for a YouTube link, then starts without it.
- Lookups started by reading an album write only their track's note, so they no longer overwrite the "Got credits" summary; only Start pasting announces on the status line.
- The desktop app maps any unlisted "<X> Programming" to "<X> Programmer" too, as the extension does.

## 26. The YouTube lookup moves to YouTube's JSON endpoints

Two open-source projects were looked at: `youtube-search-api` (npm, TypeScript) and `ytscrape` (Python).
Neither is used as a dependency: the first reads like the HTML-page scraping already in the extension, so it would block the same way, and the second is Python and needs three runtime packages.
`ytscrape` is useful as a pointer: it does not read YouTube's HTML pages but calls the same JSON endpoints YouTube's own website calls (`youtubei/v1/search` and `youtubei/v1/player`).
That technique is now in the extension (`lookups/innertube.ts`), written for this project, with no new dependency.

- **What it does.** The lookup asks `POST https://www.youtube.com/youtubei/v1/search` (and `player` for a video's description) with the web client's identity and no key.
  The answers have the shape of the page data the scorer already reads (`videoRenderer`, badges, `videoDetails`), at about a third of the size of the HTML page, so the golden-tested scoring is unchanged.
- **Order.** JSON endpoints first, through the same gate (2 at a time, spaced, cool-down after repeated failures); the HTML pages only when the JSON gives nothing, so a changed endpoint does not leave the user with no lookup at all.
  With a user's API key Google's official service is still used first, as before.
- **Measured live** from the development address, which Google was already blocking for the HTML pages: 20 paced searches in a row all answered; 10 description requests all answered; the whole golden set (15 songs, about 5 requests each) found an accepted video with the right music-video flag for 15 of 15 in 29 seconds with no fallback to HTML; a 10-track album with every lookup started together was not throttled.
- **Not verified:** how long this keeps working.
  The endpoint is unofficial and the client version it expects (a constant in `innertube.ts`) will age; Google may start refusing it as it did the HTML pages.
  The permission is the same one as before (`www.youtube.com`), so the privacy policy and store text did not change.
- **A scoring bug found on the way.** The title check matched pieces of words, so "THE GREATEST" matched a video of "BIRDS OF A FEATHER" ("the" is inside "feather") and was given that video's link.
  It now matches whole words; the golden set still passes.
  The desktop app's `scraper/youtube.py` has the same check and the same bug (not changed here).
- **What album results look like.** Most tracks of a pop album have only a lyric video, a live performance and fan uploads on YouTube; the lookup skips lyric and live videos on purpose (as the desktop app does) and finds a link only for a music video or an official audio upload, so 3 of 10 tracks of the sample album got one.

### Correction: the JSON endpoints do not work from the extension

Everything measured above was done from Node, where the request carries no `Origin` header.
Inside the real extension the same `POST youtubei/v1/search` was refused with 403 on the very first request: a browser always sends the extension's own origin (`chrome-extension://...`) with a cross-origin POST, and a page script cannot change that header.
The HTML page request from the same worker still answered 200, so the refusal is specific to the JSON POST.
Consequences:
- The JSON path is switched off by default in the extension (`realYoutube` takes it only as an option), because trying it first would only add one failed request, and one failure towards the cool-down, to every lookup. The adapter and its tests stay, since the idea works from anything that is not a browser page (the desktop app's Python is such a client).
- Whole-album lookup without a key was not enabled: it would put 10 tracks' worth of page requests through the HTML path that Google blocks after a few. With a saved key it is still on.
- Ways to run the request as the website itself (making it from a youtube.com page, or rewriting the origin header) were not tried: they amount to presenting the extension as a different client to get past YouTube's refusal, which this project does not do.
- What still works in the extension: the official Data API with the user's own key (first choice), and the HTML pages for the first few lookups of a session, one track at a time.
- The whole-word title match fix is real and stays.

### The desktop app now asks YouTube's JSON endpoints too

`scraper/youtube.py` asks `youtubei/v1/search` and `youtubei/v1/player` first (a Python client has no browser origin, so YouTube answers it) and uses the HTML pages only when those give nothing, and its title check matches whole words (the "the" in "feather" bug).
Offline: the saved captures are served through both paths, so all 15 golden songs are checked through the JSON endpoints, through the HTML fallback when the endpoints answer 403, and a case where neither answers gives no link.
Live (`uv run python -m bench.lookups --only youtube`, the 15 golden songs one after another): accuracy 1.0 and music-video flag accuracy 1.0, median 1.74 s and 24.9 s in total per song set, from an address where the HTML pages had been refused.
No clean before-number exists: the HTML path was already being refused from this address (2 of 6 album tracks found), and it was not run again to avoid hammering Google.
Payload per search is about 535 KB against about 1.4 MB for the HTML page.

## 27. A YouTube link without any look-up

The look-up may find nothing, or the wrong video, and Google can refuse it, so a track's credits now have a way that always works:
- **Find on YouTube** is a plain link (new tab, `noopener`) to YouTube's own results page for "<artist> <title> official music video". Nothing is fetched by the extension, so it needs no permission and cannot be blocked.
- **A box for the link** takes whatever the user copied from YouTube: a watch link, a youtu.be link, a shorts, embed or live link, with or without the scheme or extra parameters. It is reduced to `https://www.youtube.com/watch?v=<11-character id>` (`core/youtubeLink.ts`); anything that is not a link to one YouTube video (another site, a lookalike host, a playlist, a channel, a script) is refused with a message and changes nothing.
- The link replaces any link the look-up found, is shown as "YouTube (your link)", goes into the paste queue like any other, survives the panel being closed (it is part of the session), and can be removed. If the YouTube step is turned off in Settings the section says the link will not be pasted.

## 28. A cheaper lookup on the YouTube API path

A key gives 10,000 free units a day and a search costs 100, so the number of searches per song decides how many songs a day can be looked up.
With a key, each phase (music video, then audio) now runs one query (`API_QUERIES_PER_PHASE = 1` in `background/youtube.ts`), and a phase that found no candidate at all moves on to its next query.
The audio phase still runs only when no music video was confirmed, and only the best few candidates have their descriptions read (1 unit each).
Replayed on the saved results of the 15 golden songs (`test/lookups/youtube.test.ts`): all 15 still get an accepted video with the right music-video flag, 3 searches at most, and no more than 3 songs need more than 2 (Rosalia and Frank Ocean need a retry).
That is about 2 searches for most songs, so roughly 50 songs a day instead of about 20.
The saved results are Google's HTML pages, not the API's, so the check against the real API is a script to run with your own key:

```
$env:YOUTUBE_API_KEY = "<your key>"
node scripts/live-youtube-api.mjs --limit 5
```

It runs the extension's own lookup against the golden songs, prints per song the link, whether it is accepted and the units spent, and never prints the key.
Without `--limit` it spends about 3,000 units, so run it once, not repeatedly.
Not yet run against the real API: it needs the user's key.

## 29. No track open until the user opens one

The credits screen used to open the first track's credits, so Start pasting sat below a long list of credits, a YouTube section and the paste queue.
Now no track is open when the credits arrive (`Session.current` is `null`), the track list is followed at once by the button row, and a line says to choose a track to see its credits.
- Clicking a track opens its credits, the YouTube section (with Find on YouTube and the box for a link, so a missing link can be fixed) and the paste queue; clicking it again closes them. The buttons carry `aria-expanded`.
- Start pasting with nothing open starts the first track, in album order, whose credits are in and give something to paste. With a track open it pastes that one, as before.
- A single track has no list to click, so it stays open.
- A track's YouTube link is looked up when it is opened (or on Start pasting), no longer for the first track by default. With a saved key every track is still looked up as it is read.
- A restored session whose stored open track is missing or out of range comes back with none open.

## 30. A state on every track in the list

"Ready" said nothing about whether the read found what was wanted. Each track in the credits list now has a round mark and a few words (`core/trackHealth.ts`, pure and tested):
- **All found** (green tick): credits, and each optional step the user switched on, were found.
- **Needs a look: ...** (amber `!`): the credits are empty, or the copyright lines, the cover art link or the YouTube link are missing; the words name which. A missing YouTube link counts only after a look-up came back empty, since links are looked up when a track is opened or pasted.
- **Failed** (red cross), **Reading**, **Waiting** and **No page** keep their words.
The mark is hidden from screen readers and the words carry the meaning, so colour is never the only signal. A step switched off in Settings is never reported missing. `--warn` is a new token with its contrast pairs in `test/ui/contrast.test.ts`.

## 31. Every track gets its link, and what is missing is flagged

Hands-on finding: with YouTube links looked up only for the track the user opened, the list said "All found" for tracks whose link had never been asked for.
- **Every track is looked up as its credits arrive.** With the user's key the worker spreads the asks; with YouTube's pages they go one after another, and the first refusal or failure stops the rest (those tracks say "Not checked: YouTube is limiting requests. Open this track to try again."). Opening a track, or Start pasting, still asks for it straight away and ahead of the queue. This supersedes the "looked up when opened" rule of section 29. Not yet run live against a whole album without a key; the refusal stop is what keeps it from hammering Google.
- **No "All found" while a link is still being looked for:** the track says "Finding YouTube link". A link that cannot be asked for (no permission, or the step is off) is the user's choice and is not counted missing.
- **Missing things are flagged in the credits too:** a row for the copyright, cover art or YouTube link that was not found, in amber on a tinted band with "Not found" (or the look-up's own words), so it is visible without reading the list.
- **The YouTube link section appears only when the program did not find the link** (and while it is still looking it stays hidden). A link the user gave keeps the section, so it can be taken off.

## 32. One spacing scale

Margins, paddings and gaps had drifted (6, 10, 14, 20 and 22 px next to the 4, 8, 12, 16 ones) and nested blocks added their margins together, so gaps between blocks varied from 8 to 24 px.
- `panel.css` now has five tokens, `--space-1` to `--space-5` (4, 8, 12, 16, 24 px), and every margin, padding and gap uses them; `test/ui/spacing.test.ts` fails on any raw length (the clipped screen-reader text and the 18 px checkbox the option help lines up with are the only exceptions).
- Controls (buttons, fields, summaries, queue items) are all 8 px by 12 px; cards (credits, the step to paste) 12 px; gaps inside a control 8 or 12 px.
- A block spaces itself from the block before it only once: a stack or row inside a stack, a title or a disclosure inside a stack, and the list under a help line no longer add a second margin, and the doubled gap in the track picker is gone.
Checked in a browser at 400 px wide on the credits, track picker, paste and settings screens (a throwaway preview built from the real view with sample data), not in the real side panel.

## 33. Paste next track starts by itself after 15 seconds

When a track has been pasted and another track with credits is waiting, the finished screen counts down from 15 on the "Paste next track" button and starts that track when it reaches zero, unless the user gets there first (a click, or leaving the screen, cancels it).
It waits while the pointer is over the panel or a button has focus, like the menu countdown, and only one countdown runs at a time: after the last track the 30-second return to the main menu takes over.
The countdown does not depend on the "Go back to the main menu" setting.

## 34. Three fixes from an outside review

An independent review of the extension suggested nine changes; each was checked against the code. Three were real and are done, with the failing test written first:
- **A page that never renders is a timeout.** `waitForPage` ignored the result of its wait, so a page with neither the ready marker nor the not-found view was read as an empty album. It now throws a `timeout` error (the panel already words that). The test that pinned the old "give up quietly" behaviour now expects the error.
- **Track titles stay level with their song links.** `readTrackTitles` dropped blank titles before padding, so a blank row in the middle shifted every later title onto the wrong link. It now keeps one title per row and names a blank one "Track N" by its position.
- **Every request gets an answer.** A job that threw something unplanned (a rejected key check, a failed lookup) rejected the worker's promise, and the panel was left with a closed channel. The router, and the Genius path in the worker, now turn any rejection into an `internal` error result without passing on its text.
Not done, on purpose: waiting for stable credit text, naming a bad locale file in the package validator, a slow-load warning, and an extension README (offered, not chosen); measuring the 24-tab ceiling (the default of 3 parallel reads already limits it); and extension CI, which already exists in `.github/workflows/ci.yml`.

Three more of the review's suggestions were done afterwards:
- **Stable credit text, not just a stable card count.** `waitForCredits` now compares the cards' names and roles between checks, so a card whose roles are still filling in is not read early (a test edits one card twice, the second time after the first check).
- **A bad locale file is named.** The package validator reports `_locales/<lang>/messages.json is not valid JSON` instead of crashing with a raw parse error, as it already did for `manifest.json`.
- **`extension/README.md`** gives set-up, build, check, load-unpacked, permission and packaging steps.
Still not done: the slow-load warning (credits that did not appear in time versus a track with none).

## 35. The two countdowns are settings

The seconds before the finished screen goes back to the main menu (`returnSeconds`, default 30) and before it starts the next track (`nextTrackSeconds`, default 15) are settings, in "Pasting on Genius" beside the Go-back checkbox.
- Both are whole seconds from 5 to 120; anything else stored is clamped, and anything that is not a number falls back to the default (`COUNTDOWN_RANGE` in `shared/settings.ts`).
- `nextTrackSeconds` also accepts 0, which means "do not start it by itself": the button stays, with no countdown. The return to the menu has no zero: the checkbox turns it off.
- A change applies from the next countdown; setting the next-track seconds to 0 stops one that is running. Turning off the menu return no longer stops a running next-track countdown (it used to cancel both).
- The label and the first-time set-up no longer say "30 seconds", since the number is now the user's.

## 36. Store readiness, support and CI

- **CI on GitHub.** The branch was pushed and the `extension` job ran on Linux for the first time.
  It failed on one thing the local run could not show: the saved Apple Music pages are checked out with CRLF on Windows and LF on Linux, and a DOM that computes `innerText` ran the footer's date and "23 songs" together into a count of 202223 for LF files.
  The footer reads now use its own text (a test covers both line endings, and the whole suite was also run locally against LF copies of every fixture).
  The second run passed: format, lint, types, tests, build and package.
- **Privacy.** `PRIVACY.md` and `store/listing.md` now say that the YouTube lookup runs for every track read once the user has turned it on, that video ids go to Google with a key, and that Apple Music is read in a minimized window. A test fails if the lookup or worker code hardcodes an address the policy does not name.
  `store/listing.md` has suggested answers for the dashboard's data-use questions, to check against its current wording.
- **Support.** `.github/ISSUE_TEMPLATE/` (an extension bug form that says what not to paste, an idea form, and a link to the FAQ), `extension/FAQ.md`, and weekly grouped Dependabot updates for the extension's npm packages and the workflow actions.
- **Releasing.** `extension/RELEASING.md`: version, checks, a manual pass for Chrome and Edge on Windows and macOS, the live checks kept apart, upload, and what to do after.
  There is no changelog file: release notes go in the GitHub release.
- **Store images.** `node scripts/store-assets.mjs --chrome <chrome.exe>` renders four 1280x800 screenshots and the 440x280 tile from the real panel with sample data into `store/assets/` (not committed).

## 37. Installing without the store

The extension can be used without the Chrome Web Store: a tag named `extension-v<version>` runs `.github/workflows/extension-release.yml`, which checks the tag against the version, runs the checks and the package step, and publishes a GitHub release with the zip and a checksum file.
Users download the zip, unzip it into a folder they keep, and use Load unpacked (Chrome and Edge); the steps are in the main README and `extension/README.md`.
An unpacked extension does not update itself, so an update is a new zip unzipped over the same folder plus the reload icon.

## 38. Auto-paste (planned)

Today every field needs a press of F8.
Auto-paste fills the whole track by itself once the user starts it.
Decisions from the owner:
- **Default.** Start pasting begins automatic pasting, and a smaller "Step by step (F8)" button gives the manual mode.
  F8 keeps its manual meaning, one step per press.
  A setting can make step by step the main button.
- **Pace.** A short pause per field, 0.6 seconds by default and adjustable in Settings.
  The user always starts it; it never starts by itself.
- **No exact match.** It pauses with the text typed and says so.
  The user picks the suggestion, it notices the choice, confirms the step and carries on by itself.
- **Stop triggers.** Esc, a Pause button, the panel closing, and the user clicking or typing in the form, except while it waits for a choice (then the user is expected to act).
  Switching to another tab does not pause it.
- **Next song.** After a track the next-track countdown starts, and auto resumes by itself when the next song's edit form is open and focused.
  The user only navigates.
- **Never** presses Save.
- **Later, not now.** Opening the next song's Genius page for the user, and eventually navigating Genius by itself, as its own feature with a Genius guidelines check first.

### Design

- The paste state gains an auto mode (off, running, paused with a reason, waiting for a choice).
  The step logic (`begin`, `report`, `back`, `skip`) is unchanged, and the worker stays the only writer of the position.
- The loop runs in the Genius content script, which already does the filling: after a "filled" it waits the pause, asks the worker for the next step and repeats.
- The page tells the user from itself by `isTrusted`: the extension's own events are synthetic, the user's clicks and keys are not.
  A trusted click or key in the form pauses it, unless the state is waiting for a choice.
- Resuming after a choice reuses the page's wait for the chosen suggestion to appear (`waitForChip`), then confirms the step as an F8 press would.
- The panel keeps a connection to the worker, and its disconnect pauses auto.
- Problems pause with a plain message and never skip silently: the field is not on the form, there is no form, Genius did not keep the text, a fill is still unreported after the 20 second limit, or the tab navigates, reloads or closes.
  A reload comes back paused and never resumes by itself.

### Slices

Each is tested first and committable on its own.
1. The pure state: auto mode and pause reasons, with a test for every transition.
2. The page driver: the loop, the pace, the pause on the user's input, and the choice wait and resume, against a fake form.
3. The worker messages, the panel buttons (Start, Step by step, Pause, Resume) and the status wording.
4. The pace setting and the default.
5. A live run on a Genius song the owner created (`npm run live:genius` with the scratch profile), then docs and the privacy and listing text if anything they say changes.

### Open risks

- Genius's guidelines: per-press filling was chosen to stay inside them, and full automation is more automation.
  The pace, the opt-in start and the pauses are the mitigations; check the guidelines again before release.
- Genius may change its form markup; the existing live check is the guard.
- The pause on the user's input must not fire on the extension's own typing; the `isTrusted` test and a live run cover this.

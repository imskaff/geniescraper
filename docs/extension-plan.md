# Géniescraper browser extension: requirements, architecture and plan

Status: draft for review.
Branch: `claude/advisor-opus-698934`.
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
| 8 | Deezer and YouTube lookups with optional permissions | Replays `tests/fixtures/lookups/youtube` and matches `tests/golden/youtube.json` |
| 9 | Store readiness: icons, locales, privacy policy, listing text, permission justifications, packaging script | Zip validated; manifest contract tests green |
| 10 | Edge check, Safari converter notes | Documented result |

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
  The mapping is the extension's own: `scraper/roles.py` and the golden files, shared with the desktop app, are unchanged, so the desktop app still types "Programming" (a separate task if wanted).
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

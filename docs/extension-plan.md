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
| 7 | iTunes cover lookup | Replays `tests/fixtures/lookups/covers` |
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
- Still open: a visible tab flash and history entry per scrape, the popup fallback for Safari, a CDP side panel width narrower than 320 px (not measured), and settings for the YouTube link and cover art, which have no data to act on until the lookups arrive (slices 7 and 8).

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

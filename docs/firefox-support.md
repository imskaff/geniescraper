# Firefox support: research and plan

Status: spike done, slices 1 and 2 built (build, validator, sidebar toggle); see "Spike results".
Researched on 2026-11-05 from MDN and Mozilla's Extension Workshop, plus a read of the extension's own code.

## Decisions (from the owner, 2026-11-05)

| Question                           | Decision                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Distribution                       | Listed on addons.mozilla.org (AMO). Mozilla signs the build, so it installs on normal Firefox and updates itself. |
| Panel                              | Firefox's sidebar (`sidebar_action`), the counterpart of Chrome's side panel. The UI stays one page.              |
| Oldest Firefox                     | 140 and newer. Mozilla's built-in data declaration starts there.                                                  |
| Desktop app link                   | Very low priority. Design so it can work in Firefox later; do not build or test it now.                           |
| Optional YouTube and Deezer access | In scope for the first release.                                                                                   |
| Firefox for Android                | Out of scope. Android has no sidebars and no separate windows.                                                    |

## Spike results (2026-11-05, Firefox 159.0, Windows, web-ext 10.8.0, throwaway profile)

The spike used a small probe extension (event page, sidebar, content script, Firefox manifest like ours) run with `web-ext run`.
Each line is what really happened.

| "Check" row                                                                    | Result                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background.scripts` event page                                                | Works. The page starts, runs, and answers messages and ports. Its idle unload was not measured.                                                                                                                                                                                   |
| `chrome.*` promises                                                            | Works. `chrome` and `browser` are the same object, and `chrome.storage.local.get`, `chrome.runtime.getPlatformInfo` and `chrome.runtime.sendMessage` all return promises. No shim is needed.                                                                                      |
| `storage.session` and `onChanged`                                              | Works in the event page (`set` fires `storage.session.onChanged`). `storage.session` is `undefined` in a content script, so the Genius script must keep reaching it through the worker, as it does now. `storage.sync.set` works with the gecko id present.                       |
| `scripting.registerContentScripts`, `world: "MAIN"`, `runAt: "document_start"` | Works. The script ran with `readyState` "loading" and no `body`, i.e. before the page. Pages already open at registration time are not covered (as in Chrome).                                                                                                                    |
| `windows.create` minimized, `focused: false`                                   | Works. The window was created and stayed `minimized`, `focused: false`, and its page loaded.                                                                                                                                                                                      |
| `permissions.request`                                                          | Without a user action it rejects with "may only be called from a user input handler". With a click it was not tried (see below). `permissions.getAll()` lists the install-time hosts, `data_collection` and `permissions`.                                                        |
| Install-time host prompt                                                       | Not seen: `web-ext run` installs temporarily without a prompt. To check with a real signed install.                                                                                                                                                                               |
| `sidebar_action`                                                               | The panel page loaded in the sidebar on start, connected its port (`runtime.connect`) to the worker, and `runtime.sendMessage` got its answer (`sender.url` was the extension page, as the worker checks).                                                                        |
| `action.onClicked` calling `sidebarAction.toggle()`                            | Not exercised: it needs a real toolbar click, and the machine's desktop was in use. To try by hand.                                                                                                                                                                               |
| F7 and F8 hotkeys                                                              | In a normal (headed) Firefox, F8 reached a capture-phase `keydown` listener in a content script and F7 did not: Firefox handles it first (caret browsing). A headless Firefox driven by Marionette hands F7 to the page, so the unattended check cannot test F7 and does not try. |

Other findings:

- `web-ext lint` on `dist-firefox` reports no errors and two warnings.
  One says `strict_min_version` 140 is below Firefox for Android 142, the first with `data_collection_permissions`; Android is out of scope, so it is left.
  The other says `sidePanel.setPanelBehavior` is not implemented by Firefox; the worker only calls it behind an `"sidePanel" in chrome` check.
- The panel's `isPopupSurface` check looked only for `sidePanel`, so in Firefox it would have taken the sidebar for a popup and never reported closing; it now also counts `sidebarAction`.
- Open items for the owner: the gecko id (`geniescraper@imskaff` is a proposal in `scripts/lib/firefox-manifest.mjs`) and the declared data types (placeholder `none`).

## Decisions made after the spike (2026-11-05)

### Extension id

`geniescraper@imskaff`, approved by the owner.
It is the constant `GECKO_ID` in `extension/scripts/lib/firefox-manifest.mjs`.
It can never change once the add-on is published: a different id is a different add-on, so users would lose their settings and updates.

### Data declaration

Mozilla's allowed types (from the built-in data consent page): `personallyIdentifyingInfo`, `healthInfo`, `financialAndPaymentInfo`, `authenticationInfo`, `personalCommunications`, `locationInfo`, `browsingActivity`, `websiteContent`, `websiteActivity`, `searchTerms`, `bookmarksInfo`, plus `technicalAndInteraction` (optional only) and `none`.
The page was fetched only in part; the type names above are from a summary and should be rechecked when the first upload is prepared.

Chosen: `required: ["websiteContent"]`, `optional: []`.

| What leaves the browser                                                                                              | Goes to                                                   | Mozilla type                                             |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Song and album titles, artist names and catalog ids read from the Apple Music, Spotify or Genius page the user is on | Genius, iTunes, Spotify (always, as the flow needs them)  | `websiteContent`                                         |
| The same kind of data                                                                                                | Deezer, YouTube (only when the user turns the feature on) | `websiteContent` (already declared, so no optional type) |
| Page addresses, history, accounts, personal data                                                                     | nowhere                                                   | not declared                                             |

Why not the others: `searchTerms` is for terms typed into a search engine or the browser, not for a title the extension looks up; `browsingActivity` is for pages visited, and only ids and titles leave, never addresses; `none` would be false.
The desktop link is not built for Firefox and is not declared.
PRIVACY.md carries the same reasoning.

### Unattended real-Firefox check

`extension/scripts/live-firefox.mjs` (`npm run live:firefox`) drives a headless Firefox 159.0.1 with a throwaway profile over Marionette (no geckodriver, no new dependency, no desktop input).
It installs `dist-firefox` as a temporary add-on, opens the panel page as a tab (`moz-extension://<fixed uuid>/ui/panel.html`) and the sidebar through Firefox's own sidebar controller, reads one Apple Music and one Spotify album track through the real form, watches the reader windows, and checks F8 and F9 on a real Genius page.
It found one real bug while being built: the Genius content script has no `sidebarAction`, so detecting Firefox by that API would have given the panel F9 and the Genius page F7; Firefox is now detected by its user agent, which every part has.
Not covered: a real click on the toolbar button, and the toolbar toggle itself (a user gesture; the browser chrome is not clicked), and F7 as above.

### F7 on Firefox

Firefox handles F7 (caret browsing) itself before the page sees it, so a "back" step bound to F7 would never fire there.
Spike evidence: in a headed Firefox, a capture-phase `keydown` listener in a content script received F8 but not F7.
So the default pair is per browser (`defaultHotkeys` in `src/shared/settings.ts`): F8 next and F7 back on Chrome, Edge and Safari; F9 next and F8 back on Firefox.
The two keys of a pair are never equal (tested).
Settings already saved keep their value.

## What Firefox needs, difference by difference

Each row says what the extension does today, what Firefox does, and the change.
"Check" means the documentation does not settle it (the version tables on MDN did not render when read), so the first slice tests it in a real Firefox.

| Area                              | Today (Chrome)                                                                                                                                                      | Firefox                                                                                                                                                                                                                   | Change                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Background                        | `background.service_worker`                                                                                                                                         | No service workers. A non-persistent event page runs from `background.scripts`. Firefox 121 and newer start the page even when `service_worker` is also present.                                                          | Firefox manifest uses `background.scripts: ["background/worker.js"]`. The worker already keeps no state in memory, which is what an event page needs.                                                                                            |
| Panel                             | `side_panel.default_path`, `sidePanel` permission, `chrome.sidePanel.setPanelBehavior` (`src/background/worker.ts:104`)                                             | `sidebar_action` with `default_panel`. `sidebarAction.open()` and `toggle()` work on the active window and only inside a user-action handler. A toolbar click does not open it by itself.                                 | Firefox manifest swaps the keys. The worker adds an `action.onClicked` handler that calls `sidebarAction.toggle()`. The existing `"sidePanel" in chrome` guard already lets the worker start without the Chrome API.                             |
| Extension id and data declaration | none                                                                                                                                                                | `browser_specific_settings.gecko.id` is mandatory for MV3 signing and needed by `storage.sync`. `strict_min_version: "140.0"`. New AMO submissions since 2025-11-03 must declare `data_collection_permissions`.           | Add both to the Firefox manifest. Decide the declared types from PRIVACY.md (see "AMO submission").                                                                                                                                              |
| Site access                       | Required hosts granted at install, optional hosts requested later                                                                                                   | From Firefox 127 the install prompt lists `host_permissions` and content-script hosts, but users can revoke any host access afterwards. `optional_host_permissions` and `permissions.request()` work, from a user action. | Keep the manifest hosts as they are. Add a "grant access" state in the panel for when a required host was revoked. Check how the existing optional-host switches (`src/ui/panel.ts`, `src/background/youtube.ts`, `src/lookups/http.ts`) behave. |
| Page-world script                 | `scripting.registerContentScripts` with `world: "MAIN"` and `runAt: "document_start"` (`src/background/ports.ts:78`), used by the Spotify playback guard            | `scripting` exists from 101. `persistAcrossSessions` defaults to true and scripts are cleared on an update. MDN gives no Firefox version for `world: "MAIN"` or confirmation of `document_start`.                         | Check on 140. Re-register on `runtime.onInstalled` for an update (the registration is already idempotent).                                                                                                                                       |
| Background reader window          | `chrome.windows.create({ url, state: "minimized", focused: false })` with a tab fallback (`ports.ts:49`)                                                            | `state` and `focused` exist. A minimized state cannot be combined with position or size. No platform caveat is documented.                                                                                                | Check that Firefox opens it minimized without stealing focus; the tab fallback is already there.                                                                                                                                                 |
| Namespace                         | `chrome.*` with promises                                                                                                                                            | MDN says `browser` and promises "are no longer a source of incompatibility". It does not say whether `chrome.*` returns promises.                                                                                         | Check. If not, alias `browser` to `chrome` in one place (a small shim at each entry point) rather than adding the polyfill dependency.                                                                                                           |
| Keep-alive                        | The bridge pings `runtime.getPlatformInfo` every few seconds (`ports.ts:125`)                                                                                       | Event pages unload "after a few seconds of inactivity". Message ports are said not to prevent it. An open WebSocket is not mentioned.                                                                                     | Only matters for the desktop link, which is low priority: leave it unbuilt, keep the code browser-neutral.                                                                                                                                       |
| Desktop link socket               | `ws://127.0.0.1:<port>`                                                                                                                                             | Default MV3 CSP is `script-src 'self'; upgrade-insecure-requests;`, which may upgrade `ws:` requests. Loopback is not documented as exempt.                                                                               | Check later, when the desktop link is picked up.                                                                                                                                                                                                 |
| Storage                           | `storage.sync`, `local`, `session`                                                                                                                                  | `storage.sync` needs the gecko id. `storage.session` is in memory and not visible to content scripts by default.                                                                                                          | Check `storage.session.onChanged` (used by `src/background/worker.ts:72`) and the content script's access path.                                                                                                                                  |
| Hotkeys                           | `keydown` in the Genius content script (F8 next and F7 back by default on Chrome, F9 and F8 on Firefox; F7 is caret browsing and already suppressed by the handler) | F7 opens Firefox's caret-browsing prompt too, F8 is unassigned                                                                                                                                                            | Check that the page handler stops both.                                                                                                                                                                                                          |
| Build                             | esbuild, `target: chrome120`, `dist/`                                                                                                                               | Needs `target: firefox140`, `dist-firefox/`                                                                                                                                                                               | New `--firefox` flag in `scripts/build.mjs`, same bundles.                                                                                                                                                                                       |
| Review                            | Store reviewers read the unminified output                                                                                                                          | AMO needs the source and build steps for any bundled code, and the reviewer must reproduce the build byte for byte. Default reviewer image: Ubuntu 24.04, Node 24, npm 11.                                                | A source zip plus a short README for reviewers (Node and npm versions, `npm ci`, `npm run build:firefox`). Our output is already unminified.                                                                                                     |

## Plan, in order

Each slice leaves `main` working and tested, like the Safari slices (`docs/extension-plan.md` section 25).

0. **Spike (read-only, nothing committed).**
   Build a throwaway Firefox manifest by hand, run `web-ext run --target firefox-desktop` on Windows with Firefox 140 or newer, and write down for each "Check" row above what actually happens.
   Done when: every "Check" row has a result and the plan below is corrected.
1. **Firefox build.**
   `scripts/lib/firefox-manifest.mjs`, a pure function like `safari-manifest.mjs`, plus `npm run build:firefox` into `dist-firefox/`.
   It removes `side_panel`, `sidePanel` and `minimum_chrome_version`, and adds `background.scripts`, `sidebar_action`, `browser_specific_settings.gecko` (id, `strict_min_version: "140.0"`, `data_collection_permissions`).
   Tests for the transform; the dist validator gains a Firefox mode (letters in versions stay forbidden, `gecko.id` required, no remote or inline code).
   Done when: `web-ext lint` is clean and the extension loads.
2. **Open the sidebar.**
   Toolbar click toggles the sidebar; the panel renders there; messages and the panel's port to the worker work.
   Done when: Apple and Spotify albums are read and shown in the sidebar on Firefox 140.
3. **Reads and paste.**
   Hidden reader windows, the page-world Spotify guard, the Genius content script and the paste flow, including hotkeys, work.
   Done when: the live checks used for Chrome (`live:smoke`, `live:hidden-tab`, `live:genius`) have a Firefox run, or the spike names a better harness (Playwright cannot load Firefox extensions; `web-ext run` or geckodriver can).
4. **Permissions.**
   Revoked required hosts show a grant state; the YouTube and Deezer switches ask for access and react to `onAdded` and `onRemoved`.
   Done when: tests with a fake browser cover grant, revoke and refuse, and the real flow was tried once in Firefox.
5. **CI.**
   A job runs `web-ext lint` and the Firefox build next to the existing extension job.
6. **AMO submission.**
   Listing text (reuse `extension/store/listing.md`), privacy policy link, the declared data types, the reviewer source zip and README, `web-ext sign` or the upload page, and a release workflow step for the Firefox zip.
   Needs from the owner: a Mozilla account and an AMO API key and secret stored as repository secrets (names to agree on).
7. **Docs.**
   README, FAQ, PRIVACY.md, store listing and RELEASING.md describe Firefox, its install steps and its permission differences.

Later, not in this plan: the desktop link in Firefox (keep `src/background/bridge.ts` and `src/shared/bridge.ts` free of browser specifics), Firefox for Android, Safari.

## Risks and open items

- **Version tables unverified.** Firefox versions for `world: "MAIN"`, `document_start`, `storage.session` and `chrome.*` promises were not stated in the pages read; the spike settles them on 140.
- **Data declaration.** The extension sends song titles and artists to Genius, Apple, Spotify, Deezer and YouTube, and may send page titles and addresses to the desktop app. Which `data_collection_permissions` types that maps to is a decision for slice 6, checked against PRIVACY.md and with Mozilla if unclear.
- **Review risk.** AMO may review manually and reject for build differences; the reviewer README and a lockfile build are the guard.
- **Revocable host access.** Users can revoke required hosts in Firefox, which Chrome does not offer in the same way; without slice 4 the panel would fail silently.
- **Not testable here yet.** No Firefox has been run against this extension, and the Windows machine needs Firefox 140 or newer installed.

## Sources

- MDN: `manifest.json/background`, `background_scripts`, `manifest.json/sidebar_action`, `API/sidebarAction`, `manifest.json/browser_specific_settings`, `manifest.json/host_permissions`, `manifest.json/optional_host_permissions`, `API/scripting`, `API/windows/create`, `API/storage`, `API/permissions`, `Chrome_incompatibilities`, `Content_Security_Policy`.
- Extension Workshop: Manifest V3 migration guide, built-in data consent, signing and distribution overview, source code submission, web-ext command reference, differences between desktop and Android extensions.

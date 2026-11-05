# Firefox support: research and plan

Status: plan, nothing built yet.
Researched on 2026-11-05 from MDN and Mozilla's Extension Workshop, plus a read of the extension's own code.

## Decisions (from the owner, 2026-11-05)

| Question | Decision |
|----------|----------|
| Distribution | Listed on addons.mozilla.org (AMO). Mozilla signs the build, so it installs on normal Firefox and updates itself. |
| Panel | Firefox's sidebar (`sidebar_action`), the counterpart of Chrome's side panel. The UI stays one page. |
| Oldest Firefox | 140 and newer. Mozilla's built-in data declaration starts there. |
| Desktop app link | Very low priority. Design so it can work in Firefox later; do not build or test it now. |
| Optional YouTube and Deezer access | In scope for the first release. |
| Firefox for Android | Out of scope. Android has no sidebars and no separate windows. |

## What Firefox needs, difference by difference

Each row says what the extension does today, what Firefox does, and the change.
"Check" means the documentation does not settle it (the version tables on MDN did not render when read), so the first slice tests it in a real Firefox.

| Area | Today (Chrome) | Firefox | Change |
|------|----------------|---------|--------|
| Background | `background.service_worker` | No service workers. A non-persistent event page runs from `background.scripts`. Firefox 121 and newer start the page even when `service_worker` is also present. | Firefox manifest uses `background.scripts: ["background/worker.js"]`. The worker already keeps no state in memory, which is what an event page needs. |
| Panel | `side_panel.default_path`, `sidePanel` permission, `chrome.sidePanel.setPanelBehavior` (`src/background/worker.ts:104`) | `sidebar_action` with `default_panel`. `sidebarAction.open()` and `toggle()` work on the active window and only inside a user-action handler. A toolbar click does not open it by itself. | Firefox manifest swaps the keys. The worker adds an `action.onClicked` handler that calls `sidebarAction.toggle()`. The existing `"sidePanel" in chrome` guard already lets the worker start without the Chrome API. |
| Extension id and data declaration | none | `browser_specific_settings.gecko.id` is mandatory for MV3 signing and needed by `storage.sync`. `strict_min_version: "140.0"`. New AMO submissions since 2025-11-03 must declare `data_collection_permissions`. | Add both to the Firefox manifest. Decide the declared types from PRIVACY.md (see "AMO submission"). |
| Site access | Required hosts granted at install, optional hosts requested later | From Firefox 127 the install prompt lists `host_permissions` and content-script hosts, but users can revoke any host access afterwards. `optional_host_permissions` and `permissions.request()` work, from a user action. | Keep the manifest hosts as they are. Add a "grant access" state in the panel for when a required host was revoked. Check how the existing optional-host switches (`src/ui/panel.ts`, `src/background/youtube.ts`, `src/lookups/http.ts`) behave. |
| Page-world script | `scripting.registerContentScripts` with `world: "MAIN"` and `runAt: "document_start"` (`src/background/ports.ts:78`), used by the Spotify playback guard | `scripting` exists from 101. `persistAcrossSessions` defaults to true and scripts are cleared on an update. MDN gives no Firefox version for `world: "MAIN"` or confirmation of `document_start`. | Check on 140. Re-register on `runtime.onInstalled` for an update (the registration is already idempotent). |
| Background reader window | `chrome.windows.create({ url, state: "minimized", focused: false })` with a tab fallback (`ports.ts:49`) | `state` and `focused` exist. A minimized state cannot be combined with position or size. No platform caveat is documented. | Check that Firefox opens it minimized without stealing focus; the tab fallback is already there. |
| Namespace | `chrome.*` with promises | MDN says `browser` and promises "are no longer a source of incompatibility". It does not say whether `chrome.*` returns promises. | Check. If not, alias `browser` to `chrome` in one place (a small shim at each entry point) rather than adding the polyfill dependency. |
| Keep-alive | The bridge pings `runtime.getPlatformInfo` every few seconds (`ports.ts:125`) | Event pages unload "after a few seconds of inactivity". Message ports are said not to prevent it. An open WebSocket is not mentioned. | Only matters for the desktop link, which is low priority: leave it unbuilt, keep the code browser-neutral. |
| Desktop link socket | `ws://127.0.0.1:<port>` | Default MV3 CSP is `script-src 'self'; upgrade-insecure-requests;`, which may upgrade `ws:` requests. Loopback is not documented as exempt. | Check later, when the desktop link is picked up. |
| Storage | `storage.sync`, `local`, `session` | `storage.sync` needs the gecko id. `storage.session` is in memory and not visible to content scripts by default. | Check `storage.session.onChanged` (used by `src/background/worker.ts:72`) and the content script's access path. |
| Hotkeys | `keydown` in the Genius content script (F7 and F8 by default; F7 is caret browsing and already suppressed by the handler) | F7 opens Firefox's caret-browsing prompt too, F8 is unassigned | Check that the page handler stops both. |
| Build | esbuild, `target: chrome120`, `dist/` | Needs `target: firefox140`, `dist-firefox/` | New `--firefox` flag in `scripts/build.mjs`, same bundles. |
| Review | Store reviewers read the unminified output | AMO needs the source and build steps for any bundled code, and the reviewer must reproduce the build byte for byte. Default reviewer image: Ubuntu 24.04, Node 24, npm 11. | A source zip plus a short README for reviewers (Node and npm versions, `npm ci`, `npm run build:firefox`). Our output is already unminified. |

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

# Géniescraper extension

A Chrome (Manifest V3) extension that copies song credits from Apple Music into the Genius song edit form.
It reads an Apple Music album or song page, lists the credits in a side panel, and fills the Genius form one field at a time when you press a hotkey.
It never presses Save on Genius: you check the form and save it yourself.

The desktop app in the repository root does the same job; this folder is the extension only.
The design, the decisions and the findings behind it are in [docs/extension-plan.md](../docs/extension-plan.md).

## Requirements

- Node.js 20 or newer (CI uses 24) and npm.
- Chrome or another Chromium browser with the side panel, to run it.

## Set up and build

Run these in this folder.

```bash
npm ci
```

```bash
npm run build
```

The build writes the extension to `dist/`.
The output is not minified, so a reviewer can read what ships.

## Load it in Chrome

1. Open `chrome://extensions` and switch on Developer mode.
2. Choose Load unpacked and pick the `dist` folder.
3. Click the toolbar button to open the side panel.
4. After a rebuild, press the reload icon on the extension's card.

The first time the panel opens it walks through a short set-up.

## Checks

```bash
npm run check
```

That runs, in order, the format check, lint, type check, the tests and a build.
Each can also be run alone:

| Command             | What it does                                                                      |
| ------------------- | --------------------------------------------------------------------------------- |
| `npm run format`    | Rewrites files with Prettier (`format:check` only reports).                       |
| `npm run lint`      | ESLint.                                                                           |
| `npm run typecheck` | `tsc --noEmit`.                                                                   |
| `npm test`          | Vitest: unit tests, saved Apple Music pages and the panel against a fake browser. |

The tests need no network and no browser.
They read the saved Apple Music pages in `../tests/fixtures/` and the golden files in `../tests/golden/`, which the desktop app's tests share.

### Live checks (optional)

These drive a real Chrome against the live sites, so they send real traffic and are never run by CI.
Each takes `--chrome <path to chrome.exe>` or the `CHROME_PATH` environment variable.

| Command                             | What it checks                                                  |
| ----------------------------------- | --------------------------------------------------------------- |
| `npm run live:hidden-tab`           | Reading Apple Music in a background tab.                        |
| `npm run live:panel`                | The panel against live Apple Music.                             |
| `npm run live:sidepanel`            | The side panel opening and its layout.                          |
| `npm run live:parallel`             | Reading several tracks at once.                                 |
| `npm run live:genius`               | The fill against a Genius edit form (needs you signed in).      |
| `node scripts/live-youtube-api.mjs` | The YouTube API lookup, with your own key in `YOUTUBE_API_KEY`. |

## Permissions

| Permission                                          | Why                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `storage`                                           | Settings, the working session and the optional YouTube key.      |
| `sidePanel`                                         | The panel itself.                                                |
| `scripting`                                         | Reading an Apple Music page and filling the Genius form.         |
| `genius.com`, `music.apple.com`, `itunes.apple.com` | The pages it reads and fills, and Apple's catalog for cover art. |

Three more hosts are optional and asked for in the panel only when you switch the feature on: `api.deezer.com` (cover art), `www.youtube.com` (finding a video link) and `www.googleapis.com` (finding it with your own YouTube key).
Nothing is sent to any server of ours, because there is none.
See [PRIVACY.md](PRIVACY.md).

## Package for the Chrome Web Store

```bash
npm run package
```

This builds, validates the result (manifest, icons, locale file, size, no remote or inline scripts) and writes `release/geniescraper-extension-<version>.zip`.
The zip is the same bytes every time for the same sources.
The version comes from `package.json` and must match `manifest.json`.
The store text is in [store/listing.md](store/listing.md).

## Layout

| Folder            | Contents                                                                  |
| ----------------- | ------------------------------------------------------------------------- |
| `src/apple/`      | Reading Apple Music pages (credits, titles, cover art).                   |
| `src/background/` | The service worker: hidden tabs, the paste session, covers, YouTube.      |
| `src/genius/`     | The content script that fills the Genius form.                            |
| `src/lookups/`    | YouTube, Deezer and iTunes lookups.                                       |
| `src/core/`       | Pure logic shared by the rest: the paste queue, roles, track health.      |
| `src/ui/`         | The side panel: controller, view and stylesheet.                          |
| `src/shared/`     | Messages, settings and session formats used on both sides.                |
| `scripts/`        | Build, packaging and the live checks.                                     |
| `test/`           | Tests.                                                                    |
| `data/`           | `roles.json`, the table that maps Apple Music roles to Genius role names. |

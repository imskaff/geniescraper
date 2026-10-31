# Géniescraper extension

A Chrome (Manifest V3) extension that copies song credits from Apple Music or Spotify into the Genius song edit form.
It reads an Apple Music or Spotify album or song page, lists the credits in a side panel, and fills the Genius form one field at a time when you press a hotkey.
It never presses Save on Genius: you check the form and save it yourself.

![The side panel listening for Apple Music pages, finding one, reading the album and pasting the credits automatically](../img/extension-demo.gif)

What it does:

- **Detects open pages.** The link screen listens for Apple Music and Spotify albums and songs already open in your browser and offers each in one press, labelled with its source and named from the page itself, the page you are on first.
- **Reads Spotify too.** A Spotify track or album is read from its credits box in a hidden window.
  Chrome asks for access to `open.spotify.com` the first time you press Get credits on a Spotify page, after the panel has explained why; the desktop app does not read Spotify.
  A Spotify read has no ISRC and no track release date (the panel says so), and roles are matched in English, German, Spanish, French, Portuguese, Italian, Dutch, Polish, Swedish, Turkish, Japanese, Korean and Russian; others are listed as left out.
- **Reads the credits** of a whole album at once and marks what is missing.
- **Open on Genius** finds the song on Genius (an exact title and artist match only), opens it in a new tab and presses its Edit Metadata button, then leaves the pasting to you.
  With no match, several matches, or a Genius you are not signed in to, it opens nothing and says why.
  An optional setting does this for each song when you start pasting it.
- **Auto-paste** (on by default, a switch in the panel and in Settings) fills the Genius form by itself with a short pause between fields, and pauses when you click or type in the form or press Esc.
  Step by step with a hotkey is still there.

The desktop app in the repository root does the same job; this folder is the extension only.
The design, the decisions and the findings behind it are in [docs/extension-plan.md](../docs/extension-plan.md).

## Install it (no store needed)

You do not need the Chrome Web Store, a command line or Node.js to use the extension.

1. Download `geniescraper-extension-<version>.zip` from the [Releases page](https://github.com/imskaff/geniescraper/releases).
2. Unzip it into a folder you will keep (Chrome runs the extension from there, so do not delete or move it).
3. In Chrome open `chrome://extensions` (Edge: `edge://extensions`), switch on Developer mode, click Load unpacked, and pick the folder that contains `manifest.json`.
4. Pin Géniescraper from the toolbar's puzzle-piece menu and click it to open the side panel.

To update, unzip the newest zip over the same folder and press the reload icon on the extension's card.
Chrome may show "Disable developer mode extensions" at start-up for any extension that is not from the store; keep it enabled.
The same steps are in the [main README](../README.md#browser-extension-recommended).

## Requirements (to build it yourself)

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

| Command                             | What it checks                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run live:hidden-tab`           | Reading Apple Music in a background tab.                                                                                                                                   |
| `npm run live:panel`                | The panel against live Apple Music.                                                                                                                                        |
| `npm run live:sidepanel`            | The side panel opening and its layout.                                                                                                                                     |
| `npm run live:parallel`             | Reading several tracks at once.                                                                                                                                            |
| `npm run live:genius`               | The fill against a Genius edit form (needs you signed in); `-- --mode auto` runs it automatically and checks every pause. Use the Playwright Chromium, not branded Chrome. |
| `node scripts/live-youtube-api.mjs` | The YouTube API lookup, with your own key in `YOUTUBE_API_KEY`.                                                                                                            |

## Permissions

| Permission                                          | Why                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `storage`                                           | Settings, the working session and the optional YouTube key.                                                   |
| `sidePanel`                                         | The panel itself.                                                                                             |
| `scripting`                                         | Reading an Apple Music page and filling the Genius form.                                                      |
| `genius.com`, `music.apple.com`, `itunes.apple.com` | The pages it reads and fills, Genius's own song search for Open on Genius, and Apple's catalog for cover art. |

One more host is optional and asked for only when you first press Get credits on a Spotify page, after the panel explains it: `open.spotify.com` (reading a Spotify track or album page; the extension never signs in or sends anything).
Two more are optional and asked for in the panel only when you switch the feature on: `www.youtube.com` (finding a video link) and `www.googleapis.com` (finding it with your own YouTube key).
`api.deezer.com` is a required host: it is the permanent cover fallback when Apple's catalog has no cover, and it is sent only the song title and artist.
Nothing is sent to any server of ours, because there is none.
See [PRIVACY.md](PRIVACY.md).

## Record the release animation

```bash
node scripts/release-demo.mjs --chrome <path to a Chromium or Chrome executable>
```

It plays the real side panel with sample data in one headless window (no extension, no network, no profile of yours) and joins the screenshots into `img/extension-demo.gif` in the repository root with `ffmpeg`, which must be on the PATH.
Watch it before attaching it to a release; the story is in `test/preview/demo.ts`.

## Package for the Chrome Web Store

```bash
npm run package
```

This builds, validates the result (manifest, icons, locale file, size, no remote or inline scripts) and writes `release/geniescraper-extension-<version>.zip`.
The zip is the same bytes every time for the same sources.
The version comes from `package.json` and must match `manifest.json`.
The store text is in [store/listing.md](store/listing.md).

## Layout

| Folder            | Contents                                                                     |
| ----------------- | ---------------------------------------------------------------------------- |
| `src/apple/`      | Reading Apple Music pages (credits, titles, cover art).                      |
| `src/spotify/`    | Reading Spotify pages (credits dialog, album tracks) and its role tables.    |
| `src/providers/`  | The provider interface and one module per source.                            |
| `src/background/` | The service worker: hidden tabs, the paste session, covers, YouTube, Genius. |
| `src/genius/`     | The content script that fills the Genius form.                               |
| `src/lookups/`    | YouTube, Deezer and iTunes lookups.                                          |
| `src/core/`       | Pure logic shared by the rest: the paste queue, roles, track health.         |
| `src/ui/`         | The side panel: controller, view and stylesheet.                             |
| `src/shared/`     | Messages, settings and session formats used on both sides.                   |
| `scripts/`        | Build, packaging and the live checks.                                        |
| `test/`           | Tests.                                                                       |
| `data/`           | `roles.json`, the table that maps Apple Music roles to Genius role names.    |

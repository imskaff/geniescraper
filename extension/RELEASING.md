# Releasing the extension

A release is a zip built by `npm run package` and uploaded by hand to the Chrome Web Store (and, if wanted, Microsoft Edge Add-ons).
Nothing here submits anything on its own.

## 1. Before you start

- Work on a branch, and make sure CI is green for it (the `extension` job: audit, format, lint, types, tests, build, package).
- Decide the version.
  It lives in two places that must match, `package.json` and `manifest.json`; the package check fails if they differ.
- Read `PRIVACY.md` and `store/listing.md` against what changed since the last release.
  If a new host, permission, stored value or request was added, the policy, the listing's justification table and the dashboard's data-use answers change with it.
  The tests catch a host or permission that is missing from the policy or the listing; they cannot see the dashboard.
- First release that makes `open.spotify.com` a required host (it was optional up to 0.6.2): Chrome disables an extension whose update adds a host permission until the user accepts it.
  Users updating from 0.6.2 will see the extension turned off with an "Enable" prompt in `chrome://extensions` (and a badge on the toolbar menu) until they accept the new Spotify access.
  Say so in the release notes and the store's "What's new", and expect a drop in active users until people re-enable it.
  Unpacked (manual) installs are unaffected: reloading the folder applies the manifest.
  Re-check the dashboard's data-use answers and the single-purpose text at the same time.

## 2. Build and check

Run these in the `extension` folder.

```bash
npm ci
```

```bash
npm run check
```

```bash
npm run package
```

The package step builds again, validates the result and writes `release/geniescraper-extension-<version>.zip`.
The same sources give the same bytes, so you can compare a zip with the one CI built.

## 3. Test the real build

Unit tests use fakes, so a release needs one pass in real browsers.
Load the built `dist/` folder as an unpacked extension (`chrome://extensions` or `edge://extensions`, Developer mode, Load unpacked), then work through the list below in each cell of the matrix.

| Browser | Windows | macOS |
| ------- | ------- | ----- |
| Chrome  | [ ]     | [ ]   |
| Edge    | [ ]     | [ ]   |

The macOS workflow (`.github/workflows/macos.yml`, weekly and on demand) runs the extension's tests and a live smoke check in Chrome and Edge on a real Mac, and compiles the Safari build. It covers the reading of Apple Music, the credits and the paste screen on macOS, so on a Mac only the signed-in Genius pass and the keys need doing by hand.

At least one cell per release, Chrome on Windows first; do the others when the change touches browser-specific behaviour (windows, the side panel, permissions, hotkeys).

The pass, using a public album with several tracks and a Genius song you can open the edit form for:

1. The toolbar button opens the side panel, and the first-time set-up shows on a fresh profile.
2. Paste an album link: the tracks list, with the album name and track count.
3. Select all and get credits: tracks show "All found" or "Needs a look" with the missing item named, and no Apple Music window stays open afterwards.
4. Open a track: credits, cover link and paste queue are right; a track with no YouTube link shows the box for pasting one.
5. Start pasting with the Genius edit form open: it fills every field by itself, pausing between fields, and nothing is saved for you.
   Check each way it should stop and resume: click in the form (it pauses), Esc and the Auto-paste switch (ON glows, OFF is gray and lights up on hover), closing the panel, a name Genius has no exact match for (it waits, then carries on after you choose), and turning Auto-paste back on.
   Then Step by step: the fill key fills one field per press, and Back and Skip work.
6. Finish a track: the next-track countdown runs and starts the next one; after the last track the menu countdown returns to the main menu.
7. Settings: change a setting, close and reopen the panel, and see it kept; the YouTube hosts ask Chrome for permission only when switched on, and can be taken back.
   There is no Deezer option: Deezer is a required host and the permanent cover fallback.
   Spotify: open a Spotify track in a tab with something else playing and check the open-pages card names the page, not the playing song; press Get credits on a Spotify album and check that no permission card or Chrome prompt appears, then the track list and the credits with their "About this read" notes; a Spotify song has a cover (from Apple's catalog or Deezer) but no ISRC or track release date.
8. Reload the extension on the extensions page and reopen the panel: the session is restored, nothing breaks.
9. Edge only: the side panel and F-key suppression behave the same as in Chrome.

Write down the date, the browser and system versions, the extension version and anything odd, in the release notes or the pull request.

### Live checks (optional, not part of `npm run check`)

These send real traffic to Apple Music, Genius and YouTube, so run them sparingly and never in a loop.
`npm run live:panel`, `live:sidepanel`, `live:hidden-tab`, `live:parallel` and `live:genius`, and `node scripts/live-youtube-api.mjs` with your own key.
See the [README](README.md) for what each does and how to point it at Chrome.
CI also runs the repository's live Apple Music tests weekly, apart from pushes, so markup changes show up without blocking work.

## 4. Publish a GitHub release (installable without the store)

Pushing a tag named `extension-v<version>` runs `.github/workflows/extension-release.yml`: it checks the tag matches the version, runs `npm run check` and `npm run package`, and publishes a release with the zip and `SHA256SUMS.txt` attached, with GitHub's generated notes since the previous extension release, listing each change as its title and pull request number, without author names.
The workflow stops with a message if the tag and the version differ.

```bash
git tag extension-v0.6.2
```

```bash
git push origin extension-v0.6.2
```

Do this from the commit you tested, after it is on `main`.
Edit the release's notes on GitHub afterwards to say, in plain words, what changed for users: that is where release notes live.
Users install from that release with the steps in the [README](README.md#install-it-no-store-needed).

## 5. Upload to the Chrome Web Store (optional)

1. Chrome Web Store developer dashboard: upload the zip as a new version.
2. Fill the listing from `store/listing.md`: short and detailed description, category, single purpose, permission justifications and the data-use answers.
3. Privacy policy: the public address of `PRIVACY.md` on the default branch.
4. Add the screenshots and the promotional tile.
5. Submit for review, and wait for the result before telling anyone it is live.

## 6. After it is live

- Tag the commit that was uploaded with the version, and publish a GitHub release whose notes list what changed for users, in plain words.
  The notes live in the release, not in a changelog file in the repository.
- Check the listing in the store once, installed from the store itself, with the "pass" above in one browser.
- If a problem is found, the fix is a new version: a store release cannot be edited in place.

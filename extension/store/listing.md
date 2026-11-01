# Chrome Web Store listing: Géniescraper

Text and answers to paste into the Chrome Web Store developer dashboard.
Keep them in step with `manifest.json` and `PRIVACY.md`: a test checks the permission list below against the manifest.

## Name

Géniescraper

## Short description (132 characters at most)

Copy Apple Music song credits into the Genius song edit form, one field at a time.

## Category

Productivity

## Detailed description

Géniescraper copies the credits of an Apple Music or Spotify song into the Genius song edit form, so you do not have to type them.

How it works:

1. Open the side panel and paste an Apple Music album or song link (or open the page and the panel offers it; the Apple Music albums and songs you already have open are listed to pick from).
2. Choose the tracks you want, and review the credits the extension read.
3. Open the song's Edit Metadata form on Genius and press Start pasting: the extension fills the fields by itself, one after another.
   Open on Genius finds the song and opens that form for you (exact title and artist only; with no match or several, it stops and tells you).
   Prefer to stay in control? Step by step fills one field per key press (F8), F7 goes back, and the panel can skip a step.

What it fills: writers, producers, other roles and their artists, the phonographic and copyright lines, the label and distributor when the phonographic line makes them clear, a YouTube link, and the cover art link.
Roles are entered under the names Genius uses.

You stay in control:

- It never presses Save on Genius. You check the form and save it yourself.
- It stops the moment you click or type in the form, press Esc or turn Auto-paste off, or close the panel, and you switch it back on when you are ready.
- When Genius has no exact match for a name it leaves the text for you to choose, then carries on after you do.
- Hotkeys, what to include, and more are in Settings.

Optional extras, off until you turn them on (Chrome asks first):

- YouTube links, found by searching YouTube, or through Google's official YouTube service if you add your own free key. The set-up has one optional YouTube step; allowing it, or saving a key, turns the link on, and skipping it leaves it off. The panel walks you through getting a key.

Private by design: no accounts, no analytics, no tracking. Song titles and artists are sent only to the services above when you use them; Deezer is asked for a cover, with only the title and artist, when Apple's catalog has none.

Géniescraper is not affiliated with Apple or Genius.

## Single purpose

Copy song credits from Apple Music or Spotify into the Genius song edit form.

## Permission justifications

| Permission                                   | Justification to enter                                                                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                    | Saves the user's settings, and keeps the album and credits being worked on while the side panel is closed and reopened.                                                                                           |
| `scripting`                                  | Reads the credits from the Apple Music page the user asked for, in a minimized browser window (or a background tab), by running the extension's own reader there.                                                 |
| `sidePanel`                                  | The extension's main screen is a side panel, so it stays beside the Genius form while the user pastes.                                                                                                            |
| Host `https://music.apple.com/*`             | Reads the credits of the Apple Music album or song the user gave.                                                                                                                                                 |
| Host `https://genius.com/*`                  | Fills the fields of the Genius song edit form when the user presses the Next key, and, when the user presses Open on Genius, searches Genius for the song and opens its page and Edit Metadata form. Never saves. |
| Host `https://itunes.apple.com/*`            | Finds the exact cover art for the song from Apple's public catalog.                                                                                                                                               |
| Host `https://api.deezer.com/*`              | Cover-art fallback when Apple's catalog has none (always so for Spotify); only the song title and artist are sent, and only when Apple's search found nothing.                                                    |
| Host `https://open.spotify.com/*`            | Reads the credits of the Spotify track or album page the user picks, in a minimized window, and lists the user's open Spotify pages; nothing read from it is sent anywhere.                                       |
| Optional host `https://www.youtube.com/*`    | Finds a YouTube link for the song; requested only when the user turns it on.                                                                                                                                      |
| Optional host `https://www.googleapis.com/*` | Finds the YouTube link through Google's official service with the user's own key; requested only when the user adds a key.                                                                                        |

## Companion desktop app (no extra permission)

Optional. If the user pairs the Géniescraper desktop app, the extension's service worker opens a WebSocket to `ws://127.0.0.1` (the user's own computer) and runs the same paste engine from the desktop app's commands.
A WebSocket to the local machine needs no host permission, so none is requested, and the manifest declares no loopback address.
The user pairs once with a short code; nothing connects before that; the link never leaves the computer and carries no Genius page content.
While paired and connected, the worker also sends the desktop app the titles and addresses of the user's open Apple Music album and song pages (at most 20), so the app can list them. It reads them with the `music.apple.com` host access the extension already has, so no permission is added; nothing else is sent, and nothing goes anywhere but the user's own computer.
Enter this in the privacy practices tab as: no data sent to servers, local-only link to the user's own desktop app.

## Remote code

No. All code ships in the package; nothing is downloaded and run.

## Data usage disclosures

The developer receives nothing: there is no server, account or analytics.
The dashboard asks about data the extension handles, which includes text it sends to a service the user turned on, so answer with that in mind.
Suggested answers (check them against the dashboard's current wording at submission; the dashboard decides what counts as "collected"):

- Personally identifiable information, health, financial, personal communications, location, web history, user activity: not collected.
- Authentication information: the optional YouTube key is typed in by the user, stored only on their device and sent only to Google, in a request header, to look up a link. If the dashboard counts that as handled, tick it and say "to give the user the feature they turned on".
- Web history: not collected. The titles and addresses of the Apple Music pages the user has open are sent only to the user's own desktop app on the same computer, and only if they paired it.
- Website content: song titles, artist names and credits are read from the Apple Music or Spotify page the user asked for, and the title and artist are sent to iTunes (always), to Genius (only when the user presses Open on Genius or turns on opening each song before pasting), and to Deezer, YouTube and Google (only when the user turns those on), to find a cover, a link or the song's Genius page. Tick it if the dashboard counts text sent to those services, with the purpose "core functionality".
- Certifications: not sold or transferred to third parties apart from the requests above, which the user asked for; not used for anything unrelated to the single purpose; not used for creditworthiness or lending.

## Privacy policy

https://github.com/imskaff/geniescraper/blob/main/extension/PRIVACY.md

The repository is public, and the address is stable once the file is on the `main` branch.

## Support

- Support site and contact: https://github.com/imskaff/geniescraper/issues
- Questions and fixes for common problems: https://github.com/imskaff/geniescraper/blob/main/extension/FAQ.md
- The issue form tells people not to paste their YouTube key, cookies or account details.

## Images

Made by `node scripts/store-assets.mjs --chrome <chrome.exe>` into `store/assets/` (not committed); look at each one before uploading.
They show the real panel with sample data, and no Apple or Genius logos.
The store icon (128x128) is already in `icons/`.

| File                   | Alt text to enter                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1-credits-list.png     | The side panel listing two tracks, each marked with whether all its credits were found.                                             |
| 2-track-credits.png    | One track's credits opened: songwriters, producers, copyright lines, cover art and a YouTube link, and the paste queue.             |
| 3-paste.png            | The paste screen showing step 1 of 11, the value to fill, and the Auto-paste, Next, Previous and Skip controls.                     |
| 4-settings.png         | The settings screen: checkboxes for what to paste, the keys that fill the next step and go back, and the Genius suggestion options. |
| promo-tile-440x280.png | The Géniescraper icon and the words "Apple Music credits, into the Genius form".                                                    |

# Géniescraper extension: privacy policy

Last updated: 2026-10-30.

Géniescraper copies song credits from Apple Music into the Genius song edit form.
This page says exactly what the extension does with data.
The short version: it collects nothing, has no accounts, no analytics and no servers of its own.

## What the extension handles

- **Pages you are viewing.**
  It reads the credits (songwriters, producers, other roles, copyright lines, title, artist) of the Apple Music album or song page you give it, and it fills fields on the Genius song edit form that you have open.
  It reads and fills only while you ask it to, and it never presses Save on Genius: you check the form and save it yourself.
- **Your settings.**
  Which credits to include, hotkeys, and similar choices are stored with `chrome.storage.sync`, so Chrome may sync them across your own browsers through your Google account.
  They contain no personal data.
- **Your working session.**
  The album, the tracks you picked and their credits are kept in `chrome.storage.session`.
  That area lives in memory in your browser and is cleared when the browser closes.
- **Your own YouTube key (optional).**
  If you choose to add a YouTube Data API key, it is stored in `chrome.storage.local`, on this device only.
  It is never synced and never shown back in full.
  You can remove it in Settings at any time.
- **Update notice (optional, off by default).**
  If you turn on "Check for updates", the extension keeps a small record in `chrome.storage.local`, on this device only: when it last looked, the newest extension version it found, and whether you chose "Later" or "Skip this version".
  It contains nothing about you.

## What leaves your browser

The extension sends song titles and artist names (public text from the page you are viewing) to these services, and nothing else:

| Service              | When                                                                                                                                                   | What is sent                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `itunes.apple.com`   | Always, to find the exact cover art                                                                                                                    | The Apple Music catalog id of the album or song, or the song title and artist                       |
| `api.deezer.com`     | Only if you tick "Search Deezer for a cover" and allow Chrome's permission prompt                                                                      | Song title and artist                                                                               |
| `www.youtube.com`    | Only if you tick "Find a YouTube link" and allow Chrome's permission prompt. Then it happens for every track whose credits are read, one after another | Search terms made of the song title and artist, and the id of candidate videos                      |
| `api.github.com`     | Only if you tick "Check for updates" and allow Chrome's permission prompt. Then at most once a day, and only while the panel is open                   | Nothing about you or your songs: a plain request for the project's public list of releases          |
| `www.googleapis.com` | Only if you add your own YouTube key and allow Chrome's permission prompt. Then it happens for every track whose credits are read                      | Search terms (song title and artist), the id of candidate videos, and your key, in a request header |

The update check only reads the project's public releases list, to compare the newest extension version with the installed one; the extension then shows a notice with a link, and never downloads or installs anything.
Requests carry no cookies and no referrer.
Apple Music pages are opened in a minimized window of your own browser (a background tab if that is not possible), as if you had visited them, and closed again when read.
Because that is a real visit, Apple Music sees it as it would see any visit from your browser, including any cookies you already have for it; the extension reads only the page's public credits text.
The side panel also lists the Apple Music album and song pages you already have open (their addresses and titles, read from your own tabs with the access to `music.apple.com` the extension already has), so you can pick one.
That list stays in the panel; it is not stored and not sent anywhere, except to your own desktop app on your own computer if you have paired it (see below).
If you add the optional YouTube link by pasting one yourself, nothing is sent anywhere: the link is only copied into the Genius form.
The extension does not send anything to the developer or to any other party.
The one other place it can talk to is the optional desktop app on your own computer, described next.

## The optional desktop app on your own computer

If you also run the Géniescraper desktop app and pair the two, the extension opens a connection to `127.0.0.1` (your own computer, never another machine) and nothing else.
You pair once by typing a short code the desktop app shows; the extension then keeps a secret in `chrome.storage.local`, on this device only, never synced, and uses it only to prove to the desktop app that it is you (the secret itself is never sent again).
Over that connection the desktop app sends the list of credits to paste (the same text you would see in the side panel) and commands such as fill next, back, skip and pause.
The extension sends back only where the paste stands: a step count, whether it is running or paused, and its own plain status message.
It also tells the desktop app which Apple Music album and song pages are open in your browser, so the app can list them for you to pick from: the title and address of each such page (at most 20), whether it is the one you are looking at, and nothing else.
It sends this list when the link is made and again when your open pages change, and only to the desktop app on your own computer; it does not list or send any other tab.
It does not send the Genius page's content, your Genius account, cookies, passwords or anything else, and the desktop app never sees your Genius sign-in: you stay signed in in your own browser.
Nothing on this connection leaves your computer, and the extension never connects until you pair.
You can unpair at any time, which deletes the secret.

## What the extension does not do

- It does not collect, store or transmit personal data, browsing history, or anything about you.
- It has no analytics, telemetry, advertising or tracking.
- It does not sell or share data, and it does not use data for purposes unrelated to its single purpose.
- It does not load or run code from the internet: everything it runs ships in the package.
- It does not read other sites: its access is limited to `music.apple.com`, `genius.com` and the services above.
- It does not accept connections from the internet or from web pages: the link to the desktop app is one the extension opens itself, to your own computer, after you paired it.

## Your control

- The optional services are off until you turn them on in Settings, and Chrome asks for each permission.
  You can take any of them back in Settings or in `chrome://extensions`.
- Removing the extension removes its stored settings and key.

## Changes and contact

If this policy changes, the new text will be in this file with a new date.
Questions can be raised as an issue on the project's repository.

# Géniescraper extension: privacy policy

Last updated: 2026-10-31.

Géniescraper copies song credits from Apple Music or Spotify into the Genius song edit form.
This page says exactly what the extension does with data.
The short version: it collects nothing, has no accounts, no analytics and no servers of its own.

## What the extension handles

- **Pages you are viewing.**
  It reads the credits (songwriters, producers, other roles, copyright lines, title, artist) of the Apple Music or Spotify album or song page you give it, and it fills fields on the Genius song edit form that you have open.
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

## What leaves your browser

The extension sends song titles and artist names (public text from the page you are viewing) to these services, and nothing else:

| Service              | When                                                                                                                                                   | What is sent                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `itunes.apple.com`   | Always, to find the exact cover art                                                                                                                    | The Apple Music catalog id of the album or song, or the song title and artist                          |
| `genius.com`         | Only when you press "Open on Genius", or have "Open each song on Genius before pasting it" ticked and start pasting a song                             | Search terms made of the song title and artist, to find the song's Genius page. No cookies, no sign-in |
| `api.deezer.com`     | Only when Apple's catalog has no cover for the song (always so for a Spotify link). A required permission, not a setting                               | Song title and artist                                                                                  |
| `www.youtube.com`    | Only if you tick "Find a YouTube link" and allow Chrome's permission prompt. Then it happens for every track whose credits are read, one after another | Search terms made of the song title and artist, and the id of candidate videos                         |
| `www.googleapis.com` | Only if you add your own YouTube key and allow Chrome's permission prompt. Then it happens for every track whose credits are read                      | Search terms (song title and artist), the id of candidate videos, and your key, in a request header    |

The Genius search needs no extra permission: the extension already has access to `genius.com` to fill the edit form.
When exactly one Genius song matches the title and artist, the extension opens that song's page in a new tab of your own browser and presses its Edit Metadata button, which is the only button it presses outside the form; it never presses Save or Cancel.
With none or several matching songs it opens nothing and tells you.
Requests carry no cookies and no referrer.
The credits of a Spotify page are read from `open.spotify.com`, which is an optional permission: Chrome asks for it the first time you pick a Spotify page, after the panel has explained what will happen, and you can refuse it, or take it back at any time in `chrome://extensions`.
Then the extension opens that Spotify page in a minimized window of your own browser, with `?locale=en` added to its address so that Spotify answers in English (this changes nothing in your Spotify account or cookies and does not affect your own Spotify tabs; Spotify does not document the parameter, and if it stops working the extension reads the page in your language with its own lists of role words), presses the page's own "View credits" button for you, reads the names and roles in the box that opens, and closes the window.
It reads only that credits box and the page's title, artist and copyright lines, and the text stays in your browser.
Spotify sees this as a visit from your browser, including any cookies you already have for it, so if you are signed in to Spotify in that browser the page is the one you would see.
The extension never signs in, never types a password, and never reads your library, playlists or account.
Spotify pages are read one at a time with a pause between them, and reading stops for a while if Spotify shows a captcha.
Spotify's credits box does not show the song's release date or ISRC, so the extension does not fill them from Spotify, and the panel says so beside the credits.
Apple Music pages are opened in a minimized window of your own browser (a background tab if that is not possible), as if you had visited them, and closed again when read.
Because that is a real visit, Apple Music sees it as it would see any visit from your browser, including any cookies you already have for it; the extension reads only the page's public credits text.
The side panel also lists the Apple Music album and song pages you already have open (their addresses and titles, read from your own tabs with the access to `music.apple.com` the extension already has), so you can pick one.
Once you have allowed Spotify, it lists your open Spotify track and album pages the same way, labelled with their source.
Spotify rewrites a tab's title to the song that is playing, so for those tabs the extension reads the page's own heading (title and artists) with a small script run in the tab; the text stays in the panel and is not stored or sent.
That list stays in the panel; it is not stored and not sent anywhere, except to your own desktop app on your own computer if you have paired it (see below).
If you add the optional YouTube link by pasting one yourself, nothing is sent anywhere: the link is only copied into the Genius form.
The extension does not send anything to the developer or to any other party.
The one other place it can talk to is the optional desktop app on your own computer, described next.

## The optional desktop app on your own computer

If you also run the Géniescraper desktop app and pair the two, the extension opens a connection to `127.0.0.1` (your own computer, never another machine) and nothing else.
You pair once by typing a short code the desktop app shows; the extension then keeps a secret in `chrome.storage.local`, on this device only, never synced, and uses it only to prove to the desktop app that it is you (the secret itself is never sent again).
Over that connection the desktop app sends the list of credits to paste (the same text you would see in the side panel) and commands such as fill next, back, skip and pause.
The extension sends back only where the paste stands: a step count, whether it is running or paused, and its own plain status message.
It also tells the desktop app which Apple Music album and song pages are open (Spotify pages are not sent: the desktop app cannot read them) in your browser, so the app can list them for you to pick from: the title and address of each such page (at most 20), whether it is the one you are looking at, and nothing else.
It sends this list when the link is made and again when your open pages change, and only to the desktop app on your own computer; it does not list or send any other tab.
It does not send the Genius page's content, your Genius account, cookies, passwords or anything else, and the desktop app never sees your Genius sign-in: you stay signed in in your own browser.
Nothing on this connection leaves your computer, and the extension never connects until you pair.
You can unpair at any time, which deletes the secret.

## What the extension does not do

- It does not collect, store or transmit personal data, browsing history, or anything about you.
- It has no analytics, telemetry, advertising or tracking.
- It does not sell or share data, and it does not use data for purposes unrelated to its single purpose.
- It does not load or run code from the internet: everything it runs ships in the package.
- It does not read other sites: its access is limited to `music.apple.com`, `genius.com`, `open.spotify.com` (only after you allow it) and the services above.
- It does not accept connections from the internet or from web pages: the link to the desktop app is one the extension opens itself, to your own computer, after you paired it.

## Your control

- The optional services are off until you turn them on in Settings, and Chrome asks for each permission.
  You can take any of them back in Settings or in `chrome://extensions`.
- Removing the extension removes its stored settings and key.

## Changes and contact

If this policy changes, the new text will be in this file with a new date.
Questions can be raised as an issue on the project's repository.

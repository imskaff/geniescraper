# Géniescraper extension: privacy policy

Last updated: 2026-10-28.

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

## What leaves your browser

The extension sends song titles and artist names (public text from the page you are viewing) to these services, and nothing else:

| Service              | When                                                                              | What is sent                                                                   |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `itunes.apple.com`   | Always, to find the exact cover art                                               | The Apple Music catalog id of the album or song, or the song title and artist  |
| `api.deezer.com`     | Only if you tick "Search Deezer for a cover" and allow Chrome's permission prompt | Song title and artist                                                          |
| `www.youtube.com`    | Only if you tick "Find a YouTube link" and allow Chrome's permission prompt       | Search terms made of the song title and artist, and the id of candidate videos |
| `www.googleapis.com` | Only if you add your own YouTube key and allow Chrome's permission prompt         | Search terms (song title and artist) and your key, in a request header         |

Requests carry no cookies and no referrer.
Apple Music pages are opened in a background tab of your own browser, as if you had visited them.
The extension does not send anything to the developer or to any other party.

## What the extension does not do

- It does not collect, store or transmit personal data, browsing history, or anything about you.
- It has no analytics, telemetry, advertising or tracking.
- It does not sell or share data, and it does not use data for purposes unrelated to its single purpose.
- It does not load or run code from the internet: everything it runs ships in the package.
- It does not read other sites: its access is limited to `music.apple.com`, `genius.com` and the services above.

## Your control

- The optional services are off until you turn them on in Settings, and Chrome asks for each permission.
  You can take any of them back in Settings or in `chrome://extensions`.
- Removing the extension removes its stored settings and key.

## Changes and contact

If this policy changes, the new text will be in this file with a new date.
Questions can be raised as an issue on the project's repository.

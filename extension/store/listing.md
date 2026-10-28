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

Géniescraper copies the credits of an Apple Music song into the Genius song edit form, so you do not have to type them.

How it works:

1. Open the side panel and paste an Apple Music album or song link (or open the page and the panel offers it).
2. Choose the tracks you want, and review the credits the extension read.
3. Press Start pasting, open the song's Edit Metadata form on Genius, and press F8 to fill one field at a time.
   F7 goes back and the panel can skip a step.

What it fills: writers, producers, other roles and their artists, the phonographic and copyright lines, a YouTube link, and the cover art link.
Roles are entered under the names Genius uses.

You stay in control:

- It never presses Save on Genius. You check the form and save it yourself.
- It fills one field per key press, and when Genius has no exact match for a name it leaves the text for you to choose.
- Hotkeys, what to include, and more are in Settings.

Optional extras, off until you turn them on (Chrome asks first):

- A cover-art fallback from Deezer.
- YouTube links, found by searching YouTube, or through Google's official YouTube service if you add your own free key. The panel walks you through getting one.

Private by design: no accounts, no analytics, no tracking. Song titles and artists are sent only to the services above when you use them.

Géniescraper is not affiliated with Apple or Genius.

## Single purpose

Copy song credits from Apple Music into the Genius song edit form.

## Permission justifications

| Permission                                   | Justification to enter                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                    | Saves the user's settings, and keeps the album and credits being worked on while the side panel is closed and reopened.                                           |
| `scripting`                                  | Reads the credits from the Apple Music page the user asked for, in a minimized browser window (or a background tab), by running the extension's own reader there. |
| `sidePanel`                                  | The extension's main screen is a side panel, so it stays beside the Genius form while the user pastes.                                                            |
| Host `https://music.apple.com/*`             | Reads the credits of the Apple Music album or song the user gave.                                                                                                 |
| Host `https://genius.com/*`                  | Fills the fields of the Genius song edit form when the user presses the Next key. Never saves.                                                                    |
| Host `https://itunes.apple.com/*`            | Finds the exact cover art for the song from Apple's public catalog.                                                                                               |
| Optional host `https://api.deezer.com/*`     | Cover-art fallback; requested only when the user turns it on.                                                                                                     |
| Optional host `https://www.youtube.com/*`    | Finds a YouTube link for the song; requested only when the user turns it on.                                                                                      |
| Optional host `https://www.googleapis.com/*` | Finds the YouTube link through Google's official service with the user's own key; requested only when the user adds a key.                                        |

## Remote code

No. All code ships in the package; nothing is downloaded and run.

## Data usage disclosures

The developer receives nothing: there is no server, account or analytics.
The dashboard asks about data the extension handles, which includes text it sends to a service the user turned on, so answer with that in mind.
Suggested answers (check them against the dashboard's current wording at submission; the dashboard decides what counts as "collected"):

- Personally identifiable information, health, financial, personal communications, location, web history, user activity: not collected.
- Authentication information: the optional YouTube key is typed in by the user, stored only on their device and sent only to Google, in a request header, to look up a link. If the dashboard counts that as handled, tick it and say "to give the user the feature they turned on".
- Website content: song titles, artist names and credits are read from the Apple Music page the user asked for, and the title and artist are sent to iTunes (always) and to Deezer, YouTube and Google (only when the user turns those on), to find a cover or a link. Tick it if the dashboard counts text sent to those services, with the purpose "core functionality".
- Certifications: not sold or transferred to third parties apart from the requests above, which the user asked for; not used for anything unrelated to the single purpose; not used for creditworthiness or lending.

## Privacy policy

Link to `extension/PRIVACY.md` in the project's repository (any public URL for that file will do).

## Assets still to prepare by hand

- At least one 1280x800 or 640x400 screenshot of the side panel, a small promotional tile (440x280), and a store icon (128x128, already in `icons/`).
- Do not use Apple or Genius logos.
